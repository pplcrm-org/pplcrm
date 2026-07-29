import { describe, expect, it } from 'vitest';

import { maskEmail, maskPhone, normalizeE164 } from './phone';

// The rule itself is exercised in libs/common (phone.spec.ts) where it now lives — shared with
// the profile form. This only guards the re-export every backend SMS caller imports through.
describe('normalizeE164 re-export', () => {
  it('still normalizes through this module', () => {
    expect(normalizeE164('(613) 555-0142')).toBe('+16135550142');
    expect(normalizeE164('not a number')).toBeNull();
  });
});

describe('maskPhone', () => {
  it('keeps only the last four digits', () => {
    expect(maskPhone('+16135550142')).toBe('(•••) •••-0142');
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and domain', () => {
    expect(maskEmail('jordan@gmail.com')).toBe('j•••@gmail.com');
  });

  it('degrades safely on malformed input', () => {
    expect(maskEmail('nonsense')).toBe('•••');
  });
});
