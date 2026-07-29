import { describe, expect, it } from 'vitest';

import { normalizeE164 } from './phone';

describe('normalizeE164', () => {
  it('normalizes a bare 10-digit NANP number', () => {
    expect(normalizeE164('(613) 555-0142')).toBe('+16135550142');
    expect(normalizeE164('613.555.0142')).toBe('+16135550142');
    expect(normalizeE164('6135550142')).toBe('+16135550142');
  });

  it('normalizes an 11-digit number with a leading 1', () => {
    expect(normalizeE164('1 613 555 0142')).toBe('+16135550142');
  });

  it('passes through international numbers with a plus', () => {
    expect(normalizeE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizeE164('+16135550142')).toBe('+16135550142');
  });

  it('rejects what it cannot normalize safely', () => {
    expect(normalizeE164(null)).toBeNull();
    expect(normalizeE164(undefined)).toBeNull();
    expect(normalizeE164('')).toBeNull();
    expect(normalizeE164('555-0142')).toBeNull(); // 7 digits — no area code
    expect(normalizeE164('26135550142')).toBeNull(); // 11 digits, not a leading 1
    expect(normalizeE164('+1234')).toBeNull(); // too short for E.164
    expect(normalizeE164('not a number')).toBeNull();
  });
});
