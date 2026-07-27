import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * SECURITY REGRESSION (C3) — `activateMockPlan` writes `subscription_plan` and
 * `subscription_status: 'active'` directly onto `tenants`, and every entitlement gate
 * reads that column. Its only guard was `isMockMode`, which means *the Stripe key did
 * not resolve* — indistinguishable from a production deploy whose secretref typo'd or
 * whose Key Vault reference unmounted. In that state any tenant owner could self-grant
 * the top plan, and `syncSubscriptionFromStripe` could not correct it because it also
 * short-circuits in mock mode.
 *
 * The guard now also requires the explicit ALLOW_MOCK_PAYMENTS opt-in, matching the rule
 * stated in env.ts: money-touching mock paths are opted into, never inferred.
 */
describe('assertMockModeAllowed', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  /** Re-import the module with a fresh env so the module-level Stripe client re-evaluates. */
  async function load(env: { stripeKey?: string; allowMockPayments?: string }) {
    vi.resetModules();
    vi.stubEnv('STRIPE_SECRET_KEY', env.stripeKey ?? '');
    vi.stubEnv('ALLOW_MOCK_PAYMENTS', env.allowMockPayments ?? '');
    return await import('./stripe-platform-client');
  }

  it('refuses when no Stripe key resolved but mock payments were not opted into', async () => {
    // This is the production-misconfiguration case the finding describes.
    const { assertMockModeAllowed, isMockMode } = await load({ stripeKey: '' });
    expect(isMockMode).toBe(true);
    expect(() => assertMockModeAllowed()).toThrow(/Mock Mode/i);
  });

  it('refuses when a "MockKey" placeholder is present without the opt-in', async () => {
    const { assertMockModeAllowed } = await load({ stripeKey: 'sk_test_MockKey' });
    expect(() => assertMockModeAllowed()).toThrow(/Mock Mode/i);
  });

  it('refuses when mock payments are opted into but a real Stripe key is configured', async () => {
    // Not mock mode at all — the helper must never fabricate a subscription alongside
    // a live Stripe account.
    const { assertMockModeAllowed } = await load({
      stripeKey: 'sk_test_51RealLookingKeyValue',
      allowMockPayments: 'true',
    });
    expect(() => assertMockModeAllowed()).toThrow(/Mock Mode/i);
  });

  it('allows only local mock mode with the explicit opt-in', async () => {
    const { assertMockModeAllowed } = await load({ stripeKey: '', allowMockPayments: 'true' });
    expect(() => assertMockModeAllowed()).not.toThrow();
  });
});
