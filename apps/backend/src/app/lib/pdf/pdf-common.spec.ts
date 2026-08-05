import { describe, it, expect } from 'vitest';

import { formatMoney, formatDateLong, torontoDateString, dateColumnString } from './pdf-common';

/**
 * Pure formatting helpers shared by every donation-document PDF (receipt, statement,
 * acknowledgement). Pinning these directly is higher-leverage than re-deriving the same edge
 * cases inside each generator's spec: a wrong cents-to-dollars conversion or a date-boundary
 * off-by-one here silently ships onto a compliance document (a charitable tax receipt).
 */

describe('formatMoney', () => {
  it('formats whole dollars with the thousands separator', () => {
    expect(formatMoney(100000)).toBe('$1,000.00');
  });

  it('keeps exact cents — never rounds', () => {
    expect(formatMoney(100001)).toBe('$1,000.01');
    expect(formatMoney(99)).toBe('$0.99');
  });

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('defaults to CAD when no currency is given', () => {
    expect(formatMoney(500)).toBe('$5.00');
  });

  it('honours an explicit currency code, disambiguating a non-CAD dollar', () => {
    // The helper formats with the en-CA locale, which prints the bare "$" only for the local
    // currency and prefixes every other dollar currency with its country code. A receipt in US
    // dollars therefore reads "US$5.00", not "$5.00".
    expect(formatMoney(500, 'USD')).toBe('US$5.00');
  });
});

describe('formatDateLong', () => {
  it('formats a YYYY-MM-DD string without shifting the day', () => {
    expect(formatDateLong('2026-01-05')).toBe('January 5, 2026');
  });

  it('does not roll a year-start date back to the prior year', () => {
    expect(formatDateLong('2026-01-01')).toBe('January 1, 2026');
  });

  it('does not roll a year-end date forward to the next year', () => {
    expect(formatDateLong('2026-12-31')).toBe('December 31, 2026');
  });

  it('formats a Date instance in Toronto local time', () => {
    expect(formatDateLong(new Date('2026-06-15T12:00:00Z'))).toBe('June 15, 2026');
  });
});

describe('torontoDateString', () => {
  it('converts a UTC instant late in the UTC day to the earlier Toronto calendar date', () => {
    // 2026-01-01T03:00:00Z is 2025-12-31 22:00 in Toronto (EST, UTC-5) — the exact New-Year-drift
    // case this helper exists to avoid (see its doc comment in pdf-common.ts).
    expect(torontoDateString(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31');
  });

  it('keeps a mid-day UTC instant on the same Toronto calendar date', () => {
    expect(torontoDateString(new Date('2026-07-04T15:00:00Z'))).toBe('2026-07-04');
  });
});

describe('dateColumnString', () => {
  it('reads year/month/day off the Date in local time, zero-padded', () => {
    expect(dateColumnString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('zero-pads single-digit month and day', () => {
    expect(dateColumnString(new Date(2026, 8, 9))).toBe('2026-09-09');
  });
});
