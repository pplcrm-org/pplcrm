import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ANNUAL_MONTHS_FREE,
  annualPriceForQuantity,
  bracketIndexForSubscribers,
  cadenceLabel,
  FEATURE_MATRIX,
  GB,
  PLANS,
  priceForQuantity,
} from '@common';
import type { BillingInterval, FeatureMatrixGroup, FeatureMatrixRow, PlanDef } from '@common';

import { CurrencyService } from '../ui/currency.service';
import { CurrencySwitcher } from '../ui/currency-switcher';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { SIGNUP_URL } from '../ui/site-nav';

/** Discrete emailable-subscriber counts the slider walks through (slider index = position here). */
const SLIDER_STOPS: readonly number[] = [
  1_000, 2_500, 5_000, 10_000, 15_000, 20_000, 25_000, 50_000, 75_000, 100_000, 200_000,
];

/** Default slider position: 2,500 subscribers (the first count past the Free tier's 1,000 cap). */
const DEFAULT_STOP_INDEX = 1;
const DEFAULT_STOP = 2_500;

/** The plan keys `FEATURE_MATRIX` carries values for (exactly the displayed plans). */
type MatrixPlanKey = keyof FeatureMatrixRow['values'];

function isMatrixPlanKey(key: string): key is MatrixPlanKey {
  return key === 'free' || key === 'grassroots' || key === 'movement';
}

/** A matrix row is "table stakes" when every displayed plan simply has it (all-true checks).
 * Those rows render as the compact included-everywhere strip, not as table rows. */
function isAllTrueRow(row: FeatureMatrixRow): boolean {
  return row.values.free === true && row.values.grassroots === true && row.values.movement === true;
}

/** One-line "what this tier adds" summary per plan card. Mirrors the GATED_FEATURES split in
 * plans.ts; if a feature moves between tiers, update this wording too (pplcrm-website-claims). */
const STEP_UP_LABELS: Readonly<Record<string, string>> = {
  free: 'The full CRM: people, households, shared inbox and newsletters from your own domain.',
  grassroots: 'Everything in Free, plus forms, donations, automations, lists and volunteer management.',
  movement:
    'Everything in Grassroots, plus the field: canvassing, deliveries, companion volunteers and priority support.',
};

@Component({
  selector: 'pc-pricing-page',
  imports: [RouterLink, SiteHeader, SiteFooter, SiteIcon, CurrencySwitcher],
  templateUrl: './pricing-page.html',
})
export class PricingPage {
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly mailto = 'mailto:hello@pplcrm.com';

  private readonly currency = inject(CurrencyService);
  /** Whether prices are being shown in a non-USD currency (gates the billing disclaimer). */
  protected readonly isConverted = this.currency.isConverted;
  /** The active display currency's price symbol (e.g. `C$`), for the disclaimer copy. */
  protected readonly currencySymbol = this.currency.priceSymbol;

  /** The priced plan cards (Free / Grassroots / Movement); enterprise is a footnote. */
  protected readonly tiers: readonly PlanDef[] = PLANS.filter((plan) => plan.displayed);

  /** Features every plan includes (all-true matrix rows), shown once as a strip instead of
   * spending a table row on three identical checkmarks. */
  protected readonly includedEverywhere: readonly string[] = FEATURE_MATRIX.flatMap((group) =>
    group.rows.filter(isAllTrueRow).map((row) => row.label),
  );

  /** The comparison table: only groups and rows where plans actually differ. */
  protected readonly diffMatrix: readonly FeatureMatrixGroup[] = FEATURE_MATRIX.map((group) => ({
    category: group.category,
    rows: group.rows.filter((row) => !isAllTrueRow(row)),
  })).filter((group) => group.rows.length > 0);

  /** Billing interval the cards and comparison table price at. The marketing page defaults to
   * Annual (the in-app billing page keeps Monthly — see the plans.ts decision log). */
  protected readonly interval = signal<BillingInterval>('year');
  protected readonly annualBadge = `${ANNUAL_MONTHS_FREE} months free`;

  protected readonly maxStopIndex = SLIDER_STOPS.length - 1;
  protected readonly stopIndex = signal(DEFAULT_STOP_INDEX);
  protected readonly subscribers = computed<number>(() => SLIDER_STOPS[this.stopIndex()] ?? DEFAULT_STOP);
  protected readonly subscribersLabel = computed<string>(() => this.subscribers().toLocaleString('en-US'));

  protected onSlide(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.stopIndex.set(Number(target.value));
    }
  }

  protected setInterval(interval: BillingInterval): void {
    this.interval.set(interval);
  }

  /** Live price at the slider's subscriber count, formatted in the active display currency.
   * On annual, paid tiers show the rounded monthly-equivalent of the annual total (`$24` —
   * the exact total renders alongside via `annualNote`, with the rounding disclaimer below
   * the cards); Free keeps its plain `$0` (nothing to bill annually). */
  protected priceLabel(plan: PlanDef): string {
    const index = bracketIndexForSubscribers(plan.key, this.subscribers());
    if (index === null) return 'Contact us';
    if (this.interval() === 'year' && plan.purchasable) {
      return this.currency.formatMonthlyEquivalent(annualPriceForQuantity(plan.key, index));
    }
    return this.currency.format(priceForQuantity(plan.key, index));
  }

  /** The card's cadence line ('per month' / 'per month, billed annually' / 'forever'). */
  protected cadence(plan: PlanDef): string {
    return cadenceLabel(plan, this.interval());
  }

  /** "Billed annually as $290 · 2 months free" under an annual paid-tier price; null whenever
   * the plain monthly presentation applies (monthly interval, Free, out-of-ladder). */
  protected annualNote(plan: PlanDef): string | null {
    if (this.interval() !== 'year' || !plan.purchasable) return null;
    const index = bracketIndexForSubscribers(plan.key, this.subscribers());
    if (index === null) return null;
    const total = this.currency.format(annualPriceForQuantity(plan.key, index));
    return `Billed annually as ${total} · ${this.annualBadge}`;
  }

  /** The Free tier's $0, formatted in the active currency (shown when the slider sits above 1,000). */
  protected zeroPrice(): string {
    return this.currency.format(0);
  }

  /** The slider sits past this tier's largest bracket (Free above 1,000; Grassroots above 100,000). */
  protected overMax(plan: PlanDef): boolean {
    return bracketIndexForSubscribers(plan.key, this.subscribers()) === null;
  }

  /** The tier's hard subscriber max, formatted (e.g. "100,000"). */
  protected maxSubscribersLabel(plan: PlanDef): string {
    const brackets = plan.pricing?.brackets;
    const last = brackets?.[brackets.length - 1];
    return (last?.upTo ?? 0).toLocaleString('en-US');
  }

  /** One-line caps summary for a plan card, derived from PlanDef so it can never drift
   * (e.g. "Up to 100,000 subscribers · 5 seats · 10 GB"). */
  protected capsLine(plan: PlanDef): string {
    const parts: string[] = [`Up to ${this.maxSubscribersLabel(plan)} subscribers`];
    if (plan.seats === null && plan.volunteers === null) {
      parts.push('unlimited seats & volunteers');
    } else {
      parts.push(plan.seats === null ? 'unlimited seats' : `${plan.seats} seats`);
      if (plan.volunteers === null) parts.push('unlimited volunteers');
      else if (plan.volunteers > 0) parts.push(`${plan.volunteers} volunteers`);
    }
    if (plan.storageBytes !== null) parts.push(`${Math.round(plan.storageBytes / GB)} GB`);
    return parts.join(' · ');
  }

  /** The card's "what this tier adds" one-liner. */
  protected stepUpLabel(plan: PlanDef): string {
    return STEP_UP_LABELS[plan.key] ?? plan.blurb;
  }

  /** One matrix cell: true = included, false = not included, string = text value. */
  protected matrixValue(row: FeatureMatrixRow, plan: PlanDef): boolean | string {
    return isMatrixPlanKey(plan.key) ? row.values[plan.key] : false;
  }
}
