/**
 * The workspace's transaction currency — what donors are charged and what staff see.
 *
 * Distinct from `./billing/currency.ts`, which converts pplCRM's own USD subscription prices
 * for display on the marketing site. This one is the tenant's money: donations, pledges, and
 * event pricing. Before it existed, Stripe was charged in hardcoded `cad` while every grid
 * formatted the same numbers as `USD`.
 */

/** Currencies a workspace can transact in. Each is supported by Stripe Connect. */
export const WORKSPACE_CURRENCIES = ['CAD', 'USD', 'GBP', 'EUR', 'AUD', 'NZD'] as const;
export type WorkspaceCurrency = (typeof WORKSPACE_CURRENCIES)[number];

/** Matches the currency donations were hardcoded to before this setting existed. */
export const DEFAULT_CURRENCY: WorkspaceCurrency = 'CAD';

export const WORKSPACE_CURRENCY_LABELS: Readonly<Record<WorkspaceCurrency, string>> = {
  CAD: 'Canadian dollar (CAD)',
  USD: 'US dollar (USD)',
  GBP: 'British pound (GBP)',
  EUR: 'Euro (EUR)',
  AUD: 'Australian dollar (AUD)',
  NZD: 'New Zealand dollar (NZD)',
};

/** Stripe Connect account country → the currency that account settles in. */
const CURRENCY_BY_COUNTRY: Readonly<Record<string, WorkspaceCurrency>> = {
  CA: 'CAD',
  US: 'USD',
  GB: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  FR: 'EUR',
  DE: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
};

export function isWorkspaceCurrency(value: unknown): value is WorkspaceCurrency {
  return typeof value === 'string' && (WORKSPACE_CURRENCIES as readonly string[]).includes(value);
}

/** Normalise a stored setting into a usable currency, falling back to the default. */
export function toWorkspaceCurrency(value: unknown): WorkspaceCurrency {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return isWorkspaceCurrency(upper) ? upper : DEFAULT_CURRENCY;
}

/** The currency a Stripe Connect account in `country` settles in — used to seed the setting. */
export function workspaceCurrencyForCountry(country: string | null | undefined): WorkspaceCurrency {
  const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
  return CURRENCY_BY_COUNTRY[code] ?? DEFAULT_CURRENCY;
}

/** Stripe wants a lowercase ISO-4217 code on charge creation. */
export function toStripeCurrency(currency: WorkspaceCurrency): string {
  return currency.toLowerCase();
}

/**
 * Format a minor-unit amount (cents) for display.
 *
 * Locale is left to the runtime so a viewer sees their own grouping and symbol placement; the
 * currency itself is always the workspace's, never the viewer's.
 */
export function formatMoney(cents: number, currency: WorkspaceCurrency = DEFAULT_CURRENCY): string {
  const amount = Number.isFinite(cents) ? cents / 100 : 0;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
