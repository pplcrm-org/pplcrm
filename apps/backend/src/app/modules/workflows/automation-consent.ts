import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';

type Db = Kysely<Models> | Transaction<Models>;

export type AutomationSendConsent = { ok: true } | { ok: false; reason: string };

/**
 * May an automation `send_email` step email this person? Automations aren't campaign-scoped
 * (workflows has no campaign_id), so this is the workflow analogue of the newsletter
 * sendability triad (NewslettersController.buildRecipientQuery):
 *  1. Address suppressed (hard bounce / spam complaint) → never.
 *  2. Person is do-not-contact for email → never.
 *  3. Person has subscription rows and NONE subscribed → they unsubscribed from this
 *     organization's email; skip.
 *  A person with NO subscription rows at all is allowed: they never joined the newsletter,
 *  and the email is relationship mail triggered by their own action (e.g. a volunteer shift).
 */
export async function resolveAutomationSendConsent(
  db: Db,
  tenantId: string,
  person: { id: string; email: string },
): Promise<AutomationSendConsent> {
  const suppressed = await db
    .selectFrom('email_suppressions')
    .select('id')
    .where('tenant_id', '=', tenantId)
    // Case-insensitive: suppressions are stored lowercased but persons keep mixed case.
    .where(sql<boolean>`lower(email) = ${person.email.toLowerCase()}`)
    .executeTakeFirst();
  if (suppressed) return { ok: false, reason: 'Address previously bounced or complained — suppressed' };

  const dnc = await db
    .selectFrom('persons')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', person.id)
    .where(sql<boolean>`do_not_contact AND (do_not_contact_channels IS NULL OR 'email' = ANY(do_not_contact_channels))`)
    .executeTakeFirst();
  if (dnc) return { ok: false, reason: 'Contact is marked do-not-contact for email' };

  const subscriptions = await db
    .selectFrom('campaign_subscriptions')
    .select(['status'])
    .where('tenant_id', '=', tenantId)
    .where('person_id', '=', person.id)
    .execute();
  if (subscriptions.length > 0 && !subscriptions.some((s) => s.status === 'subscribed')) {
    return { ok: false, reason: 'Contact has unsubscribed from your emails' };
  }

  return { ok: true };
}
