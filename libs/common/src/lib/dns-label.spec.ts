import { describe, expect, it } from 'vitest';

import { DEFAULT_LINK_SUBDOMAIN, MAX_DNS_LABEL_LENGTH, isValidDnsLabel, normalizeDnsLabel } from './dns-label';

/**
 * These labels become a live DNS host (`<label>.<domain>`) that SendGrid is asked to create and
 * that we later look up. Anything that survives validation but isn't a legal label produces a
 * record the tenant can never satisfy.
 */
describe('dns-label', () => {
  it('accepts ordinary labels, including the default', () => {
    expect(isValidDnsLabel(DEFAULT_LINK_SUBDOMAIN)).toBe(true);
    expect(isValidDnsLabel('links')).toBe(true);
    expect(isValidDnsLabel('go')).toBe(true);
    expect(isValidDnsLabel('e1')).toBe(true);
    expect(isValidDnsLabel('my-links')).toBe(true);
  });

  it('rejects anything that is not a single legal label', () => {
    expect(isValidDnsLabel('')).toBe(false);
    // A dot would silently create a deeper host than the user is being shown.
    expect(isValidDnsLabel('email.links')).toBe(false);
    expect(isValidDnsLabel('-links')).toBe(false);
    expect(isValidDnsLabel('links-')).toBe(false);
    expect(isValidDnsLabel('link_s')).toBe(false);
    expect(isValidDnsLabel('links go')).toBe(false);
    // Uppercase must be normalized first, not accepted: hosts are compared case-sensitively
    // against what SendGrid returns and what the DNS lookup yields.
    expect(isValidDnsLabel('Links')).toBe(false);
  });

  it('enforces the RFC 1035 label ceiling', () => {
    expect(isValidDnsLabel('a'.repeat(MAX_DNS_LABEL_LENGTH))).toBe(true);
    expect(isValidDnsLabel('a'.repeat(MAX_DNS_LABEL_LENGTH + 1))).toBe(false);
  });

  it('normalizes user typing before validation', () => {
    expect(normalizeDnsLabel('  Links  ')).toBe('links');
    expect(isValidDnsLabel(normalizeDnsLabel('  Links  '))).toBe(true);
  });
});
