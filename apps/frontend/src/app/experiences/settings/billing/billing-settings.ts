import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import {
  ANNUAL_MONTHS_FREE,
  ANNUAL_PRICE_MULTIPLIER,
  PLANS,
  PURCHASABLE_PLAN_KEYS,
  annualPriceForQuantity,
  bracketIndexForSubscribers,
  maxQuantity,
  planDisplayName,
  priceLabelAt,
  type BillingInterval,
  type PlanDef,
  type PlanKey,
  type PurchasablePlanKey,
} from '@common';
import { TRPCService } from '../../../services/api/trpc-service';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';

export interface BillingDetailsSnapshot {
  plan: string;
  status: string;
  interval: BillingInterval;
  endsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  hasActiveSubscription: boolean;
  isMockMode: boolean;
}

/** Shape returned by `billing.getUsage` — the tenant's live emailable-subscriber count against
 * its current plan's bracket ladder. */
export interface BillingUsageSnapshot {
  subscribers: number;
  billedQuantity: number;
  subscriberCap: number;
  emailCap: number;
  monthlyPrice: number;
  interval: BillingInterval;
  tierMax: number;
}

/** Discrete slider stops for "how many subscribers do you have" — mirrors the website pricing
 * slider so the two surfaces feel identical. */
const SUBSCRIBER_SLIDER_STOPS = [
  1_000, 2_500, 5_000, 10_000, 15_000, 20_000, 25_000, 50_000, 75_000, 100_000, 200_000,
] as const;

function isPurchasablePlan(value: string | undefined): value is PurchasablePlanKey {
  return value != null && (PURCHASABLE_PLAN_KEYS as readonly string[]).includes(value);
}

@Component({
  selector: 'pc-billing-settings',
  imports: [DatePipe, Icon, StatusBadge],
  templateUrl: './billing-settings.html',
})
export class BillingSettingsComponent extends TRPCService<any> implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly actionPending = signal(false);
  protected readonly details = signal<BillingDetailsSnapshot | null>(null);
  protected readonly usage = signal<BillingUsageSnapshot | null>(null);

  /** Upgrade grid: the purchasable paid tiers only (Grassroots, Movement). Free is the current
   * plan for everyone who hasn't upgraded, and Enterprise is a contact-us footnote, not a card. */
  protected readonly plans: readonly PlanDef[] = PLANS.filter((p) => p.purchasable);
  protected readonly enterpriseMailto = 'mailto:hello@pplcrm.com?subject=Enterprise%20Inquiry';

  /** Free is not an "upgrade option", so it gets its own quiet panel below the paid cards rather
   * than a third card in the grid. */
  protected readonly freePlan = PLANS.find((p) => p.key === 'free') ?? null;

  /** Free is settled (chosen, not merely defaulted-into). Everyone starts on plan 'free' with a
   * null status, which is not the same thing. */
  protected readonly onFreePlan = computed(
    () => this.details()?.plan === 'free' && !!this.details()?.hasActiveSubscription,
  );

  /** Moving to Free is only self-serve while no paid subscription is live; otherwise it is a
   * cancellation and belongs in the Stripe portal. */
  protected readonly canChooseFree = computed(() => !this.details()?.stripeSubscriptionId);

  /** Billing interval for the upgrade cards. Monthly is the deliberate default — electoral
   * campaigns often end mid-year and shouldn't be nudged into annual prepay. */
  protected readonly billingInterval = signal<BillingInterval>('month');
  protected readonly annualBadge = `${ANNUAL_MONTHS_FREE} months free`;

  protected readonly sliderStops = SUBSCRIBER_SLIDER_STOPS;
  protected readonly sliderIndex = signal(0);
  protected readonly sliderValue = computed(() => this.sliderStops[this.sliderIndex()] ?? this.sliderStops[0]);
  protected readonly maxSliderStop = computed(
    () => this.sliderStops[this.sliderStops.length - 1] ?? this.sliderStops[0],
  );

  /** "12,340 emailable subscribers · billed for up to 15,000 at $89/mo" (or "at $890/yr" on
   * annual billing) — omits the billed clause for plans with no meaningful bracket (free,
   * enterprise). */
  protected readonly usageSummary = computed<string | null>(() => {
    const snapshot = this.usage();
    const planKey = this.details()?.plan;
    if (!snapshot || !planKey) return null;

    const subscribers = `${this.formatCount(snapshot.subscribers)} emailable subscribers`;
    if (planKey === 'free' || planKey === 'enterprise') return subscribers;

    const cap = this.formatCount(snapshot.subscriberCap);
    const price =
      snapshot.interval === 'year'
        ? `$${snapshot.monthlyPrice * ANNUAL_PRICE_MULTIPLIER}/yr`
        : `$${snapshot.monthlyPrice}/mo`;
    return `${subscribers} · billed for up to ${cap} at ${price}`;
  });

  protected planLabel(plan: string | null | undefined): string {
    return planDisplayName(plan);
  }

  protected priceLabel(plan: PlanDef): string {
    return priceLabelAt(plan, this.sliderValue(), this.billingInterval());
  }

  /** "billed annually as $290" under an annual card price (null on monthly, out-of-ladder, or
   * ladderless plans — the card falls back to its plain monthly presentation). */
  protected annualNote(plan: PlanDef): string | null {
    if (this.billingInterval() !== 'year' || !plan.pricing) return null;
    const index = bracketIndexForSubscribers(plan.key, this.sliderValue());
    if (index === null) return null;
    return `billed annually as $${this.formatCount(annualPriceForQuantity(plan.key, index))}`;
  }

  protected setBillingInterval(interval: BillingInterval): void {
    this.billingInterval.set(interval);
  }

  protected formatCount(n: number): string {
    return n.toLocaleString('en-US');
  }

  protected onSliderInput(event: Event): void {
    const index = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isNaN(index)) this.sliderIndex.set(index);
  }

  ngOnInit(): void {
    void this.initBilling();
  }

  private async initBilling() {
    await this.loadBilling();

    // Listen to query params for mock successes or redirect callbacks
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => void this.handleQueryParams(params));
  }

  protected async loadBilling() {
    const end = this._loading.begin();
    try {
      const [details, usage] = await Promise.all([
        this.api.billing.getDetails.query(),
        this.api.billing.getUsage.query(),
      ]);
      this.details.set(details);
      this.usage.set(usage);
      this.syncSliderToUsage(usage);
    } catch (err) {
      console.error(err);
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load subscription details.');
    } finally {
      end();
    }
  }

  /** Snaps the slider to the tenant's live subscriber count, rounded up to the nearest stop.
   * Falls back to the first stop when usage is unavailable or already past the highest stop. */
  private syncSliderToUsage(usage: BillingUsageSnapshot | null | undefined): void {
    const subscribers = usage?.subscribers;
    if (subscribers == null) {
      this.sliderIndex.set(0);
      return;
    }
    const index = this.sliderStops.findIndex((stop) => subscribers <= stop);
    this.sliderIndex.set(index === -1 ? this.sliderStops.length - 1 : index);
  }

  private async handleQueryParams(params: Record<string, string>): Promise<void> {
    if (params['mock_checkout_success'] && isPurchasablePlan(params['plan'])) {
      await this.handleMockActivation(params['plan'], params['interval'] === 'year' ? 'year' : 'month');
    } else if (params['checkout_success']) {
      await this.syncFromStripe('Subscription activated successfully! Thank you for your purchase.');
      this.clearQueryParams();
    } else if (params['portal_return']) {
      await this.syncFromStripe(null);
      this.clearQueryParams();
    } else if (params['mock_portal_success']) {
      this.alerts.showSuccess('Simulated Customer Portal: Retrieved successfully.');
      this.clearQueryParams();
    }
  }

  /** Returning from Stripe Checkout/Portal: reconcile the plan straight from Stripe (webhooks
   * can lag or be unconfigured for the active Stripe mode), then reload the page data. */
  private async syncFromStripe(successMessage: string | null): Promise<void> {
    const end = this._loading.begin();
    try {
      const res = await this.api.billing.syncSubscription.mutate();
      if (successMessage) {
        this.alerts.showSuccess(successMessage);
      } else if (res.synced) {
        this.alerts.showSuccess('Your billing details are up to date.');
      }
    } catch (err) {
      console.error(err);
      this.alerts.showError('Could not refresh your subscription from Stripe. Reload the page to try again.');
    } finally {
      end();
    }
    await this.loadBilling();
  }

  protected async subscribe(plan: PlanDef) {
    if (!isPurchasablePlan(plan.key)) return;
    const planKey = plan.key;
    this.actionPending.set(true);
    try {
      const res = await this.api.billing.createCheckout.mutate({ plan: planKey, interval: this.billingInterval() });
      if (res?.url) {
        window.location.href = res.url;
      } else {
        throw new Error('No redirect URL returned from billing engine.');
      }
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Checkout failed. Please try again.');
      this.actionPending.set(false);
    }
  }

  /** Commit to the Free plan. Not a checkout: Free isn't purchasable, so this records the choice
   * directly. It is what unblocks leaving demo mode, which needs a settled plan decision. */
  protected async continueOnFree() {
    this.actionPending.set(true);
    try {
      await this.api.billing.selectFree.mutate();
      this.alerts.showSuccess('You’re on the Free plan. You can upgrade whenever you need to.');
      await this.loadBilling();
    } catch (err) {
      this.alerts.showError(
        err instanceof Error && err.message ? err.message : 'Could not switch to the Free plan. Please try again.',
      );
    } finally {
      this.actionPending.set(false);
    }
  }

  protected async openPortal() {
    this.actionPending.set(true);
    try {
      const res = await this.api.billing.createPortal.mutate();
      if (res?.url) {
        window.location.href = res.url;
      } else {
        throw new Error('No redirect URL returned from billing portal.');
      }
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not open billing portal.');
      this.actionPending.set(false);
    }
  }

  private async handleMockActivation(plan: PurchasablePlanKey, interval: BillingInterval = 'month') {
    const end = this._loading.begin();
    try {
      const quantity = this.mockQuantityFor(plan);
      await this.api.billing.activateMockPlan.mutate({ plan, quantity, interval });
      this.alerts.showSuccess(`Success! [Mock Mode] activated your "${plan.toUpperCase()}" plan.`);
      await this.loadBilling();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Mock plan activation failed.');
    } finally {
      end();
      this.clearQueryParams();
    }
  }

  /** The bracket index (Stripe quantity) matching the tenant's current subscriber count, so mock
   * activation lands on the same billed tier the real checkout would compute. */
  private mockQuantityFor(plan: PlanKey): number {
    const subscribers = this.usage()?.subscribers ?? 0;
    return bracketIndexForSubscribers(plan, subscribers) ?? maxQuantity(plan);
  }

  protected async cancelMock() {
    const end = this._loading.begin();
    try {
      await this.api.billing.cancelMockPlan.mutate();
      this.alerts.showSuccess('Mock subscription has been canceled.');
      await this.loadBilling();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to cancel mock plan.');
    } finally {
      end();
    }
  }

  private clearQueryParams() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        mock_checkout_success: null,
        plan: null,
        interval: null,
        checkout_success: null,
        portal_return: null,
        mock_portal_success: null,
      },
      queryParamsHandling: 'merge',
    });
  }
}
