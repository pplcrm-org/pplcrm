import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationResponseJSON } from '@simplewebauthn/types';

import { AuthController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { ForbiddenError } from '../../errors/app-errors';
import { PasskeyController } from './passkey.controller';
import { TENANT_PENDING_APPROVAL_REASON } from '../../../../../../libs/common/src';
import { hashPassword } from '../../lib/password-hash';
import { hashToken } from '../../lib/token-hash';
import { storeChallenge } from '../../lib/webauthn-challenges';

/**
 * The closed-beta gate on the two sign-in paths that are not plain password sign-in:
 * the second half of an email-OTP sign-in (`AuthController.verify2FA`) and passkey sign-in
 * (`PasskeyController.verifyAuthentication`).
 *
 * `tenant-approval.spec.ts` already pins the password path. These two also mint sessions, so
 * an unapproved workspace that reaches either one must be refused with no session row written.
 *
 * Rows are inserted directly instead of running `signUp`, for the same reason the sibling spec
 * does it: a real signup seeds a whole demo workspace and none of that is what is being tested.
 * The code under test reads through the module-level database handle, not a transaction, so
 * `useTestTransaction` cannot be used here — cleanup is explicit in `afterEach`.
 *
 * The WebAuthn signature check is replaced with a stub that always succeeds, so a failure in
 * these tests is the approval gate and never the cryptography.
 */

vi.mock('@simplewebauthn/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@simplewebauthn/server');
  return {
    ...actual,
    verifyAuthenticationResponse: vi.fn().mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    }),
  };
});

const OTP = '123456';
const PASSWORD = 'Correct-Horse-Battery-42!';
const CHALLENGE = 'test-challenge-value';

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('closed-beta gate on the 2FA and passkey sign-in paths', () => {
  const auth = new AuthController();
  const passkeys = new PasskeyController();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;

  let tenantId: string;
  let userId: string;
  let email: string;
  let credentialId: string;
  let nonce: string;

  /** A verified owner, with a live OTP challenge and a passkey, on a tenant in the given state. */
  async function seed(status: 'pending' | 'approved' | 'declined'): Promise<void> {
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: `Beta Gate Org ${tenantId}`,
        approval_status: status,
        approval_requested_at: new Date(),
        approval_token_hash: null,
        approved_at: status === 'approved' ? new Date() : null,
        declined_at: status === 'declined' ? new Date() : null,
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
        two_factor_enabled: true,
        // The OTP is stored hashed; verify2FA hashes the submitted code and compares.
        two_factor_code: hashToken(OTP),
        two_factor_expires_at: new Date(Date.now() + 5 * 60 * 1000),
        two_factor_attempts: 0,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .updateTable('tenants')
      .set({ admin_id: userId, createdby_id: userId })
      .where('id', '=', tenantId)
      .execute();

    await db
      .insertInto('passkeys')
      .values({
        user_id: userId,
        tenant_id: tenantId,
        credential_id: credentialId,
        public_key: Buffer.from('not-a-real-key').toString('base64url'),
        counter: 0,
        device_type: 'singleDevice',
        backed_up: false,
        transports: null,
        aaguid: null,
        friendly_name: 'Test Key',
      })
      .execute();
  }

  /** How many session rows exist for the seeded workspace. Zero means no session was issued. */
  async function sessionCount(): Promise<number> {
    const rows = await db.selectFrom('sessions').select('id').where('tenant_id', '=', tenantId).execute();
    return rows.length;
  }

  /** A passkey assertion shaped enough for the controller; the signature check is stubbed out. */
  function assertion(): AuthenticationResponseJSON {
    return {
      id: credentialId,
      rawId: credentialId,
      response: {
        authenticatorData: 'x',
        clientDataJSON: 'x',
        signature: 'x',
      },
      clientExtensionResults: {},
      type: 'public-key',
    } as AuthenticationResponseJSON;
  }

  beforeEach(() => {
    tenantId = rand();
    userId = rand();
    email = `beta-gate-${tenantId}@example.com`;
    credentialId = `cred-${tenantId}`;
    nonce = `nonce-${tenantId}`;
    // The challenge is a short-lived in-memory entry the options endpoint would have written.
    storeChallenge(`auth:${nonce}`, CHALLENGE);
  });

  afterEach(async () => {
    await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('passkeys').where('tenant_id', '=', tenantId).execute();
    await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  describe('verify2FA (second half of an email-OTP sign-in)', () => {
    it('refuses a pending workspace and writes no session row', async () => {
      await seed('pending');

      await expect(auth.verify2FA(email, OTP, '127.0.0.1', 'Vitest')).rejects.toMatchObject({
        status: 403,
        data: { reason: TENANT_PENDING_APPROVAL_REASON },
      });
      expect(await sessionCount()).toBe(0);
    });

    // A decline is an ops decision, not a different user experience: same refusal, same reason.
    it('refuses a declined workspace and writes no session row', async () => {
      await seed('declined');

      await expect(auth.verify2FA(email, OTP, '127.0.0.1', 'Vitest')).rejects.toThrow(ForbiddenError);
      expect(await sessionCount()).toBe(0);
    });

    // Positive control: without this, the two refusals above could pass for any reason at all.
    it('issues a session once the workspace is approved', async () => {
      await seed('approved');

      const tokens = await auth.verify2FA(email, OTP, '127.0.0.1', 'Vitest');

      expect(tokens.auth_token).toBeTypeOf('string');
      expect(tokens.refresh_token).toBeTypeOf('string');
      expect(await sessionCount()).toBe(1);
    });
  });

  describe('passkey verifyAuthentication', () => {
    it('refuses a pending workspace and writes no session row', async () => {
      await seed('pending');

      await expect(passkeys.verifyAuthentication(assertion(), nonce, '127.0.0.1', 'Vitest')).rejects.toMatchObject({
        status: 403,
        data: { reason: TENANT_PENDING_APPROVAL_REASON },
      });
      expect(await sessionCount()).toBe(0);
    });

    it('refuses a declined workspace and writes no session row', async () => {
      await seed('declined');

      await expect(passkeys.verifyAuthentication(assertion(), nonce, '127.0.0.1', 'Vitest')).rejects.toThrow(
        ForbiddenError,
      );
      expect(await sessionCount()).toBe(0);
    });

    // Positive control. It also proves the stubbed signature check is really in effect: without
    // the stub this call would fail on the fake public key long before reaching the gate.
    it('issues a session once the workspace is approved', async () => {
      await seed('approved');

      const tokens = await passkeys.verifyAuthentication(assertion(), nonce, '127.0.0.1', 'Vitest');

      expect(tokens.auth_token).toBeTypeOf('string');
      expect(tokens.refresh_token).toBeTypeOf('string');
      expect(await sessionCount()).toBe(1);
    });
  });
});
