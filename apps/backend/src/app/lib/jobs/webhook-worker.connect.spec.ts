import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the shared platform client: the worker's Connect paths must never hit the network, and the
// application-fee refund call needs a spy.
const platform = vi.hoisted(() => ({ isMockMode: false, applicationFeeRefund: vi.fn() }));
vi.mock('../stripe-platform-client', () => ({
  get isMockMode() {
    return platform.isMockMode;
  },
  getStripe: () => ({ applicationFees: { createRefund: platform.applicationFeeRefund } }),
}));

import { BaseRepository } from '../base.repo';
import { BillingController } from '../../modules/billing/controller';
import { STRIPE_ACCOUNT_STATUS_KEY } from '../../modules/donations/stripe-connect';
import { WebhookEventWorker } from './webhook-worker';

const db = (BaseRepository as any)._db;

async function seedTenantWithAdmin(): Promise<{ tenantId: string; userId: string }> {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
  const tenantId = rand();
  const userId = rand();
  await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant Connect Worker' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `test-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId }).where('id', '=', tenantId).execute();
  return { tenantId, userId };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await db.updateTable('tenants').set({ admin_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

// Spec files run in parallel and share the one webhook_events queue, so every insert here gets a
// unique stripe_event_id, every claim is targeted (processNextEvent(eventRowId)), and cleanup only
// deletes this file's rows — never a blanket deleteFrom.
const insertedEventRowIds: string[] = [];

async function enqueueEvent(tenantId: string | null, event: Record<string, unknown>): Promise<string> {
  const row = await db
    .insertInto('webhook_events')
    .values({
      tenant_id: tenantId,
      stripe_event_id: `${String(event['id'])}_${Math.random().toString(36).slice(2, 9)}`,
      type: String(event['type']),
      payload: JSON.stringify(event),
      status: 'pending',
      // Backdate: the claim compares run_at against the JS clock, which can lag Postgres's now()
      // default by enough to make a freshly inserted row "not due yet" (flaky claims).
      run_at: new Date(Date.now() - 60_000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const rowId = String(row.id);
  insertedEventRowIds.push(rowId);
  return rowId;
}

async function eventStatus(id: string): Promise<string> {
  const row = await db.selectFrom('webhook_events').select('status').where('id', '=', id).executeTakeFirstOrThrow();
  return String(row.status);
}

describe('WebhookEventWorker — Stripe Connect dispatch', () => {
  const worker = new WebhookEventWorker();
  let tenantId: string;
  let billingSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    platform.isMockMode = false;
    platform.applicationFeeRefund.mockReset();
    billingSpy = vi.spyOn(BillingController.prototype, 'processWebhookEvent').mockResolvedValue(undefined as any);
    ({ tenantId } = await seedTenantWithAdmin());
  });

  afterEach(async () => {
    if (insertedEventRowIds.length) {
      await db.deleteFrom('webhook_events').where('id', 'in', insertedEventRowIds.splice(0)).execute();
    }
    await cleanTenant(tenantId);
  });

  it('account.updated refreshes the cached Connect status (this is what opens the charges gate)', async () => {
    const eventId = await enqueueEvent(tenantId, {
      id: 'evt_acct_upd_1',
      type: 'account.updated',
      account: 'acct_w1',
      data: { object: { id: 'acct_w1', details_submitted: true, charges_enabled: true } },
    });

    await (worker as any).processNextEvent(eventId);

    const statusRow = await db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', STRIPE_ACCOUNT_STATUS_KEY)
      .executeTakeFirst();
    expect(statusRow?.value).toEqual({ detailsSubmitted: true, chargesEnabled: true });
    expect(await eventStatus(eventId)).toBe('processed');
    expect(billingSpy).not.toHaveBeenCalled();
  });

  it('an unhandled Connect event is acknowledged without reaching the BillingController', async () => {
    const eventId = await enqueueEvent(tenantId, {
      id: 'evt_conn_unhandled_1',
      type: 'payment_intent.created',
      account: 'acct_w1',
      data: { object: { id: 'pi_1' } },
    });

    await (worker as any).processNextEvent(eventId);

    expect(billingSpy).not.toHaveBeenCalled();
    expect(await eventStatus(eventId)).toBe('processed');
  });

  it('platform-account events (no `account`) still fall through to the BillingController', async () => {
    const eventId = await enqueueEvent(null, {
      id: 'evt_billing_1',
      type: 'invoice.paid',
      data: { object: { customer: 'cus_platform_1' } },
    });

    await (worker as any).processNextEvent(eventId);

    expect(billingSpy).toHaveBeenCalledTimes(1);
    expect(await eventStatus(eventId)).toBe('processed');
  });

  // Regression: subscription-lifecycle events are emitted for BOTH a donation pledge (Connect) and a
  // tenant's own plan (platform). They must be discriminated by `account`, or platform billing events
  // are swallowed by the donation branches and a failed renewal never triggers a payment hold / a
  // cancellation never downgrades the tenant.
  for (const type of ['customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed']) {
    it(`platform \`${type}\` (no account) reaches the BillingController`, async () => {
      const eventId = await enqueueEvent(null, {
        id: `evt_platform_${type}`,
        type,
        data: { object: { id: 'sub_platform_1', subscription: 'sub_platform_1', status: 'past_due' } },
      });

      await (worker as any).processNextEvent(eventId);

      expect(billingSpy).toHaveBeenCalledTimes(1);
      expect(await eventStatus(eventId)).toBe('processed');
    });
  }

  it('Connect `customer.subscription.updated` (has account) is handled as a pledge, NOT by billing', async () => {
    const eventId = await enqueueEvent(tenantId, {
      id: 'evt_conn_sub_upd',
      type: 'customer.subscription.updated',
      account: 'acct_w1',
      data: { object: { id: 'sub_conn_1', status: 'past_due' } },
    });

    await (worker as any).processNextEvent(eventId);

    expect(billingSpy).not.toHaveBeenCalled();
    expect(await eventStatus(eventId)).toBe('processed');
  });

  it('a fully refunded Connect charge refunds the platform application fee', async () => {
    platform.applicationFeeRefund.mockResolvedValue({ id: 'fr_1' });
    const eventId = await enqueueEvent(tenantId, {
      id: 'evt_refund_1',
      type: 'charge.refunded',
      account: 'acct_w1',
      data: {
        object: {
          id: 'ch_1',
          amount: 5000,
          amount_refunded: 5000,
          refunded: true,
          application_fee: 'fee_abc',
          payment_intent: 'pi_refund_1',
        },
      },
    });

    await (worker as any).processNextEvent(eventId);

    expect(platform.applicationFeeRefund).toHaveBeenCalledWith('fee_abc');
    expect(await eventStatus(eventId)).toBe('processed');
  });

  it('a partial refund leaves the application fee untouched', async () => {
    const eventId = await enqueueEvent(tenantId, {
      id: 'evt_refund_partial_1',
      type: 'charge.refunded',
      account: 'acct_w1',
      data: {
        object: {
          id: 'ch_2',
          amount: 5000,
          amount_refunded: 1000,
          refunded: false,
          application_fee: 'fee_def',
          payment_intent: 'pi_refund_2',
        },
      },
    });

    await (worker as any).processNextEvent(eventId);

    expect(platform.applicationFeeRefund).not.toHaveBeenCalled();
    expect(await eventStatus(eventId)).toBe('processed');
  });
});
