/**
 * The subdomain label used for click-tracking (link branding) CNAMEs.
 *
 * A default rather than a constant: `email.<domain>` is already taken on plenty of domains — a
 * marketing site, a redirect, an old mail host — and link branding is required for a domain to
 * reach verified status. Hardcoding the label meant a collision locked that tenant out of
 * sending altogether, with nothing they could do about it from the UI.
 */
export const DEFAULT_LINK_SUBDOMAIN = 'email';

/** RFC 1035 label ceiling. The full host is `<label>.<domain>`, so the domain eats the rest. */
export const MAX_DNS_LABEL_LENGTH = 63;

/**
 * A single DNS label — one segment of a hostname, no dots.
 *
 * Deliberately stricter than RFC 1035 in one way (lowercase only) because every host we build
 * from it is compared case-sensitively against what SendGrid returns and what a DNS lookup
 * yields. Normalize with `normalizeDnsLabel` before validating user input.
 */
export function isValidDnsLabel(value: string): boolean {
  if (value.length === 0 || value.length > MAX_DNS_LABEL_LENGTH) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value);
}

/** Trim and lowercase a user-typed label. Does not validate — pair with `isValidDnsLabel`. */
export function normalizeDnsLabel(value: string): string {
  return value.trim().toLowerCase();
}
