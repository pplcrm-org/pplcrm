/**
 * Phone normalization for SMS sending. Contact numbers (`persons.mobile`,
 * `profiles.mobile`) are free-text; Twilio needs E.164. This is deliberately
 * conservative: it only accepts numbers it can normalize unambiguously and
 * returns null for everything else — a null simply means "SMS isn't offered for
 * this contact", never an error.
 *
 * Shared rather than backend-only so a form can tell someone their number is
 * un-textable *before* they save it: the backend re-checks the same way, and a
 * second implementation would eventually disagree with this one.
 */

const NANP_LENGTH = 10;
const NANP_WITH_COUNTRY_LENGTH = 11;

/** Normalize a free-text phone number to E.164, or null if it can't be done safely. */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (hasPlus) {
    // Already international — just validate the digit count (E.164 max 15).
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (digits.length === NANP_LENGTH) return `+1${digits}`;
  if (digits.length === NANP_WITH_COUNTRY_LENGTH && digits.startsWith('1')) return `+${digits}`;
  return null;
}
