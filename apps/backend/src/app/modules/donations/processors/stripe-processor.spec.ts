import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the shared platform client so we can assert the exact Checkout Session params (and the
// `{stripeAccount}` request options) without any network call, and flip mock mode per test.
const state = vi.hoisted(() => ({ isMockMode: false, createSession: vi.fn() }));
vi.mock('../../../lib/stripe-platform-client', () => ({
  get isMockMode() {
    return state.isMockMode;
  },
  getStripe: () => ({ checkout: { sessions: { create: state.createSession } } }),
}));

import { env } from '../../../../env';
import { platformFeeCents, StripeDonationProcessor } from './stripe-processor';

describe('StripeDonationProcessor.createOneTimeCheckout (Connect direct charge)', () => {
  beforeEach(() => {
    state.isMockMode = false;
    state.createSession.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the session on the connected account with the platform application fee', async () => {
    state.createSession.mockResolvedValue({ url: 'https://stripe.example/session_123' });

    const processor = new StripeDonationProcessor({ accountId: 'acct_42', feePercent: 1 });
    const result = await processor.createOneTimeCheckout({
      tenantId: '42',
      userId: '7',
      personId: '99',
      amountCents: 5000,
      address: { country: 'CA', state: 'ON' },
    });

    expect(result).toEqual({ url: 'https://stripe.example/session_123' });
    expect(state.createSession).toHaveBeenCalledTimes(1);
    expect(state.createSession).toHaveBeenCalledWith(
      {
        payment_method_types: ['card'],
        // Receipts need the donor's mailing address, so Checkout must collect it.
        billing_address_collection: 'required',
        line_items: [
          {
            price_data: {
              currency: 'cad',
              product_data: { name: 'Campaign Donation' },
              unit_amount: 5000,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        payment_intent_data: { application_fee_amount: 50 },
        success_url: `${env.appUrl}/people/99?checkout_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.appUrl}/people/99?checkout_cancel=true`,
        metadata: {
          tenantId: '42',
          personId: '99',
          amount: '5000',
          residencyProvince: 'ON',
          residencyCountry: 'CA',
          createdBy: '7',
        },
      },
      { stripeAccount: 'acct_42' },
    );
  });

  it('charges in the workspace currency', async () => {
    state.createSession.mockResolvedValue({ url: 'https://stripe.example/session_gbp' });

    const processor = new StripeDonationProcessor({ accountId: 'acct_42', feePercent: 1, currency: 'gbp' });
    await processor.createOneTimeCheckout({
      tenantId: '42',
      userId: '7',
      personId: '99',
      amountCents: 5000,
      address: { country: 'GB' },
    });

    const [payload] = state.createSession.mock.calls[0];
    expect(payload.line_items[0].price_data.currency).toBe('gbp');
  });

  it('falls back to CAD rather than sending an undefined currency', async () => {
    // A charge with `currency: undefined` is rejected by Stripe; the config field is optional
    // so a caller that forgets it must still produce a valid, correctly-denominated charge.
    state.createSession.mockResolvedValue({ url: 'https://stripe.example/session_default' });

    const processor = new StripeDonationProcessor({ accountId: 'acct_42', feePercent: 1 });
    await processor.createOneTimeCheckout({
      tenantId: '42',
      userId: '7',
      personId: '99',
      amountCents: 5000,
      address: { country: 'CA' },
    });

    const [payload] = state.createSession.mock.calls[0];
    expect(payload.line_items[0].price_data.currency).toBe('cad');
  });

  it('omits payment_intent_data entirely when the fee rounds to zero', async () => {
    state.createSession.mockResolvedValue({ url: 'https://stripe.example/session_tiny' });
    const processor = new StripeDonationProcessor({ accountId: 'acct_42', feePercent: 1 });
    await processor.createOneTimeCheckout({
      tenantId: '1',
      userId: '2',
      personId: '3',
      amountCents: 49, // 1% of 49¢ rounds to 0
      address: {},
    });
    const params = state.createSession.mock.calls[0][0];
    expect(params.payment_intent_data).toBeUndefined();
  });

  it('honors custom success/cancel URLs', async () => {
    state.createSession.mockResolvedValue({ url: 'https://stripe.example/session_456' });
    const processor = new StripeDonationProcessor({ accountId: 'acct_1', feePercent: 1 });
    await processor.createOneTimeCheckout({
      tenantId: '1',
      userId: '2',
      personId: '3',
      amountCents: 1000,
      address: {},
      customUrls: { successUrl: 'https://app/success?sid={CHECKOUT_SESSION_ID}', cancelUrl: 'https://app/cancel' },
    });
    const params = state.createSession.mock.calls[0][0];
    expect(params.success_url).toBe('https://app/success?sid={CHECKOUT_SESSION_ID}');
    expect(params.cancel_url).toBe('https://app/cancel');
  });

  it('takes the mock branch (no Stripe call) in platform mock mode', async () => {
    state.isMockMode = true;
    const processor = new StripeDonationProcessor({ accountId: undefined, feePercent: 1 });
    const result = await processor.createOneTimeCheckout({
      tenantId: '42',
      userId: '7',
      personId: '99',
      amountCents: 5000,
      address: { country: 'CA', state: 'ON' },
    });
    expect(state.createSession).not.toHaveBeenCalled();
    expect(result.url).toContain('/people/99?mock_donation_success=true');
    expect(result.url).toContain('session_id=cs_mock_');
  });
});

describe('platformFeeCents', () => {
  it('computes, rounds, and floors the fee', () => {
    expect(platformFeeCents(5000, 1)).toBe(50);
    expect(platformFeeCents(49, 1)).toBe(0); // rounds down to zero → caller omits the field
    expect(platformFeeCents(51, 1)).toBe(1); // 0.51 rounds up
    expect(platformFeeCents(5000, 0)).toBe(0);
    expect(platformFeeCents(5000, 3.9)).toBe(195);
  });
});
