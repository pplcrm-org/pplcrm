import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock env BEFORE importing controller to disable mock mode in controller
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

// Spy on Stripe constructor and webhooks constructEvent. `vi.mock` factories are hoisted above
// module-level const declarations, so the mock fns themselves must go through `vi.hoisted` —
// referencing a plain outer `const` here throws "Cannot access before initialization".
const {
  stripeSubscriptionsRetrieve,
  stripeSubscriptionsUpdate,
  stripeSubscriptionsList,
  stripeCheckoutSessionsCreate,
  stripeCustomersCreate,
} = vi.hoisted(() => ({
  stripeSubscriptionsRetrieve: vi.fn(),
  stripeSubscriptionsUpdate: vi.fn(),
  stripeSubscriptionsList: vi.fn(),
  stripeCheckoutSessionsCreate: vi.fn(),
  stripeCustomersCreate: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = {
      constructEvent: (payload: string) => JSON.parse(payload),
    };
    subscriptions = {
      retrieve: stripeSubscriptionsRetrieve,
      update: stripeSubscriptionsUpdate,
      list: stripeSubscriptionsList,
    };
    checkout = {
      sessions: {
        create: stripeCheckoutSessionsCreate,
      },
    };
    customers = {
      create: stripeCustomersCreate,
    };
  },
}));

import { BillingController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { WebhookEventWorker } from '../../lib/jobs/webhook-worker';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { syncSubscriptionQuantity } from './subscription-sync';

describe('Billing Webhook Async Processing Integration', () => {
  const db = (BaseRepository as any)._db;
  let controller: BillingController;
  let _worker: WebhookEventWorker;

  // webhook_events is a single shared queue and spec files run in parallel (the Connect worker
  // spec uses it too), so every query/cleanup here is scoped to THIS spec's event ids — never a
  // blanket deleteFrom or an unfiltered count.
  const EVENT_IDS = ['evt_test_123', 'evt_test_dup'];

  beforeEach(async () => {
    controller = new BillingController();
    _worker = new WebhookEventWorker();
    vi.restoreAllMocks();
    stripeSubscriptionsRetrieve.mockReset();
    stripeSubscriptionsUpdate.mockReset();

    await db.deleteFrom('webhook_events').where('stripe_event_id', 'in', EVENT_IDS).execute();
  });

  afterEach(async () => {
    await db.deleteFrom('webhook_events').where('stripe_event_id', 'in', EVENT_IDS).execute();
  });

  it('should immediately persist Stripe event payload to webhook_events as pending', async () => {
    const mockEvent = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_session',
          customer: 'cus_123',
          subscription: 'sub_123',
        },
      },
    };

    const payloadStr = JSON.stringify(mockEvent);

    // Call handleWebhook (simulating Stripe HTTP Post)
    await controller.handleWebhook(payloadStr, 'sig_header');

    // Verify it is saved in the database
    const events = await db
      .selectFrom('webhook_events')
      .selectAll()
      .where('stripe_event_id', '=', 'evt_test_123')
      .execute();
    expect(events.length).toBe(1);
    expect(events[0].stripe_event_id).toBe('evt_test_123');
    expect(events[0].type).toBe('checkout.session.completed');
    expect(events[0].status).toBe('pending');
    expect(events[0].attempts).toBe(0);
  });

  it('should ignore duplicate webhook event inserts on conflict and not crash', async () => {
    const mockEvent = {
      id: 'evt_test_dup',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_session',
        },
      },
    };

    const payloadStr = JSON.stringify(mockEvent);

    // Call handleWebhook twice with the same event id
    await controller.handleWebhook(payloadStr, 'sig_header');
    await controller.handleWebhook(payloadStr, 'sig_header');

    // Only one row should be present
    const events = await db
      .selectFrom('webhook_events')
      .selectAll()
      .where('stripe_event_id', '=', 'evt_test_dup')
      .execute();
    expect(events.length).toBe(1);
    expect(events[0].stripe_event_id).toBe('evt_test_dup');
  });
});

/** Seeds a minimal billable tenant row (no admin user — the invoice.paid/subscription-changed
 * email paths no-op without one, keeping these tests focused on the quantity persistence). */
async function seedBillingTenant(
  db: any,
  overrides: Record<string, unknown> = {},
): Promise<{ tenantId: string; customerId: string }> {
  const tenantId = String(Math.floor(Math.random() * 100000000) + 1000000);
  const customerId = `cus_${tenantId}`;
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant Webhook Quantity',
      subscription_plan: 'grassroots',
      subscription_status: 'active',
      subscription_quantity: 1,
      stripe_customer_id: customerId,
      stripe_subscription_id: `sub_${tenantId}`,
      ...overrides,
    })
    .execute();
  return { tenantId, customerId };
}

async function cleanBillingTenant(db: any, tenantId: string): Promise<void> {
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('BillingController.processWebhookEvent — subscription_quantity persistence', () => {
  const db = (BaseRepository as any)._db;
  let controller: BillingController;
  let tenantId: string;
  let customerId: string;

  beforeEach(async () => {
    controller = new BillingController();
    vi.restoreAllMocks();
    stripeSubscriptionsRetrieve.mockReset();
    stripeSubscriptionsUpdate.mockReset();
  });

  afterEach(async () => {
    await cleanBillingTenant(db, tenantId);
  });

  it('persists the Stripe item quantity on customer.subscription.updated', async () => {
    ({ tenantId, customerId } = await seedBillingTenant(db));

    await controller.processWebhookEvent({
      id: 'evt_sub_updated',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_${tenantId}`,
          customer: customerId,
          status: 'active',
          items: { data: [{ price: { id: 'price_unknown' }, quantity: 4, current_period_end: null }] },
        },
      },
    } as any);

    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_quantity).toBe(4);
    // Unknown price id → interval falls back to the stored value ('month' seed default).
    expect(tenant.subscription_interval).toBe('month');
  });

  it('persists the annual interval when the Stripe price is an annual price id', async () => {
    ({ tenantId, customerId } = await seedBillingTenant(db));

    await controller.processWebhookEvent({
      id: 'evt_sub_updated_annual',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_${tenantId}`,
          customer: customerId,
          status: 'active',
          items: { data: [{ price: { id: 'price_test_grassroots_annual' }, quantity: 2, current_period_end: null }] },
        },
      },
    } as any);

    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_plan).toBe('grassroots');
    expect(tenant.subscription_quantity).toBe(2);
    expect(tenant.subscription_interval).toBe('year');
  });

  it('resets subscription_quantity to 1 and the interval to month on customer.subscription.deleted', async () => {
    ({ tenantId, customerId } = await seedBillingTenant(db, {
      subscription_quantity: 7,
      subscription_interval: 'year',
    }));

    await controller.processWebhookEvent({
      id: 'evt_sub_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: `sub_${tenantId}`, customer: customerId } },
    } as any);

    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_quantity).toBe(1);
    expect(tenant.subscription_plan).toBe('free');
    expect(tenant.subscription_interval).toBe('month');
  });

  it('downgrades the billed quantity on invoice.paid when the emailable count has dropped', async () => {
    // Grassroots bracket 5 tops out at 15,000 — with zero emailable persons seeded, the current
    // bracket resolves to 1, which is below the billed quantity of 5, so invoice.paid (proof
    // we've crossed a cycle boundary) should reconcile the billed quantity down to 1.
    ({ tenantId, customerId } = await seedBillingTenant(db, { subscription_quantity: 5 }));
    stripeSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 5 }] },
    });

    await controller.processWebhookEvent({
      id: 'evt_invoice_paid',
      type: 'invoice.paid',
      data: {
        object: {
          customer: customerId,
          amount_paid: 4900,
          hosted_invoice_url: 'https://stripe.example.com/invoice',
          lines: { data: [] },
        },
      },
    } as any);

    expect(stripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_' + tenantId, {
      items: [{ id: 'si_1', quantity: 1 }],
      proration_behavior: 'none',
    });
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_quantity).toBe(1);
  });

  it('does not sync on invoice.paid when the billed quantity is already at (or below) the current bracket', async () => {
    ({ tenantId, customerId } = await seedBillingTenant(db, { subscription_quantity: 1 }));

    await controller.processWebhookEvent({
      id: 'evt_invoice_paid_noop',
      type: 'invoice.paid',
      data: {
        object: {
          customer: customerId,
          amount_paid: 2900,
          hosted_invoice_url: 'https://stripe.example.com/invoice',
          lines: { data: [] },
        },
      },
    } as any);

    expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled();
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_quantity).toBe(1);
  });
});

describe('BillingController.syncSubscriptionFromStripe — webhook-independent reconciliation', () => {
  const db = (BaseRepository as any)._db;
  let controller: BillingController;
  let tenantId: string;

  beforeEach(() => {
    controller = new BillingController();
    stripeSubscriptionsList.mockReset();
  });

  afterEach(async () => {
    await cleanBillingTenant(db, tenantId);
  });

  it('mirrors the live subscription (plan, quantity, interval, period end) onto the tenant', async () => {
    ({ tenantId } = await seedBillingTenant(db));
    const periodEnd = 1799999999; // seconds
    stripeSubscriptionsList.mockResolvedValue({
      data: [
        {
          id: 'sub_live_movement',
          status: 'active',
          items: {
            data: [{ price: { id: 'price_test_movement' }, quantity: 3, current_period_end: periodEnd }],
          },
        },
      ],
    });

    const res = await controller.syncSubscriptionFromStripe({ tenant_id: tenantId });

    expect(res).toEqual({ synced: true, plan: 'movement' });
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_plan).toBe('movement');
    expect(tenant.subscription_status).toBe('active');
    expect(tenant.subscription_quantity).toBe(3);
    expect(tenant.subscription_interval).toBe('month');
    expect(tenant.stripe_subscription_id).toBe('sub_live_movement');
    expect(new Date(tenant.subscription_ends_at).getTime()).toBe(periodEnd * 1000);
  });

  it('keeps the stored plan when the live price id matches no configured price, but still syncs status/quantity', async () => {
    ({ tenantId } = await seedBillingTenant(db, { subscription_quantity: 1 }));
    stripeSubscriptionsList.mockResolvedValue({
      data: [
        {
          id: 'sub_live_unknown_price',
          status: 'past_due',
          items: { data: [{ price: { id: 'price_from_another_mode' }, quantity: 2, current_period_end: null }] },
        },
      ],
    });

    const res = await controller.syncSubscriptionFromStripe({ tenant_id: tenantId });

    expect(res).toEqual({ synced: true, plan: 'grassroots' });
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_plan).toBe('grassroots');
    expect(tenant.subscription_status).toBe('past_due');
    expect(tenant.subscription_quantity).toBe(2);
  });

  it('downgrades to free when the customer has no live subscription but one was stored', async () => {
    ({ tenantId } = await seedBillingTenant(db, { subscription_quantity: 4, subscription_interval: 'year' }));
    stripeSubscriptionsList.mockResolvedValue({ data: [{ id: 'sub_old', status: 'canceled', items: { data: [] } }] });

    const res = await controller.syncSubscriptionFromStripe({ tenant_id: tenantId });

    expect(res).toEqual({ synced: true, plan: 'free' });
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_plan).toBe('free');
    expect(tenant.subscription_status).toBe('canceled');
    expect(tenant.subscription_quantity).toBe(1);
    expect(tenant.subscription_interval).toBe('month');
  });

  it('does not touch a tenant that has a Stripe customer but never subscribed', async () => {
    ({ tenantId } = await seedBillingTenant(db, {
      subscription_plan: 'free',
      subscription_status: 'inactive',
      stripe_subscription_id: null,
    }));
    stripeSubscriptionsList.mockResolvedValue({ data: [] });

    const res = await controller.syncSubscriptionFromStripe({ tenant_id: tenantId });

    expect(res).toEqual({ synced: false, plan: 'free' });
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_status).toBe('inactive');
  });
});

describe('syncSubscriptionQuantity (live mode) — idempotency + proration_behavior', () => {
  const db = (BaseRepository as any)._db;
  let tenantId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    stripeSubscriptionsRetrieve.mockReset();
    stripeSubscriptionsUpdate.mockReset();
    ({ tenantId } = await seedBillingTenant(db));
  });

  afterEach(async () => {
    await cleanBillingTenant(db, tenantId);
  });

  it('is a no-op (does not call subscriptions.update) when the live quantity already matches', async () => {
    stripeSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 3 }] },
    });

    await syncSubscriptionQuantity(tenantId, 3);

    expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('calls subscriptions.update when the quantity differs, and writes the column optimistically', async () => {
    stripeSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 2 }] },
    });

    await syncSubscriptionQuantity(tenantId, 6);

    expect(stripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_' + tenantId, {
      items: [{ id: 'si_1', quantity: 6 }],
      proration_behavior: 'always_invoice',
    });
    const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
    expect(tenant.subscription_quantity).toBe(6);
  });

  it('calling it twice in a row with the same target quantity only updates Stripe once (idempotent)', async () => {
    stripeSubscriptionsRetrieve.mockResolvedValueOnce({ items: { data: [{ id: 'si_1', quantity: 1 }] } });
    await syncSubscriptionQuantity(tenantId, 8);
    expect(stripeSubscriptionsUpdate).toHaveBeenCalledTimes(1);

    // Second call: the "live" retrieve now reflects the already-applied quantity.
    stripeSubscriptionsRetrieve.mockResolvedValueOnce({ items: { data: [{ id: 'si_1', quantity: 8 }] } });
    await syncSubscriptionQuantity(tenantId, 8);
    expect(stripeSubscriptionsUpdate).toHaveBeenCalledTimes(1);
  });

  it('invoices a quantity INCREASE on an annual subscription immediately (proration always_invoice)', async () => {
    stripeSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 2, price: { recurring: { interval: 'year' } } }] },
    });

    await syncSubscriptionQuantity(tenantId, 6);

    expect(stripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_' + tenantId, {
      items: [{ id: 'si_1', quantity: 6 }],
      proration_behavior: 'always_invoice',
    });
  });

  it('keeps proration "none" for a quantity DECREASE on an annual subscription', async () => {
    stripeSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 6, price: { recurring: { interval: 'year' } } }] },
    });

    await syncSubscriptionQuantity(tenantId, 2);

    expect(stripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_' + tenantId, {
      items: [{ id: 'si_1', quantity: 2 }],
      proration_behavior: 'none',
    });
  });

  it('invoices a quantity INCREASE on a monthly subscription immediately too (proration always_invoice)', async () => {
    stripeSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 2, price: { recurring: { interval: 'month' } } }] },
    });

    await syncSubscriptionQuantity(tenantId, 6);

    expect(stripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_' + tenantId, {
      items: [{ id: 'si_1', quantity: 6 }],
      proration_behavior: 'always_invoice',
    });
  });
});

describe('BillingController.createCheckoutSession — Stripe Tax parameters', () => {
  const db = (BaseRepository as any)._db;
  let controller: BillingController;
  let tenantId: string;
  let customerId: string;

  beforeEach(async () => {
    controller = new BillingController();
    vi.restoreAllMocks();
    stripeCheckoutSessionsCreate.mockReset();
    stripeCustomersCreate.mockReset();
    ({ tenantId, customerId } = await seedBillingTenant(db));
  });

  afterEach(async () => {
    await cleanBillingTenant(db, tenantId);
  });

  it('creates the Checkout session with automatic tax, address collection, and tax ID collection', async () => {
    stripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.example/session' });

    const result = await controller.createCheckoutSession({ tenant_id: tenantId, user_id: tenantId }, 'grassroots');

    expect(result.url).toBe('https://checkout.stripe.example/session');
    // Tenant already has a Stripe customer, so no new Customer is created.
    expect(stripeCustomersCreate).not.toHaveBeenCalled();
    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledTimes(1);
    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: 'price_test_grassroots', quantity: 1 }],
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
        customer_update: { address: 'auto', name: 'auto' },
        tax_id_collection: { enabled: true },
      }),
    );
  });

  it('uses the annual price id when checkout is created with the year interval', async () => {
    stripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.example/session' });

    await controller.createCheckoutSession({ tenant_id: tenantId, user_id: tenantId }, 'movement', 'year');

    expect(stripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_test_movement_annual', quantity: 1 }],
      }),
    );
  });
});

describe('BillingController.processWebhookEvent — receipt email tax line', () => {
  const db = (BaseRepository as any)._db;
  let controller: BillingController;
  let tenantId: string;
  let customerId: string;
  let adminId: string;

  beforeEach(async () => {
    controller = new BillingController();
    vi.restoreAllMocks();
    stripeSubscriptionsRetrieve.mockReset();
    stripeSubscriptionsUpdate.mockReset();
    ({ tenantId, customerId } = await seedBillingTenant(db));
    adminId = String(Math.floor(Math.random() * 100000000) + 1000000);
    await db
      .insertInto('authusers')
      .values({
        id: adminId,
        tenant_id: tenantId,
        email: `billing-admin-${adminId}@example.com`,
        password: 'password',
        first_name: 'Billing',
        last_name: 'Admin',
        verified: true,
        createdby_id: adminId,
        updatedby_id: adminId,
      })
      .execute();
    await db.updateTable('tenants').set({ admin_id: adminId }).where('id', '=', tenantId).execute();
  });

  afterEach(async () => {
    await db.updateTable('tenants').set({ admin_id: null }).where('id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('id', '=', adminId).execute();
    await cleanBillingTenant(db, tenantId);
  });

  function invoicePaidEvent(overrides: Record<string, unknown> = {}): any {
    return {
      id: `evt_invoice_paid_${Math.random().toString(36).substring(7)}`,
      type: 'invoice.paid',
      data: {
        object: {
          customer: customerId,
          amount_paid: 5150,
          hosted_invoice_url: 'https://stripe.example.com/invoice',
          lines: { data: [{ description: 'Grassroots plan', amount: 4900, quantity: 1 }] },
          ...overrides,
        },
      },
    };
  }

  it('includes a tax line when the invoice carries a non-zero total_taxes amount', async () => {
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined as any);

    await controller.processWebhookEvent(invoicePaidEvent({ total_taxes: [{ amount: 250 }] }));

    expect(sendMail).toHaveBeenCalledTimes(1);
    const msg = sendMail.mock.calls[0][0] as { text: string; html: string };
    expect(msg.text).toContain('Tax: $2.50');
    expect(msg.html).toContain('<strong>Tax</strong>: $2.50');
  });

  it('omits the tax line when the invoice has no tax', async () => {
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined as any);

    await controller.processWebhookEvent(invoicePaidEvent({ total_taxes: null }));

    expect(sendMail).toHaveBeenCalledTimes(1);
    const msg = sendMail.mock.calls[0][0] as { text: string; html: string };
    expect(msg.text).not.toContain('Tax:');
    expect(msg.html).not.toContain('<strong>Tax</strong>');
  });
});

/**
 * Free is not purchasable, so it never arrives from Stripe. Without an explicit path a tenant
 * sits at subscription_status = NULL forever, which is what strands them in demo mode.
 */
describe('BillingController.selectFreePlan', () => {
  const db = (BaseRepository as any)._db;
  let controller: BillingController;
  let tenantId: string;

  const tenantRow = () => db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();

  beforeEach(() => {
    controller = new BillingController();
  });

  afterEach(async () => {
    await cleanBillingTenant(db, tenantId);
  });

  it('records an active status on free for a tenant that never subscribed', async () => {
    ({ tenantId } = await seedBillingTenant(db, {
      subscription_plan: 'free',
      subscription_status: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }));

    const res = await controller.selectFreePlan({ tenant_id: tenantId });

    expect(res).toEqual({ success: true, plan: 'free' });
    const tenant = await tenantRow();
    expect(tenant.subscription_plan).toBe('free');
    // The exact value demo.exit gates on — the whole point of this path.
    expect(tenant.subscription_status).toBe('active');
    expect(tenant.subscription_ends_at).toBeNull();
    expect(tenant.subscription_quantity).toBe(1);
  });

  it('creates no Stripe customer, so a later sync cannot clobber the status', async () => {
    ({ tenantId } = await seedBillingTenant(db, {
      subscription_plan: 'free',
      subscription_status: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }));

    await controller.selectFreePlan({ tenant_id: tenantId });

    const tenant = await tenantRow();
    expect(tenant.stripe_customer_id).toBeNull();
    expect(tenant.stripe_subscription_id).toBeNull();
    // syncSubscriptionFromStripe returns early without a customer id, leaving free/active intact.
    await expect(controller.syncSubscriptionFromStripe({ tenant_id: tenantId })).resolves.toEqual({
      synced: false,
      plan: 'free',
    });
    expect((await tenantRow()).subscription_status).toBe('active');
  });

  it('refuses while a paid subscription is live — that downgrade belongs in the Stripe portal', async () => {
    ({ tenantId } = await seedBillingTenant(db)); // grassroots + active + sub id

    await expect(controller.selectFreePlan({ tenant_id: tenantId })).rejects.toThrow(/Cancel it under Manage/i);

    const tenant = await tenantRow();
    expect(tenant.subscription_plan).toBe('grassroots');
    expect(tenant.subscription_status).toBe('active');
  });

  it('allows free after a paid subscription was canceled', async () => {
    ({ tenantId } = await seedBillingTenant(db, {
      subscription_plan: 'free',
      subscription_status: 'canceled',
      subscription_ends_at: new Date().toISOString(),
    }));

    await controller.selectFreePlan({ tenant_id: tenantId });

    const tenant = await tenantRow();
    expect(tenant.subscription_status).toBe('active');
    expect(tenant.subscription_ends_at).toBeNull();
  });

  it('is idempotent once free is already settled', async () => {
    ({ tenantId } = await seedBillingTenant(db, {
      subscription_plan: 'free',
      subscription_status: 'active',
      stripe_customer_id: null,
      stripe_subscription_id: null,
    }));

    await expect(controller.selectFreePlan({ tenant_id: tenantId })).resolves.toEqual({ success: true, plan: 'free' });
    expect((await tenantRow()).subscription_status).toBe('active');
  });
});
