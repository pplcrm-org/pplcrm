/**
 * Phone/contact helpers for SMS sending.
 *
 * `normalizeE164` moved to `@common` so the profile form can reject an un-textable number
 * with the same rule the sender applies; it is re-exported here to keep one import site
 * for phone handling in the backend.
 */

export { normalizeE164 } from '@common';

/** Mask a phone number for display: keeps the last 4 digits ("(•••) •••-4821"). */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `(•••) •••-${last4}`;
}

/** Mask an email for display: first letter + domain ("j•••@gmail.com"). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const first = local?.charAt(0) ?? '';
  return `${first}•••@${domain}`;
}
