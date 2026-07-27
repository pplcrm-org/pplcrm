import { createHash } from 'node:crypto';
import { UnauthorizedError } from '../errors/app-errors';
import { consumeRateLimit, peekRateLimit, resetRateLimit } from './durable-rate-limiter';
import { GENERIC_SIGNIN_ERROR } from '../../../../../libs/common/src';

/**
 * Per-account sign-in throttling (finding M1).
 *
 * Sign-in was rate limited per IP only (10 / 15 min). An attacker spreading attempts
 * across a botnet therefore faced no ceiling whatsoever against a single known email —
 * and the counter behind that limit lived in a per-process Map that reset on deploy and
 * multiplied by the replica count.
 *
 * This adds the missing axis: a durable counter keyed on the account.
 *
 * Two deliberate choices:
 *
 *  - The email is HASHED into the key. Rate-limit keys are ordinary table rows and end up
 *    in query logs and backups; there is no reason for them to be a list of addresses that
 *    have attempted to sign in.
 *  - Exceeding the limit raises the SAME generic error as a wrong password. A distinct
 *    "account locked" response would confirm the address exists, reintroducing the
 *    enumeration oracle that signIn's constant-time dummy-hash path exists to close.
 */

/** Failed attempts allowed per account per window. */
const MAX_FAILED_ATTEMPTS = 10;
/** Rolling window. Long enough to make sustained guessing impractical, short enough that
 *  a locked-out real user is not stuck for the day. */
const WINDOW_MS = 15 * 60 * 1000;

function keyFor(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `signIn:acct:${digest}`;
}

/**
 * Throw when this account has already burned its attempts for the window.
 *
 * Does NOT record a hit — only failures count, so a user with the right password is never
 * penalised for someone else hammering their address.
 *
 * @returns how many failures are already on record, so the caller can skip the clear when
 *   there is nothing to clear (the overwhelming majority of sign-ins).
 */
export async function assertSignInAttemptsRemaining(email: string): Promise<number> {
  const used = await peekRateLimit(keyFor(email), WINDOW_MS);
  if (used >= MAX_FAILED_ATTEMPTS) {
    throw new UnauthorizedError(GENERIC_SIGNIN_ERROR);
  }
  return used;
}

/** Record one failed attempt against the account. */
export async function recordFailedSignIn(email: string): Promise<void> {
  await consumeRateLimit(keyFor(email), MAX_FAILED_ATTEMPTS, WINDOW_MS);
}

/**
 * Clear the counter after a successful password verification.
 *
 * `priorFailures` lets the caller skip the write entirely when the counter is already
 * empty — a clean sign-in should not cost a DELETE.
 */
export async function clearSignInAttempts(email: string, priorFailures = 1): Promise<void> {
  if (priorFailures <= 0) return;
  await resetRateLimit(keyFor(email), WINDOW_MS);
}
