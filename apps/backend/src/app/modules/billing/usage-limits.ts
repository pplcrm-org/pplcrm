import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import {
  annualPriceForQuantity,
  bracketForQuantity,
  bracketIndexForSubscribers,
  emailCapForQuantity,
  getPlanDef,
  GB,
  maxQuantity,
  PLANS,
  PLANS_BY_KEY,
  startingPriceLabel,
  subscriberCapForQuantity,
  type BillingInterval,
  type PlanKey,
} from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { ALL_FOLDERS } from '../../../../../../libs/common/src/lib/emails';
import { env } from '../../../env';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { logger } from '../../logger';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import { sendWindow } from '../newsletters/send-guards';
import { syncSubscriptionQuantity } from './subscription-sync';

export interface PlanLimits {
  price: string;
  /** Emailable-subscriber cap (Infinity = unlimited). */
  subscribers: number;
  seats: number;
  emails: number;
  /** Storage quota in bytes (Infinity = unlimited). */
  storageBytes: number;
}

const settingsRepo = new SettingsRepo();
const mailService = new TransactionalEmailService();

/** null limit in a plan def means "unlimited" — represent it as Infinity so usage % never trips an alert. */
function orUnlimited(value: number | null): number {
  return value == null ? Number.POSITIVE_INFINITY : value;
}

/**
 * Bracket-aware plan limits at a given Stripe `quantity` (defaults to 1 — the lowest bracket).
 * Seats/storage stay flat per tier (unrelated to subscriber count); subscribers/emails/price
 * come from the bracket the quantity resolves to. Enterprise (`pricing: null`) has no ladder —
 * subscribers/emails/price fall back to "unlimited"/"Custom" as before. The caps themselves are
 * interval-independent (email caps are always monthly) — `interval` only changes the price
 * string ('$29/month' vs '$290/year').
 */
export function getPlanLimits(
  planName: string | null | undefined,
  quantity = 1,
  interval: BillingInterval = 'month',
): PlanLimits {
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;

  if (!plan.pricing) {
    return {
      price: 'Custom',
      subscribers: Number.POSITIVE_INFINITY,
      seats: orUnlimited(plan.seats),
      emails: Number.POSITIVE_INFINITY,
      storageBytes: orUnlimited(plan.storageBytes),
    };
  }

  const bracket = bracketForQuantity(plan.key, quantity);
  const price =
    bracket.price === 0
      ? '$0/month'
      : interval === 'year'
        ? `$${annualPriceForQuantity(plan.key, quantity)}/year`
        : `$${bracket.price}/month`;
  return {
    price,
    subscribers: subscriberCapForQuantity(plan.key, quantity),
    seats: orUnlimited(plan.seats),
    emails: emailCapForQuantity(plan.key, quantity),
    storageBytes: orUnlimited(plan.storageBytes),
  };
}

/** Rounds a byte count to GB with one decimal place, for the coarse-grained usage/alerting resources. */
function bytesToGB(bytes: number): number {
  return Math.round((bytes / GB) * 10) / 10;
}

/**
 * Count of emailable subscribers for a tenant: has an address, not globally do-not-contact, and
 * the address isn't suppressed (hard bounce / spam complaint). This intentionally undercounts
 * channel-specific DNC, which errs in the customer's favour. Shared by usage-limit checks and
 * checkout (to compute the Stripe bracket quantity) and the `getUsage` tRPC endpoint.
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

/** Dedup key prefix for the "your list has grown" family of bracket alerts, stored in the same
 * `billing.limit_alerts_sent` settings blob as the existing 90/100% resource alerts. */
const BRACKET_MAX_FLAG = 'bracket_max';
function bracketUpFlag(targetQty: number): string {
  return `bracket_up_${targetQty}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
export async function checkTenantUsage(tenantId: string, db: Kysely<any>): Promise<void> {
  const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', BigInt(tenantId)).executeTakeFirst();

  if (!tenant) {
    logger.error(`[checkTenantUsage] Tenant not found: ${tenantId}`);
    return;
  }

  const planName = (tenant['subscription_plan'] as string) || 'free';
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;
  const billedQuantity = Number(tenant['subscription_quantity'] ?? 1) || 1;
  const planLimits = getPlanLimits(planName, billedQuantity);

  // 1. Count emailable Subscribers.
  // We meter the sendable audience, NOT total contacts — a tenant can store its whole
  // voter/canvassing universe for free; the cost (and the cap) is who it can email.
  const currentSubscribers = await countEmailableSubscribers(tenantId, db);

  // 2. Count Active User Seats
  const seatsCountRow = await db
    .selectFrom('authusers')
    .select(db.fn.countAll().as('cnt'))
    .where('tenant_id', '=', tenantId)
    .where('deletion_scheduled_at', 'is', null)
    .where('deactivated_at', 'is', null)
    .executeTakeFirst();
  const currentSeats = Number(seatsCountRow?.cnt || 0);

  // 3. Count Outbound Emails within Current Billing Cycle
  const endsAt = tenant['subscription_ends_at']
    ? new Date(tenant['subscription_ends_at'] as string | number | Date)
    : null;
  let billingCycleStart = new Date();
  billingCycleStart.setDate(billingCycleStart.getDate() - 30); // fallback: last 30 days
  if (endsAt) {
    // Reuse the canonical, drift-free billing-cycle window (send-guards.ts). Computing the monthly
    // anniversary by chaining setMonth (as this did) corrupts a 29th–31st billing day when it steps
    // through a shorter month, so the metered cycle landed days off the real anniversary.
    billingCycleStart = sendWindow(endsAt, new Date()).start;
  }

  const emailsCountRow = await db
    .selectFrom('emails')
    .select(db.fn.countAll().as('cnt'))
    .where('tenant_id', '=', tenantId)
    .where('folder_id', '=', ALL_FOLDERS.SENT)
    .where('created_at', '>=', billingCycleStart)
    .executeTakeFirst();
  const emailsSent = Number(emailsCountRow?.cnt || 0);

  const newslettersCountRow = await db
    .selectFrom('newsletters')
    .select(db.fn.sum('delivered_count').as('cnt'))
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'sent')
    .where('send_date', '>=', billingCycleStart)
    .executeTakeFirst();
  const newslettersSent = Number(newslettersCountRow?.cnt || 0);

  const totalEmailsSent = emailsSent + newslettersSent;

  // 4. Sum uploaded file storage
  const storageRow = await db
    .selectFrom('files')
    .select(db.fn.sum('size_bytes').as('total'))
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  const currentStorageBytes = Number(storageRow?.total || 0);

  // Retrieve existing warning status from settings
  const alertSettingsRow = await settingsRepo.getByKey({
    tenant_id: tenantId,
    key: 'billing.limit_alerts_sent',
  });
  let alertSettings: Record<string, boolean> = {};
  if (alertSettingsRow?.value) {
    const val = alertSettingsRow.value;
    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
    if (parsed && typeof parsed === 'object') {
      alertSettings = { ...parsed };
    }
  }

  let settingsChanged = false;

  const resources = [
    {
      name: 'subscriber list',
      key: 'subscribers',
      current: currentSubscribers,
      limit: planLimits.subscribers,
      unit: 'email subscribers',
    },
    {
      name: 'user seats',
      key: 'seats',
      current: currentSeats,
      limit: planLimits.seats,
      unit: 'active users',
    },
    {
      name: 'outbound emails',
      key: 'emails',
      current: totalEmailsSent,
      limit: planLimits.emails,
      unit: 'sent emails',
    },
    {
      name: 'file storage',
      key: 'storage',
      current: bytesToGB(currentStorageBytes),
      limit: bytesToGB(planLimits.storageBytes),
      unit: 'GB used',
    },
  ];

  const adminsList: { email: string; first_name: string }[] = [];

  for (const resource of resources) {
    const pct = resource.limit ? (resource.current / resource.limit) * 100 : 0;
    const flag90 = `${resource.key}_90`;
    const flag100 = `${resource.key}_100`;

    // Handle 100% capacity limit hit
    if (pct >= 100) {
      if (!alertSettings[flag100]) {
        alertSettings[flag100] = true;
        alertSettings[flag90] = true; // Auto-set 90% if we skipped directly to 100%
        settingsChanged = true;
        await sendLimitEmail(tenantId, tenant['name'] as string, planName, resource, 100, adminsList, db);
      }
    } else {
      // Reset 100% flag if usage drops below 100%
      if (alertSettings[flag100]) {
        alertSettings[flag100] = false;
        settingsChanged = true;
      }

      // Handle 90% limit hit
      if (pct >= 90) {
        if (!alertSettings[flag90]) {
          alertSettings[flag90] = true;
          settingsChanged = true;
          await sendLimitEmail(tenantId, tenant['name'] as string, planName, resource, 90, adminsList, db);
        }
      } else {
        // Reset 90% flag if usage drops below 90%
        if (alertSettings[flag90]) {
          alertSettings[flag90] = false;
          settingsChanged = true;
        }
      }
    }
  }

  // Bracket-quantity notify-then-adjust: only meaningful for purchasable plans with an active
  // (or trialing) subscription — free/enterprise tenants have no Stripe quantity to sync.
  const subscriptionStatus = (tenant['subscription_status'] as string) || '';
  if (plan.purchasable && (subscriptionStatus === 'active' || subscriptionStatus === 'trialing')) {
    const targetQuantity = bracketIndexForSubscribers(plan.key, currentSubscribers);

    if (targetQuantity === null) {
      // Outgrown the tier's top bracket — notify, then clamp the billed quantity to the max
      // bracket so at least the highest-priced bracket is charged (no unbounded overage).
      if (!alertSettings[BRACKET_MAX_FLAG]) {
        alertSettings[BRACKET_MAX_FLAG] = true;
        settingsChanged = true;
        await sendBracketMaxEmail(tenantId, tenant['name'] as string, plan.key, currentSubscribers, adminsList, db);
      }
      const clamped = maxQuantity(plan.key);
      if (clamped !== billedQuantity && Number.isFinite(clamped)) {
        await syncSubscriptionQuantity(tenantId, clamped);
      }
    } else if (targetQuantity > billedQuantity) {
      // List grew into a higher bracket — notify, then adjust Stripe immediately. On either
      // interval the prorated difference for the rest of the current period is invoiced right
      // away (see subscription-sync.ts) — this also raises the send-time email allowance,
      // which is keyed to the billed quantity (newsletters/send-guards.ts).
      const billingInterval: BillingInterval = tenant['subscription_interval'] === 'year' ? 'year' : 'month';
      const flag = bracketUpFlag(targetQuantity);
      if (!alertSettings[flag]) {
        alertSettings[flag] = true;
        settingsChanged = true;
        await sendBracketUpEmail(
          tenantId,
          tenant['name'] as string,
          plan.key,
          targetQuantity,
          billingInterval,
          adminsList,
          db,
        );
      }
      await syncSubscriptionQuantity(tenantId, targetQuantity);
    } else if (targetQuantity < billedQuantity) {
      // Mid-cycle shrink — do nothing; `invoice.paid` reconciles downgrades at the cycle boundary.
    } else {
      // Back in step with the billed bracket — clear any stale bracket_* flags so a future
      // regrowth past the same bracket re-sends the notice.
      for (const key of Object.keys(alertSettings)) {
        if (key.startsWith('bracket_') && alertSettings[key]) {
          alertSettings[key] = false;
          settingsChanged = true;
        }
      }
    }
  }

  if (settingsChanged) {
    const adminUserId = tenant['admin_id'] ? String(tenant['admin_id']) : '1';
    await settingsRepo.upsertMany({
      tenant_id: tenantId,
      user_id: adminUserId,
      entries: [
        {
          key: 'billing.limit_alerts_sent',
          value: alertSettings,
        },
      ],
    });
  }
}

async function sendLimitEmail(
  tenantId: string,
  tenantName: string,
  planName: string,
  resource: { name: string; current: number; limit: number; unit: string },
  pct: 90 | 100,
  adminsCache: { email: string; first_name: string }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
  db: Kysely<any>,
): Promise<void> {
  const admins = await getAdmins(tenantId, adminsCache, db);

  const billingPageUrl = `${env.appUrl}/workspace/billing`;
  const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1);
  const prefix = pct === 100 ? 'reached' : 'approaching';

  const upgradeText = upgradePlansText();
  const upgradeHtml = upgradePlansHtml();

  const subject = `Action needed: you have ${prefix} your ${resource.limit.toLocaleString()} ${resource.unit} limit`;
  const text = `Hi,

Your organization "${tenantName}" has reached ${pct}% of its ${resource.name} capacity limit under the ${planLabel} plan.

Current usage: ${resource.current.toLocaleString()} / ${resource.limit.toLocaleString()} ${resource.unit} (${pct}%).

To prevent disruption to your workflows and ensure continued access, please upgrade your subscription plan.

Upgrade options:
${upgradeText}

Update your subscription tier here: ${billingPageUrl}

Thank you,
The pplCRM team`;

  const html = `<h2>You have ${prefix} a plan limit</h2>
<p>Hi,</p>
<p>Your organization <strong>${tenantName}</strong> has reached <strong>${pct}%</strong> of its ${resource.name} capacity limit under the <strong>${planLabel}</strong> plan.</p>
<div class="panel">
<p><strong>Current usage:</strong> ${resource.current.toLocaleString()} / ${resource.limit.toLocaleString()} ${resource.unit} (${pct}%)</p>
</div>
<p>To prevent disruption to your workflows and ensure continued access, please upgrade your subscription plan.</p>
<p><strong>Upgrade options:</strong></p>
<ul>
${upgradeHtml}
</ul>
<div class="btn-container">
  <a href="${billingPageUrl}" class="btn">Upgrade your plan</a>
</div>`;

  await sendToAdmins(admins, subject, text, html, tenantId, db);
}

/** "You've outgrown this tier's top bracket" email — clamp warning, distinct from the routine
 * bracket-up notice (there's no higher bracket to move into). */
async function sendBracketMaxEmail(
  tenantId: string,
  tenantName: string,
  planKey: PlanKey,
  currentSubscribers: number,
  adminsCache: { email: string; first_name: string }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
  db: Kysely<any>,
): Promise<void> {
  const admins = await getAdmins(tenantId, adminsCache, db);
  const plan = PLANS_BY_KEY[planKey];
  const cap = subscriberCapForQuantity(planKey, maxQuantity(planKey));
  const billingPageUrl = `${env.appUrl}/workspace/billing`;

  const subject = `Your ${plan.name} plan has outgrown its top bracket`;
  const text = `Hi,

Your organization "${tenantName}" now has ${currentSubscribers.toLocaleString()} emailable subscribers, which exceeds the ${plan.name} plan's top bracket of ${cap.toLocaleString()}.

We've capped your billed bracket at the plan maximum for now. Please contact us so we can talk about a plan that fits your list, or move to a higher tier.

Manage your subscription here: ${billingPageUrl}

Thank you,
The pplCRM team`;

  const html = `<h2>Your list has outgrown its plan</h2>
<p>Hi,</p>
<p>Your organization <strong>${tenantName}</strong> now has <strong>${currentSubscribers.toLocaleString()}</strong> emailable subscribers, which exceeds the <strong>${plan.name}</strong> plan's top bracket of ${cap.toLocaleString()}.</p>
<p>We've capped your billed bracket at the plan maximum for now. Please contact us so we can talk about a plan that fits your list, or move to a higher tier.</p>
<div class="btn-container">
  <a href="${billingPageUrl}" class="btn">Manage billing</a>
</div>`;

  await sendToAdmins(admins, subject, text, html, tenantId, db);
}

/** "Your list grew into the next bracket" email — sent once per bracket via the `bracket_up_N`
 * dedup flag. Both intervals invoice the prorated difference for the rest of the current
 * period immediately; the interval only changes how the price is labelled. */
async function sendBracketUpEmail(
  tenantId: string,
  tenantName: string,
  planKey: PlanKey,
  targetQuantity: number,
  interval: BillingInterval,
  adminsCache: { email: string; first_name: string }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
  db: Kysely<any>,
): Promise<void> {
  const admins = await getAdmins(tenantId, adminsCache, db);
  const plan = PLANS_BY_KEY[planKey];
  const bracket = bracketForQuantity(planKey, targetQuantity);
  const billingPageUrl = `${env.appUrl}/workspace/billing`;

  const priceText =
    interval === 'year' ? `$${annualPriceForQuantity(planKey, targetQuantity)}/year` : `$${bracket.price}/month`;
  const periodText = interval === 'year' ? 'year' : 'month';
  const timingText = `you'll now be billed ${priceText} for up to ${bracket.upTo.toLocaleString()} emailable subscribers, and the prorated difference for the remainder of your current ${periodText} has been charged. Your monthly email allowance grows with the new bracket right away`;

  const subject = `Your ${plan.name} plan is moving to a new price bracket`;
  const text = `Hi,

Your organization "${tenantName}" has grown past your current bracket on the ${plan.name} plan. As a result, ${timingText}.

Manage your subscription here: ${billingPageUrl}

Thank you,
The pplCRM team`;

  const html = `<h2>Your plan is moving to a new price bracket</h2>
<p>Hi,</p>
<p>Your organization <strong>${tenantName}</strong> has grown past your current bracket on the <strong>${plan.name}</strong> plan. As a result, ${timingText.replace(priceText, `<strong>${priceText}</strong>`)}.</p>
<div class="btn-container">
  <a href="${billingPageUrl}" class="btn">Manage billing</a>
</div>`;

  await sendToAdmins(admins, subject, text, html, tenantId, db);
}

async function getAdmins(
  tenantId: string,
  adminsCache: { email: string; first_name: string }[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
  db: Kysely<any>,
): Promise<{ email: string; first_name: string }[]> {
  if (adminsCache.length === 0) {
    const admins = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', tenantId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely expression builder over a BigInt id filter; see pplcrm-any-exceptions
      .where((eb: any) =>
        eb.or([
          eb('role', '=', 'admin'),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt id vs string-typed column; see pplcrm-any-exceptions
          eb('id', '=', BigInt(tenantId) as any), // admin fallback
        ]),
      )
      .where('deletion_scheduled_at', 'is', null)
      .where('deactivated_at', 'is', null)
      .execute();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped-handle query result; see pplcrm-any-exceptions
    adminsCache.push(...(admins as any));
  }
  return adminsCache;
}

async function sendToAdmins(
  admins: { email: string; first_name: string }[],
  subject: string,
  text: string,
  html: string,
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BigInt tenant_id filter needs an untyped handle; see pplcrm-any-exceptions
  _db: Kysely<any>,
): Promise<void> {
  for (const admin of admins) {
    if (admin.email) {
      try {
        await mailService.enqueueMail({
          to: admin.email,
          tenant_id: tenantId,
          subject,
          text,
          html,
        });
      } catch (err) {
        logger.error({ err }, `Failed to send limit notification email to ${admin.email}`);
      }
    }
  }
}

function seatsLabel(seats: number | null): string {
  return seats == null ? 'unlimited' : String(seats);
}

function upgradePlansText(): string {
  return PLANS.filter((p) => p.purchasable)
    .map((p) => {
      const cap = p.pricing ? p.pricing.brackets[p.pricing.brackets.length - 1] : undefined;
      const emails = cap ? cap.upTo * (p.pricing?.emailsPerSubscriber ?? 0) : 0;
      return `- ${p.name} plan (${startingPriceLabel(p)}/month): up to ${(cap?.upTo ?? 0).toLocaleString()} subscribers, ${seatsLabel(p.seats)} user seats, and ${emails.toLocaleString()} monthly emails.`;
    })
    .join('\n');
}

function upgradePlansHtml(): string {
  return PLANS.filter((p) => p.purchasable)
    .map((p) => {
      const cap = p.pricing ? p.pricing.brackets[p.pricing.brackets.length - 1] : undefined;
      const emails = cap ? cap.upTo * (p.pricing?.emailsPerSubscriber ?? 0) : 0;
      return `  <li><strong>${p.name} plan (${startingPriceLabel(p)}/month):</strong> up to ${(cap?.upTo ?? 0).toLocaleString()} subscribers, ${seatsLabel(p.seats)} user seats, and ${emails.toLocaleString()} monthly emails.</li>`;
    })
    .join('\n');
}

export async function checkAllUsageLimits(db: Kysely<Models>): Promise<void> {
  const tenants = await db.selectFrom('tenants').select('id').execute();
  for (const tenant of tenants) {
    try {
      await checkTenantUsage(String(tenant['id']), db);
    } catch (err) {
      logger.error({ err }, `Failed to check usage limits for tenant ${tenant['id']}`);
    }
  }
}

export async function queueUsageLimitCheck(tenantId: string, db: Kysely<Models>): Promise<void> {
  // Check if there is already a pending limits check job for this tenant
  const existing = await db
    .selectFrom('background_jobs')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'pending')
    .where(sql.raw("payload->>'type'"), '=', 'check_usage_limits')
    .executeTakeFirst();

  if (!existing) {
    await db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({ type: 'check_usage_limits', tenant_id: tenantId }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();
  }
}
