import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY,
  formatMoney,
  isWorkspaceCurrency,
  toStripeCurrency,
  toWorkspaceCurrency,
  workspaceCurrencyForCountry,
} from './money';

describe('toWorkspaceCurrency', () => {
  it('accepts a supported code in any casing', () => {
    expect(toWorkspaceCurrency('USD')).toBe('USD');
    expect(toWorkspaceCurrency('gbp')).toBe('GBP');
    expect(toWorkspaceCurrency('  eur  ')).toBe('EUR');
  });

  it('falls back to the default for anything unusable', () => {
    // The setting is free-form jsonb, so a bad value must not break a charge.
    expect(toWorkspaceCurrency('JPY')).toBe(DEFAULT_CURRENCY);
    expect(toWorkspaceCurrency('')).toBe(DEFAULT_CURRENCY);
    expect(toWorkspaceCurrency(null)).toBe(DEFAULT_CURRENCY);
    expect(toWorkspaceCurrency(42)).toBe(DEFAULT_CURRENCY);
    expect(toWorkspaceCurrency(undefined)).toBe(DEFAULT_CURRENCY);
  });
});

describe('formatMoney', () => {
  it('renders cents as a major-unit amount in the given currency', () => {
    expect(formatMoney(150000, 'CAD')).toBe('CA$1,500.00');
    expect(formatMoney(2000, 'USD')).toBe('$20.00');
    expect(formatMoney(0, 'CAD')).toBe('CA$0.00');
  });

  it('distinguishes currencies rather than assuming dollars', () => {
    // The bug this setting fixes: the app charged CAD and displayed USD.
    expect(formatMoney(150000, 'CAD')).not.toBe(formatMoney(150000, 'USD'));
  });

  it('defaults to the workspace default currency', () => {
    expect(formatMoney(2000)).toBe(formatMoney(2000, DEFAULT_CURRENCY));
  });

  it('treats a non-finite amount as zero rather than rendering NaN', () => {
    expect(formatMoney(Number.NaN, 'CAD')).toBe('CA$0.00');
  });
});

describe('toStripeCurrency', () => {
  it('lowercases for the Stripe API', () => {
    expect(toStripeCurrency('CAD')).toBe('cad');
    expect(toStripeCurrency('EUR')).toBe('eur');
  });
});

describe('workspaceCurrencyForCountry', () => {
  it('maps a Connect account country to its settlement currency', () => {
    expect(workspaceCurrencyForCountry('CA')).toBe('CAD');
    expect(workspaceCurrencyForCountry('us')).toBe('USD');
    expect(workspaceCurrencyForCountry('DE')).toBe('EUR');
  });

  it('falls back to the default for an unmapped or missing country', () => {
    expect(workspaceCurrencyForCountry('BR')).toBe(DEFAULT_CURRENCY);
    expect(workspaceCurrencyForCountry(null)).toBe(DEFAULT_CURRENCY);
  });
});

describe('isWorkspaceCurrency', () => {
  it('is exact — no casing or whitespace tolerance', () => {
    expect(isWorkspaceCurrency('CAD')).toBe(true);
    expect(isWorkspaceCurrency('cad')).toBe(false);
    expect(isWorkspaceCurrency('JPY')).toBe(false);
    expect(isWorkspaceCurrency(null)).toBe(false);
  });
});
