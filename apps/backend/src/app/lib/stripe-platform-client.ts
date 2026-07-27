import Stripe from 'stripe';
import { env } from '../../env';

/** The single platform Stripe client + mock-mode flag, shared by billing (platform subscriptions)
 * and donations (Connect direct charges on tenant connected accounts via `{ stripeAccount }`
 * request options). Lives in lib/ so neither module imports from the other. */
const stripeSecretKey = env.stripeSecretKey;
export const stripe = stripeSecretKey && !stripeSecretKey.includes('MockKey') ? new Stripe(stripeSecretKey) : null;
export const isMockMode = stripe === null;

export function getStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe is not configured (running in mock mode)');
  }
  return stripe;
}

/**
 * Guard for the client-callable mock-billing helpers (activateMockPlan / cancelMockPlan),
 * which write `subscription_plan` and `subscription_status` straight onto `tenants`.
 *
 * SECURITY: `isMockMode` only means "no Stripe key resolved", which is also what a
 * misconfigured production deploy looks like. Requiring the explicit ALLOW_MOCK_PAYMENTS
 * opt-in as well means a missing key can never be mistaken for permission to fabricate a
 * subscription. Per env.ts, money-touching mock paths are opt-in, never inferred.
 */
export function assertMockModeAllowed(): void {
  if (!isMockMode || !env.allowMockPayments) {
    throw new Error('This helper is only available in local Mock Mode');
  }
}
