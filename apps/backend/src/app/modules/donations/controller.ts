import { TRPCError } from '@trpc/server';
import {
  CA_PROVINCES,
  STRIPE_CONNECT_COUNTRIES,
  US_STATES,
  toStripeCurrency,
  toWorkspaceCurrency,
  type DonationAddressType,
} from '@common';
import { env } from '../../../env';
import { BadRequestError, PreconditionFailedError } from '../../errors/app-errors';
import { getStripe, isMockMode } from '../../lib/stripe-platform-client';
import { torontoDateString } from '../../lib/pdf/pdf-common';
import { assertStripeConnectReady, getCachedConnectState, getConnectedAccountId } from './stripe-connect';
import { BaseController } from '../../lib/base.controller';
import { pinnedCampaignId } from '../../lib/tenant-context';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { DonationsRepo } from './repositories/donations.repo';
import { DonationPeriodsRepo } from './repositories/periods.repo';
import { DonationPledgesRepo } from './repositories/pledges.repo';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { WorkflowsController } from '../workflows/controller';
import type { Selectable, Transaction, Updateable } from 'kysely';
import { logger } from '../../logger';
import { assertTenantMayAcceptDonations, tenantMayAcceptDonations, type SettingsLookup } from './donation-guards';
import { StripeDonationProcessor } from './processors/stripe-processor';
import { DonationReceiptsController } from './receipts/controller';

// Donation lifecycle statuses. Only 'succeeded' counts toward cumulative/contribution totals,
// so flipping a reversed gift to one of the terminal states drops it out of those sums.
const DONATION_STATUS = {
  succeeded: 'succeeded',
  refunded: 'refunded',
  disputed: 'disputed',
} as const;
type ReversedStatus = typeof DONATION_STATUS.refunded | typeof DONATION_STATUS.disputed;

/**
 * Stripe billing address → donation address snapshot. Returns null when Stripe collected nothing
 * usable (pre-address-collection sessions, some wallet payments) — issuance then falls back to
 * the household address or holds with "needs donor address".
 */
export function mapStripeBillingAddress(
  addr:
    | {
        line1?: string | null;
        line2?: string | null;
        city?: string | null;
        state?: string | null;
        postal_code?: string | null;
        country?: string | null;
      }
    | null
    | undefined,
): DonationAddressType | null {
  if (!addr?.line1 || !addr.city || !addr.country) return null;
  return {
    street: addr.line1,
    apt: addr.line2 || null,
    city: addr.city,
    state: addr.state || '',
    zip: addr.postal_code || '',
    country: addr.country,
  };
}

/**
 * A "YYYY-MM-DD" gift date from the record-donation dialog → the timestamp stored in
 * `donations.created_at`, which is the column receipts read for the printed gift date and the
 * coverage year (see the receipts controller's use of `torontoDateString`).
 *
 * Midday UTC, not midnight: receipts format the timestamp in America/Toronto, and midnight UTC
 * formats as the previous day there — the printed-date bug from REVIEW4 T1-1. Midday UTC lands on
 * the intended day in every timezone the app formats in. Past dates are unrestricted (staff enter
 * cheques months late); a date beyond {@link latestAcceptableGiftDate} is refused.
 */
export function parseGiftDate(giftDate: string, now: Date = new Date()): Date {
  const parsed = new Date(`${giftDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError('That gift date is not a real date. Use YYYY-MM-DD.');
  }
  if (giftDate > latestAcceptableGiftDate(now)) {
    throw new BadRequestError('A gift cannot be dated in the future. Use today’s date or earlier.');
  }
  return parsed;
}

/**
 * The latest gift date the server accepts: the day after today in America/Toronto.
 *
 * The dialog pre-fills the gift date with the recorder's own calendar day, which can be one day
 * ahead of Toronto's (London between midnight and about 5am, mornings in Sydney). Refusing that
 * pre-filled value made the dialog reject its own default. No inhabited timezone runs more than a
 * day ahead of Toronto, so one day of slack covers every recorder while still refusing a date
 * genuinely in the future.
 *
 * Computed by adding a day to the Toronto calendar date rather than adding 24 hours to the
 * instant: on the November clock change a 24-hour jump lands back on the same Toronto day.
 */
function latestAcceptableGiftDate(now: Date): string {
  const next = new Date(`${torontoDateString(now)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Which country an entry of `donations.allowed_regions` belongs to, or null when it belongs to no
 * country the settings page can produce.
 *
 * The settings page writes bare two-letter codes for Canada (CA_PROVINCES) and the United States
 * (US_STATES) — the two lists share no code — and ISO 3166-2 "CC-XX" codes for the other countries
 * it offers regions for (DE-BY, FR-IDF, IN-MH). A code whose country cannot be identified is still
 * matched against the donor's state; only the country half of the comparison is skipped.
 */
function regionCodeCountry(code: string): string | null {
  const dash = code.indexOf('-');
  if (dash > 0) return code.slice(0, dash);
  if (CA_PROVINCES.some((p) => p.code === code)) return 'CA';
  if (US_STATES.some((s) => s.code === code)) return 'US';
  return null;
}

/**
 * A donor's country field → the ISO two-letter code the residency settings are written in.
 *
 * Payment providers send the code ("CA"), but a staff-typed or household-copied address can carry
 * the printed name ("Canada"). Comparing a name against a list of codes refused every such donor,
 * so a recognized country name is folded to its code; anything else is passed through unchanged
 * (upper-cased), which leaves an unknown spelling to fail the country list as before.
 */
function normalizeCountryCode(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!value) return '';
  const named = STRIPE_CONNECT_COUNTRIES.find((c) => c.name.toUpperCase() === value);
  return named ? named.code : value;
}

/**
 * Whether a donor's state/province field satisfies one allowed region code. Payment providers send
 * the subdivision without the country prefix ("BY"), while the stored code carries it ("DE-BY"), so
 * both spellings count as a match.
 */
function regionCodeMatchesState(code: string, state: string): boolean {
  if (!state) return false;
  const dash = code.indexOf('-');
  return state === code || (dash > 0 && state === code.slice(dash + 1));
}

/**
 * True when Stripe refused a subscription cancel because there is nothing left to cancel: the
 * subscription is already canceled, or it no longer exists on the connected account. Either way
 * the donor's card is not being charged, so marking the pledge cancelled is honest. Every other
 * Stripe failure means the subscription may still be live and must be surfaced to the caller.
 */
function isAlreadyCancelledInStripe(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = 'code' in err ? err.code : undefined;
  const message = err instanceof Error ? err.message : '';
  return code === 'resource_missing' || /no such subscription|already (been )?canceled/i.test(message);
}

export class DonationsController extends BaseController<'donations', DonationsRepo> {
  private settingsRepo = new SettingsRepo();
  private periodsRepo = new DonationPeriodsRepo();
  private pledgesRepo = new DonationPledgesRepo();
  private campaignsRepo = new CampaignsRepo();

  // Bound settings accessor handed to the fail-closed guards, so they stay decoupled from the
  // settings repo while reusing the same lookup the controller already uses.
  private readonly settingsLookup: SettingsLookup = (tenantId, key) => this.getSettingVal(tenantId, key);

  constructor() {
    super(new DonationsRepo());
  }

  /**
   * Deleting a gift has to respect its paper trail (fk_donation_receipt_items_donation):
   * a gift covered by an OFFICIAL document (tax receipt or year-end statement — issued or
   * cancelled, both are retained records that cite it) cannot be deleted; the reversal flow
   * (refund/chargeback) is how a receipted gift is undone. A gift covered only by its automatic
   * acknowledgement CAN be deleted: the acknowledgement's items are detached and the
   * acknowledgement itself is cancelled, since a thank-you note pins no legal state.
   */
  public override async delete(tenant_id: string, idToDelete: string, userId?: string) {
    const result = await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        await this.releaseReceiptLinksForDelete(trx, tenant_id, [idToDelete], userId);
        return this.getRepo().delete({ tenant_id, id: idToDelete }, trx);
      });
    try {
      if (userId != null) {
        await this.userActivity.log({
          tenant_id,
          user_id: userId,
          activity: 'delete',
          entity: 'donations',
          entity_id: String(idToDelete),
          quantity: 1,
          metadata: { id: idToDelete },
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log delete donation activity');
    }
    return result;
  }

  public override async deleteMany(tenant_id: string, idsToDelete: string[], userId?: string) {
    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        await this.releaseReceiptLinksForDelete(trx, tenant_id, idsToDelete, userId);
        return this.getRepo().deleteMany({ tenant_id, ids: idsToDelete }, trx);
      });
  }

  /** See delete()/deleteMany() above. Runs inside the same transaction as the row delete. */
  private async releaseReceiptLinksForDelete(
    trx: Transaction<Models>,
    tenant_id: string,
    ids: string[],
    userId?: string,
  ): Promise<void> {
    if (ids.length === 0) return;

    const official = await trx
      .selectFrom('donation_receipt_items as dri')
      .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
      .select('dri.donation_id')
      .where('dri.tenant_id', '=', tenant_id)
      .where('dri.donation_id', 'in', ids)
      .where('dr.kind', '!=', 'acknowledgement')
      .limit(1)
      .executeTakeFirst();
    if (official) {
      throw new BadRequestError(
        'This gift is covered by an official tax receipt or year-end statement, which must be retained. ' +
          'Reverse or refund the gift instead — that cancels its receipts and keeps the paper trail.',
      );
    }

    const ackReceipts = await trx
      .selectFrom('donation_receipt_items as dri')
      .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
      .select('dr.id')
      .distinct()
      .where('dri.tenant_id', '=', tenant_id)
      .where('dri.donation_id', 'in', ids)
      .where('dr.kind', '=', 'acknowledgement')
      .execute();
    if (ackReceipts.length === 0) return;
    const ackIds = ackReceipts.map((r) => String(r.id));

    await trx
      .deleteFrom('donation_receipt_items')
      .where('tenant_id', '=', tenant_id)
      .where('receipt_id', 'in', ackIds)
      .execute();
    await trx
      .updateTable('donation_receipts')
      .set({
        status: 'cancelled',
        cancelled_reason: 'Donation deleted',
        cancelled_at: new Date(),
        cancelled_by: userId ?? null,
        updated_at: new Date(),
        ...(userId != null ? { updatedby_id: userId } : {}),
      })
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', ackIds)
      .where('status', '=', 'issued')
      .execute();
  }

  public async getPersonDonationsList(tenantId: string, personId: string) {
    return this.getRepo().getPersonDonationsList(tenantId, personId);
  }

  public async getPersonCumulativeDonations(tenantId: string, personId: string, year: number): Promise<number> {
    return this.getRepo().getPersonCumulativeDonations(tenantId, personId, year);
  }

  /** Header-tile aggregates for the donations page, computed in SQL (see repo). */
  public async getDonationsLedgerSummary(tenantId: string, scope: 'all' | 'one-time') {
    return this.getRepo().getLedgerSummary(tenantId, scope);
  }

  /** One gift with its receipt state and campaign label — the donation detail page. */
  public async getDonationDetail(tenantId: string, donationId: string) {
    // Campaigns §15 — by-id reads carry no campaign key, so the middleware guard never fires;
    // without this pin a campaign-pinned Editor could open any campaign's gift by knowing its id.
    // A pinned caller asking for another campaign's gift gets the same NOT_FOUND as a bad id.
    const pinned = pinnedCampaignId();
    const row = await this.getRepo()
      .db.selectFrom('donations')
      .leftJoin('persons', 'persons.id', 'donations.person_id')
      .leftJoin('campaigns', 'campaigns.id', 'donations.campaign_id')
      .selectAll('donations')
      .select((eb) => [
        eb.fn.coalesce('persons.first_name', 'donations.first_name').as('person_first_name'),
        eb.fn.coalesce('persons.last_name', 'donations.last_name').as('person_last_name'),
        eb.fn.coalesce('persons.email', 'donations.email').as('person_email'),
        'campaigns.name as campaign_name',
      ])
      .where('donations.tenant_id', '=', tenantId)
      .where('donations.id', '=', donationId)
      .$if(pinned != null, (b) => b.where('donations.campaign_id', '=', String(pinned)))
      .executeTakeFirst();
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Donation not found' });
    }
    const [withState] = await this.getRepo().withReceiptState(tenantId, [row]);
    return withState;
  }

  // ── Donation Periods ────────────────────────────────────────────────────────

  public async getDonationPeriods(tenantId: string) {
    return this.periodsRepo.getAllForTenant(tenantId);
  }

  public async createDonationPeriod(
    tenantId: string,
    userId: string,
    payload: { name: string; start_date: string; end_date?: string | null; limit_amount: number; campaign_id?: string },
  ) {
    // Contribution-limit windows are per campaign (§15).
    const campaignId = await this.campaignsRepo.resolveForWrite({
      tenant_id: tenantId,
      campaign_id: payload.campaign_id,
    });
    return this.periodsRepo.db
      .insertInto('donation_periods')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: payload.name,
        start_date: payload.start_date,
        end_date: payload.end_date ? payload.end_date : null,
        limit_amount: payload.limit_amount,
        is_active: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async updateDonationPeriod(
    tenantId: string,
    userId: string,
    id: string,
    payload: {
      name?: string;
      start_date?: string;
      end_date?: string | null;
      limit_amount?: number;
      is_active?: boolean;
    },
  ) {
    const set: Updateable<Models['donation_periods']> = { updatedby_id: userId, updated_at: new Date() };
    if (payload.name !== undefined) set.name = payload.name;
    if (payload.start_date !== undefined) set.start_date = payload.start_date;
    if ('end_date' in payload) set.end_date = payload.end_date ?? null;
    if (payload.limit_amount !== undefined) set.limit_amount = payload.limit_amount;
    if (payload.is_active !== undefined) set.is_active = payload.is_active;

    return this.periodsRepo.db
      .updateTable('donation_periods')
      .set(set)
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async deleteDonationPeriod(tenantId: string, id: string) {
    await this.periodsRepo.db
      .deleteFrom('donation_periods')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  // ── Pledges ─────────────────────────────────────────────────────────────────

  public async getTenantPledgesList(tenantId: string) {
    return this.pledgesRepo.getAllForTenant(tenantId);
  }

  public async getPersonPledges(tenantId: string, personId: string) {
    return this.pledgesRepo.getForPerson(tenantId, personId);
  }

  public async cancelPledge(tenantId: string, pledgeId: string, userId: string) {
    const pledge = await this.pledgesRepo.db
      .selectFrom('donation_pledges')
      .selectAll()
      .where('id', '=', pledgeId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!pledge) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Pledge not found.' });
    }

    // Cancel in Stripe if there's a real subscription — on the tenant's connected account.
    // Nothing below marks the row cancelled unless Stripe has actually stopped charging the donor:
    // saying "cancelled" while the card is still billed monthly is the worst outcome here.
    if (pledge.stripe_subscription_id && !pledge.stripe_subscription_id.startsWith('sub_mock_') && !isMockMode) {
      const accountId = await getConnectedAccountId(tenantId);
      if (!accountId) {
        throw new PreconditionFailedError(
          'This monthly gift is billed through Stripe, but this workspace has no Stripe account connected, so the charge cannot be stopped here. Reconnect Stripe and cancel again, or cancel the subscription in your Stripe dashboard.',
        );
      }
      try {
        await getStripe().subscriptions.cancel(pledge.stripe_subscription_id, {}, { stripeAccount: accountId });
      } catch (err) {
        if (!isAlreadyCancelledInStripe(err)) {
          logger.error({ err }, 'Stripe subscription cancel failed');
          throw new PreconditionFailedError(
            'Stripe did not cancel this monthly gift, so the donor is still being charged. Try again in a minute; if it keeps failing, cancel the subscription in your Stripe dashboard.',
            undefined,
            { cause: err },
          );
        }
        logger.info({ err }, 'Stripe subscription was already cancelled; marking the pledge cancelled');
      }
    }

    return this.pledgesRepo.db
      .updateTable('donation_pledges')
      .set({
        status: 'cancelled',
        cancelled_at: new Date(),
        updatedby_id: userId,
        updated_at: new Date(),
      })
      .where('id', '=', pledgeId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async getSettingVal(tenantId: string, key: string): Promise<any> {
    const row = await this.settingsRepo.getByKey({ tenant_id: tenantId, key });
    return row?.value;
  }

  /**
   * The workspace's transaction currency, lowercased for Stripe. Falls back to the default
   * rather than throwing: a workspace that never opened Settings still has to be able to
   * take a gift, and CAD is what every charge was hardcoded to before this setting existed.
   */
  private async resolveStripeCurrency(tenantId: string): Promise<string> {
    return toStripeCurrency(toWorkspaceCurrency(await this.getSettingVal(tenantId, 'organization.currency')));
  }

  public calculateTaxCredit(
    amountCents: number,
    cumulativeBeforeCents: number,
    tiers: Array<{ limit: number; rate: number }>,
  ): number {
    if (!tiers || tiers.length === 0) return 0;

    const sortedTiers = [...tiers].sort((a, b) => a.limit - b.limit);
    let creditCents = 0;
    let remainingAmount = amountCents;
    let currentCumulative = cumulativeBeforeCents;

    for (const tier of sortedTiers) {
      const tierLimitCents = tier.limit * 100;

      if (currentCumulative < tierLimitCents && remainingAmount > 0) {
        const availableInTier = tierLimitCents - currentCumulative;
        const amountInTier = Math.min(remainingAmount, availableInTier);

        creditCents += amountInTier * tier.rate;
        remainingAmount -= amountInTier;
        currentCumulative += amountInTier;
      }
    }

    return Math.round(creditCents);
  }

  /**
   * Resolve the active limit window for the tenant.
   * Returns { limitCents, cumulative } using the donation_period if one is active,
   * or falling back to the legacy calendar-year setting.
   */
  private async resolveLimitWindow(
    tenantId: string,
    personId: string,
  ): Promise<{ limitCents: number; cumulative: number; periodName: string | null }> {
    const activePeriod = await this.periodsRepo.getActivePeriodForToday(tenantId);

    if (activePeriod) {
      const cumulative = await this.getRepo().getPersonCumulativeDonationsForPeriod(
        tenantId,
        personId,
        new Date(activePeriod.start_date),
        activePeriod.end_date ? new Date(activePeriod.end_date) : null,
      );
      return {
        limitCents: Number(activePeriod.limit_amount),
        cumulative,
        periodName: activePeriod.name,
      };
    }

    // Fallback: calendar year + legacy settings
    const limitVal = await this.getSettingVal(tenantId, 'donations.limit');
    const limitSetting = limitVal !== undefined && limitVal !== null ? Number(limitVal) : 1000;
    const currentYear = new Date().getFullYear();
    const cumulative = await this.getRepo().getPersonCumulativeDonations(tenantId, personId, currentYear);
    return { limitCents: limitSetting * 100, cumulative, periodName: null };
  }

  /**
   * Perform eligibility checks based on limit and residency restrictions.
   * For recurring donations, pass monthlyAmountCents and remainingMonths to enforce
   * the total commitment against the period limit.
   */
  public async checkEligibility(
    tenantId: string,
    personId: string,
    amountCents: number,
    address: { country?: string; state?: string },
    options?: { isRecurring?: boolean; remainingMonths?: number },
  ) {
    const { limitCents, cumulative, periodName } = await this.resolveLimitWindow(tenantId, personId);

    // For recurring: check total commitment (monthly × remaining months) against limit
    const effectiveAmount =
      options?.isRecurring && options?.remainingMonths ? amountCents * options.remainingMonths : amountCents;

    if (cumulative + effectiveAmount > limitCents) {
      const allowedAmount = Math.max(0, limitCents - cumulative) / 100;
      const periodLabel = periodName ? `during the "${periodName}" period` : 'this year';
      const limitLabel = limitCents / 100;
      return {
        eligible: false,
        reason: `Donation exceeds the maximum limit of $${limitLabel} ${periodLabel}. Already donated: $${cumulative / 100}. Maximum additional allowed: $${allowedAmount}.`,
      };
    }

    // Residency check
    const restrictResidency = (await this.getSettingVal(tenantId, 'donations.restrict_residency')) === true;
    const allowedCountries = String((await this.getSettingVal(tenantId, 'donations.allowed_countries')) || '').trim();
    const allowedRegions = String((await this.getSettingVal(tenantId, 'donations.allowed_regions')) || '').trim();

    if (restrictResidency) {
      const country = normalizeCountryCode(address.country || '');
      const state = (address.state || '').trim().toUpperCase();

      // Restriction on with no countries selected enforces nothing — every donor passes. This is
      // deliberately left permissive (refusing everyone would take a workspace's donations offline
      // from an empty settings field); the settings page is the place to warn about it.
      if (allowedCountries) {
        const countriesList = allowedCountries.split(',').map((c) => normalizeCountryCode(c));
        if (!country || !countriesList.includes(country)) {
          return {
            eligible: false,
            reason: `Donor must reside in one of the allowed countries: ${allowedCountries}.`,
          };
        }
      }

      // A configured region list is a closed list: the donor must match one of its codes, and a
      // donor whose country contributes no code to the list is refused rather than waved through.
      // This gate is fail-closed by policy — an admin who wants a whole country to give adds no
      // region for it, and the country list alone then decides.
      //
      // The match is still code-aware: a code names both a country and a subdivision, so "NY" only
      // admits a donor whose country is the United States (regionCodeCountry), and the stored
      // "DE-BY" spelling matches a provider's bare "BY" (regionCodeMatchesState).
      const regionsList = allowedRegions
        .split(',')
        .map((r) => r.trim().toUpperCase())
        .filter((r) => r.length > 0);
      if (regionsList.length > 0) {
        const matched = regionsList.some((r) => {
          const codeCountry = regionCodeCountry(r);
          if (codeCountry && country && codeCountry !== country) return false;
          return regionCodeMatchesState(r, state);
        });
        if (!matched) {
          return {
            eligible: false,
            reason: `Donor must reside in one of the allowed provinces/states: ${regionsList.join(', ')}.`,
          };
        }
      }
    }

    return { eligible: true };
  }

  /**
   * Get donation stats for a person relative to the active limit window.
   */
  public async getDonationStats(tenantId: string, personId: string) {
    const { limitCents, cumulative, periodName } = await this.resolveLimitWindow(tenantId, personId);
    return {
      cumulativeAmount: cumulative / 100,
      limitAmount: limitCents / 100,
      remainingAmount: Math.max(0, limitCents / 100 - cumulative / 100),
      periodName,
    };
  }

  /** Whether this tenant has acknowledged residency settings and may accept donations (fail-closed).
   * Used by the public donation page to gate rendering before showing a live donation form. */
  public mayAcceptDonations(tenantId: string): Promise<boolean> {
    return tenantMayAcceptDonations(this.settingsLookup, tenantId);
  }

  /**
   * Context the donation UI needs to show the right residency disclaimer and Stripe affordances:
   * the tenant's country, whether residency has been acknowledged (the fail-closed gate), and
   * Connect readiness. Shape is depended on by the frontend — keep name/fields stable.
   */
  public async getResidencyContext(tenantId: string): Promise<{
    country: string | null;
    residencyAcknowledged: boolean;
    stripeConnected: boolean;
  }> {
    // `tenants` is looked up by primary id (it's on the tenant-scope allow-list — scoping the tenant
    // table by tenant_id would be circular).
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select('country')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    const residencyAcknowledged = await tenantMayAcceptDonations(this.settingsLookup, tenantId);
    // Connect readiness (cached; mock mode reads as connected) — lets the fundraising editor gate
    // "connect Stripe first" without a second round-trip.
    const connectState = await getCachedConnectState(tenantId);
    return {
      country: tenant?.country != null ? String(tenant.country) : null,
      residencyAcknowledged,
      stripeConnected: connectState.chargesEnabled,
    };
  }

  // ── One-time Checkout ────────────────────────────────────────────────────────

  public async createCheckoutSession(
    auth: { tenant_id: string; user_id: string },
    personId: string,
    amountCents: number,
    address: { country?: string; state?: string },
    customUrls?: { successUrl?: string; cancelUrl?: string },
  ): Promise<{ url: string | null }> {
    // Fail-closed residency gate FIRST — an org that hasn't confirmed residency can't take money.
    await assertTenantMayAcceptDonations(this.settingsLookup, auth.tenant_id);

    const eligibility = await this.checkEligibility(auth.tenant_id, personId, amountCents, address);
    if (!eligibility.eligible) {
      throw new BadRequestError(eligibility.reason);
    }

    // Connect gate: fails closed unless onboarding is complete (mock mode passes with no account).
    const accountId = await assertStripeConnectReady(auth.tenant_id);
    const processor = new StripeDonationProcessor({
      accountId,
      feePercent: env.donationsPlatformFeePercent,
      currency: await this.resolveStripeCurrency(auth.tenant_id),
    });
    return processor.createOneTimeCheckout({
      tenantId: auth.tenant_id,
      userId: auth.user_id,
      personId,
      amountCents,
      address,
      customUrls,
    });
  }

  // ── Recurring Subscription Checkout ─────────────────────────────────────────

  /**
   * Calculate remaining months in the active donation period from today.
   * Returns null if the period is open-ended.
   */
  private getRemainingMonths(endDate: Date | null): number | null {
    if (!endDate) return null;
    const now = new Date();
    const diffMs = endDate.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30));
  }

  public async createRecurringCheckoutSession(
    auth: { tenant_id: string; user_id: string },
    personId: string,
    monthlyAmountCents: number,
    address: { country?: string; state?: string },
    customUrls?: { successUrl?: string; cancelUrl?: string },
  ) {
    // Fail-closed residency gate FIRST (same as one-time).
    await assertTenantMayAcceptDonations(this.settingsLookup, auth.tenant_id);

    // Determine remaining months for limit enforcement
    const activePeriod = await this.periodsRepo.getActivePeriodForToday(auth.tenant_id);
    const remainingMonths = activePeriod?.end_date ? this.getRemainingMonths(new Date(activePeriod.end_date)) : null;

    const eligibility = await this.checkEligibility(auth.tenant_id, personId, monthlyAmountCents, address, {
      isRecurring: true,
      remainingMonths: remainingMonths ?? 12,
    });
    if (!eligibility.eligible) {
      throw new BadRequestError(eligibility.reason);
    }

    // Connect gate: fails closed unless onboarding is complete (mock mode passes with no account).
    const accountId = await assertStripeConnectReady(auth.tenant_id);

    if (isMockMode) {
      const mockSubId = 'sub_mock_' + Math.random().toString(36).substring(7);
      const mockSessionId = 'cs_mock_rec_' + Math.random().toString(36).substring(7);

      let successUrl = customUrls?.successUrl
        ? customUrls.successUrl.replace('{CHECKOUT_SESSION_ID}', mockSessionId)
        : `${env.appUrl}/people/${personId}?mock_pledge_success=true&monthly_amount=${monthlyAmountCents / 100}&session_id=${mockSessionId}`;

      if (customUrls?.successUrl) {
        const sep = successUrl.includes('?') ? '&' : '?';
        successUrl += `${sep}is_mock=true&person_id=${personId}&monthly_amount_cents=${monthlyAmountCents}&province=${encodeURIComponent(address.state || '')}&country=${encodeURIComponent(address.country || '')}&tenant_id=${auth.tenant_id}&user_id=${auth.user_id}&mock_sub_id=${mockSubId}`;
      }

      return { url: successUrl, mock: true };
    }

    // Create a one-off price for this amount (monthly) — a Connect direct charge on the tenant's
    // account; the platform fee on recurring gifts is percent-only (application_fee_percent).
    const currency = await this.resolveStripeCurrency(auth.tenant_id);
    const session = await getStripe().checkout.sessions.create(
      {
        payment_method_types: ['card'],
        // Same rule as one-time gifts: no donation without a mailing address (receipts print it).
        billing_address_collection: 'required',
        line_items: [
          {
            price_data: {
              currency,
              product_data: { name: 'Monthly Campaign Donation' },
              unit_amount: monthlyAmountCents,
              recurring: { interval: 'month' },
            },
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url:
          customUrls?.successUrl ||
          `${env.appUrl}/people/${personId}?checkout_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: customUrls?.cancelUrl || `${env.appUrl}/people/${personId}?checkout_cancel=true`,
        subscription_data: {
          ...(env.donationsPlatformFeePercent > 0 ? { application_fee_percent: env.donationsPlatformFeePercent } : {}),
          metadata: {
            tenantId: auth.tenant_id,
            personId,
            monthlyAmount: String(monthlyAmountCents),
            residencyProvince: address.state || '',
            residencyCountry: address.country || '',
            createdBy: auth.user_id,
          },
        },
        metadata: {
          tenantId: auth.tenant_id,
          personId,
          monthlyAmount: String(monthlyAmountCents),
          residencyProvince: address.state || '',
          residencyCountry: address.country || '',
          createdBy: auth.user_id,
          isRecurring: 'true',
        },
      },
      { stripeAccount: accountId },
    );

    return { url: session.url };
  }

  // ── Confirm Flows ────────────────────────────────────────────────────────────

  public async confirmDonation(tenantId: string, userId: string, sessionId: string) {
    const existing = await this.getRepo()
      .db.selectFrom('donations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('stripe_session_id', '=', sessionId)
      .executeTakeFirst();

    if (existing) {
      return { success: true, donation: existing };
    }

    if (sessionId.startsWith('cs_mock_')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Mock sessions must be confirmed via the confirmMockDonation endpoint.',
      });
    }

    const accountId = await getConnectedAccountId(tenantId);
    if (isMockMode || !accountId) {
      throw new PreconditionFailedError('Stripe is not connected for this tenant.');
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId });
    if (session.payment_status !== 'paid') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Session has not been paid.' });
    }

    const personId = String(session.metadata?.['personId']);
    const amountCents = Number(session.metadata?.['amount']);
    const province = String(session.metadata?.['residencyProvince'] || '');
    const country = String(session.metadata?.['residencyCountry'] || '');

    const record = await this.recordSuccessfulDonation(
      tenantId,
      personId,
      amountCents,
      sessionId,
      province,
      country,
      userId,
      undefined,
      'card',
      undefined,
      session.payment_intent ? String(session.payment_intent) : null,
      mapStripeBillingAddress(session.customer_details?.address),
    );
    return { success: true, donation: record };
  }

  public async confirmMockDonation(
    tenantId: string,
    userId: string,
    personId: string,
    amountCents: number,
    sessionId: string,
    province: string,
    country: string,
  ) {
    const existing = await this.getRepo()
      .db.selectFrom('donations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('stripe_session_id', '=', sessionId)
      .executeTakeFirst();

    if (existing) {
      return { success: true, donation: existing };
    }

    const record = await this.recordSuccessfulDonation(
      tenantId,
      personId,
      amountCents,
      sessionId,
      province,
      country,
      userId,
    );
    return { success: true, donation: record };
  }

  /**
   * Confirm a mock recurring pledge from the frontend (no real Stripe).
   */
  public async confirmMockPledge(
    tenantId: string,
    userId: string,
    personId: string,
    monthlyAmountCents: number,
    mockSubId: string,
    province: string,
    country: string,
  ) {
    return this.recordNewPledge(tenantId, personId, monthlyAmountCents, mockSubId, null, province, country, userId);
  }

  // ── Internal Write Helpers ───────────────────────────────────────────────────

  public async recordNewPledge(
    tenantId: string,
    personId: string,
    monthlyAmountCents: number,
    stripeSubscriptionId: string,
    stripeCustomerId: string | null,
    province: string,
    country: string,
    userId: string,
    campaignId?: string,
  ): Promise<Selectable<Models['donation_pledges']>> {
    const existing = await this.pledgesRepo.db
      .selectFrom('donation_pledges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('stripe_subscription_id', '=', stripeSubscriptionId)
      .executeTakeFirst();

    if (existing) return existing;

    // Which fund the pledge belongs to (§15); Stripe-path pledges without an
    // explicit campaign land in the office context.
    const resolvedCampaignId = await this.campaignsRepo.resolveForWrite({
      tenant_id: tenantId,
      campaign_id: campaignId,
    });

    const person = await this.pledgesRepo.db
      .selectFrom('persons')
      .select(['first_name', 'last_name', 'email'])
      .where('id', '=', personId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const pledge = await this.pledgesRepo.db.transaction().execute(async (trx) => {
      const inserted = (await trx
        .insertInto('donation_pledges')
        .values({
          tenant_id: tenantId,
          campaign_id: resolvedCampaignId,
          person_id: personId,
          stripe_subscription_id: stripeSubscriptionId,
          stripe_customer_id: stripeCustomerId,
          monthly_amount: monthlyAmountCents,
          status: 'active',
          first_name: person?.first_name ?? null,
          last_name: person?.last_name ?? null,
          email: person?.email ?? null,
          state: province || null,
          country: country || null,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as Selectable<Models['donation_pledges']>;

      // "Donor" is derived from donations/pledges data (§15) — no tag to maintain.

      await trx
        .insertInto('user_activity')
        .values({
          tenant_id: tenantId,
          user_id: userId,
          activity: `Started a monthly pledge of $${monthlyAmountCents / 100}/month`,
          entity: 'persons',
          entity_id: personId,
          quantity: 1,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      return inserted;
    });

    return pledge;
  }

  /** Record an offline gift (spec §12, Fig. 15 "Record donation" dialog) — cash, check, or bank
   * transfer collected outside the Stripe checkout flow. Shares the tagging/activity-log/workflow
   * wiring with the Stripe path so offline and online gifts show up identically on the person's
   * Donations tab and Activity log. */
  public async recordManualDonation(
    auth: { tenant_id: string; user_id: string },
    personId: string,
    amountCents: number,
    method: 'card' | 'check' | 'cash' | 'bank_transfer',
    campaignId: string | undefined,
    address: DonationAddressType,
    giftDate?: string,
  ): Promise<Selectable<Models['donations']>> {
    const person = await this.getRepo()
      .db.selectFrom('persons')
      .select(['id'])
      .where('id', '=', personId)
      .where('tenant_id', '=', auth.tenant_id)
      .executeTakeFirst();
    if (!person) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Choose who gave this gift. Receipts need a name.' });
    }
    // Zod enforces the shape; this guards direct callers. No gift without a mailing address —
    // official receipts must print one.
    if (!address?.street || !address.city || !address.state || !address.zip || !address.country) {
      throw new BadRequestError('Enter the donor’s mailing address — receipts need it.');
    }

    return this.recordSuccessfulDonation(
      auth.tenant_id,
      personId,
      amountCents,
      null,
      '',
      '',
      auth.user_id,
      undefined,
      method,
      campaignId,
      undefined,
      address,
      giftDate ? parseGiftDate(giftDate) : undefined,
    );
  }

  public async recordSuccessfulDonation(
    tenantId: string,
    personId: string,
    amountCents: number,
    sessionId: string | null,
    province: string,
    country: string,
    userId: string,
    pledgeId?: string,
    method: 'card' | 'check' | 'cash' | 'bank_transfer' = 'card',
    campaignId?: string,
    stripePaymentIntentId?: string | null,
    /**
     * Donor mailing address (Stripe billing address or the manual-entry dialog). Written onto
     * the row so receipts print the address as it was at gift time. Nullable only for legacy
     * callers (old pledge installments without a Stripe address) — receipt issuance then falls
     * back to the household address, or holds with "needs donor address".
     */
    address?: DonationAddressType | null,
    /**
     * When the gift was received, for a gift entered after the fact. Written to `created_at`,
     * which is the column receipts read for the printed gift date and the coverage year. Absent
     * means now (the column's own default).
     */
    receivedAt?: Date,
  ): Promise<Selectable<Models['donations']>> {
    // Which fund the gift belongs to (§15); Stripe-path gifts without an
    // explicit campaign land in the office context.
    const resolvedCampaignId = await this.campaignsRepo.resolveForWrite({
      tenant_id: tenantId,
      campaign_id: campaignId,
    });

    const person = await this.getRepo()
      .db.selectFrom('persons')
      .select(['first_name', 'last_name', 'email'])
      .where('id', '=', personId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const { isFirstGift, record } = await this.getRepo()
      .db.transaction()
      .execute(async (trx) => {
        // The 'donation_recorded' automation trigger promises "a one-time gift or the first of a
        // recurring plan", so a pledge fires it once and later installments do not. Checked
        // inside the transaction, before the insert, so it sees only earlier gifts.
        const earlierPledgeGift = pledgeId
          ? await trx
              .selectFrom('donations')
              .select('id')
              .where('tenant_id', '=', tenantId)
              .where('pledge_id', '=', pledgeId)
              .where('status', '=', 'succeeded')
              .limit(1)
              .executeTakeFirst()
          : undefined;

        const inserted = (await trx
          .insertInto('donations')
          .values({
            tenant_id: tenantId,
            campaign_id: resolvedCampaignId,
            person_id: personId,
            first_name: person?.first_name ?? null,
            last_name: person?.last_name ?? null,
            email: person?.email ?? null,
            amount: amountCents,
            status: 'succeeded',
            stripe_session_id: sessionId,
            stripe_payment_intent_id: stripePaymentIntentId ?? null,
            street: address?.street || null,
            apt: address?.apt || null,
            city: address?.city || null,
            state: address?.state || province || null,
            zip: address?.zip || null,
            country: address?.country || country || null,
            pledge_id: pledgeId ? pledgeId : null,
            method,
            // Only set for a backdated entry; otherwise the column default (now) stands.
            ...(receivedAt ? { created_at: receivedAt } : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow()) as Selectable<Models['donations']>;

        // Every gift is acknowledged, unconditionally — no workspace setting, no receipting regime,
        // no mailing address required. A donor who gives and hears nothing back assumes the payment
        // failed. Official TAX receipts are a separate, year-end activity (or the manual button on
        // the gift detail page); an acknowledgement makes no tax claim, so nothing gates it.
        //
        // Transactional outbox: the job exists only if the gift committed.
        await trx
          .insertInto('background_jobs')
          .values({
            tenant_id: tenantId,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'issue-donation-acknowledgement',
              tenant_id: tenantId,
              donation_id: inserted.id,
              user_id: userId,
            }),
            run_at: new Date(),
            max_attempts: 3,
          })
          .execute();

        // "Donor" is derived from donations data (§15) — no tag to maintain.

        try {
          await trx
            .insertInto('user_activity')
            .values({
              tenant_id: tenantId,
              user_id: userId,
              activity: `Collected a donation of $${amountCents / 100}`,
              entity: 'persons',
              entity_id: personId,
              quantity: 1,
              createdby_id: userId,
              updatedby_id: userId,
            })
            .execute();
        } catch (err) {
          logger.error({ err }, 'Failed to write audit activity log for donation');
        }

        // No pledge at all, or the pledge's first successful gift.
        return { isFirstGift: !earlierPledgeGift, record: inserted };
      });

    if (isFirstGift) {
      try {
        const workflowsController = new WorkflowsController();
        // 'donation_recorded' is the canonical trigger name (the Zod enum + UI card). The old
        // 'donation_received' string never matched a saveable workflow, so this trigger was dead.
        await workflowsController.triggerWorkflow(tenantId, personId, 'donation_recorded', null);
      } catch (workflowErr) {
        logger.error({ err: workflowErr }, 'Failed to trigger workflow on donation_recorded');
      }
    }

    return record;
  }

  /**
   * Reverse a donation because Stripe reported a full refund or a lost chargeback. Flips the status
   * to a terminal reversed state (so it drops out of contribution totals, which count only
   * 'succeeded'), stamps refunded_at, and records an activity entry. Idempotent — a duplicate or
   * retried webhook for the same reversal is a no-op. Returns true when a donation matched.
   */
  public async reverseDonation(
    tenantId: string,
    userId: string,
    opts: { paymentIntentId: string | null; invoiceId: string | null; status: ReversedStatus },
  ): Promise<boolean> {
    const donation = await this.getRepo().findByPaymentIntentOrInvoice(tenantId, opts.paymentIntentId, opts.invoiceId);
    if (!donation) {
      logger.warn(
        { tenantId, paymentIntentId: opts.paymentIntentId, invoiceId: opts.invoiceId, status: opts.status },
        'Refund/dispute webhook did not match any donation; nothing to reverse',
      );
      return false;
    }
    if (donation.status === opts.status) return true; // already reversed — idempotent

    await this.getRepo()
      .db.transaction()
      .execute(async (trx) => {
        await trx
          .updateTable('donations')
          .set({ status: opts.status, refunded_at: new Date(), updated_at: new Date() })
          .where('id', '=', donation.id)
          .where('tenant_id', '=', tenantId)
          .execute();

        // A reversed gift may not keep an uncancelled receipt (per-gift receipts cancel; a
        // cumulative receipt covering it cancels + flags reissue; statements regenerate on rerun).
        const receiptsController = new DonationReceiptsController();
        await receiptsController.cancelReceiptsForReversedDonation(
          trx,
          tenantId,
          userId,
          donation.id,
          opts.status === DONATION_STATUS.refunded ? 'refunded' : 'disputed (chargeback)',
        );

        if (donation.person_id) {
          const verb = opts.status === DONATION_STATUS.refunded ? 'refunded' : 'disputed (chargeback)';
          try {
            await trx
              .insertInto('user_activity')
              .values({
                tenant_id: tenantId,
                user_id: userId,
                activity: `Donation of $${donation.amount / 100} ${verb}`,
                entity: 'persons',
                entity_id: donation.person_id,
                quantity: 1,
                createdby_id: userId,
                updatedby_id: userId,
              })
              .execute();
          } catch (err) {
            logger.error({ err }, 'Failed to write audit activity log for donation reversal');
          }
        }
      });
    return true;
  }

  /**
   * Restore a donation whose chargeback the tenant won: Stripe returned the funds, so a gift we
   * had marked 'disputed' counts again. Only un-reverses a still-disputed row (never resurrects a
   * genuine refund). Returns true when a donation matched.
   */
  public async restoreDisputedDonation(
    tenantId: string,
    userId: string,
    opts: { paymentIntentId: string | null; invoiceId: string | null },
  ): Promise<boolean> {
    const donation = await this.getRepo().findByPaymentIntentOrInvoice(tenantId, opts.paymentIntentId, opts.invoiceId);
    if (!donation) return false;
    if (donation.status !== DONATION_STATUS.disputed) return true; // nothing to restore — idempotent

    await this.getRepo()
      .db.transaction()
      .execute(async (trx) => {
        await trx
          .updateTable('donations')
          .set({ status: DONATION_STATUS.succeeded, refunded_at: null, updated_at: new Date() })
          .where('id', '=', donation.id)
          .where('tenant_id', '=', tenantId)
          .execute();

        // Deliberately NO automatic receipt reissue on a won chargeback: the cancelled receipt's
        // serial is burned (a successor must print "cancels and replaces"), so a human reissues
        // from the receipts list where the cancelled receipt is surfaced.
        if (donation.person_id) {
          try {
            await trx
              .insertInto('user_activity')
              .values({
                tenant_id: tenantId,
                user_id: userId,
                activity: `Donation of $${donation.amount / 100} chargeback resolved in your favour`,
                entity: 'persons',
                entity_id: donation.person_id,
                quantity: 1,
                createdby_id: userId,
                updatedby_id: userId,
              })
              .execute();
          } catch (err) {
            logger.error({ err }, 'Failed to write audit activity log for donation restore');
          }
        }
      });
    return true;
  }
}
