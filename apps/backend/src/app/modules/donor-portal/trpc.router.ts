import { z } from 'zod';
import { authProcedure as baseAuthProcedure, router } from '../../../trpc';
import { idSchema } from '../../../../../../libs/common/src/lib/schemas/core.schema';
import { planFeatureGate } from '../billing/plan-gate';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { BaseRepository } from '../../lib/base.repo';
import { NotFoundError } from '../../errors/app-errors';
import { DonorPortalController } from './controller';
import { donorPortalUrl } from './portal-url';
import { publicOrgName } from '../../lib/public-tenant';

const controller = new DonorPortalController();

// Sending a link is a donations-feature action, so it carries the same plan gate as the rest of
// the donations surface.
const authProcedure = baseAuthProcedure.use(planFeatureGate('donations'));

const personInput = z.object({ personId: idSchema });

async function personOrThrow(tenantId: string, personId: string) {
  const person = await BaseRepository.dbInstance
    .selectFrom('persons')
    .select(['id', 'first_name', 'email'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', personId)
    .executeTakeFirst();
  if (!person) throw new NotFoundError('Person not found.');
  return person;
}

async function tenantSlug(tenantId: string): Promise<string> {
  const row = await BaseRepository.dbInstance
    .selectFrom('tenants')
    .select('slug')
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!row?.slug) throw new NotFoundError('Workspace not found.');
  return String(row.slug);
}

async function logStaffActivity(tenantId: string, userId: string, personId: string, text: string): Promise<void> {
  await BaseRepository.dbInstance
    .insertInto('user_activity')
    .values({
      tenant_id: tenantId,
      user_id: userId,
      activity: text,
      entity: 'persons',
      entity_id: personId,
      quantity: 1,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
}

export const DonorPortalRouter = router({
  /**
   * Mint a giving-portal link for this person and email it to them (when they have an email).
   * The raw URL is returned ONCE so the staff panel can offer Copy link — the honest fallback
   * when the email cannot go out (no address on file, demo workspace).
   */
  sendLink: authProcedure.input(personInput).mutation(async ({ ctx, input }) => {
    const person = await personOrThrow(ctx.auth.tenant_id, input.personId);
    const slug = await tenantSlug(ctx.auth.tenant_id);
    const minted = await controller.mintLink(ctx.auth.tenant_id, input.personId, ctx.auth.user_id);
    const url = donorPortalUrl(slug, minted.token);

    let emailed = false;
    if (person.email) {
      const orgName = await publicOrgName(ctx.auth.tenant_id);
      // Outbox, not inline: the mutation must not wait on the mail provider. Link-only body —
      // enqueued payloads cannot carry attachments, and this one needs none.
      await new TransactionalEmailService().enqueueMail({
        to: String(person.email),
        subject: `Your giving page for ${orgName}`,
        text: `Hi ${person.first_name || 'there'},\n\nHere is your personal giving page for ${orgName} — your giving history, receipts, and monthly gift settings:\n\n${url}`,
        html: `<p>Hi ${person.first_name || 'there'},</p>
<p>Here is your personal giving page for ${orgName} — your giving history, receipts, and monthly gift settings:</p>
<div class="btn-container"><a href="${url}" class="btn">Open your giving page</a></div>`,
        tenant_id: ctx.auth.tenant_id,
        audience: 'contact',
      });
      emailed = true;
    }
    await logStaffActivity(ctx.auth.tenant_id, ctx.auth.user_id, input.personId, 'Sent a giving-portal link');
    return { url, emailed, expires_at: minted.expires_at };
  }),

  /**
   * Stop every live link for this person at once. Deliberately NOT plan-gated: revocation is a
   * safety action, and a downgraded workspace must still be able to kill a link it sent.
   */
  revokeLinks: baseAuthProcedure.input(personInput).mutation(async ({ ctx, input }) => {
    await personOrThrow(ctx.auth.tenant_id, input.personId);
    const revoked = await controller.revokeLinks(ctx.auth.tenant_id, input.personId);
    if (revoked > 0) {
      await logStaffActivity(ctx.auth.tenant_id, ctx.auth.user_id, input.personId, 'Revoked the giving-portal links');
    }
    return { revoked };
  }),

  /** Link state for the panel on the person record. */
  getLinkStatus: authProcedure.input(personInput).query(async ({ ctx, input }) => {
    return controller.linkStatus(ctx.auth.tenant_id, input.personId);
  }),
});
