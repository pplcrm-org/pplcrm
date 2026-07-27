import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../env';

/**
 * Hashing for the 6-digit companion verification code (finding M5).
 *
 * The code was stored as a bare SHA-256. Over a 10^6 space that is not a hash at all in
 * any meaningful sense — a rainbow table of every possible code is a megabyte and takes
 * seconds to build, so anyone with a database read (a backup, a replica, a support query)
 * could reverse every outstanding code instantly and walk the volunteer verification flow.
 *
 * Two changes make that impractical:
 *
 *  - Keyed with the application secret, so precomputation needs the secret, not just the
 *    ciphertext. A stolen database alone is no longer enough.
 *  - Bound to the volunteer id, so one table cannot be reused across accounts and a code
 *    captured for one volunteer cannot be replayed against another.
 *
 * The online guessing ceiling was already adequate (3 codes x 5 attempts per 15 min), so
 * this is specifically about at-rest exposure.
 */
export function hashVerificationCode(volunteerId: string, code: string): string {
  return createHmac('sha256', env.sharedSecret).update(`companion-code:${volunteerId}:${code}`).digest('hex');
}

/** Constant-time comparison of a submitted code against the stored hash. */
export function verificationCodeMatches(volunteerId: string, code: string, storedHash: string): boolean {
  const expected = Buffer.from(hashVerificationCode(volunteerId, code), 'utf8');
  const actual = Buffer.from(storedHash, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
