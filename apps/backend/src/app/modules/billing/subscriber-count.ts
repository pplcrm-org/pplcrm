import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Count of emailable subscribers for a tenant: has an address, not globally do-not-contact, and
 * the address isn't suppressed (hard bounce / spam complaint). This intentionally undercounts
 * channel-specific DNC, which errs in the customer's favour. Shared by usage-limit checks,
 * checkout (to compute the Stripe bracket quantity), the `getUsage` tRPC endpoint, and the
 * Free-plan subscriber-cap send gate (newsletters/send-guards.ts) — its own module so the send
 * guards can use it without importing usage-limits (which imports send-guards back).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
export async function countEmailableSubscribers(tenantId: string, db: Kysely<any>): Promise<number> {
  // Case-insensitive suppression match: suppressions are stored lowercased but persons keep mixed
  // case, so compare lower(email) on both sides — otherwise a mixed-case bounced address is counted
  // as emailable and inflates the Stripe bracket.
  const suppressedEmails = db
    .selectFrom('email_suppressions')
    .select(sql<string>`lower(email)`.as('email'))
    .where('tenant_id', '=', tenantId);
  const row = await db
    .selectFrom('persons')
    .select(db.fn.countAll().as('cnt'))
    .where('tenant_id', '=', tenantId)
    .where('email', 'is not', null)
    .where('email', '<>', '')
    .where('do_not_contact', '=', false)
    .where(sql<boolean>`lower(persons.email) NOT IN ${suppressedEmails}`)
    .executeTakeFirst();
  return Number(row?.cnt || 0);
}
