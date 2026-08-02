import { DEFAULT_CURRENCY, toStripeCurrency } from '@common';
import { env } from '../../../../env';
import { getStripe, isMockMode } from '../../../lib/stripe-platform-client';

export interface OneTimeCheckoutParams {
  tenantId: string;
  userId: string;
  personId: string;
  amountCents: number;
  address: { country?: string; state?: string };
  customUrls?: { successUrl?: string; cancelUrl?: string };
}

/**
 * Stripe one-time checkout — Connect direct charges. The session is created with the
 * PLATFORM key against the tenant's connected account (`{ stripeAccount }`), so the campaign is
 * merchant of record and pays Stripe's processing fees itself; the platform takes
 * `payment_intent_data.application_fee_amount` (DONATIONS_PLATFORM_FEE_PERCENT of the gift).
 * Mock mode keys off the platform client (same `MockKey` convention as billing).
 */
export class StripeDonationProcessor {
  constructor(
    private readonly config: {
      accountId: string | undefined;
      feePercent: number;
      /** Workspace transaction currency (`organization.currency`), lowercased for Stripe. */
      currency?: string;
    },
  ) {}

  /**
   * Never let an absent config value reach Stripe as `currency: undefined` — that is a rejected
   * charge (or worse, a silently mis-denominated one). Falls back to what donations were
   * hardcoded to before `organization.currency` existed.
   */
  private get currency(): string {
    return this.config.currency || toStripeCurrency(DEFAULT_CURRENCY);
  }

  public async createOneTimeCheckout(params: OneTimeCheckoutParams): Promise<{ url: string | null }> {
    const { tenantId, userId, personId, amountCents, address, customUrls } = params;

    if (isMockMode) {
      const mockSessionId = 'cs_mock_' + Math.random().toString(36).substring(7);
      let redirectBase = customUrls?.successUrl
        ? customUrls.successUrl.replace('{CHECKOUT_SESSION_ID}', mockSessionId)
        : `${env.appUrl}/people/${personId}?mock_donation_success=true&amount=${amountCents / 100}&session_id=${mockSessionId}&province=${address.state || ''}&country=${address.country || ''}`;

      if (customUrls?.successUrl) {
        const separator = redirectBase.includes('?') ? '&' : '?';
        redirectBase += `${separator}is_mock=true&person_id=${personId}&amount_cents=${amountCents}&province=${encodeURIComponent(address.state || '')}&country=${encodeURIComponent(address.country || '')}&tenant_id=${tenantId}&user_id=${userId}`;
      }

      return { url: redirectBase };
    }

    const applicationFeeCents = platformFeeCents(amountCents, this.config.feePercent);

    const session = await getStripe().checkout.sessions.create(
      {
        payment_method_types: ['card'],
        // No donation without a mailing address — official receipts must print one, so Stripe
        // collects the billing address and the confirm path snapshots it onto the donation row.
        billing_address_collection: 'required',
        line_items: [
          {
            price_data: {
              currency: this.currency,
              product_data: { name: 'Campaign Donation' },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        ...(applicationFeeCents > 0 ? { payment_intent_data: { application_fee_amount: applicationFeeCents } } : {}),
        success_url:
          customUrls?.successUrl ||
          `${env.appUrl}/people/${personId}?checkout_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: customUrls?.cancelUrl || `${env.appUrl}/people/${personId}?checkout_cancel=true`,
        metadata: {
          tenantId,
          personId,
          amount: String(amountCents),
          residencyProvince: address.state || '',
          residencyCountry: address.country || '',
          createdBy: userId,
        },
      },
      { stripeAccount: this.config.accountId },
    );

    return { url: session.url };
  }
}

/** Platform application fee in cents; 0 means "omit the field" (Stripe rejects a 0 fee). */
export function platformFeeCents(amountCents: number, feePercent: number): number {
  return Math.max(0, Math.round((amountCents * feePercent) / 100));
}
