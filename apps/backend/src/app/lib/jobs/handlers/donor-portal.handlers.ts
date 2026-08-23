import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { logger } from '../../../logger';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { notificationEnabled } from '../../profile-preferences';
import { publicOrgName } from '../../public-tenant';
import { DonorPortalController } from '../../../modules/donor-portal/controller';
import { donorPortalUrl } from '../../../modules/donor-portal/portal-url';
import type { JobPayloadOf } from '../job-payloads';

/**
 * The self-request path's second half. The public route already answered an identical 200 —
 * whether this job finds a person decides only what happens NEXT, invisibly to the requester:
 * a match gets a fresh giving-portal link by email; no match ends here, silently.
 */
export async function handleSendDonorPortalLink(
  job: JobPayloadOf<'send-donor-portal-link'>,
  db: Kysely<Models>,
): Promise<void> {
  const email = job.email.trim().toLowerCase();
  if (!email) return;

  const candidates = await db
    .selectFrom('persons')
    .select(['id', 'first_name'])
    .where('tenant_id', '=', job.tenant_id)
    .where('deceased_at', 'is', null)
    .where((eb) => eb.or([eb(eb.fn('lower', ['email']), '=', email), eb(eb.fn('lower', ['email2']), '=', email)]))
    .orderBy('created_at', 'desc')
    .execute();
  if (candidates.length === 0) return; // deliberate silence — see the doc comment

  // Several people can share an address line; prefer the one who has actually given.
  let person = candidates[0];
  if (candidates.length > 1) {
    const withGift = await db
      .selectFrom('donations')
      .select('person_id')
      .where('tenant_id', '=', job.tenant_id)
      .where(
        'person_id',
        'in',
        candidates.map((c) => String(c.id)),
      )
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (withGift?.person_id) {
      person = candidates.find((c) => String(c.id) === String(withGift.person_id)) ?? person;
    }
  }
  if (!person) return;

  const tenant = await db.selectFrom('tenants').select('slug').where('id', '=', job.tenant_id).executeTakeFirst();
  if (!tenant?.slug) return;

  const controller = new DonorPortalController();
  const minted = await controller.mintLink(job.tenant_id, String(person.id), null);
  const url = donorPortalUrl(String(tenant.slug), minted.token);
  const orgName = await publicOrgName(job.tenant_id);

  const mail = new TransactionalEmailService();
  await mail.sendMail({
    to: email,
    subject: `Your giving page for ${orgName}`,
    text: `Hi ${person.first_name || 'there'},\n\nHere is your personal giving page for ${orgName} — your giving history, receipts, and monthly gift settings:\n\n${url}\n\nIf you didn't ask for this link, you can ignore this email.`,
    html: `<p>Hi ${person.first_name || 'there'},</p>
<p>Here is your personal giving page for ${orgName} — your giving history, receipts, and monthly gift settings:</p>
<div class="btn-container"><a href="${url}" class="btn">Open your giving page</a></div>
<p>If you didn't ask for this link, you can ignore this email.</p>`,
    tenant_id: job.tenant_id,
    audience: 'contact',
  });
}

/**
 * A pledge was cancelled (by the donor on their giving page, or via a Stripe-side cancellation).
 * Bell + email to every active admin/owner, each half behind that user's own
 * donor_pledge_cancelled / donor_pledge_cancelled_in_app preference.
 */
export async function handleNotifyDonorPledgeCancelled(
  job: JobPayloadOf<'notify-donor-pledge-cancelled'>,
  db: Kysely<Models>,
): Promise<void> {
  const pledge = await db
    .selectFrom('donation_pledges')
    .leftJoin('persons', 'persons.id', 'donation_pledges.person_id')
    .select([
      'donation_pledges.monthly_amount',
      'donation_pledges.person_id',
      db.fn.coalesce('persons.first_name', 'donation_pledges.first_name').as('first_name'),
      db.fn.coalesce('persons.last_name', 'donation_pledges.last_name').as('last_name'),
    ])
    .where('donation_pledges.tenant_id', '=', job.tenant_id)
    .where('donation_pledges.id', '=', job.pledge_id)
    .executeTakeFirst();
  if (!pledge) return;

  const donorName = [pledge.first_name, pledge.last_name].filter(Boolean).join(' ') || 'A donor';
  const amount = `$${Number(pledge.monthly_amount) / 100}/month`;
  const how = job.source === 'portal' ? 'from their giving portal' : 'through the payment provider';
  const summary = `${donorName} cancelled their ${amount} gift ${how}.`;

  const admins = await db
    .selectFrom('authusers')
    .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
    .select(['authusers.id', 'authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
    .where('authusers.tenant_id', '=', job.tenant_id)
    .where('authusers.role', 'in', ['admin', 'owner'])
    .where('authusers.deactivated_at', 'is', null)
    .where('authusers.deleted_at', 'is', null)
    .execute();

  for (const admin of admins) {
    try {
      if (notificationEnabled(admin.profile_preferences, 'donor_pledge_cancelled_in_app')) {
        const { NotificationsRepo } = await import('../../../modules/notifications/repositories/notifications.repo');
        await new NotificationsRepo().pushNotification({
          tenant_id: job.tenant_id,
          user_id: String(admin.id),
          title: 'Monthly pledge cancelled',
          message: summary,
          type: 'donations',
          link: '/donations/pledges',
        });
      }
      if (notificationEnabled(admin.profile_preferences, 'donor_pledge_cancelled') && admin.email) {
        const staffMail = new TransactionalEmailService({ defaultAudience: 'staff' });
        await staffMail.sendMail({
          to: admin.email,
          subject: 'A donor cancelled their monthly pledge',
          notificationSettingsLink: true,
          tenant_id: job.tenant_id,
          text: `Hi ${admin.first_name || 'there'},\n\n${summary}\n\nSee your pledges under Donations → Pledges: ${env.appUrl}/donations/pledges`,
          html: `<h2>Monthly pledge cancelled</h2>
<p>Hi ${admin.first_name || 'there'},</p>
<p>${summary}</p>
<div class="btn-container"><a href="${env.appUrl}/donations/pledges" class="btn">Review pledges</a></div>`,
        });
      }
    } catch (err) {
      // One admin's failed notification must not stop the rest of the roster.
      logger.error({ err, tenantId: job.tenant_id, adminId: admin.id }, 'Failed to notify pledge cancellation');
    }
  }
}
