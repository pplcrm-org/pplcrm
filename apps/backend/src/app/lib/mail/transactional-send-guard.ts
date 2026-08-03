import type { Kysely, Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../base.repo';
import { consumeRateLimit } from '../durable-rate-limiter';
import { logger } from '../../logger';

/**
 * The pre-send gate for Postmark transactional mail (finding C5).
 *
 * Everything in `pplcrm-sending-guards` protects one pipe: SendGrid newsletters and
 * automations. The Postmark pipe had no gates at all — no suspension check, no pause
 * check, no allowance, no rate limit — while sending from the platform address with the
 * pplCRM logo, on pplCRM's own DKIM-signed reputation.
 *
 * That made it a usable spam relay. The events module is not plan-gated, so a free tenant
 * could import a large list, create one event whose name carried the payload, and loop
 * `events.addRegistration` to emit mass phishing that touched none of the anti-abuse layer.
 *
 * Blocking every transactional email would be wrong: password resets and email verification
 * must keep working for a paused tenant, or the owner cannot sign in to fix the problem.
 * So mail is classified by who receives it, and only audience-facing mail is gated.
 */

/**
 * Who a transactional email is going to. This decides whether it is gated, because the
 * abuse potential lives entirely in the "contact" case.
 */
export type MailAudience =
  /**
   * Account and security mail to a person who holds (or is being given) a login: password
   * reset, email verification, invitations, email-change confirmations. Never gated — a
   * suspended tenant's owner still needs to be able to sign in and read notices.
   */
  | 'account'
  /**
   * Operational mail to the tenant's own staff: task assignments, export-ready notices,
   * form submission alerts. Gated on suspension and capped generously; the recipients are
   * staff addresses, so volume is naturally bounded.
   */
  | 'staff'
  /**
   * Mail to someone in the tenant's audience — a supporter, volunteer, or registrant.
   * This is the spam vector: the recipient list is attacker-chosen and unbounded. Fully
   * gated on suspension/pause and capped per tenant per hour.
   */
  | 'contact';

/**
 * Per-tenant hourly ceilings on outbound transactional mail, by audience.
 *
 * Sized to be invisible to real use (a busy campaign confirming registrations all evening
 * stays well under) while making the platform useless as a bulk relay. Newsletters remain
 * the supported way to reach a large audience, and they run the full guard stack.
 */
const HOURLY_CAPS: Record<MailAudience, number> = {
  account: Number.POSITIVE_INFINITY,
  staff: 500,
  contact: 200,
};

const HOUR_MS = 60 * 60 * 1000;

type Db = Kysely<Models> | Transaction<Models>;

/**
 * Why a send was blocked. The distinction matters to callers deciding between dropping and
 * retrying: 'rate_capped' clears by itself as the rolling hour moves, while 'suspended' and
 * 'sending_paused' are standing states that a retry cannot resolve.
 */
export type TransactionalSendBlockReason = 'suspended' | 'sending_paused' | 'rate_capped';

export class TransactionalSendBlockedError extends Error {
  public readonly reason: TransactionalSendBlockReason;

  constructor(message: string, reason: TransactionalSendBlockReason = 'suspended') {
    super(message);
    this.name = 'TransactionalSendBlockedError';
    this.reason = reason;
  }
}

/**
 * Throws when this tenant may not send audience-facing transactional mail right now.
 *
 * Callers in the job worker should catch and drop the message rather than retry — a
 * suspended tenant will still be suspended on the next attempt.
 */
export async function assertTenantMaySendTransactional(
  tenantId: string | null | undefined,
  audience: MailAudience,
  db?: Db,
): Promise<void> {
  // Account/security mail is never gated, and platform mail (ops digests, which carry no
  // tenant) has no tenant to gate on.
  if (audience === 'account') return;
  if (!tenantId) return;

  const client = db ?? BaseRepository.dbInstance;

  const tenant = await client
    .selectFrom('tenants')
    .select(['suspended_at', 'sending_paused_at'])
    .where('id', '=', tenantId)
    .executeTakeFirst();

  if (tenant?.suspended_at) {
    throw new TransactionalSendBlockedError(
      `Tenant ${tenantId} is suspended — transactional mail withheld.`,
      'suspended',
    );
  }
  // A pause is the tripwire response to a bounce/complaint spike. Continuing to emit
  // audience-facing mail through a second pipe would defeat it.
  if (audience === 'contact' && tenant?.sending_paused_at) {
    throw new TransactionalSendBlockedError(
      `Tenant ${tenantId} has sending paused — transactional mail withheld.`,
      'sending_paused',
    );
  }

  const cap = HOURLY_CAPS[audience];
  if (!Number.isFinite(cap)) return;

  const result = await consumeRateLimit(`txmail:${audience}:${tenantId}`, cap, HOUR_MS);
  if (!result.allowed) {
    logger.warn(
      { tenantId, audience, count: result.count, cap },
      'Transactional mail hourly cap exceeded — message withheld',
    );
    throw new TransactionalSendBlockedError(
      `Tenant ${tenantId} exceeded the hourly ${audience} mail cap (${cap}) — message withheld.`,
      'rate_capped',
    );
  }
}
