import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock env BEFORE importing the controller so `stripe-platform-client` resolves a "real" key and
// isMockMode is false — same pattern as controller.spec.ts. Cancel/resume behave completely
// differently in mock mode (immediate downgrade / hard refusal), and those branches plus the
// demo-mode FORBIDDEN gate are covered elsewhere; this file pins the LIVE-mode behavior.
vi.mock('../../../env', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    env: {
      ...actual.env,
      stripeSecretKey: 'sk_test_live_key_not_mock',
      stripeWebhookSecret: 'whsec_test_secret',
      stripePlanGrassrootsPriceId: 'price_test_grassroots',
      stripePlanMovementPriceId: 'price_test_movement',
      stripePlanGrassrootsAnnualPriceId: 'price_test_grassroots_annual',
      stripePlanMovementAnnualPriceId: 'price_test_movement_annual',
    },
  };
});

// `vi.mock` factories are hoisted above module-level consts, so the mock fns go through
// `vi.hoisted` (mirrors controller.spec.ts).
const { stripeSubscriptionsUpdate, stripeSubscriptionsRetrieve, stripeSubscriptionsCancel } = vi.hoisted(() => ({
  stripeSubscriptionsUpdate: vi.fn(),
  stripeSubscriptionsRetrieve: vi.fn(),
  stripeSubscriptionsCancel: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = {
      constructEvent: (payload: string) => JSON.parse(payload),
    };
    subscriptions = {
      update: stripeSubscriptionsUpdate,
      retrieve: stripeSubscriptionsRetrieve,
      cancel: stripeSubscriptionsCancel,
    };
  },
}));

import { BillingController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { BadRequestError, NotFoundError } from '../../errors/app-errors';

const db = (BaseRepository as any)._db;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/** Seeds a minimal billable tenant (grassroots, active, live subscription id) — unique random
 * ids so this file survives the full parallel suite. */
async function seedTenant(overrides: Record<string, unknown> = {}): Promise<{ tenantId: string; subId: string }> {
  const tenantId = rand();
  const subId = `sub_${tenantId}`;
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Cancel/Resume Spec Tenant',
      subscription_plan: 'grassroots',
      subscription_status: 'active',
      subscription_quantity: 1,
      stripe_customer_id: `cus_${tenantId}`,
      stripe_subscription_id: subId,
      ...overrides,
    })
    .execute();
  return { tenantId, subId };
}

describe('BillingController cancel/resume (live Stripe mode)', () => {
  let controller: BillingController;
  const createdTenants: string[] = [];

  async function seed(overrides: Record<string, unknown> = {}): Promise<{ tenantId: string; subId: string }> {
    const seeded = await seedTenant(overrides);
    createdTenants.push(seeded.tenantId);
    return seeded;
  }

  const tenantRow = (id: string) => db.selectFrom('tenants').selectAll().where('id', '=', id).executeTakeFirst();

  beforeEach(() => {
    controller = new BillingController();
    stripeSubscriptionsUpdate.mockReset();
    stripeSubscriptionsRetrieve.mockReset();
    stripeSubscriptionsCancel.mockReset();
    // Default: Stripe acknowledges the update with a period end on the first item (the shape
    // subscriptionPeriodEnd() reads on the basil-era API).
    stripeSubscriptionsUpdate.mockResolvedValue({
      items: { data: [{ current_period_end: 1_799_999_999 }] },
    });
  });

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const id = createdTenants.pop();
      await db.deleteFrom('tenants').where('id', '=', id).execute();
    }
  });

  describe('cancelSubscription — schedules a period-end cancellation', () => {
    it('sets cancel_at_period_end on the stored subscription — never an immediate cancel', async () => {
      const { tenantId, subId } = await seed();

      const result = await controller.cancelSubscription({ tenant_id: tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(subId, { cancel_at_period_end: true });
      expect(stripeSubscriptionsCancel).not.toHaveBeenCalled();
      expect(result.immediate).toBe(false);
    });

    it('reports endsAt from the subscription item current_period_end (seconds → ISO)', async () => {
      const { tenantId } = await seed();
      stripeSubscriptionsUpdate.mockResolvedValue({
        items: { data: [{ current_period_end: 1_900_000_000 }] },
      });

      const result = await controller.cancelSubscription({ tenant_id: tenantId });

      expect(result.endsAt).toBe(new Date(1_900_000_000 * 1000).toISOString());
    });

    it('degrades endsAt to null (without throwing) when the returned subscription has no item period end', async () => {
      const { tenantId } = await seed();
      stripeSubscriptionsUpdate.mockResolvedValue({ items: { data: [] } });

      const result = await controller.cancelSubscription({ tenant_id: tenantId });

      expect(result).toEqual({ endsAt: null, immediate: false });
    });

    it('does not write the tenants row itself — the plan stays live until the webhook mirrors the deletion', async () => {
      const { tenantId, subId } = await seed();

      await controller.cancelSubscription({ tenant_id: tenantId });

      const tenant = await tenantRow(tenantId);
      expect(tenant.subscription_plan).toBe('grassroots');
      expect(tenant.subscription_status).toBe('active');
      expect(tenant.stripe_subscription_id).toBe(subId);
    });

    it('refuses with BadRequestError when no subscription id is stored', async () => {
      const { tenantId } = await seed({ stripe_subscription_id: null });

      await expect(controller.cancelSubscription({ tenant_id: tenantId })).rejects.toThrow(BadRequestError);
      await expect(controller.cancelSubscription({ tenant_id: tenantId })).rejects.toThrow(
        'There is no active paid subscription to cancel.',
      );
      expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('refuses when the stored subscription is already fully canceled (status not live)', async () => {
      const { tenantId } = await seed({ subscription_status: 'canceled' });

      await expect(controller.cancelSubscription({ tenant_id: tenantId })).rejects.toThrow(
        /no active paid subscription/,
      );
      expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('still allows cancelling while past_due — a tenant whose card failed must be able to leave (REVIEW4 T1-10)', async () => {
      const { tenantId, subId } = await seed({ subscription_status: 'past_due' });

      const result = await controller.cancelSubscription({ tenant_id: tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(subId, { cancel_at_period_end: true });
      expect(result.immediate).toBe(false);
    });

    it('throws NotFoundError for a tenant that does not exist', async () => {
      await expect(controller.cancelSubscription({ tenant_id: rand() })).rejects.toThrow(NotFoundError);
      expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('accepts a second cancel while one is already scheduled — the same idempotent Stripe update again', async () => {
      // The backend has no already-scheduled check: Stripe treats a repeated
      // cancel_at_period_end: true as a no-op. The UI-side disabling of further cancel actions
      // (commit 6208c0ed) is driven by getBillingDetails.cancelAtPeriodEnd, pinned below.
      const { tenantId, subId } = await seed();

      const first = await controller.cancelSubscription({ tenant_id: tenantId });
      const second = await controller.cancelSubscription({ tenant_id: tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledTimes(2);
      expect(stripeSubscriptionsUpdate).toHaveBeenNthCalledWith(1, subId, { cancel_at_period_end: true });
      expect(stripeSubscriptionsUpdate).toHaveBeenNthCalledWith(2, subId, { cancel_at_period_end: true });
      expect(first.immediate).toBe(false);
      expect(second.immediate).toBe(false);
    });

    it('acts only on the caller-tenant subscription — another tenant subscription id is never touched', async () => {
      const a = await seed();
      const b = await seed();

      await controller.cancelSubscription({ tenant_id: a.tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(a.subId, { cancel_at_period_end: true });
      // The other tenant's row is untouched and its subscription was never named to Stripe.
      const other = await tenantRow(b.tenantId);
      expect(other.stripe_subscription_id).toBe(b.subId);
      expect(other.subscription_status).toBe('active');
    });
  });

  describe('getBillingDetails — how the UI learns a cancellation is scheduled', () => {
    it('reports cancelAtPeriodEnd true when Stripe says so (this is what disables further cancel actions)', async () => {
      const { tenantId, subId } = await seed();
      stripeSubscriptionsRetrieve.mockResolvedValue({ cancel_at_period_end: true });

      const details = await controller.getBillingDetails({ tenant_id: tenantId });

      expect(stripeSubscriptionsRetrieve).toHaveBeenCalledExactlyOnceWith(subId);
      expect(details.cancelAtPeriodEnd).toBe(true);
      expect(details.canModifySubscription).toBe(true);
    });

    it('degrades cancelAtPeriodEnd to false on a Stripe read failure instead of failing the page', async () => {
      const { tenantId } = await seed();
      stripeSubscriptionsRetrieve.mockRejectedValue(new Error('Stripe is down'));

      const details = await controller.getBillingDetails({ tenant_id: tenantId });

      expect(details.cancelAtPeriodEnd).toBe(false);
      expect(details.plan).toBe('grassroots');
    });

    it('never asks Stripe when there is no live subscription to have a scheduled cancellation', async () => {
      const { tenantId } = await seed({ stripe_subscription_id: null, subscription_status: 'canceled' });

      const details = await controller.getBillingDetails({ tenant_id: tenantId });

      expect(stripeSubscriptionsRetrieve).not.toHaveBeenCalled();
      expect(details.cancelAtPeriodEnd).toBe(false);
      expect(details.canModifySubscription).toBe(false);
    });
  });

  describe('resumeSubscription — clears the scheduled cancellation', () => {
    it('sets cancel_at_period_end false on the stored subscription and reports resumed', async () => {
      const { tenantId, subId } = await seed();

      const result = await controller.resumeSubscription({ tenant_id: tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(subId, { cancel_at_period_end: false });
      expect(result).toEqual({ resumed: true });
    });

    it('refuses with BadRequestError when no subscription id is stored — nothing to resume', async () => {
      const { tenantId } = await seed({ stripe_subscription_id: null });

      await expect(controller.resumeSubscription({ tenant_id: tenantId })).rejects.toThrow(BadRequestError);
      await expect(controller.resumeSubscription({ tenant_id: tenantId })).rejects.toThrow(
        'There is no subscription to resume.',
      );
      expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('issues the same idempotent update when nothing is scheduled — per the code, only the stored id gates resume', async () => {
      // resumeSubscription never checks whether a cancellation is actually scheduled; setting
      // cancel_at_period_end: false on an un-scheduled subscription is a no-op at Stripe.
      const { tenantId, subId } = await seed();
      stripeSubscriptionsRetrieve.mockResolvedValue({ cancel_at_period_end: false });

      const result = await controller.resumeSubscription({ tenant_id: tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(subId, { cancel_at_period_end: false });
      expect(result).toEqual({ resumed: true });
    });

    it('acts only on the caller-tenant subscription id', async () => {
      const a = await seed();
      const b = await seed();

      await controller.resumeSubscription({ tenant_id: b.tenantId });

      expect(stripeSubscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(b.subId, { cancel_at_period_end: false });
      const other = await tenantRow(a.tenantId);
      expect(other.stripe_subscription_id).toBe(a.subId);
    });
  });
});
