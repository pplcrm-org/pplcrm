import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../lib/base.repo';
import { cancelSubscriptionImmediately, setSubscriptionCollectionPaused } from './subscription-sync';

// `vi.mock` factories are hoisted above module-level consts, so the mock fns and the mutable
// mock-mode flag must go through `vi.hoisted` — mirrors the pattern in controller.spec.ts.
const { subscriptionsUpdate, subscriptionsCancel, getStripeMock, mockState } = vi.hoisted(() => ({
  subscriptionsUpdate: vi.fn(),
  subscriptionsCancel: vi.fn(),
  getStripeMock: vi.fn(),
  mockState: { isMockMode: false },
}));

vi.mock('../../lib/stripe-platform-client', () => ({
  getStripe: getStripeMock,
  get isMockMode() {
    return mockState.isMockMode;
  },
}));

describe('subscription-sync', () => {
  const db = BaseRepository.dbInstance;
  const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

  let tenantWithSubId: string;
  let tenantWithoutSubId: string;
  const stripeSubscriptionId = 'sub_test_123';

  beforeEach(async () => {
    mockState.isMockMode = false;
    subscriptionsUpdate.mockReset().mockResolvedValue({});
    subscriptionsCancel.mockReset().mockResolvedValue({});
    getStripeMock.mockReset().mockReturnValue({
      subscriptions: { update: subscriptionsUpdate, cancel: subscriptionsCancel },
    });

    tenantWithSubId = rand();
    tenantWithoutSubId = rand();
    await db
      .insertInto('tenants')
      .values([
        {
          id: tenantWithSubId,
          name: 'Sub Sync Tenant (has subscription)',
          stripe_subscription_id: stripeSubscriptionId,
        },
        { id: tenantWithoutSubId, name: 'Sub Sync Tenant (no subscription)', stripe_subscription_id: null },
      ])
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('tenants').where('id', 'in', [tenantWithSubId, tenantWithoutSubId]).execute();
  });

  describe('setSubscriptionCollectionPaused', () => {
    it('pauses collection with behavior "void" for a tenant with a stored subscription id', async () => {
      await setSubscriptionCollectionPaused(tenantWithSubId, true);

      expect(getStripeMock).toHaveBeenCalledTimes(1);
      expect(subscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(stripeSubscriptionId, {
        pause_collection: { behavior: 'void' },
      });
    });

    it('clears pause_collection (empty string) when unpausing', async () => {
      await setSubscriptionCollectionPaused(tenantWithSubId, false);

      expect(subscriptionsUpdate).toHaveBeenCalledExactlyOnceWith(stripeSubscriptionId, {
        pause_collection: '',
      });
    });

    it('no-ops for a tenant with no stored subscription id — no Stripe call, no throw', async () => {
      await expect(setSubscriptionCollectionPaused(tenantWithoutSubId, true)).resolves.toBeUndefined();
      expect(getStripeMock).not.toHaveBeenCalled();
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('no-ops in mock mode even for a tenant with a stored subscription id', async () => {
      mockState.isMockMode = true;

      await expect(setSubscriptionCollectionPaused(tenantWithSubId, true)).resolves.toBeUndefined();
      expect(getStripeMock).not.toHaveBeenCalled();
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it('propagates a Stripe error to the caller (callers are documented to wrap this in try/catch)', async () => {
      subscriptionsUpdate.mockRejectedValueOnce(new Error('Stripe is down'));

      await expect(setSubscriptionCollectionPaused(tenantWithSubId, true)).rejects.toThrow('Stripe is down');
    });
  });

  describe('cancelSubscriptionImmediately', () => {
    it('cancels the stored Stripe subscription id', async () => {
      await cancelSubscriptionImmediately(tenantWithSubId);

      expect(getStripeMock).toHaveBeenCalledTimes(1);
      expect(subscriptionsCancel).toHaveBeenCalledExactlyOnceWith(stripeSubscriptionId);
    });

    it('no-ops for a tenant with no stored subscription id — no Stripe call, no throw', async () => {
      await expect(cancelSubscriptionImmediately(tenantWithoutSubId)).resolves.toBeUndefined();
      expect(getStripeMock).not.toHaveBeenCalled();
      expect(subscriptionsCancel).not.toHaveBeenCalled();
    });

    it('no-ops in mock mode even for a tenant with a stored subscription id', async () => {
      mockState.isMockMode = true;

      await expect(cancelSubscriptionImmediately(tenantWithSubId)).resolves.toBeUndefined();
      expect(getStripeMock).not.toHaveBeenCalled();
      expect(subscriptionsCancel).not.toHaveBeenCalled();
    });

    it('propagates a Stripe error to the caller (the deletion handler logs-and-continues on this)', async () => {
      subscriptionsCancel.mockRejectedValueOnce(new Error('Stripe is down'));

      await expect(cancelSubscriptionImmediately(tenantWithSubId)).rejects.toThrow('Stripe is down');
    });
  });
});
