/**
 * Subscription plans — the single source of truth for tiers, prices and limits.
 *
 * Consumed by:
 *  - backend enforcement  (modules/billing/usage-limits.ts, controller.ts, trpc.router.ts)
 *  - the CRM billing page (experiences/settings/billing)
 *  - the marketing website pricing page + home teaser
 *
 * Pricing model (decision log, 2026-07-14 — supersedes the flat-price 5-column model):
 *  - Three FEATURE tiers (Free / Grassroots / Movement). Which tier you're on is a feature
 *    decision. Within a tier, PRICE scales smoothly by emailable-subscriber bracket instead of
 *    stair-stepping between tiers — the old model jumped a customer 3.4× (Starter $29 →
 *    Representative $99) the moment they crossed one subscriber count. `representative` is
 *    retired. Feature split (revised 2026-07-14): newsletters are table stakes on EVERY plan
 *    including Free; forms, donations, automations, lists (segments), volunteer management
 *    (teams & events) and API access & integrations (added 2026-07-27 — a free workspace with a
 *    scriptable write endpoint is the cheapest way to bulk-load a junk list into shared sending
 *    infrastructure) are the paid step-up (Grassroots and up); the field-ops surface — both
 *    companion apps (canvassing & deliveries), companion volunteer access & monitoring, yard
 *    signs, turf cutting, walk lists & routes, field reports, route optimization — is
 *    Movement-only.
 *  - Meter the EMAILABLE-SUBSCRIBER count, NOT total contacts. A campaign can store its
 *    whole voter / canvassing universe for free (storage is cheap) and only pays for who it
 *    can actually email. This is the differentiator vs. contact-metered tools.
 *  - Stripe never learns about "subscribers" — each purchasable tier has ONE graduated Stripe
 *    price, and the app reports `quantity = 1-based bracket index` (see `bracketIndexForSubscribers`).
 *    All bracket→price/subscriber-cap/email-cap logic lives here, in `plans.ts`, as inspectable
 *    data; Stripe just multiplies quantity by its graduated unit amounts.
 *  - Emails/month = 8× the bracket's subscriber cap on Grassroots (between Mailchimp
 *    Essentials' 10× and a weekly-send cadence) and 12× on Movement (matches Mailchimp
 *    Standard / Constant Contact Standard so the flagship spec-sheet line shows no smaller).
 *    Free keeps 2×. Enforced at send time since 2026-07-18 (send-guards.ts monthly allowance),
 *    not just alerted on.
 *  - Monthly send, storage and seat caps protect the real COGS: SendGrid (newsletters),
 *    Postmark (transactional, scales with seats/activity) and Azure Blob (files).
 *  - Companion volunteers carry an auth-SMS cost — and the companion apps that use them are
 *    Movement-only. (Revised 2026-07-16: companion volunteer access itself moved to
 *    Movement-only. On Grassroots it was a dead grant — volunteer links are minted only by
 *    turf assignments and delivery routes, both Movement-gated — so the old "15 volunteers"
 *    could never be used. Staff-side volunteer management — teams & volunteer events — stays
 *    Grassroots.)
 *  - Enterprise is dropped as a priced column (contact-us footnote only); the `enterprise`
 *    PlanKey stays valid internally for custom/negotiated tenants — `pricing: null` marks it.
 *  - All prices are USD.
 *  - Annual billing (added 2026-07-18): each purchasable tier also has a yearly Stripe price at
 *    exactly 10× the monthly unit amounts — "2 months free" (`ANNUAL_PRICE_MULTIPLIER`). The
 *    graduated ladder is linear in quantity, so 10× holds at every bracket and the whole
 *    quantity-as-bracket-index mechanism carries over unchanged. Display is the monthly
 *    equivalent rounded to the nearest dollar, with the EXACT annual total always alongside
 *    plus a rounding disclaimer ("$24 per month, billed annually as $290") — the checkable
 *    number is the annual total, which is what's actually charged. The website pricing page
 *    defaults to Annual (marketing convention: 2026-07-18); the in-app billing page keeps
 *    Monthly as its default (electoral campaigns end in November — don't nudge existing
 *    customers into prepay). Mid-year bracket GROWTH on an annual subscription is
 *    invoiced prorated immediately (see backend subscription-sync.ts); downgrades still defer
 *    to renewal on both intervals. Send/usage caps stay MONTHLY regardless of billing interval.
 *
 * Market calibration (competitive research 2026-07-14; final ladder locked 2026-07-15, monthly
 * billing): Grassroots beats every full-suite competitor at every count — $69 vs $75 (Mailchimp
 * Essentials) at 5k, $89 vs $110 at 10k, $129 vs $230 at 20k, $219 vs beehiiv Scale's $199 at
 * 50k is the one near-miss (beehiiv is newsletter-only). Movement beats Mailchimp Standard at
 * every count — $125 vs $100 at 5k is the exception early on, but $195 vs $230 at 15k,
 * $365 vs $450 at 50k, $565 vs $800 at 100k. Roughly 1.8× Grassroots at every bracket —
 * "cheapest full-featured option" rather than "suspiciously cheap".
 *
 * Stripe ops (manual, not code — one graduated recurring price per purchasable tier;
 * `quantity` = the bracket index from `bracketIndexForSubscribers`):
 *  - Grassroots: [{ up_to: 1, unit_amount: 2900 }, { up_to: 7, unit_amount: 2000 }, { up_to: 'inf', unit_amount: 7000 }]
 *    → qty 1 = $29, qty 2–7 add $20/step (→ $149), qty 8–10 add $70/step (→ $359; the
 *    piecewise step change at the 25,000-subscriber boundary — see GRASSROOTS_BRACKETS below).
 *  - Movement: [{ up_to: 1, unit_amount: 5500 }, { up_to: 7, unit_amount: 3500 }, { up_to: 'inf', unit_amount: 10000 }]
 *    → qty 1 = $55, qty 2–7 add $35/step (→ $265), qty 8–11 add $100/step (→ $665; same
 *    piecewise step change at the 25,000-subscriber boundary — see MOVEMENT_BRACKETS below).
 *  - Grassroots annual (interval = year): [{ up_to: 1, unit_amount: 29000 }, { up_to: 7, unit_amount: 20000 }, { up_to: 'inf', unit_amount: 70000 }]
 *  - Movement annual (interval = year): [{ up_to: 1, unit_amount: 55000 }, { up_to: 7, unit_amount: 35000 }, { up_to: 'inf', unit_amount: 100000 }]
 *    (exactly 10× the monthly unit amounts. Same graduated shape, same quantity semantics,
 *    exclusive tax on the price. Created 2026-07-18 in BOTH modes — test-mode IDs are set in
 *    .env.production, live-mode IDs are in its comments for the launch swap. A default billing
 *    portal configuration with subscription_update enabled (price switches only, proration
 *    always_invoice) exists in test mode so monthly customers can self-switch to annual; the
 *    live-mode portal needs the same configuration at launch alongside the sk_live swap.)
 *
 * Internal plan keys are persisted in `tenants.subscription_plan` and mapped to Stripe
 * price IDs. Display names are intentionally allowed to differ from keys, but here they are
 * kept aligned (`grassroots`→"Grassroots", `movement`→"Movement", …) except the free key,
 * which presents as "Free" (renamed from "Starter" in the 2026-07-14 overhaul —
 * `LEGACY_PLAN_ALIASES` resolves stale `starter` values written before the rename).
 */

export const GB = 1024 * 1024 * 1024;

/** Every plan key that can appear in `tenants.subscription_plan`. */
export type PlanKey = 'free' | 'grassroots' | 'movement' | 'enterprise';

/** Paid plans bought via self-serve Stripe checkout (excludes free and contact-sales enterprise). */
export const PURCHASABLE_PLAN_KEYS = ['grassroots', 'movement'] as const;
export type PurchasablePlanKey = (typeof PURCHASABLE_PLAN_KEYS)[number];

/** Billing intervals a purchasable plan can be bought on. Monthly is the default everywhere;
 * annual is 10× the monthly bracket price — "2 months free". */
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Months a customer doesn't pay for on annual billing — the marketing claim "2 months free". */
export const ANNUAL_MONTHS_FREE = 2;

/**
 * `tenants.subscription_status` values that mean "this workspace has a settled plan".
 *
 * Free counts: `billing.selectFree` writes `active`/`free`, because choosing Free is a real
 * decision and the things that need one (leaving demo mode, verifying a sending identity) must
 * not be reserved for people who pay. The absence of a status — the state every brand-new
 * workspace starts in — is what "no plan chosen yet" means.
 */
export const SETTLED_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;

/** True when `tenants.subscription_status` means the workspace has settled on a plan. */
export function hasSettledPlan(subscriptionStatus: string | null | undefined): boolean {
  return (SETTLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscriptionStatus ?? '');
}

/** Annual price = monthly bracket price × this. Derived from ANNUAL_MONTHS_FREE so the
 * marketing claim and the multiplier can't drift apart. */
export const ANNUAL_PRICE_MULTIPLIER = 12 - ANNUAL_MONTHS_FREE;

/** One row of a tier's price ladder. `upTo` is the inclusive emailable-subscriber cap; the
 * bracket's position in `TierPricing.brackets` (1-based) is the Stripe `quantity` billed for it. */
export interface PriceBracket {
  /** Emailable-subscriber cap of this bracket (inclusive). */
  readonly upTo: number;
  /** USD/month at this bracket (annual billing charges ×`ANNUAL_PRICE_MULTIPLIER` per year). */
  readonly price: number;
}

/** A purchasable (or free) tier's full price ladder. `null` on `PlanDef.pricing` means the
 * tier has no ladder at all — currently only `enterprise` (custom, negotiated pricing). */
export interface TierPricing {
  /** Ascending by `upTo`. Index + 1 = the Stripe `quantity` for that bracket; the last
   * bracket's `upTo` is the tier's hard subscriber max. */
  readonly brackets: readonly PriceBracket[];
  /** Monthly send cap = this × the current bracket's `upTo` (12 on paid tiers, 2 on Free). */
  readonly emailsPerSubscriber: number;
}

export interface PlanDef {
  readonly key: PlanKey;
  /** Customer-facing name (may differ from key). */
  readonly name: string;
  /** Display cadence, e.g. 'per month' / 'forever' / 'contact us'. */
  readonly cadence: string;
  readonly blurb: string;
  /** Bracket price ladder. `null` = enterprise custom pricing (no ladder, no Stripe quantity). */
  readonly pricing: TierPricing | null;
  /** File-storage quota in bytes. null = unlimited / custom. */
  readonly storageBytes: number | null;
  /** Included staff seats. null = unlimited. */
  readonly seats: number | null;
  /** Included companion volunteers. 0 = none, null = unlimited. */
  readonly volunteers: number | null;
  /** Bought via self-serve Stripe checkout (false for free + enterprise). */
  readonly purchasable: boolean;
  /** Highlighted as the recommended tier. */
  readonly featured: boolean;
  /** Shown as a priced column on pricing surfaces (false = enterprise, footnote-only). */
  readonly displayed: boolean;
  /** Marketing feature bullets shown on app-side billing cards (see FEATURE_MATRIX below for
   * the website's comparison-table view of the same feature split — keep both in sync). */
  readonly features: readonly string[];
}

/**
 * Grassroots ladder (final 2026-07-15 pricing) — $29 ≤1,000, +$20/bracket through 25,000, then
 * +$70/bracket to the 100,000 tier max (10 brackets). Bracket widths are non-uniform (1k → 2.5k
 * → 5k-wide steps → 25k-wide steps), so the ladder is spelled out literally rather than
 * generated. Price deltas stay Stripe-graduatable: +$20 ×6, then +$70 ×3 (see Stripe ops above).
 */
const GRASSROOTS_BRACKETS: readonly PriceBracket[] = [
  { upTo: 1_000, price: 29 },
  { upTo: 2_500, price: 49 },
  { upTo: 5_000, price: 69 },
  { upTo: 10_000, price: 89 },
  { upTo: 15_000, price: 109 },
  { upTo: 20_000, price: 129 },
  { upTo: 25_000, price: 149 },
  { upTo: 50_000, price: 219 },
  { upTo: 75_000, price: 289 },
  { upTo: 100_000, price: 359 },
];

/**
 * Movement ladder (final 2026-07-15 pricing) — $55 ≤1,000, +$35/bracket through 25,000, then
 * +$100/bracket to the 200,000 tier max (11 brackets). Same stops as Grassroots plus a final
 * 200,000 bracket; roughly 1.8× Grassroots at every shared stop. Price deltas stay
 * Stripe-graduatable: +$35 ×6, then +$100 ×4 (see Stripe ops above).
 */
const MOVEMENT_BRACKETS: readonly PriceBracket[] = [
  { upTo: 1_000, price: 55 },
  { upTo: 2_500, price: 90 },
  { upTo: 5_000, price: 125 },
  { upTo: 10_000, price: 160 },
  { upTo: 15_000, price: 195 },
  { upTo: 20_000, price: 230 },
  { upTo: 25_000, price: 265 },
  { upTo: 50_000, price: 365 },
  { upTo: 75_000, price: 465 },
  { upTo: 100_000, price: 565 },
  { upTo: 200_000, price: 665 },
];

export const PLANS: readonly PlanDef[] = [
  {
    key: 'free',
    name: 'Free',
    cadence: 'forever',
    blurb: 'For getting your bearings and running a small list.',
    pricing: { brackets: [{ upTo: 1_000, price: 0 }], emailsPerSubscriber: 2 },
    storageBytes: 1 * GB,
    seats: 2,
    volunteers: 0,
    purchasable: false,
    featured: false,
    displayed: true,
    features: [
      'Unlimited contacts & households',
      'Demo workspace with sample data',
      'Up to 1,000 email subscribers',
      '2,000 emails / month',
      '2 staff seats · 1 GB storage',
      'People CRM & CSV import/export',
      'Newsletters, templates, scheduling & dynamic content',
      'AI deliverability check on every newsletter',
      'Custom reports & role-based access',
      'Community support',
    ],
  },
  {
    key: 'grassroots',
    name: 'Grassroots',
    cadence: 'per month',
    blurb: 'For a local candidate or small campaign getting to work.',
    pricing: { brackets: GRASSROOTS_BRACKETS, emailsPerSubscriber: 8 },
    storageBytes: 10 * GB,
    seats: 5,
    volunteers: 0,
    purchasable: true,
    featured: false,
    displayed: true,
    features: [
      'Everything in Free, plus:',
      'Scales smoothly from $29/month as your list grows',
      'Save 2 months with annual billing',
      'Up to 100,000 email subscribers · 8× emails/month',
      '5 staff seats · 10 GB storage',
      'Shared inbox with Gmail & Microsoft mailbox sync',
      'Forms & donations',
      'Automations & lists (segments)',
      'API access & 300+ integrations',
      'Volunteer management (teams & events)',
      'Email support',
    ],
  },
  {
    key: 'movement',
    name: 'Movement',
    cadence: 'per month',
    blurb: 'For a large campaign or advocacy operation at full tilt.',
    pricing: { brackets: MOVEMENT_BRACKETS, emailsPerSubscriber: 12 },
    storageBytes: 200 * GB,
    seats: null,
    volunteers: null,
    purchasable: true,
    featured: true,
    displayed: true,
    features: [
      'Everything in Grassroots, plus:',
      'Scales smoothly from $55/month as your list grows',
      'Save 2 months with annual billing',
      'Up to 200,000 email subscribers · 12× emails/month',
      'Unlimited staff seats & volunteers · 200 GB storage',
      'Canvassing & deliveries companion apps',
      'Companion volunteer access & field monitoring',
      'Yard signs & route optimization',
      'Turf cutting, walk lists & routes, field reports',
      'Priority support & onboarding',
    ],
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    cadence: 'contact us',
    blurb: 'For federations, parties and multi-office operations.',
    pricing: null,
    storageBytes: null,
    seats: null,
    volunteers: null,
    purchasable: false,
    featured: false,
    displayed: false,
    features: [
      'Everything in Movement, plus:',
      'Unlimited subscribers & sends',
      'Multiple linked workspaces',
      'Single sign-on (SSO)',
      'Custom integrations',
      'SLA support & guided onboarding',
    ],
  },
];

export const PLANS_BY_KEY: Record<PlanKey, PlanDef> = PLANS.reduce(
  (acc, plan) => {
    acc[plan.key] = plan;
    return acc;
  },
  {} as Record<PlanKey, PlanDef>,
);

/** Stale plan values that must still resolve after the 2026-07-14 tier rename/retirement:
 * `representative` (retired, features split into grassroots/movement — nearest fit is
 * movement) and `starter` (renamed to `free`). Resolved case-insensitively by `getPlanDef`. */
export const LEGACY_PLAN_ALIASES: Readonly<Record<string, PlanKey>> = {
  representative: 'movement',
  starter: 'free',
};

/** Resolve a (possibly mixed-case, possibly legacy) stored plan value to its definition. */
export function getPlanDef(planName: string | null | undefined): PlanDef | undefined {
  if (!planName) return undefined;
  const key = planName.toLowerCase();
  const resolvedKey = LEGACY_PLAN_ALIASES[key] ?? key;
  return (PLANS_BY_KEY as Record<string, PlanDef | undefined>)[resolvedKey];
}

/** Customer-facing display name for a stored plan value (falls back to the raw value). */
export function planDisplayName(planName: string | null | undefined): string {
  return getPlanDef(planName)?.name ?? (planName ? planName : 'Free');
}

/**
 * 1-based Stripe quantity for an emailable-subscriber count on the given plan, or `null` when
 * the count exceeds the tier's max bracket (caller should treat this as "outgrown the tier").
 * A count of 0 still bills quantity 1 (every purchasable plan has a non-zero minimum charge).
 * Plans with no pricing ladder (enterprise) always return `null` — quantity is meaningless there.
 */
export function bracketIndexForSubscribers(key: PlanKey, count: number): number | null {
  const pricing = PLANS_BY_KEY[key].pricing;
  if (!pricing) return null;
  const normalizedCount = Math.max(count, 0);
  const index = pricing.brackets.findIndex((bracket) => normalizedCount <= bracket.upTo);
  return index === -1 ? null : index + 1;
}

/** The highest valid Stripe quantity (= number of brackets) for a plan. `Infinity` for plans
 * with no pricing ladder (enterprise — no quantity ceiling applies). */
export function maxQuantity(key: PlanKey): number {
  const pricing = PLANS_BY_KEY[key].pricing;
  return pricing ? pricing.brackets.length : Infinity;
}

/** The price bracket for a given Stripe quantity, clamping `qty` into the valid `[1, maxQuantity]`
 * range. Throws only if called against a plan with no pricing ladder (enterprise) — callers
 * should guard with `PLANS_BY_KEY[key].pricing !== null` first; purchasable/free plans always
 * have at least one bracket. */
export function bracketForQuantity(key: PlanKey, qty: number): PriceBracket {
  const pricing = PLANS_BY_KEY[key].pricing;
  if (!pricing) {
    throw new Error(`plan "${key}" has no pricing ladder (enterprise is custom-priced)`);
  }
  const max = pricing.brackets.length;
  const clampedIndex = Math.min(Math.max(qty, 1), max) - 1;
  const bracket = pricing.brackets[clampedIndex];
  if (!bracket) {
    // Unreachable: clampedIndex is always within [0, brackets.length - 1] above.
    throw new Error(`unreachable: no bracket at index ${clampedIndex} for plan "${key}"`);
  }
  return bracket;
}

/** Emailable-subscriber cap for a Stripe quantity on a plan. */
export function subscriberCapForQuantity(key: PlanKey, qty: number): number {
  return bracketForQuantity(key, qty).upTo;
}

/** Monthly email-send cap for a Stripe quantity on a plan (= subscriber cap × the plan's
 * `emailsPerSubscriber` multiplier). */
export function emailCapForQuantity(key: PlanKey, qty: number): number {
  const pricing = PLANS_BY_KEY[key].pricing;
  const multiplier = pricing?.emailsPerSubscriber ?? 0;
  return subscriberCapForQuantity(key, qty) * multiplier;
}

/** USD/month price for a Stripe quantity on a plan. */
export function priceForQuantity(key: PlanKey, qty: number): number {
  return bracketForQuantity(key, qty).price;
}

/** USD/year price for a Stripe quantity on a plan — exactly `ANNUAL_PRICE_MULTIPLIER`× the
 * monthly bracket price ("2 months free"). */
export function annualPriceForQuantity(key: PlanKey, qty: number): number {
  return priceForQuantity(key, qty) * ANNUAL_PRICE_MULTIPLIER;
}

/** Monthly-equivalent of an annual USD total, rounded to the nearest whole dollar (290 → 24).
 * The customer-facing framing for annual prices: "$24 per month, billed annually as $290" —
 * surfaces that show it must keep the exact annual total alongside and carry the rounding
 * disclaimer, since equivalent × 12 ≠ the billed total. */
export function monthlyEquivalentUsd(annualUsd: number): number {
  return Math.round(annualUsd / 12);
}

/** "$29" for whole dollars; tolerates cent amounts defensively ("$24.17"). */
function usdLabel(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Cadence line for surfaces with a monthly/annual toggle. Non-purchasable plans keep their
 * static cadence ('forever' / 'contact us'); paid plans read 'per month' or
 * 'per month, billed annually'. */
export function cadenceLabel(plan: PlanDef, interval: BillingInterval): string {
  if (!plan.purchasable) return plan.cadence;
  return interval === 'year' ? 'per month, billed annually' : plan.cadence;
}

/** Short "starting at" label for a plan card, e.g. '$0' (free), 'From $29' (grassroots),
 * 'From $55' (movement), 'Custom' (enterprise). With `interval: 'year'`, paid plans show the
 * rounded monthly-equivalent of the annual price, e.g. 'From $24'. */
export function startingPriceLabel(plan: PlanDef, interval: BillingInterval = 'month'): string {
  const usd = startingPriceUsd(plan, interval);
  if (usd === null) return 'Custom';
  return usd === 0 ? '$0' : `From ${usdLabel(usd)}`;
}

/** Numeric USD "starting at" price for a plan (0 = free, `null` = enterprise/custom, no ladder).
 * The numeric sibling of `startingPriceLabel`, for surfaces that convert prices to another
 * display currency (the marketing site's home teaser). With `interval: 'year'`, returns the
 * rounded monthly-equivalent of the annual price. */
export function startingPriceUsd(plan: PlanDef, interval: BillingInterval = 'month'): number | null {
  if (!plan.pricing) return null;
  const first = plan.pricing.brackets[0];
  if (!first) {
    // Unreachable: every non-null TierPricing in PLANS has at least one bracket.
    throw new Error(`unreachable: plan "${plan.key}" pricing has no brackets`);
  }
  if (interval === 'year') return monthlyEquivalentUsd(first.price * ANNUAL_PRICE_MULTIPLIER);
  return first.price;
}

/** Live price label for a plan at a given emailable-subscriber count, e.g. '$69' (in-ladder),
 * 'Contact us' (past the tier's max bracket), 'Custom' (enterprise, no ladder). With
 * `interval: 'year'`, the label is the rounded monthly-equivalent of the annual price ('$58').
 * Used by the website pricing slider and the frontend billing upgrade cards. */
export function priceLabelAt(plan: PlanDef, subscribers: number, interval: BillingInterval = 'month'): string {
  if (!plan.pricing) return 'Custom';
  const index = bracketIndexForSubscribers(plan.key, subscribers);
  if (index === null) return 'Contact us';
  const monthly = priceForQuantity(plan.key, index);
  if (interval === 'year') {
    return usdLabel(monthlyEquivalentUsd(monthly * ANNUAL_PRICE_MULTIPLIER));
  }
  return usdLabel(monthly);
}

/** Capability ordering of the tiers — used by `planAllowsFeature` for min-plan gating. */
const PLAN_RANK: Record<PlanKey, number> = { free: 0, grassroots: 1, movement: 2, enterprise: 3 };

/**
 * Server-enforced feature gates — the machine-readable core of FEATURE_MATRIX below (keep the
 * two in sync when a feature moves between tiers). The backend's plan-gate middleware
 * (apps/backend modules/billing/plan-gate.ts) blocks mutations in a gated module for tenants
 * below the feature's minimum plan.
 */
export const GATED_FEATURES = {
  forms: { minPlan: 'grassroots', label: 'Forms' },
  // The shared inbox (Gmail / Microsoft mailbox sync). Paid-only since 2026-08-01: a synced
  // team inbox is a complete standalone product (Front's entry plan is $25/seat/month with no
  // free tier), its storage and sync cost grow without bound, and a workspace that only wants
  // an inbox never meets the levers that meter everything else (subscribers, sends) — so on
  // Free it was a permanent freeload. Unlike other gated features, ACCESS is blocked too, not
  // just mutations (operator decision 2026-08-01); the demo workspace's seeded inbox is exempt.
  // Synced mail is purged 30 days after a downgrade to Free (billing/inbox-purge).
  inbox: { minPlan: 'grassroots', label: 'Shared inbox (mailbox sync)' },
  // API access covers every keyed surface (Zapier, server-side form/RSVP/signup submits) AND
  // key issuance. Paid-only since 2026-07-27: a free workspace with a scriptable write endpoint
  // is the cheapest way to bulk-load a junk list into shared sending infrastructure, and the
  // per-tenant keyed rate limit is deliberately generous for real integrations.
  api: { minPlan: 'grassroots', label: 'API access & integrations' },
  donations: { minPlan: 'grassroots', label: 'Donations' },
  automations: { minPlan: 'grassroots', label: 'Automations' },
  lists: { minPlan: 'grassroots', label: 'Lists (segments)' },
  volunteers: { minPlan: 'grassroots', label: 'Volunteer management' },
  canvassing: { minPlan: 'movement', label: 'Canvassing' },
  deliveries: { minPlan: 'movement', label: 'Deliveries' },
  companions: { minPlan: 'movement', label: 'Companion volunteer access' },
} as const satisfies Record<string, { minPlan: PlanKey; label: string }>;

export type GatedFeature = keyof typeof GATED_FEATURES;

/**
 * Days between a downgrade to Free and the permanent deletion of the workspace's synced
 * shared-inbox mail. Access is cut off at downgrade time (GATED_FEATURES.inbox above); this is
 * only the destruction delay. Upgrading within the window cancels the deletion and restores the
 * inbox intact; after it, the mail is unrecoverable even on re-upgrade, because a fresh mailbox
 * connection only backfills the initial-sync window. Stated in the in-app inbox lock panel, the
 * cancellation email and the Help Center — keep those in sync if this changes.
 */
export const INBOX_PURGE_DELAY_DAYS = 30;

/** Whether a (possibly legacy/mixed-case) stored plan value includes a gated feature. */
export function planAllowsFeature(planName: string | null | undefined, feature: GatedFeature): boolean {
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;
  return PLAN_RANK[plan.key] >= PLAN_RANK[GATED_FEATURES[feature].minPlan];
}

/**
 * Minimum plan for real (paid) household geocoding. Kept OUT of `GATED_FEATURES`/`FEATURE_MATRIX`
 * deliberately: this is a backend cost control, not a marketed tRPC-module feature — the heavy
 * geocoding consumers (canvassing turf-cutting, delivery routing) are already Movement-gated via
 * `GATED_FEATURES`, and this just stops lower tiers from incurring Google Geocoding API spend on
 * plain household map pins / ward enrichment. Mock/test geocoding is free and stays ungated.
 */
export const GEOCODING_MIN_PLAN: PlanKey = 'movement';

/** Whether a stored plan value may incur real (paid) geocoding — Movement and up. See `GEOCODING_MIN_PLAN`. */
export function planAllowsGeocoding(planName: string | null | undefined): boolean {
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;
  return PLAN_RANK[plan.key] >= PLAN_RANK[GEOCODING_MIN_PLAN];
}

/**
 * Minimum plan for choosing where a workspace's data is stored (see ../data-residency.ts).
 *
 * Kept OUT of `GATED_FEATURES` for the same reason as `GEOCODING_MIN_PLAN`: that registry gates
 * tRPC MODULES through `planFeatureGate`, and residency is not a module — there is no procedure
 * to refuse. It is a provisioning attribute chosen once, at signup, before any plan has been
 * selected. Signup therefore records the answer from anyone and TELLS them it needs Movement;
 * it does not refuse the choice at a point where nobody could have paid yet.
 *
 * It does appear in `FEATURE_MATRIX` (the 'Movement only' group), because the signup form now
 * states this rule to every user and the pricing page has to agree with it.
 */
export const DATA_RESIDENCY_MIN_PLAN: PlanKey = 'movement';

/** Whether a stored plan value includes choosing a data region — Movement and up. */
export function planAllowsDataResidency(planName: string | null | undefined): boolean {
  const plan = getPlanDef(planName) ?? PLANS_BY_KEY.free;
  return PLAN_RANK[plan.key] >= PLAN_RANK[DATA_RESIDENCY_MIN_PLAN];
}

/**
 * Shared feature-comparison matrix — drives the website's Mailchimp-style comparison table
 * (plan-header cards + feature rows). This is a SEPARATE data source from each PlanDef's
 * `features[]` bullet list (which drives the app-side billing cards): `features[]` is a short,
 * narrative "everything in X, plus Y" list; `FEATURE_MATRIX` is an exhaustive row-by-row grid.
 * They describe the same feature split from two different plan keys, so keep them in sync by
 * hand when a feature moves between tiers — there is no single source both surfaces read from.
 */
export interface FeatureMatrixRow {
  readonly label: string;
  /** true = ✓, false = ✗, string = a text cell (e.g. "Up to 1,000", "2 seats"). */
  readonly values: Readonly<Record<'free' | 'grassroots' | 'movement', boolean | string>>;
}

export interface FeatureMatrixGroup {
  readonly category: string;
  readonly rows: readonly FeatureMatrixRow[];
}

export const FEATURE_MATRIX: readonly FeatureMatrixGroup[] = [
  {
    category: 'Usage',
    rows: [
      {
        label: 'Emailable subscribers',
        values: { free: 'Up to 1,000', grassroots: 'Up to 100,000', movement: 'Up to 200,000' },
      },
      {
        label: 'Emails / month',
        values: { free: '2,000', grassroots: '8× your subscriber cap', movement: '12× your subscriber cap' },
      },
      { label: 'File storage', values: { free: '1 GB', grassroots: '10 GB', movement: '200 GB' } },
      { label: 'Staff seats', values: { free: '2', grassroots: '5', movement: 'Unlimited' } },
      { label: 'Companion volunteers', values: { free: '0', grassroots: '0', movement: 'Unlimited' } },
    ],
  },
  {
    category: 'Everything in every plan',
    rows: [
      { label: 'Unlimited contacts & households', values: { free: true, grassroots: true, movement: true } },
      { label: 'People CRM', values: { free: true, grassroots: true, movement: true } },
      { label: 'CSV import/export', values: { free: true, grassroots: true, movement: true } },
      { label: 'Newsletters', values: { free: true, grassroots: true, movement: true } },
      { label: 'Send from your own verified domain', values: { free: true, grassroots: true, movement: true } },
      { label: 'Pre-built templates', values: { free: true, grassroots: true, movement: true } },
      { label: 'Custom-coded templates', values: { free: true, grassroots: true, movement: true } },
      { label: 'Email scheduling', values: { free: true, grassroots: true, movement: true } },
      { label: 'AI deliverability check on every send', values: { free: true, grassroots: true, movement: true } },
      { label: 'Dynamic content', values: { free: true, grassroots: true, movement: true } },
      { label: 'Custom reports', values: { free: true, grassroots: true, movement: true } },
      { label: 'Role-based access', values: { free: true, grassroots: true, movement: true } },
      { label: 'Demo workspace', values: { free: true, grassroots: true, movement: true } },
    ],
  },
  {
    category: 'Grow & engage',
    rows: [
      {
        label: 'Shared inbox (Gmail & Microsoft mailbox sync)',
        values: { free: false, grassroots: true, movement: true },
      },
      { label: 'Forms', values: { free: false, grassroots: true, movement: true } },
      { label: 'Donations', values: { free: false, grassroots: true, movement: true } },
      { label: 'API access & 300+ integrations', values: { free: false, grassroots: true, movement: true } },
      { label: 'Automations', values: { free: false, grassroots: true, movement: true } },
      { label: 'Lists (segments)', values: { free: false, grassroots: true, movement: true } },
      {
        label: 'Volunteer management (teams & events)',
        values: { free: false, grassroots: true, movement: true },
      },
    ],
  },
  {
    category: 'Canvassing',
    rows: [
      { label: 'Canvassing companion app', values: { free: false, grassroots: false, movement: true } },
      { label: 'Turf cutting', values: { free: false, grassroots: false, movement: true } },
      { label: 'Walk lists & routes', values: { free: false, grassroots: false, movement: true } },
      { label: 'Field reports', values: { free: false, grassroots: false, movement: true } },
    ],
  },
  {
    category: 'Deliveries',
    rows: [
      { label: 'Deliveries companion app', values: { free: false, grassroots: false, movement: true } },
      { label: 'Yard sign requests', values: { free: false, grassroots: false, movement: true } },
      { label: 'Route optimization', values: { free: false, grassroots: false, movement: true } },
      { label: 'Delivery monitoring', values: { free: false, grassroots: false, movement: true } },
    ],
  },
  {
    category: 'Movement only',
    rows: [
      {
        label: 'Companion volunteer access & monitoring',
        values: { free: false, grassroots: false, movement: true },
      },
      // Backed by DATA_RESIDENCY_MIN_PLAN above. Every other plan is stored where the platform
      // runs, which is why the lower cells say "Canada" rather than ✗ — those workspaces still
      // have a data region, they just do not get to pick it. The movement cell is a STRING on
      // purpose: a bare ✓ rendered as "Included" next to two "Canada" cells read as nonsense
      // (Canada / Canada / Included — included *what*?).
      {
        label: 'Where your data is stored',
        values: { free: 'Canada', grassroots: 'Canada', movement: 'Choose your region' },
      },
      {
        label: 'Support',
        values: { free: 'Community', grassroots: 'Email', movement: 'Priority + onboarding' },
      },
    ],
  },
];
