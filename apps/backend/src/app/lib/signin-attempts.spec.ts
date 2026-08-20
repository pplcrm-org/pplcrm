import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GENERIC_SIGNIN_ERROR } from '../../../../../libs/common/src';
import { UnauthorizedError } from '../errors/app-errors';
import { AuthController } from '../modules/auth/controller';
import { BaseRepository } from './base.repo';
import { hashPassword } from './password-hash';
import { assertSignInAttemptsRemaining, clearSignInAttempts, recordFailedSignIn } from './signin-attempts';

/**
 * Per-account sign-in throttling (security finding M1): 10 failed attempts per account per
 * 15-minute window, counted durably in the `rate_limits` table.
 *
 * The property that must never regress silently: exceeding the limit raises the SAME
 * UNAUTHORIZED error a wrong password raises. A distinct "account locked" response would
 * confirm the address exists — the enumeration oracle signIn's constant-time dummy-hash
 * path exists to close. (At the wire, trpc.ts's errorFormatter additionally collapses every
 * sign-in credential failure to GENERIC_SIGNIN_ERROR; these tests pin the layer beneath it.)
 *
 * No `useTestTransaction` here: the limiter writes through `BaseRepository.dbInstance` on
 * purpose (its counters must be durable), so each test uses a unique random email and
 * `afterEach` deletes exactly the keys it created.
 */

vi.mock('./hibp', () => ({
  getPwnedCount: vi.fn().mockResolvedValue(0),
}));

const MAX_FAILED_ATTEMPTS = 10;
const PASSWORD = 'Correct-Horse-Battery-42!';

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/** Mirror of the (deliberately unexported) key derivation in signin-attempts.ts. */
function keyFor(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `signIn:acct:${digest}`;
}

async function recordFailures(email: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await recordFailedSignIn(email);
  }
}

describe('sign-in attempt throttling (finding M1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;

  let usedEmails: string[] = [];

  /** Every email a test throttles must come from here so afterEach can delete its bucket. */
  function trackedEmail(): string {
    const email = `throttle-${rand()}@example.com`;
    usedEmails.push(email);
    return email;
  }

  beforeEach(() => {
    usedEmails = [];
  });

  afterEach(async () => {
    if (usedEmails.length > 0) {
      await db
        .deleteFrom('rate_limits')
        .where(
          'key',
          'in',
          usedEmails.map((e) => keyFor(e)),
        )
        .execute();
    }
  });

  describe('the counter itself', () => {
    it('reports zero failures for a fresh account and does not block it', async () => {
      const email = trackedEmail();
      await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(0);
    });

    it('checking remaining attempts never consumes one', async () => {
      // Only FAILURES count — a user whose address is merely being hammered with checks
      // (or who signs in correctly over and over) must never accumulate strikes.
      const email = trackedEmail();
      for (let i = 0; i < MAX_FAILED_ATTEMPTS + 5; i++) {
        await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(0);
      }
    });

    it('still admits the attempt after nine failures (boundary)', async () => {
      const email = trackedEmail();
      await recordFailures(email, MAX_FAILED_ATTEMPTS - 1);
      await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(MAX_FAILED_ATTEMPTS - 1);
    });

    it('blocks the account after the tenth failure with the same generic error as a wrong password', async () => {
      const email = trackedEmail();
      await recordFailures(email, MAX_FAILED_ATTEMPTS);

      const err: unknown = await assertSignInAttemptsRemaining(email).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      // Same status, same code, and the shared generic message — never a distinct
      // "account locked" response that would confirm the address exists.
      expect((err as UnauthorizedError).status).toBe(401);
      expect((err as UnauthorizedError).code).toBe('UNAUTHORIZED');
      expect((err as UnauthorizedError).message).toBe(GENERIC_SIGNIN_ERROR);
    });

    it('clearing after a successful verification resets the window', async () => {
      const email = trackedEmail();
      await recordFailures(email, 3);
      await clearSignInAttempts(email, 3);
      await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(0);
    });

    it('clearing with zero prior failures skips the write and leaves the bucket alone', async () => {
      const email = trackedEmail();
      await recordFailures(email, 3);
      await clearSignInAttempts(email, 0);
      await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(3);
    });

    it('keys the counter on the normalized address, not the spelling of the attempt', async () => {
      const email = trackedEmail();
      const variants = [email.toUpperCase(), `  ${email}`, `${email}  `, email];
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await recordFailedSignIn(variants[i % variants.length]);
      }
      await expect(assertSignInAttemptsRemaining(email)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('wired into signIn', () => {
    const controller = new AuthController();

    let tenantId: string;
    let userId: string;

    beforeEach(() => {
      tenantId = rand();
      userId = rand();
    });

    afterEach(async () => {
      await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
      await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
      await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
      await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    });

    /** A verified owner on an approved tenant, inserted directly — a real signUp seeds a whole
     *  demo workspace and none of that is what these assertions are about. */
    async function seedUser(email: string): Promise<void> {
      await db
        .insertInto('tenants')
        .values({
          id: tenantId,
          name: `Throttle Test Org ${tenantId}`,
          approval_status: 'approved',
          approval_requested_at: new Date(),
          approved_at: new Date(),
        })
        .execute();

      await db
        .insertInto('authusers')
        .values({
          id: userId,
          tenant_id: tenantId,
          email,
          password: await hashPassword(PASSWORD),
          first_name: 'Casey',
          last_name: 'Owner',
          role: 'owner',
          verified: true,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      await db
        .updateTable('tenants')
        .set({ admin_id: userId, createdby_id: userId })
        .where('id', '=', tenantId)
        .execute();
    }

    it('records a strike when a sign-in fails', async () => {
      const email = trackedEmail(); // no such account — signIn fails after the dummy-hash verify
      await expect(controller.signIn({ email, password: 'wrong-password-1!' })).rejects.toThrow(UnauthorizedError);
      await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(1);
    });

    it('locks before looking the account up, and the lockout itself adds no strike', async () => {
      // The email does not exist; the throw must come from the counter, ahead of the
      // user lookup and password verification.
      const email = trackedEmail();
      await recordFailures(email, MAX_FAILED_ATTEMPTS);

      await expect(controller.signIn({ email, password: 'anything-at-all-1!' })).rejects.toThrow(UnauthorizedError);

      // Still exactly 10: a blocked attempt never reached recordFailedSignIn. (This pins the
      // ordering — were the check after the failure path, the count would now be 11.)
      const row = await db
        .selectFrom('rate_limits')
        .select('count')
        .where('key', '=', keyFor(email))
        .executeTakeFirst();
      expect(Number(row?.count)).toBe(MAX_FAILED_ATTEMPTS);
    });

    it('refuses even the correct password while the account is locked', async () => {
      const email = trackedEmail();
      await seedUser(email);
      await recordFailures(email, MAX_FAILED_ATTEMPTS);

      const err: unknown = await controller.signIn({ email, password: PASSWORD }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect((err as UnauthorizedError).message).toBe(GENERIC_SIGNIN_ERROR);
    });

    it('a successful sign-in clears the strikes', async () => {
      const email = trackedEmail();
      await seedUser(email);
      await recordFailures(email, 3);

      const tokens = await controller.signIn({ email, password: PASSWORD });
      expect(tokens).toHaveProperty('auth_token');

      await expect(assertSignInAttemptsRemaining(email)).resolves.toBe(0);
    });

    it('a window of failures ends in lockout through the real failure path', async () => {
      const email = trackedEmail();
      await seedUser(email);

      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await expect(controller.signIn({ email, password: `wrong-${i}-password!` })).rejects.toThrow(UnauthorizedError);
      }

      // Attempt 11 with the CORRECT password: locked.
      await expect(controller.signIn({ email, password: PASSWORD })).rejects.toThrow(UnauthorizedError);
    });
  });

  // Deliberately out of scope: window expiry (fixed-window bucketing is durable-rate-limiter's
  // own contract, and faking Date.now() around a real Postgres write path buys little for what
  // it costs in realism).
});
