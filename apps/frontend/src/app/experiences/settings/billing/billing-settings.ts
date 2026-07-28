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
  subscriberCapForQuantity,
  type BillingInterval,
  type PlanDef,
  type PlanKey,
  type PurchasablePlanKey,
} from '@common';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
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
  host: {
    '(window:pageshow)': 'onPageShow($event)',
  },
})
export class BillingSettingsComponent extends TRPCService<any> implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly details = signal<BillingDetailsSnapshot | null>(null);
  protected readonly usage = signal<BillingUsageSnapshot | null>(null);

  /**
   * Which card is mid-redirect, rather than a page-wide "something is pending" flag.
   *
   * A single shared flag made every button on the page dead the moment one of them was clicked —
   * and because both the Checkout and the portal handoffs end in `window.location.href` and never
   * resolve, the flag was only ever cleared by an error. Come back from Stripe with the browser's
   * back button and the page restores from the bfcache with the flag still set: three greyed-out
   * plans and no way to recover short of a hard reload. Scoped per plan, the worst case is one
   * busy card.
   */
  protected readonly pendingPlan = signal<PlanKey | null>(null);
  protected readonly portalPending = signal(false);
  protected readonly busy = computed(() => this.pendingPlan() !== null || this.portalPending());

  /** All three priced tiers, side by side: Free, Grassroots, Movement. Free sat in a separate
   * panel below the paid cards until 2026-07-26 and read as an afterthought — you could not
   * compare what you'd gain by paying, or see at a glance which tier you were on. Enterprise
   * stays a contact-us footnote (`displayed: false`). */
  protected readonly plans: readonly PlanDef[] = PLANS.filter((p) => p.displayed);
  protected readonly enterpriseMailto = 'mailto:hello@pplcrm.com?subject=Enterprise%20Inquiry';

  /** Free is settled (chosen, not merely defaulted-into). Everyone starts on plan 'free' with a
   * null status, which is not the same thing. */
  protected readonly onFreePlan = computed(
    () => this.details()?.plan === 'free' && !!this.details()?.hasActiveSubscription,
  );

  /** Moving to Free is only self-serve while no paid subscription is live; otherwise it is a
   * cancellation and belongs in the Stripe portal. */
  protected readonly canChooseFree = computed(() => !this.details()?.stripeSubscriptionId);

  /** The Free tier's hard subscriber ceiling, read from the ladder rather than restated. */
  protected readonly freeSubscriberCap = subscriberCapForQuantity('free', 1);

  /** A list already past the Free ceiling can't move to Free — the send caps would refuse the
   * next newsletter, so offering the button would be offering a downgrade that breaks sending. */
  protected readonly outgrewFree = computed(() => (this.usage()?.subscribers ?? 0) > this.freeSubscriberCap);

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

  /** Free is flat, so the subscriber slider must not move its price — running it through the
   * ladder would print "Contact us" the moment the slider passed 1,000. */
  protected priceLabel(plan: PlanDef): string {
    if (plan.key === 'free') return '$0';
    return priceLabelAt(plan, this.sliderValue(), this.billingInterval());
  }

  /** What sits under the price. Annual cards say "/ month" too — the exact annual total is
   * spelled out by `annualNote` right below, which is the number actually charged. */
  protected priceCadence(plan: PlanDef): string {
    return plan.key === 'free' ? 'forever' : '/ month';
  }

  /** The tier this workspace is on. Free only counts once it has been chosen — every brand-new
   * tenant carries plan 'free' with no status, which means "hasn't decided", not "on Free". */
  protected isCurrentPlan(plan: PlanDef): boolean {
    if (plan.key === 'free') return this.onFreePlan();
    return this.details()?.plan === plan.key;
  }

  /** Why a tier can't be picked right now, in the user's terms. `null` = it can. */
  protected blockedReason(plan: PlanDef): string | null {
    if (this.isCurrentPlan(plan)) return null;
    if (plan.key !== 'free') return null;
    if (this.outgrewFree()) {
      return `Your list is past the ${this.formatCount(this.freeSubscriberCap)}-subscriber Free limit.`;
    }
    if (!this.canChooseFree()) return 'Cancel your subscription in the billing portal to move back to Free.';
    return null;
  }

  protected ctaLabel(plan: PlanDef): string {
    if (this.isCurrentPlan(plan)) return 'Current plan';
    if (plan.key === 'free') return 'Switch to Free';
    if (!this.details()?.hasActiveSubscription) return `Choose ${plan.name}`;
    return this.isUpgrade(plan) ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`;
  }

  protected ctaDisabled(plan: PlanDef): boolean {
    return this.isCurrentPlan(plan) || this.pendingPlan() === plan.key || this.blockedReason(plan) !== null;
  }

  /** Picking a tier. Free records a choice directly (it isn't purchasable); the paid tiers go
   * through Stripe Checkout. One entry point so the cards stay uniform. */
  protected async choosePlan(plan: PlanDef): Promise<void> {
    if (this.ctaDisabled(plan)) return;
    if (plan.key === 'free') {
      await this.continueOnFree();
      return;
    }
    await this.subscribe(plan);
  }

  private isUpgrade(plan: PlanDef): boolean {
    const order: PlanKey[] = ['free', 'grassroots', 'movement', 'enterprise'];
    const current = order.indexOf((this.details()?.plan ?? 'free') as PlanKey);
    return order.indexOf(plan.key) > current;
  }

  /** "billed annually as $290" under an annual card price (null on monthly, out-of-ladder, or
   * ladderless plans — the card falls back to its plain monthly presentation). */
  protected annualNote(plan: PlanDef): string | null {
    // Free has a ladder (one $0 bracket) but is not billed, so "billed annually as $0" is noise.
    if (!plan.purchasable) return null;
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

  /** The single place this page hands the browser to Stripe. Extracted only so tests can observe
   * the handoff: jsdom makes `window.location` unforgeable, so it cannot be stubbed in place. */
  protected redirectTo(url: string): void {
    window.location.href = url;
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
      // `tenant_plan_selected` on the signed-in user is what unlocks sender verification
      // elsewhere in Settings; keep it in step with what this page just read.
      await this.auth.getCurrentUser().catch(() => undefined);
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
    this.pendingPlan.set(planKey);
    try {
      const res = await this.api.billing.createCheckout.mutate({ plan: planKey, interval: this.billingInterval() });
      if (res?.url) {
        this.redirectTo(res.url);
      } else {
        throw new Error('No redirect URL returned from billing engine.');
      }
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Checkout failed. Please try again.');
      this.pendingPlan.set(null);
    }
  }

  /**
   * What stops working on Free, phrased for a human. Empty when nothing would break.
   *
   * Forms and API keys are the dangerous ones: both keep *looking* live after a downgrade while
   * quietly refusing traffic, so a campaign finds out from a drop in signups rather than from us.
   */
  private async downgradeWarning(): Promise<string | null> {
    let impact: { activeAutomations: number; apiKeys: number; publishedForms: number };
    try {
      impact = await this.api.billing.getDowngradeImpact.query();
    } catch {
      // Never let a failed advisory lookup block a billing action the user is entitled to take.
      return null;
    }

    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const losses: string[] = [];
    if (impact.publishedForms > 0) {
      losses.push(
        `${plural(impact.publishedForms, 'published form', 'published forms')} will stop accepting submissions` +
          ' — anyone who opens one on your website sees an error',
      );
    }
    if (impact.apiKeys > 0) {
      losses.push(
        `${plural(impact.apiKeys, 'API key', 'API keys')} will stop working, so Zapier and any server-side` +
          ' integration you have built will fail',
      );
    }
    if (impact.activeAutomations > 0) {
      losses.push(`${plural(impact.activeAutomations, 'active automation', 'active automations')} will stop sending`);
    }
    if (losses.length === 0) return null;

    return `On the Free plan, ${losses.join('; ')}. Nothing is deleted — it all resumes if you upgrade again.`;
  }

  /** Commit to the Free plan. Not a checkout: Free isn't purchasable, so this records the choice
   * directly. It is what unblocks leaving demo mode, which needs a settled plan decision. */
  protected async continueOnFree() {
    const warning = await this.downgradeWarning();
    if (warning) {
      const confirmed = await this.dialogs.confirm({
        title: 'Move to the Free plan?',
        message: warning,
        variant: 'danger',
        confirmText: 'Move to Free',
        cancelText: 'Stay on my plan',
        emphasizeCancel: true,
      });
      if (!confirmed) return;
    }

    this.pendingPlan.set('free');
    try {
      await this.api.billing.selectFree.mutate();
      this.alerts.showSuccess('You’re on the Free plan. You can upgrade whenever you need to.');
      await this.loadBilling();
    } catch (err) {
      this.alerts.showError(
        err instanceof Error && err.message ? err.message : 'Could not switch to the Free plan. Please try again.',
      );
    } finally {
      this.pendingPlan.set(null);
    }
  }

  protected async openPortal() {
    // The portal is where a paid downgrade or cancellation actually happens, and it is Stripe's
    // UI — we cannot warn inside it, and by the time the webhook tells us, the forms have already
    // gone quiet. So warn on the way in. Only for paid tenants with something to lose, because
    // this button is also the ordinary "update my card" path and must not nag.
    if (this.details()?.plan && this.details()?.plan !== 'free') {
      const warning = await this.downgradeWarning();
      if (warning) {
        const proceed = await this.dialogs.confirm({
          title: 'Before you change your plan',
          message: `If you cancel or move to the Free plan: ${warning} Changing your payment details is unaffected.`,
          variant: 'warning',
          confirmText: 'Open billing portal',
        });
        if (!proceed) return;
      }
    }

    this.portalPending.set(true);
    try {
      const res = await this.api.billing.createPortal.mutate();
      if (res?.url) {
        this.redirectTo(res.url);
      } else {
        throw new Error('No redirect URL returned from billing portal.');
      }
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not open billing portal.');
      this.portalPending.set(false);
    }
  }

  /**
   * Coming back from Stripe with the back button restores this page from the bfcache — same JS
   * state, no ngOnInit — so the in-flight redirect flags survive and would leave the plan buttons
   * disabled forever. Clear them and re-read, since whatever they did on Stripe may have changed
   * the subscription.
   */
  protected onPageShow(event: PageTransitionEvent): void {
    if (!event.persisted) return;
    this.pendingPlan.set(null);
    this.portalPending.set(false);
    void this.loadBilling();
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
