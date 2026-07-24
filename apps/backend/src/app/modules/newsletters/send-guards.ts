import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import { emailCapForQuantity, getPlanDef, PLANS_BY_KEY, type PlanKey } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { ForbiddenError, NotFoundError, PreconditionFailedError, TooManyRequestsError } from '../../errors/app-errors';
import { logger } from '../../logger';

/**
 * Anti-abuse guards around bulk (newsletter) sending. Free accounts are the spam vector — a
 * throwaway signup must not be able to blast a purchased list — so sending is gated on real
 * identity (verified DKIM domain, and on Free a verified mobile number), throttled while an
 * account is new, and automatically shut off when a send's engagement shows list abuse
 * (hard bounces = purchased/scraped list, spam complaints = non-consenting recipients).
 *
 * Enforcement points:
 *  - `assertTenantMaySendNewsletter` — pre-send, in NewslettersController.sendNewsletter.
 *  - `assertTenantSendingNotBlocked` + the caps — per batch, in the send-newsletter job handler
 *    (so an in-flight send stops mid-batch when a tripwire fires).
 *  - `applyEngagementTripwires` — in the SendGrid event webhook after aggregates recompute.
 *
 * Besides the abuse guards, this module enforces the PLAN METER: the monthly email allowance
 * (`emailsPerSubscriber` × the billed bracket's subscriber cap — 2× Free, 8× Grassroots,
 * 12× Movement). Billing handles subscriber growth by moving the tenant up a bracket and
 * invoicing the prorated difference immediately (usage-limits.ts + subscription-sync.ts), so
 * the allowance is keyed to `tenants.subscription_quantity` — always a paid-for bracket. The
 * gate is what makes "pay for the lowest bracket, import a huge list, blast it, cancel"
 * impossible: sending N emails requires being billed like a tenant with an N-sized audience.
 */

/** New Free tenants are warmed up: at most this many newsletter emails per rolling day… */
export const FREE_WARMUP_DAILY_CAP = 100;
/** …for this many days after tenant creation. */
export const FREE_WARMUP_DAYS = 7;

/** Per-tenant rolling-hour send ceilings enforced by the outbox worker (queue fairness +
 * blast-radius cap; a deferred send resumes automatically). */
export const HOURLY_SEND_CAPS: Record<PlanKey, number> = {
  free: 500,
  grassroots: 5_000,
  movement: 20_000,
  enterprise: 50_000,
};

/** Tripwires need a minimum sample so one bad address on a tiny send doesn't pause a tenant. */
export const TRIPWIRE_MIN_RECIPIENTS = 20;
/** Hard-bounce rate above which sending is paused (a clean opt-in list bounces ~1–2%). */
export const HARD_BOUNCE_PAUSE_RATE = 0.05;
/** Spam-complaint rate above which the whole account is suspended pending human review. */
export const SPAM_COMPLAINT_SUSPEND_RATE = 0.01;

export const SENDING_SUSPENDED_MESSAGE =
  'This account is suspended pending a review of recent sending activity. Please contact support.';
export const SENDING_PAUSED_MESSAGE =
  'Sending is paused: a recent newsletter had an unusually high bounce rate, which usually means the list contains addresses that never opted in. Please contact support to review and resume sending.';
export const SENDING_PAYMENT_HOLD_MESSAGE =
  'Sending is on hold because your last subscription payment did not go through. Update your payment method on the Billing page (Workspace → Billing) to resume — everything else keeps working, and nothing is lost.';

/** Stripe subscription statuses that put newsletter sending on hold: the tenant is on a paid
 * plan whose latest invoice failed (`past_due`, then `unpaid` once retries are exhausted).
 * Without this, growth is invoiced immediately (subscription-sync `always_invoice`) but a
 * declined card would not actually stop the blast the invoice was for. */
const PAYMENT_HOLD_STATUSES: ReadonlySet<string> = new Set(['past_due', 'unpaid']);
export const DOMAIN_UNVERIFIED_MESSAGE =
  'Before sending, verify the domain you send from (Settings → Domains) and choose a default From address on that domain (Settings → Communications). This protects your deliverability.';
export const PHONE_UNVERIFIED_MESSAGE =
  'On the Free plan, verify a mobile phone number (Settings → Communications) before your first newsletter send.';
export const AUTOMATION_PHONE_UNVERIFIED_MESSAGE =
  'On the Free plan, verify a mobile phone number (Settings → Communications) before automation emails can send. This email was not sent.';
export const ORG_ADDRESS_MISSING_MESSAGE =
  'Before sending, an administrator must set your organization’s mailing address (Settings → Organization). Anti-spam laws (like CAN-SPAM and CASL) require it in every newsletter footer.';

/** Rolling window the automation tripwires aggregate over. Automation emails are one-recipient
 * sends spread over time (no per-send population like a newsletter), so the "send" a tripwire
 * judges is the tenant's recent automation volume as a whole. */
export const AUTOMATION_TRIPWIRE_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type Db = Kysely<Models> | Transaction<Models>;

export interface SendingTenant {
  id: string;
  plan: PlanKey;
  /** Billed Stripe bracket index (1-based); 1 for free tenants. Keys the monthly allowance. */
  subscription_quantity: number;
  /** End of the current billing period — anchors the monthly allowance window on paid plans. */
  subscription_ends_at: Date | null;
  /** Stripe subscription status ('' for free tenants) — `past_due`/`unpaid` holds sending. */
  subscription_status: string;
  created_at: Date | null;
  suspended_at: Date | null;
  sending_paused_at: Date | null;
  sending_phone_verified_at: Date | null;
}

/** Resolve a stored plan value to its key, treating unknown/absent as free (fail closed). */
export function planKeyOf(planName: string | null | undefined): PlanKey {
  return getPlanDef(planName)?.key ?? 'free';
}

/** The tenant's daily warm-up cap, or null when no warm-up applies (paid plan or account older
 * than the warm-up window). Pure, so the cap math is unit-testable. */
export function warmupDailyCap(plan: PlanKey, createdAt: Date | null, now: Date): number | null {
  if (plan !== 'free') return null;
  if (!createdAt) return FREE_WARMUP_DAILY_CAP; // unknown age: fail closed
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs < FREE_WARMUP_DAYS * DAY_MS ? FREE_WARMUP_DAILY_CAP : null;
}

/** The tenant's monthly newsletter-email cap at its billed bracket, or `Infinity` when no cap
 * applies (enterprise — custom pricing, no ladder). Pure, so the cap math is unit-testable. */
export function monthlyEmailCap(plan: PlanKey, billedQuantity: number): number {
  if (!PLANS_BY_KEY[plan].pricing) return Number.POSITIVE_INFINITY;
  return emailCapForQuantity(plan, billedQuantity);
}

/**
 * The window the monthly allowance meters over. Paid plans use the current billing cycle —
 * monthly anniversaries stepped back from `subscription_ends_at`, so annual subscriptions
 * still reset monthly ("send caps stay monthly regardless of billing interval", plans.ts).
 * Free tenants have no cycle, so they meter the UTC calendar month. Pure for unit tests.
 */
export function sendWindow(subscriptionEndsAt: Date | null, now: Date): { start: Date; resetsAt: Date } {
  if (!subscriptionEndsAt) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
  // The monthly anniversaries are `subscriptionEndsAt` shifted by whole months. Each anniversary is
  // computed from the ORIGINAL anchor (never by chaining setMonth off the previous result) and the
  // day is clamped to the target month's length — otherwise a 29th–31st anchor drifts every time it
  // steps through a shorter month (Mar 31 → "Feb 31" → Mar 3), landing the meter days off the real
  // billing anniversary and letting a tenant double-dip the monthly cap near the boundary.
  const anniversary = (k: number): Date => shiftMonthsUTC(subscriptionEndsAt, k);

  // Start from the coarse month difference, then nudge so anniversary(k) <= now < anniversary(k+1).
  let k =
    (now.getUTCFullYear() - subscriptionEndsAt.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - subscriptionEndsAt.getUTCMonth());
  while (anniversary(k) > now) k--;
  while (anniversary(k + 1) <= now) k++;
  return { start: anniversary(k), resetsAt: anniversary(k + 1) };
}

/**
 * `base` shifted by `months` (may be negative) in UTC, with the day-of-month clamped to the target
 * month's length so the anchor day never overflows into the next month. Always call with the
 * original anchor date and an absolute month delta — do NOT chain, or the clamp compounds into drift.
 */
function shiftMonthsUTC(base: Date, months: number): Date {
  const monthIndex = base.getUTCMonth() + months;
  const targetYear = base.getUTCFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), daysInTargetMonth);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/** Which tripwire, if any, a send's engagement stats have crossed. Pure for unit tests. */
export function evaluateTripwires(stats: {
  totalRecipients: number;
  hardBounces: number;
  spamReports: number;
}): 'suspend' | 'pause' | null {
  if (stats.totalRecipients < TRIPWIRE_MIN_RECIPIENTS) return null;
  if (stats.spamReports / stats.totalRecipients > SPAM_COMPLAINT_SUSPEND_RATE) return 'suspend';
  if (stats.hardBounces / stats.totalRecipients > HARD_BOUNCE_PAUSE_RATE) return 'pause';
  return null;
}

export async function loadSendingTenant(db: Db, tenantId: string): Promise<SendingTenant> {
  const row = await db
    .selectFrom('tenants')
    .select([
      'id',
      'subscription_plan',
      'subscription_quantity',
      'subscription_ends_at',
      'subscription_status',
      'created_at',
      'suspended_at',
      'sending_paused_at',
      'sending_phone_verified_at',
    ])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Organization not found');
  const toDate = (v: Date | string | null): Date | null => (v == null ? null : new Date(v));
  return {
    id: String(row.id),
    plan: planKeyOf(row.subscription_plan),
    subscription_quantity: Number(row.subscription_quantity ?? 1) || 1,
    subscription_ends_at: toDate(row.subscription_ends_at),
    subscription_status: typeof row.subscription_status === 'string' ? row.subscription_status : '',
    created_at: toDate(row.created_at),
    suspended_at: toDate(row.suspended_at),
    sending_paused_at: toDate(row.sending_paused_at),
    sending_phone_verified_at: toDate(row.sending_phone_verified_at),
  };
}

/** True when a paid tenant's subscription payment has failed (`past_due`/`unpaid`) — sending
 * is on hold until the payment method is fixed. Free/enterprise tenants never hold (no
 * self-serve invoice to fail). Pure, shared with the worker's mid-flight check. */
export function hasPaymentHold(tenant: SendingTenant): boolean {
  return PLANS_BY_KEY[tenant.plan].purchasable && PAYMENT_HOLD_STATUSES.has(tenant.subscription_status);
}

/** Free-plan identity gate: a verified mobile number is required before any tenant-originated
 * email (newsletter or automation) leaves a Free account. Pure, shared by both send paths. */
export function needsPhoneVerification(tenant: SendingTenant): boolean {
  return tenant.plan === 'free' && !tenant.sending_phone_verified_at;
}

/** Throws when the tenant is suspended, tripwire-paused, or on a payment hold. */
export function assertTenantSendingNotBlocked(tenant: SendingTenant): void {
  if (tenant.suspended_at) throw new ForbiddenError(SENDING_SUSPENDED_MESSAGE);
  if (tenant.sending_paused_at) throw new ForbiddenError(SENDING_PAUSED_MESSAGE);
  if (hasPaymentHold(tenant)) throw new PreconditionFailedError(SENDING_PAYMENT_HOLD_MESSAGE);
}

/** SUM of newsletter emails handed to SendGrid for this tenant since `since`. */
export async function sentEmailsSince(db: Db, tenantId: string, since: Date): Promise<number> {
  const row = await db
    .selectFrom('newsletter_send_log')
    .select((eb) => eb.fn.coalesce(eb.fn.sum('recipient_count'), sql<number>`0`).as('total'))
    .where('tenant_id', '=', tenantId)
    .where('created_at', '>=', since)
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}

/** Record one delivered batch — the data the warm-up and hourly caps meter. */
export async function logNewsletterBatch(
  db: Db,
  tenantId: string,
  newsletterId: string,
  recipientCount: number,
): Promise<void> {
  if (recipientCount <= 0) return;
  await db
    .insertInto('newsletter_send_log')
    .values({ tenant_id: tenantId, newsletter_id: newsletterId, recipient_count: recipientCount })
    .execute();
}

/** Record one automation send_email delivery. Same table as newsletter batches (SUMmed by
 * `sentEmailsSince`), so automation volume counts toward the warm-up/hourly/monthly caps —
 * an automation is not a side-channel around the plan meter. */
export async function logAutomationSend(db: Db, tenantId: string): Promise<void> {
  await db
    .insertInto('newsletter_send_log')
    .values({ tenant_id: tenantId, newsletter_id: null, recipient_count: 1, source: 'automation' })
    .execute();
}

/** The server-appended compliance footer needs the org's postal address (CAN-SPAM/CASL), so a
 * newsletter may not send until an administrator has set it. */
export async function hasOrganizationAddress(db: Db, tenantId: string): Promise<boolean> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', 'organization.address')
    .executeTakeFirst();
  return typeof row?.value === 'string' && row.value.trim().length > 0;
}

/** True when the tenant's default From address belongs to a DKIM-verified sending domain. */
export async function hasVerifiedSendingDomain(db: Db, tenantId: string): Promise<boolean> {
  const rows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('tenant_id', '=', tenantId)
    .where('key', 'in', ['communications.default_from_email', 'communications.verified_domains'])
    .execute();
  let fromEmail = '';
  let domains: { domain?: string; status?: string }[] = [];
  for (const row of rows) {
    if (row.key === 'communications.default_from_email' && typeof row.value === 'string') {
      fromEmail = row.value.toLowerCase().trim();
    } else if (row.key === 'communications.verified_domains' && Array.isArray(row.value)) {
      domains = row.value as { domain?: string; status?: string }[];
    }
  }
  const fromDomain = fromEmail.split('@')[1];
  if (!fromDomain) return false;
  return domains.some((d) => d.domain === fromDomain && d.status === 'verified');
}

/**
 * The pre-send gate. Ordered so the most actionable message wins: blocked states first, then
 * identity prerequisites, then the warm-up volume cap, then the monthly plan allowance.
 */
export async function assertTenantMaySendNewsletter(
  db: Db,
  tenantId: string,
  plannedRecipients: number,
): Promise<void> {
  const tenant = await loadSendingTenant(db, tenantId);
  assertTenantSendingNotBlocked(tenant);

  if (!(await hasVerifiedSendingDomain(db, tenantId))) {
    throw new PreconditionFailedError(DOMAIN_UNVERIFIED_MESSAGE);
  }
  if (!(await hasOrganizationAddress(db, tenantId))) {
    throw new PreconditionFailedError(ORG_ADDRESS_MISSING_MESSAGE);
  }
  if (needsPhoneVerification(tenant)) {
    throw new PreconditionFailedError(PHONE_UNVERIFIED_MESSAGE);
  }

  const now = new Date();
  const cap = warmupDailyCap(tenant.plan, tenant.created_at, now);
  if (cap != null) {
    const sentToday = await sentEmailsSince(db, tenantId, new Date(now.getTime() - DAY_MS));
    if (sentToday + plannedRecipients > cap) {
      const remaining = Math.max(0, cap - sentToday);
      throw new TooManyRequestsError(
        `During your first ${FREE_WARMUP_DAYS} days on the Free plan you can send up to ${cap} emails per day. ` +
          `This newsletter has ${plannedRecipients.toLocaleString()} recipients and ${remaining} remain today — ` +
          `narrow the audience or try again tomorrow.`,
      );
    }
  }

  const planCap = monthlyEmailCap(tenant.plan, tenant.subscription_quantity);
  if (Number.isFinite(planCap)) {
    const window = sendWindow(tenant.subscription_ends_at, now);
    const sentThisCycle = await sentEmailsSince(db, tenantId, window.start);
    if (sentThisCycle + plannedRecipients > planCap) {
      const remaining = Math.max(0, planCap - sentThisCycle);
      const resetsOn = window.resetsAt.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
      throw new TooManyRequestsError(
        `Your plan includes ${planCap.toLocaleString()} newsletter emails per month and ` +
          `${remaining.toLocaleString()} remain until ${resetsOn}. This newsletter has ` +
          `${plannedRecipients.toLocaleString()} recipients — narrow the audience, or upgrade ` +
          `your plan for a larger monthly allowance.`,
      );
    }
  }
}

/**
 * How many more emails the tenant may send right now under the hourly cap, (if active) the
 * warm-up daily cap, and the monthly plan allowance. The worker trims batches to this and
 * defers when it reaches 0 — so even a send that raced past the pre-send gate (or a
 * mid-flight bracket change) can't trickle past the monthly ceiling.
 */
export async function remainingSendAllowance(db: Db, tenant: SendingTenant, now: Date): Promise<number> {
  const hourly = HOURLY_SEND_CAPS[tenant.plan];
  const sentLastHour = await sentEmailsSince(db, tenant.id, new Date(now.getTime() - HOUR_MS));
  let allowance = Math.max(0, hourly - sentLastHour);

  const dailyCap = warmupDailyCap(tenant.plan, tenant.created_at, now);
  if (dailyCap != null) {
    const sentToday = await sentEmailsSince(db, tenant.id, new Date(now.getTime() - DAY_MS));
    allowance = Math.min(allowance, Math.max(0, dailyCap - sentToday));
  }

  const planCap = monthlyEmailCap(tenant.plan, tenant.subscription_quantity);
  if (Number.isFinite(planCap)) {
    const window = sendWindow(tenant.subscription_ends_at, now);
    const sentThisCycle = await sentEmailsSince(db, tenant.id, window.start);
    allowance = Math.min(allowance, Math.max(0, planCap - sentThisCycle));
  }
  return allowance;
}

/** Tripwire pause: newsletter sending only. Idempotent — an already-paused tenant is left as is. */
export async function pauseTenantSending(db: Db, tenantId: string, reason: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ sending_paused_at: new Date(), sending_paused_reason: reason })
    .where('id', '=', tenantId)
    .where('sending_paused_at', 'is', null)
    .execute();
}

/** Tripwire suspension: blocks sign-in (auth checks suspended_at) AND sending. Idempotent. */
export async function suspendTenant(db: Db, tenantId: string, reason: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ suspended_at: new Date() })
    .where('id', '=', tenantId)
    .where('suspended_at', 'is', null)
    .execute();
  await pauseTenantSending(db, tenantId, reason);
}

/**
 * Evaluate a newsletter's engagement against the abuse tripwires and pause/suspend its tenant.
 * Called from the SendGrid event webhook after each aggregate recompute. Uses hard bounces only
 * (SendGrid `bounce` events excluding the soft `blocked` sub-type) so soft failures and
 * suppression `dropped` events never count against the tenant.
 */
export async function applyEngagementTripwires(db: Db, tenantId: string, newsletterId: string): Promise<void> {
  const newsletter = await db
    .selectFrom('newsletters')
    .select(['total_recipients', 'name'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', newsletterId)
    .executeTakeFirst();
  const totalRecipients = Number(newsletter?.total_recipients ?? 0);
  if (totalRecipients < TRIPWIRE_MIN_RECIPIENTS) return;

  const stats = await db
    .selectFrom('newsletter_events')
    .select([
      sql<number>`COUNT(DISTINCT email) FILTER (WHERE event_type = 'bounce' AND COALESCE(bounce_type, '') <> 'blocked')`.as(
        'hard_bounces',
      ),
      sql<number>`COUNT(DISTINCT email) FILTER (WHERE event_type = 'spamreport')`.as('spam_reports'),
    ])
    .where('tenant_id', '=', tenantId)
    .where('newsletter_id', '=', newsletterId)
    .executeTakeFirst();

  const hardBounces = Number(stats?.hard_bounces ?? 0);
  const spamReports = Number(stats?.spam_reports ?? 0);
  const verdict = evaluateTripwires({ totalRecipients, hardBounces, spamReports });
  if (!verdict) return;

  if (verdict === 'suspend') {
    logger.error(
      { tenantId, newsletterId, totalRecipients, spamReports, newsletterName: newsletter?.name },
      '[abuse-tripwire] Spam-complaint rate exceeded — tenant suspended pending human review',
    );
    await suspendTenant(db, tenantId, `spam_complaint_rate:${newsletterId}`);
  } else {
    logger.error(
      { tenantId, newsletterId, totalRecipients, hardBounces, newsletterName: newsletter?.name },
      '[abuse-tripwire] Hard-bounce rate exceeded — tenant sending paused',
    );
    await pauseTenantSending(db, tenantId, `hard_bounce_rate:${newsletterId}`);
  }
}

/**
 * The automation counterpart of `applyEngagementTripwires` — same thresholds, same semantics
 * (`evaluateTripwires`: hard-bounce rate >5% pauses sending, spam-complaint rate >1% suspends
 * the account, minimum sample of TRIPWIRE_MIN_RECIPIENTS), so automations are not a
 * side-channel around the account-level abuse wires. Called from the SendGrid event webhook
 * whenever an automation bounce/complaint event arrives.
 *
 * Sample: because automation emails go out one recipient at a time, the population is a rolling
 * AUTOMATION_TRIPWIRE_WINDOW_DAYS window — sends metered into `newsletter_send_log`
 * (`source='automation'`, written on actual delivery) vs the hard bounces / spam complaints the
 * webhook stamps onto `workflow_runs` (`bounced_at` / `spam_reported_at`; soft `blocked`
 * bounces are never stamped). Send-log retention (32 days) comfortably outlives the window.
 */
export async function applyAutomationTripwires(db: Db, tenantId: string): Promise<void> {
  const since = new Date(Date.now() - AUTOMATION_TRIPWIRE_WINDOW_DAYS * DAY_MS);

  const sent = await db
    .selectFrom('newsletter_send_log')
    .select((eb) => eb.fn.coalesce(eb.fn.sum('recipient_count'), sql<number>`0`).as('total'))
    .where('tenant_id', '=', tenantId)
    .where('source', '=', 'automation')
    .where('created_at', '>=', since)
    .executeTakeFirst();
  const totalRecipients = Number(sent?.total ?? 0);
  if (totalRecipients < TRIPWIRE_MIN_RECIPIENTS) return;

  const stats = await db
    .selectFrom('workflow_runs')
    .select([
      sql<number>`COUNT(*) FILTER (WHERE bounced_at >= ${since})`.as('hard_bounces'),
      sql<number>`COUNT(*) FILTER (WHERE spam_reported_at >= ${since})`.as('spam_reports'),
    ])
    .where('tenant_id', '=', tenantId)
    .where('step_kind', '=', 'send_email')
    .executeTakeFirst();

  const hardBounces = Number(stats?.hard_bounces ?? 0);
  const spamReports = Number(stats?.spam_reports ?? 0);
  const verdict = evaluateTripwires({ totalRecipients, hardBounces, spamReports });
  if (!verdict) return;

  if (verdict === 'suspend') {
    logger.error(
      { tenantId, totalRecipients, spamReports, windowDays: AUTOMATION_TRIPWIRE_WINDOW_DAYS },
      '[abuse-tripwire] Automation spam-complaint rate exceeded — tenant suspended pending human review',
    );
    await suspendTenant(db, tenantId, 'automation_spam_complaint_rate');
  } else {
    logger.error(
      { tenantId, totalRecipients, hardBounces, windowDays: AUTOMATION_TRIPWIRE_WINDOW_DAYS },
      '[abuse-tripwire] Automation hard-bounce rate exceeded — tenant sending paused',
    );
    await pauseTenantSending(db, tenantId, 'automation_hard_bounce_rate');
  }
}
