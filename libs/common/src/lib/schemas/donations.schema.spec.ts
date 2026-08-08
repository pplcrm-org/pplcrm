import { describe, it, expect } from 'vitest';
import { countryDisplayName } from './donations.schema';

describe('countryDisplayName', () => {
  it('maps a recognized ISO code to its printed name', () => {
    expect(countryDisplayName('CA')).toBe('Canada');
    expect(countryDisplayName('US')).toBe('United States');
  });

  it('is case-insensitive on the stored code', () => {
    expect(countryDisplayName('ca')).toBe('Canada');
  });

  it('passes through a legacy printed name unchanged', () => {
    expect(countryDisplayName('Canada')).toBe('Canada');
  });

  it('passes through free text unchanged', () => {
    expect(countryDisplayName('Somewhere else')).toBe('Somewhere else');
  });

  it('passes through an unrecognized code unchanged', () => {
    expect(countryDisplayName('ZZ')).toBe('ZZ');
  });

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(countryDisplayName(null)).toBe('');
    expect(countryDisplayName(undefined)).toBe('');
    expect(countryDisplayName('')).toBe('');
  });
});
