import type { Kysely, Transaction } from 'kysely';
import { getPlanDef } from '@common';
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
 * retrying: 'rate_capped' clears by itself as the rolling hour moves, while 'suspended',
 * 'sending_paused' and 'demo_mode' are standing states that a retry cannot resolve
 * ('demo_mode' clears only when the user removes the seeded demo data).
 */
export type TransactionalSendBlockReason = 'suspended' | 'sending_paused' | 'rate_capped' | 'demo_mode';

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
    .select(['suspended_at', 'sending_paused_at', 'demo_mode_at', 'subscription_plan'])
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
  // Demo workspaces gate as the top tier for FEATURES (billing/plan-gate.ts), which reaches
  // audience-facing mail paths a free workspace never could — form confirmations, donation
  // documents, volunteer-event mail. None of it may go out during the demo: the seeded
  // contacts are reserved example.com addresses that can only bounce, and "nothing you do in
  // the demo reaches a real person" is the promise the Help Center makes. Staff and account
  // mail keep flowing — those recipients are the workspace's own real logins.
  //
  // UNPAID workspaces only. Exiting the demo requires a settled subscription first, so "paid,
  // demo data still present" is a normal transitional state — and a paying customer in it is
  // collecting real donations whose acknowledgements and tax receipts are 'contact' mail.
  // Blocking those silently (the job worker drops blocked messages) meant receipts recorded as
  // issued were never emailed (REVIEW7 C3). A paid tenant's real contacts are legitimate;
  // their seeded example.com contacts can only bounce into the suppression list, which is
  // harmless.
  const storedPlanPaid = getPlanDef(tenant?.subscription_plan)?.purchasable === true;
  if (audience === 'contact' && tenant?.demo_mode_at && !storedPlanPaid) {
    throw new TransactionalSendBlockedError(
      `Tenant ${tenantId} is in demo mode — audience-facing transactional mail withheld until the demo data is removed.`,
      'demo_mode',
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
