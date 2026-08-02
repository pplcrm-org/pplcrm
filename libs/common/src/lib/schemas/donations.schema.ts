import { z } from 'zod';
import { idSchema } from './core.schema';

/**
 * Offline gift entry (spec §12, Fig. 15 "Record donation" dialog). Distinct from the Stripe
 * checkout path (`createCheckout`/`confirmDonation`) — this is for gifts collected outside the
 * public donation form (cash at a fundraiser, a mailed check, a bank transfer).
 */
export const DONATION_METHODS = ['card', 'check', 'cash', 'bank_transfer'] as const;
export const DONATION_METHOD_LABELS: Record<(typeof DONATION_METHODS)[number], string> = {
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};

export const donationMethodSchema = z.enum(DONATION_METHODS);
export type DonationMethod = z.infer<typeof donationMethodSchema>;

/**
 * Donor mailing address, captured with every gift (operator rule: no donation without an
 * address — official receipts must print the donor's address). Snapshotted onto the donation
 * row; distinct from `addressSchema` (household geocoding shape) because every field here is
 * required except the unit.
 */
export const donationAddressSchema = z.object({
  street: z.string().trim().min(1, 'Street address is required').max(150, 'Street is too long'),
  apt: z.string().trim().max(30, 'Unit is too long').nullable().optional(),
  city: z.string().trim().min(1, 'City is required').max(100, 'City is too long'),
  state: z.string().trim().min(1, 'Province or state is required').max(100, 'Province is too long'),
  zip: z.string().trim().min(1, 'Postal code is required').max(20, 'Postal code is too long'),
  country: z.string().trim().min(1, 'Country is required').max(100, 'Country is too long'),
});
export type DonationAddressType = z.infer<typeof donationAddressSchema>;

export const RecordDonationObj = z.object({
  personId: idSchema,
  amountCents: z.number().int().positive('Enter an amount above zero, like 50'),
  method: donationMethodSchema,
  /** Campaigns §15 — which fund this gift belongs to; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  /** Required — receipts need a mailing address, so gifts are not recorded without one. */
  address: donationAddressSchema,
});
export type RecordDonationType = z.infer<typeof RecordDonationObj>;

/**
 * Countries a campaign can pick when connecting Stripe for donations (Stripe Connect hosted
 * onboarding). A curated subset of Stripe-supported countries — extend freely; onboarding handles
 * country-specific requirements. Shared so the settings UI select and the backend z.enum agree.
 */
export const STRIPE_CONNECT_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
] as const;

export const STRIPE_CONNECT_COUNTRY_CODES = STRIPE_CONNECT_COUNTRIES.map((c) => c.code) as [
  (typeof STRIPE_CONNECT_COUNTRIES)[number]['code'],
  ...(typeof STRIPE_CONNECT_COUNTRIES)[number]['code'][],
];
export const stripeConnectCountrySchema = z.enum(STRIPE_CONNECT_COUNTRY_CODES);
export type StripeConnectCountry = z.infer<typeof stripeConnectCountrySchema>;
