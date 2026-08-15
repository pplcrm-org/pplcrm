import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { subscriberCapForQuantity, type PlanDef } from '@common';
import { of } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { BillingSettingsComponent } from './billing-settings';
import type { BillingDetailsSnapshot, BillingUsageSnapshot } from './billing-settings';

/**
 * The downgrade warning is the only thing between a campaign and a silent outage: on Free, its
 * published forms and API keys keep looking live while refusing traffic. These specs pin the two
 * places that warning has to fire (the "Switch to Free" card and the way in to the Stripe portal),
 * the places it must NOT fire (nothing to lose, or a free tenant just updating a card), and the
 * rule that a failed advisory lookup never blocks a billing action the user is entitled to take.
 */
describe('BillingSettingsComponent', () => {
  const FREE_CAP = subscriberCapForQuantity('free', 1);

  let fixture: ComponentFixture<BillingSettingsComponent>;
  let component: BillingSettingsComponent;
  let mockApi: any;
  let mockAlerts: any;
  let mockDialogs: any;
  let mockAuth: any;
  let mockRouter: any;
  /** Records the Stripe handoff. jsdom's `window.location` is unforgeable, so the component
   * funnels both redirects through `redirectTo`, which is what we watch here. */
  let redirects: string[];

  const detailsFor = (over: Partial<BillingDetailsSnapshot> = {}): BillingDetailsSnapshot => ({
    plan: 'grassroots',
    status: 'active',
    interval: 'month',
    endsAt: null,
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    hasActiveSubscription: true,
    // Mirrors the backend derivation (stored subscription id in a modifiable status), so the
    // existing seeds keep meaning what they meant; explicit overrides still win via the spread.
    canModifySubscription: over.stripeSubscriptionId !== null,
    cancelAtPeriodEnd: false,
    isMockMode: false,
    ...over,
  });

  const usageFor = (over: Partial<BillingUsageSnapshot> = {}): BillingUsageSnapshot => ({
    subscribers: 120,
    billedQuantity: 0,
    subscriberCap: 15_000,
    emailCap: 120_000,
    monthlyPrice: 89,
    interval: 'month',
    tierMax: 200_000,
    ...over,
  });

  const noImpact = { activeAutomations: 0, apiKeys: 0, publishedForms: 0 };

  /** Builds the fixture with `api` stubbed *before* the first change detection, because
   * `ngOnInit` immediately fires `getDetails`/`getUsage` through it. */
  async function render(
    opts: {
      details?: Partial<BillingDetailsSnapshot>;
      impact?: { activeAutomations: number; apiKeys: number; publishedForms: number };
      usage?: Partial<BillingUsageSnapshot>;
    } = {},
  ): Promise<void> {
    mockApi.billing.getDetails.query.mockResolvedValue(detailsFor(opts.details));
    mockApi.billing.getUsage.query.mockResolvedValue(usageFor(opts.usage));
    mockApi.billing.getDowngradeImpact.query.mockResolvedValue(opts.impact ?? noImpact);

    fixture = TestBed.createComponent(BillingSettingsComponent);
    component = fixture.componentInstance;
    (component as any).api = mockApi;
    vi.spyOn(component as any, 'redirectTo').mockImplementation((url: unknown) => {
      redirects.push(url as string);
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    mockApi = {
      billing: {
        getDetails: { query: vi.fn() },
        getUsage: { query: vi.fn() },
        getDowngradeImpact: { query: vi.fn() },
        selectFree: { mutate: vi.fn().mockResolvedValue(undefined) },
        createPortal: { mutate: vi.fn().mockResolvedValue({ url: 'https://portal.stripe.test/session' }) },
        createCheckout: { mutate: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/session' }) },
        switchPlan: { mutate: vi.fn().mockResolvedValue({ plan: 'movement', interval: 'month', endsAt: null }) },
        syncSubscription: { mutate: vi.fn().mockResolvedValue({ synced: false }) },
        cancelSubscription: { mutate: vi.fn().mockResolvedValue({ endsAt: null, immediate: false }) },
        resumeSubscription: { mutate: vi.fn().mockResolvedValue(undefined) },
        activateMockPlan: { mutate: vi.fn().mockResolvedValue(undefined) },
        cancelMockPlan: { mutate: vi.fn().mockResolvedValue(undefined) },
      },
    };

    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn(), show: vi.fn() };
    // Default: the user backs out. Each test that needs a "yes" opts in explicitly, so a spec can
    // never accidentally pass because the dialog auto-confirmed.
    mockDialogs = { confirm: vi.fn().mockResolvedValue(false) };
    mockAuth = { getCurrentUser: vi.fn().mockResolvedValue(null), getUserSignal: vi.fn() };
    mockRouter = { navigate: vi.fn().mockResolvedValue(true) };
    redirects = [];

    await TestBed.configureTestingModule({
      imports: [BillingSettingsComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
        { provide: Router, useValue: mockRouter },
        { provide: AlertService, useValue: mockAlerts },
        { provide: AuthService, useValue: mockAuth },
        { provide: ConfirmDialogService, useValue: mockDialogs },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('loads details and usage on init', async () => {
    await render();

    expect(mockApi.billing.getDetails.query).toHaveBeenCalled();
    expect(mockApi.billing.getUsage.query).toHaveBeenCalled();
    expect(component['details']()?.plan).toBe('grassroots');
    expect(component['usage']()?.subscribers).toBe(120);
  });

  describe('downgradeWarning', () => {
    const warn = async (impact: Partial<typeof noImpact>): Promise<string | null> => {
      mockApi.billing.getDowngradeImpact.query.mockResolvedValue({ ...noImpact, ...impact });
      return component['downgradeWarning']();
    };

    beforeEach(async () => {
      await render();
    });

    // Since 2026-08-01 the warning is never empty: the shared inbox is Grassroots+ and its synced
    // mail is permanently purged 30 days after a downgrade, so that line is always at stake.
    it('always warns about the synced-inbox purge, even when nothing else breaks', async () => {
      const message = await warn({});

      expect(message).toContain('shared inbox will close');
      expect(message).toContain('permanently deleted 30 days after the downgrade');
      expect(message).not.toContain('published form');
      expect(message).not.toContain('API key');
      expect(message).not.toContain('automation');
    });

    it('names published forms as losing submissions, not merely "disabled"', async () => {
      const message = await warn({ publishedForms: 1 });

      expect(message).toContain('1 published form will stop accepting submissions');
      expect(message).toContain('sees an error');
    });

    it('names API keys with the integrations that break', async () => {
      const message = await warn({ apiKeys: 1 });

      expect(message).toContain('1 API key will stop working');
      expect(message).toContain('Zapier');
    });

    it('names automations', async () => {
      expect(await warn({ activeAutomations: 1 })).toContain('1 active automation will stop sending');
    });

    it('pluralizes each count independently', async () => {
      const message = await warn({ publishedForms: 2, apiKeys: 3, activeAutomations: 4 });

      expect(message).toContain('2 published forms');
      expect(message).toContain('3 API keys');
      expect(message).toContain('4 active automations');
    });

    it('joins several losses into one sentence and states exactly what is and is not deleted', async () => {
      const message = await warn({ publishedForms: 1, apiKeys: 1, activeAutomations: 1 });

      expect(message).toMatch(/^On the Free plan, .+; .+; .+\./);
      expect(message).toContain(
        'Your contacts, households and other data are not deleted, and everything except the synced inbox mail resumes if you upgrade again.',
      );
    });

    it('adds the send block when the list is over the Free subscriber cap', async () => {
      component['usage'].set(usageFor({ subscribers: FREE_CAP + 500 }));

      const message = await warn({});

      expect(message).toContain('newsletter sending will be blocked');
      expect(message).toContain((FREE_CAP + 500).toLocaleString('en-US'));
    });

    // A broken advisory query must not become a broken billing page: the user is entitled to
    // move to Free whether or not we can tell them what it costs them.
    it('degrades to no warning when the impact lookup fails', async () => {
      mockApi.billing.getDowngradeImpact.query.mockRejectedValue(new Error('boom'));

      expect(await component['downgradeWarning']()).toBeNull();
      expect(mockAlerts.showError).not.toHaveBeenCalled();
    });
  });

  describe('continueOnFree', () => {
    // The education dialog always fires now — the inbox-purge consequence is always at stake —
    // so even a "nothing else to lose" tenant confirms before landing on Free.
    it('educates first, then switches to Free once confirmed', async () => {
      await render({ details: { plan: 'free', hasActiveSubscription: false, stripeSubscriptionId: null } });
      mockDialogs.confirm.mockResolvedValue(true);

      await component['continueOnFree']();

      expect(mockDialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Move to the Free plan?',
          message: expect.stringContaining('shared inbox'),
        }),
      );
      expect(mockApi.billing.selectFree.mutate).toHaveBeenCalled();
      expect(mockAlerts.showSuccess).toHaveBeenCalled();
      // The page re-reads afterwards, so the card reflects the new plan without a manual reload.
      expect(mockApi.billing.getDetails.query).toHaveBeenCalledTimes(2);
    });

    it('confirms first — as a danger dialog defaulting to staying put — when something breaks', async () => {
      await render({
        details: { plan: 'free', hasActiveSubscription: false, stripeSubscriptionId: null },
        impact: { activeAutomations: 0, apiKeys: 0, publishedForms: 2 },
      });

      await component['continueOnFree']();

      expect(mockDialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Move to the Free plan?',
          variant: 'danger',
          confirmText: 'Move to Free',
          cancelText: 'Stay on my plan',
          emphasizeCancel: true,
          message: expect.stringContaining('2 published forms will stop accepting submissions'),
        }),
      );
    });

    it('does nothing at all when the user backs out', async () => {
      await render({
        details: { plan: 'free', hasActiveSubscription: false, stripeSubscriptionId: null },
        impact: { activeAutomations: 1, apiKeys: 0, publishedForms: 0 },
      });

      await component['continueOnFree']();

      expect(mockApi.billing.selectFree.mutate).not.toHaveBeenCalled();
      // Leaving the card spinning forever would be the worst outcome of a cancel.
      expect(component['pendingPlan']()).toBeNull();
      expect(mockAlerts.showSuccess).not.toHaveBeenCalled();
    });

    it('proceeds once the user confirms', async () => {
      await render({
        details: { plan: 'free', hasActiveSubscription: false, stripeSubscriptionId: null },
        impact: { activeAutomations: 1, apiKeys: 0, publishedForms: 0 },
      });
      mockDialogs.confirm.mockResolvedValue(true);

      await component['continueOnFree']();

      expect(mockApi.billing.selectFree.mutate).toHaveBeenCalled();
      expect(component['pendingPlan']()).toBeNull();
    });

    it('surfaces a failed switch and releases the card', async () => {
      await render({ details: { plan: 'free', hasActiveSubscription: false, stripeSubscriptionId: null } });
      mockDialogs.confirm.mockResolvedValue(true);
      mockApi.billing.selectFree.mutate.mockRejectedValue(new Error('Plan change rejected.'));

      await component['continueOnFree']();

      expect(mockAlerts.showError).toHaveBeenCalledWith('Plan change rejected.');
      expect(component['pendingPlan']()).toBeNull();
    });
  });

  describe('openPortal', () => {
    it('never nags a free tenant — the portal is also the "update my card" path', async () => {
      await render({
        details: { plan: 'free', hasActiveSubscription: true, stripeSubscriptionId: null },
        impact: { activeAutomations: 3, apiKeys: 3, publishedForms: 3 },
      });

      await component['openPortal']();

      expect(mockApi.billing.getDowngradeImpact.query).not.toHaveBeenCalled();
      expect(mockDialogs.confirm).not.toHaveBeenCalled();
      expect(mockApi.billing.createPortal.mutate).toHaveBeenCalled();
    });

    // The inbox purge means a paid tenant always has something to lose on the way to Free, so
    // the way into the portal always warns (declining stays put; card-only changes are named as
    // unaffected in the dialog copy).
    it('warns a paid tenant even when no forms/keys/automations would break', async () => {
      await render();

      await component['openPortal']();

      expect(mockDialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Before you change your plan',
          message: expect.stringContaining('shared inbox'),
        }),
      );
      expect(redirects).toEqual([]);

      mockDialogs.confirm.mockResolvedValue(true);
      await component['openPortal']();
      expect(redirects).toEqual(['https://portal.stripe.test/session']);
    });

    // We cannot warn inside Stripe's own UI, and by the time the webhook lands the forms are
    // already dead — so the warning has to happen on the way in.
    it('warns a paid tenant with something to lose, and says card changes are unaffected', async () => {
      await render({ impact: { activeAutomations: 0, apiKeys: 2, publishedForms: 0 } });

      await component['openPortal']();

      expect(mockDialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Before you change your plan',
          variant: 'warning',
          confirmText: 'Open billing portal',
          message: expect.stringContaining('2 API keys will stop working'),
        }),
      );
      const { message } = mockDialogs.confirm.mock.calls[0][0];
      expect(message).toContain('If you cancel or move to the Free plan:');
      expect(message).toContain('Changing your payment details is unaffected.');
    });

    it('stays put when the user declines the warning', async () => {
      await render({ impact: { activeAutomations: 0, apiKeys: 2, publishedForms: 0 } });

      await component['openPortal']();

      expect(mockApi.billing.createPortal.mutate).not.toHaveBeenCalled();
      expect(component['portalPending']()).toBe(false);
      expect(redirects).toEqual([]);
    });

    it('opens the portal once the user acknowledges', async () => {
      await render({ impact: { activeAutomations: 0, apiKeys: 2, publishedForms: 0 } });
      mockDialogs.confirm.mockResolvedValue(true);

      await component['openPortal']();

      expect(mockApi.billing.createPortal.mutate).toHaveBeenCalled();
      expect(redirects).toEqual(['https://portal.stripe.test/session']);
    });

    it('releases the button when the portal cannot be opened', async () => {
      await render();
      mockDialogs.confirm.mockResolvedValue(true);
      mockApi.billing.createPortal.mutate.mockResolvedValue({ url: null });

      await component['openPortal']();

      expect(mockAlerts.showError).toHaveBeenCalledWith('No redirect URL returned from billing portal.');
      expect(component['portalPending']()).toBe(false);
    });
  });

  /** The Free CTA is what makes `continueOnFree` reachable at all, so its gating is part of the
   * same contract: a tenant that cannot safely land on Free must never be offered the button
   * without being told why. */
  describe('choosing Free from the plan cards', () => {
    const freePlan = (): PlanDef => {
      const plan = component['plans'].find((p) => p.key === 'free');
      if (!plan) throw new Error('Free should be one of the displayed plan cards.');
      return plan;
    };

    /**
     * With a live subscription, moving to Free IS the cancellation. The card used to be greyed
     * out with a note telling the user to press a different button that ran exactly the flow they
     * had just asked for, so it now runs that flow itself.
     */
    it('runs the cancellation flow for a subscriber instead of greying the card out', async () => {
      await render();
      mockDialogs.confirm.mockResolvedValue(true);
      mockApi.billing.cancelSubscription.mutate.mockResolvedValue({ endsAt: null, immediate: false });

      expect(component['freeIsCancellation']()).toBe(true);
      expect(component['blockedReason'](freePlan())).toBeNull();
      expect(component['ctaDisabled'](freePlan())).toBe(false);
      expect(component['ctaLabel'](freePlan())).toBe('Downgrade to Free');

      await component['choosePlan'](freePlan());

      expect(mockDialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel your subscription?' }));
      expect(mockApi.billing.cancelSubscription.mutate).toHaveBeenCalled();
      // Never the plain Free selection: the backend refuses it while a subscription is live.
      expect(mockApi.billing.selectFree.mutate).not.toHaveBeenCalled();
    });

    /** A second cancellation would be a no-op the user cannot tell apart from the first. */
    it('blocks — and dates — a card whose cancellation is already scheduled', async () => {
      await render({ details: { cancelAtPeriodEnd: true, endsAt: new Date('2026-09-30T00:00:00Z') } });

      expect(component['blockedReason'](freePlan())).toContain('Already scheduled');
      expect(component['ctaDisabled'](freePlan())).toBe(true);
    });

    it('blocks — and explains — a list that has outgrown the Free ceiling', async () => {
      await render({
        details: { plan: 'grassroots', stripeSubscriptionId: null },
        usage: { subscribers: FREE_CAP + 1 },
      });

      expect(component['outgrewFree']()).toBe(true);
      expect(component['blockedReason'](freePlan())).toContain(`${FREE_CAP.toLocaleString('en-US')}-subscriber Free`);
      expect(component['ctaDisabled'](freePlan())).toBe(true);
    });

    it('refuses to act on a blocked card even if the click gets through', async () => {
      await render({ usage: { subscribers: FREE_CAP + 1 } });

      await component['choosePlan'](freePlan());

      expect(mockApi.billing.selectFree.mutate).not.toHaveBeenCalled();
      expect(mockApi.billing.cancelSubscription.mutate).not.toHaveBeenCalled();
      expect(mockDialogs.confirm).not.toHaveBeenCalled();
    });

    it('routes an allowed Free choice through the downgrade warning', async () => {
      await render({
        details: { plan: 'grassroots', stripeSubscriptionId: null },
        impact: { activeAutomations: 0, apiKeys: 0, publishedForms: 1 },
      });

      expect(component['ctaDisabled'](freePlan())).toBe(false);

      await component['choosePlan'](freePlan());

      expect(mockDialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move to the Free plan?' }));
      expect(mockApi.billing.selectFree.mutate).not.toHaveBeenCalled();
    });
  });

  /** With a live subscription, a plan change must UPDATE it in place. Routing it through
   * Checkout created a second subscription that nothing canceled — double-billing. */
  describe('in-place plan switch for a live subscription', () => {
    const paidPlan = (key: 'grassroots' | 'movement'): PlanDef => {
      const plan = component['plans'].find((p) => p.key === key);
      if (!plan) throw new Error(`${key} should be one of the displayed plan cards.`);
      return plan;
    };

    it('confirms, then switches in place — never through Checkout', async () => {
      await render();
      mockDialogs.confirm.mockResolvedValue(true);

      await component['choosePlan'](paidPlan('movement'));

      expect(mockDialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Upgrade to Movement?' }));
      expect(mockApi.billing.switchPlan.mutate).toHaveBeenCalledWith({ plan: 'movement', interval: 'month' });
      expect(mockApi.billing.createCheckout.mutate).not.toHaveBeenCalled();
      expect(redirects).toEqual([]);
    });

    it('does nothing when the dialog is declined', async () => {
      await render();

      await component['choosePlan'](paidPlan('movement'));

      expect(mockDialogs.confirm).toHaveBeenCalled();
      expect(mockApi.billing.switchPlan.mutate).not.toHaveBeenCalled();
    });

    it('names the Movement-only features that turn off before a paid downgrade', async () => {
      await render({ details: { plan: 'movement' } });
      mockDialogs.confirm.mockResolvedValue(true);

      await component['choosePlan'](paidPlan('grassroots'));

      const dialog = mockDialogs.confirm.mock.calls[0][0];
      expect(dialog.title).toBe('Switch to Grassroots?');
      expect(dialog.variant).toBe('danger');
      expect(dialog.message).toContain('Canvassing');
      expect(dialog.message).toContain('Deliveries');
      expect(mockApi.billing.switchPlan.mutate).toHaveBeenCalledWith({ plan: 'grassroots', interval: 'month' });
    });

    it('offers the current plan card as a billing-interval switch', async () => {
      await render();
      mockDialogs.confirm.mockResolvedValue(true);
      component['billingInterval'].set('year');

      expect(component['ctaDisabled'](paidPlan('grassroots'))).toBe(false);
      expect(component['ctaLabel'](paidPlan('grassroots'))).toBe('Switch to annual billing');

      await component['choosePlan'](paidPlan('grassroots'));

      expect(mockApi.billing.switchPlan.mutate).toHaveBeenCalledWith({ plan: 'grassroots', interval: 'year' });
    });

    it('still uses Checkout for a first-time subscriber', async () => {
      await render({ details: { plan: 'free', hasActiveSubscription: false, stripeSubscriptionId: null } });

      await component['choosePlan'](paidPlan('grassroots'));

      expect(mockApi.billing.createCheckout.mutate).toHaveBeenCalledWith({ plan: 'grassroots', interval: 'month' });
      expect(mockApi.billing.switchPlan.mutate).not.toHaveBeenCalled();
      expect(redirects).toEqual(['https://checkout.stripe.test/session']);
    });
  });
});
