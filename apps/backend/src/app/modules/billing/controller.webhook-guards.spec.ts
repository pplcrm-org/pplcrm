import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock env BEFORE importing the controller so the module is not in Stripe mock mode.
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

// `vi.mock` factories are hoisted above module-level consts, so the spies must go through
// `vi.hoisted` (same shape the sibling controller.spec.ts uses).
const { stripeSubscriptionsRetrieve, stripeSubscriptionsUpdate, stripeSubscriptionsCancel } = vi.hoisted(() => ({
  stripeSubscriptionsRetrieve: vi.fn(),
  stripeSubscriptionsUpdate: vi.fn(),
  stripeSubscriptionsCancel: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = {
      constructEvent: (payload: string) => JSON.parse(payload),
    };
    subscriptions = {
      retrieve: stripeSubscriptionsRetrieve,
      update: stripeSubscriptionsUpdate,
      cancel: stripeSubscriptionsCancel,
      list: vi.fn(),
    };
    checkout = { sessions: { create: vi.fn() } };
    customers = { create: vi.fn() };
  },
}));

import { BillingController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

/**
 * `processWebhookEvent` opens its own connections through the module-level repos, so a test
 * transaction cannot be threaded into it. Rows are therefore committed and removed in `afterEach`,
 * scoped to the ids this file created (never a blanket delete — spec files run in parallel against
 * one shared Postgres).
 */
interface SeededTenant {
  tenantId: string;
  customerId: string;
  subscriptionId: string;
}

const db = (BaseRepository as any)._db;

async function seedTenant(overrides: Record<string, unknown> = {}): Promise<SeededTenant> {
  const tenantId = String(Math.floor(Math.random() * 100000000) + 1000000);
  const customerId = `cus_guard_${tenantId}`;
  const subscriptionId = `sub_guard_${tenantId}`;
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant Stray Subscription Guard',
      subscription_plan: 'grassroots',
      subscription_status: 'active',
      subscription_quantity: 3,
      subscription_interval: 'month',
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      ...overrides,
    })
    .execute();
  return { tenantId, customerId, subscriptionId };
}

async function readTenant(tenantId: string): Promise<any> {
  return db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
}

function deletedEvent(subscriptionId: string, customerId: string): any {
  return {
    id: `evt_deleted_${subscriptionId}`,
    type: 'customer.subscription.deleted',
    created: 1_700_000_000,
    data: { object: { id: subscriptionId, customer: customerId } },
  };
}

function updatedEvent(subscriptionId: string, customerId: string, overrides: Record<string, unknown> = {}): any {
  return {
    id: `evt_updated_${subscriptionId}`,
    type: 'customer.subscription.updated',
    created: 1_700_000_000,
    data: {
      object: {
        id: subscriptionId,
        customer: customerId,
        status: 'active',
        items: { data: [{ price: { id: 'price_test_movement' }, quantity: 9, current_period_end: null }] },
        ...overrides,
      },
    },
  };
}

describe('BillingController.processWebhookEvent — stray-subscription guard on cancellation webhooks', () => {
  let controller: BillingController;
  const createdTenantIds: string[] = [];

  async function seed(overrides: Record<string, unknown> = {}): Promise<SeededTenant> {
    const seeded = await seedTenant(overrides);
    createdTenantIds.push(seeded.tenantId);
    return seeded;
  }

  beforeEach(() => {
    controller = new BillingController();
    vi.restoreAllMocks();
    stripeSubscriptionsRetrieve.mockReset();
    stripeSubscriptionsUpdate.mockReset();
    stripeSubscriptionsCancel.mockReset();
    stripeSubscriptionsCancel.mockResolvedValue({ id: 'canceled', status: 'canceled' });
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds) {
      await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    }
    createdTenantIds.length = 0;
  });

  it('downgrades to free when customer.subscription.deleted names the subscription the tenant stores', async () => {
    const { tenantId, customerId, subscriptionId } = await seed();

    await controller.processWebhookEvent(deletedEvent(subscriptionId, customerId));

    const tenant = await readTenant(tenantId);
    expect(tenant.subscription_plan).toBe('free');
    expect(tenant.subscription_status).toBe('canceled');
    expect(tenant.stripe_subscription_id).toBeNull();
    expect(tenant.subscription_quantity).toBe(1);
    expect(tenant.subscription_interval).toBe('month');
  });

  it('leaves a paying tenant untouched when customer.subscription.deleted names a stray subscription on the same customer', async () => {
    const { tenantId, customerId, subscriptionId } = await seed();

    await controller.processWebhookEvent(deletedEvent(`sub_stray_${tenantId}`, customerId));

    const tenant = await readTenant(tenantId);
    expect(tenant.subscription_plan).toBe('grassroots');
    expect(tenant.subscription_status).toBe('active');
    expect(tenant.stripe_subscription_id).toBe(subscriptionId);
    expect(tenant.subscription_quantity).toBe(3);
  });

  it('leaves a paying tenant untouched when customer.subscription.updated names a stray subscription on the same customer', async () => {
    const { tenantId, customerId, subscriptionId } = await seed();

    await controller.processWebhookEvent(updatedEvent(`sub_stray_${tenantId}`, customerId));

    const tenant = await readTenant(tenantId);
    expect(tenant.subscription_plan).toBe('grassroots');
    expect(tenant.subscription_status).toBe('active');
    expect(tenant.stripe_subscription_id).toBe(subscriptionId);
    // The stray event carried quantity 9 and the movement price — neither may be mirrored.
    expect(tenant.subscription_quantity).toBe(3);
  });

  it('leaves a paying tenant untouched when a stray subscription is canceled via customer.subscription.updated', async () => {
    const { tenantId, customerId, subscriptionId } = await seed();

    await controller.processWebhookEvent(
      updatedEvent(`sub_stray_${tenantId}`, customerId, { status: 'canceled', items: { data: [] } }),
    );

    const tenant = await readTenant(tenantId);
    expect(tenant.subscription_plan).toBe('grassroots');
    expect(tenant.subscription_status).toBe('active');
    expect(tenant.stripe_subscription_id).toBe(subscriptionId);
  });

  it('applies the cancellation as a fallback when the tenant stores no subscription id (self-heal branch)', async () => {
    const { tenantId, customerId } = await seed({ stripe_subscription_id: null });

    await controller.processWebhookEvent(deletedEvent(`sub_unknown_${tenantId}`, customerId));

    const tenant = await readTenant(tenantId);
    expect(tenant.subscription_plan).toBe('free');
    expect(tenant.subscription_status).toBe('canceled');
    expect(tenant.stripe_subscription_id).toBeNull();
  });

  it('adopts the event subscription id on customer.subscription.updated when the tenant stores none (self-heal branch)', async () => {
    const { tenantId, customerId } = await seed({ stripe_subscription_id: null });
    const incomingSubscriptionId = `sub_adopted_${tenantId}`;

    await controller.processWebhookEvent(updatedEvent(incomingSubscriptionId, customerId));

    const tenant = await readTenant(tenantId);
    expect(tenant.stripe_subscription_id).toBe(incomingSubscriptionId);
    expect(tenant.subscription_plan).toBe('movement');
    expect(tenant.subscription_quantity).toBe(9);
  });

  it('ignores a cancellation for a Stripe customer that matches no tenant, without throwing', async () => {
    const orphanCustomerId = `cus_orphan_${Math.floor(Math.random() * 100000000)}`;

    await expect(
      controller.processWebhookEvent(deletedEvent(`sub_orphan_${orphanCustomerId}`, orphanCustomerId)),
    ).resolves.toBeUndefined();
  });

  it('ignores an update for a Stripe customer that matches no tenant, without throwing', async () => {
    const orphanCustomerId = `cus_orphan_upd_${Math.floor(Math.random() * 100000000)}`;

    await expect(
      controller.processWebhookEvent(updatedEvent(`sub_orphan_${orphanCustomerId}`, orphanCustomerId)),
    ).resolves.toBeUndefined();
  });

  it('does not touch any other tenant when a stray cancellation arrives', async () => {
    const bystander = await seed();
    const target = await seed();

    await controller.processWebhookEvent(deletedEvent(`sub_stray_${target.tenantId}`, target.customerId));

    const other = await readTenant(bystander.tenantId);
    expect(other.subscription_plan).toBe('grassroots');
    expect(other.stripe_subscription_id).toBe(bystander.subscriptionId);
  });

  /**
   * The duplicate-checkout branch. Two completed Checkout sessions (two tabs, back button) leave
   * the customer with two live Stripe subscriptions. The handler stores the NEW id and cancels the
   * OLD one in Stripe, so the workspace is not billed twice and no subscription is left running
   * with nothing pointing at it.
   */
  function checkoutCompletedEvent(tenantId: string, customerId: string, subscriptionId: string): any {
    return {
      id: `evt_checkout_${subscriptionId}`,
      type: 'checkout.session.completed',
      created: 1_700_000_000,
      data: {
        object: {
          id: `cs_${tenantId}`,
          customer: customerId,
          subscription: subscriptionId,
          metadata: { tenantId },
        },
      },
    };
  }

  it('cancels the previously stored subscription and stores the new one when a second checkout session completes', async () => {
    const { tenantId, customerId, subscriptionId: firstSubscriptionId } = await seed();
    const secondSubscriptionId = `sub_second_${tenantId}`;
    stripeSubscriptionsRetrieve.mockResolvedValue({
      id: secondSubscriptionId,
      status: 'active',
      items: { data: [{ price: { id: 'price_test_movement' }, quantity: 2, current_period_end: null }] },
    });

    await controller.processWebhookEvent(checkoutCompletedEvent(tenantId, customerId, secondSubscriptionId));

    // The OLD subscription is the one cancelled — never the one the customer just bought.
    expect(stripeSubscriptionsCancel).toHaveBeenCalledTimes(1);
    expect(stripeSubscriptionsCancel).toHaveBeenCalledWith(firstSubscriptionId);
    expect(stripeSubscriptionsCancel).not.toHaveBeenCalledWith(secondSubscriptionId);

    const tenant = await readTenant(tenantId);
    expect(tenant.stripe_subscription_id).toBe(secondSubscriptionId);
    expect(tenant.subscription_plan).toBe('movement');
  });

  it('still stores the new subscription id, without throwing, when the Stripe cancel of the old one fails', async () => {
    const { tenantId, customerId, subscriptionId: firstSubscriptionId } = await seed();
    const secondSubscriptionId = `sub_second_fail_${tenantId}`;
    stripeSubscriptionsRetrieve.mockResolvedValue({
      id: secondSubscriptionId,
      status: 'active',
      items: { data: [{ price: { id: 'price_test_movement' }, quantity: 2, current_period_end: null }] },
    });
    stripeSubscriptionsCancel.mockRejectedValue(new Error('Stripe API unavailable'));

    await expect(
      controller.processWebhookEvent(checkoutCompletedEvent(tenantId, customerId, secondSubscriptionId)),
    ).resolves.toBeUndefined();

    expect(stripeSubscriptionsCancel).toHaveBeenCalledWith(firstSubscriptionId);

    const tenant = await readTenant(tenantId);
    expect(tenant.stripe_subscription_id).toBe(secondSubscriptionId);
    expect(tenant.subscription_plan).toBe('movement');
  });

  it('does not call Stripe cancel on a first-ever checkout, when the tenant stores no subscription id', async () => {
    const { tenantId, customerId } = await seed({ stripe_subscription_id: null, subscription_plan: 'free' });
    const firstSubscriptionId = `sub_first_${tenantId}`;
    stripeSubscriptionsRetrieve.mockResolvedValue({
      id: firstSubscriptionId,
      status: 'active',
      items: { data: [{ price: { id: 'price_test_grassroots' }, quantity: 2, current_period_end: null }] },
    });

    await controller.processWebhookEvent(checkoutCompletedEvent(tenantId, customerId, firstSubscriptionId));

    expect(stripeSubscriptionsCancel).not.toHaveBeenCalled();

    const tenant = await readTenant(tenantId);
    expect(tenant.stripe_subscription_id).toBe(firstSubscriptionId);
    expect(tenant.subscription_plan).toBe('grassroots');
  });
});
