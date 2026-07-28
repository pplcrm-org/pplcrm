import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

import { randomBytes } from 'crypto';

import type { IAuthKeyPayload } from '../../../../../../libs/common/src';
import { env } from '../../../env';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors/app-errors';
import { BaseRepository } from '../../lib/base.repo';
import { consumeChallenge, storeChallenge } from '../../lib/webauthn-challenges';
import { createTokens } from './auth-tokens';
import { assertTenantApprovedForSignIn } from './tenant-approval';

export class PasskeyController {
  private get db() {
    return BaseRepository.dbInstance;
  }

  // ── Email Check ──────────────────────────────────────────────────────────
  public async checkEmailPasskeys(email: string): Promise<{ hasPasskeys: boolean }> {
    const user = await this.db
      .selectFrom('authusers')
      .select(['id', 'tenant_id'])
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();

    if (!user) return { hasPasskeys: false };

    const row = await this.db
      .selectFrom('passkeys')
      .select(this.db.fn.countAll<string>().as('count'))
      .where('user_id', '=', user.id)
      .where('tenant_id', '=', user.tenant_id)
      .executeTakeFirst();

    return { hasPasskeys: Number(row?.count ?? 0) > 0 };
  }

  public async deletePasskey(auth: IAuthKeyPayload, id: string) {
    const result = await this.db
      .deleteFrom('passkeys')
      .where('id', '=', id)
      .where('user_id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (Number(result.numDeletedRows) === 0) {
      throw new NotFoundError('Passkey not found.');
    }
    return { success: true };
  }

  // ── Authentication ────────────────────────────────────────────────────────
  public async getAuthenticationOptions() {
    const nonce = randomBytes(16).toString('hex');

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: [], // discoverable credential — browser prompts user to choose
    });

    storeChallenge(`auth:${nonce}`, options.challenge);
    return { options, nonce };
  }

  // ── Registration ─────────────────────────────────────────────────────────
  public async getRegistrationOptions(auth: IAuthKeyPayload) {
    const user = await this.db
      .selectFrom('authusers')
      .select(['id', 'email', 'first_name', 'last_name'])
      .where('id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!user) throw new NotFoundError('User not found');

    const existingPasskeys = await this.db
      .selectFrom('passkeys')
      .select(['credential_id', 'transports'])
      .where('user_id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .execute();

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
      attestationType: 'none',
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credential_id,
        transports: (pk.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    storeChallenge(`reg:${auth.user_id}`, options.challenge);
    return options;
  }

  // ── Management ────────────────────────────────────────────────────────────
  public async listPasskeys(auth: IAuthKeyPayload) {
    return this.db
      .selectFrom('passkeys')
      .select(['id', 'friendly_name', 'device_type', 'backed_up', 'aaguid', 'transports', 'created_at'])
      .where('user_id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .orderBy('created_at', 'asc')
      .execute();
  }

  public async updatePasskeyName(auth: IAuthKeyPayload, id: string, friendlyName: string) {
    const result = await this.db
      .updateTable('passkeys')
      .set({ friendly_name: friendlyName })
      .where('id', '=', id)
      .where('user_id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      throw new NotFoundError('Passkey not found.');
    }
    return { success: true };
  }

  public async verifyAuthentication(
    response: AuthenticationResponseJSON,
    nonce: string,
    ipAddress?: string,
    userAgent?: string,
    rememberMe?: boolean,
  ) {
    const challenge = consumeChallenge(`auth:${nonce}`);
    if (!challenge) throw new UnauthorizedError('Authentication challenge expired. Please try again.');

    // NOTE: unscoped by design — credential_id lookup happens before tenant is known; passkey row carries tenant_id for post-auth scoping
    // eslint-disable-next-line local/no-unscoped-db-query
    const passkey = await this.db
      .selectFrom('passkeys')
      .selectAll()
      .where('credential_id', '=', response.id)
      .executeTakeFirst();

    if (!passkey) throw new UnauthorizedError('Passkey not recognized.');

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getExpectedOrigins(),
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, 'base64url'),
        counter: Number(passkey.counter),
        transports: (passkey.transports as AuthenticatorTransportFuture[] | null) ?? undefined,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) throw new UnauthorizedError('Passkey authentication failed.');

    await this.db
      .updateTable('passkeys')
      .set({ counter: verification.authenticationInfo.newCounter })
      .where('credential_id', '=', passkey.credential_id)
      .where('tenant_id', '=', passkey.tenant_id)
      .execute();

    // Fetch the user
    const user = await this.db
      .selectFrom('authusers')
      .select([
        'id',
        'email',
        'first_name',
        'last_name',
        'tenant_id',
        'role',
        'verified',
        'deletion_scheduled_at',
        'deactivated_at',
      ])
      .where('id', '=', passkey.user_id)
      .executeTakeFirst();

    if (!user) throw new UnauthorizedError();
    if (user.deactivated_at) {
      throw new ForbiddenError('This account has been deactivated. Contact an administrator to restore access.');
    }
    if (!user.verified) throw new UnauthorizedError('Email not verified.');

    const tenantId = String(user.tenant_id);
    const userId = String(user.id);

    // Closed beta: passkeys are a third way to mint a session, so the gate has to be here too
    // or an unapproved workspace could simply register one and walk in.
    await assertTenantApprovedForSignIn(tenantId);

    return createTokens({
      user_id: userId,
      tenant_id: tenantId,
      name: user.first_name,
      ipAddress,
      userAgent,
      rememberMe,
    });
  }

  public async verifyRegistration(auth: IAuthKeyPayload, response: RegistrationResponseJSON, friendlyName?: string) {
    const challenge = consumeChallenge(`reg:${auth.user_id}`);
    if (!challenge) throw new BadRequestError('Registration challenge expired or not found. Please try again.');

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: getExpectedOrigins(),
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestError('Passkey registration verification failed.');
    }

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

    const user = await this.db
      .selectFrom('authusers')
      .select('tenant_id')
      .where('id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('passkeys')
      .values({
        user_id: auth.user_id,
        tenant_id: user.tenant_id,
        credential_id: credential.id,
        public_key: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        transports: (credential.transports as string[] | undefined) ?? null,
        aaguid: aaguid ?? null,
        friendly_name: friendlyName ?? null,
      })
      .execute();

    return { verified: true };
  }
}

function getExpectedOrigins(): string[] {
  const origins: string[] = [env.appUrl];
  if (env.apiUrl !== env.appUrl) {
    try {
      origins.push(new URL(env.apiUrl).origin);
    } catch {}
  }
  return origins;
}

const rpID = env.webAuthnRpId;
const rpName = env.webAuthnRpName;
