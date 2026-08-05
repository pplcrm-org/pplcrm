import { ConfidentialClientApplication } from '@azure/msal-node';
import type { Kysely, Transaction } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { useTestTransaction } from '../../lib/test-utils/db-test-isolation';

// OAUTH_TOKEN_ENC_KEY is unset in the test environment, which makes the real
// encryptSecret() an identity function -- "the token is not stored in plaintext"
// would then be unfalsifiable. This reversible stand-in proves the service sends
// both tokens through the encryption boundary on write and back through
// decryption on read. The real AES-GCM code is covered by
// apps/backend/src/app/lib/secret-crypto.spec.ts.
vi.mock('../../lib/secret-crypto', () => ({
  encryptSecret: (plaintext: string): string => (plaintext ? `enc-test(${plaintext})` : plaintext),
  decryptSecret: (stored: string): string =>
    stored.startsWith('enc-test(') && stored.endsWith(')') ? stored.slice('enc-test('.length, -1) : stored,
}));

import { MsOAuthService, NEEDS_FULL_SYNC } from './ms-oauth.service';

const ENC = (plaintext: string): string => `enc-test(${plaintext})`;

/** Kysely's ControlledTransaction savepoint API, narrowed to what this spec drives. */
interface SavepointCapable {
  savepoint(name: string): { execute(): Promise<SavepointTransaction> };
}
interface SavepointTransaction extends Transaction<Models> {
  releaseSavepoint(name: string): { execute(): Promise<unknown> };
  rollbackToSavepoint(name: string): { execute(): Promise<unknown> };
}

const SAVEPOINT = 'ms_oauth_spec';
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/**
 * MsOAuthService.handleCallback calls `db.transaction()`, which Kysely forbids on a
 * Transaction object -- so the rolled-back spec transaction cannot simply be handed
 * to the service. This wrapper gives the service a db-shaped object whose
 * `transaction()` opens a real savepoint inside the spec transaction, preserving
 * commit/rollback semantics.
 */
function dbOnTransaction(
  trx: Transaction<Models>,
  overrideTrx?: (inner: Transaction<Models>) => Transaction<Models>,
): { db: Kysely<Models>; transactionCount: () => number } {
  let transactions = 0;

  const wrapper = {
    deleteFrom: (table: unknown) => (trx as unknown as Record<string, (t: unknown) => unknown>)['deleteFrom'](table),
    insertInto: (table: unknown) => (trx as unknown as Record<string, (t: unknown) => unknown>)['insertInto'](table),
    selectFrom: (table: unknown) => (trx as unknown as Record<string, (t: unknown) => unknown>)['selectFrom'](table),
    transaction: () => ({
      execute: async <T>(callback: (inner: Transaction<Models>) => Promise<T>): Promise<T> => {
        transactions += 1;
        const sp = await (trx as unknown as SavepointCapable).savepoint(SAVEPOINT).execute();
        try {
          const result = await callback(overrideTrx ? overrideTrx(sp) : sp);
          await sp.releaseSavepoint(SAVEPOINT).execute();
          return result;
        } catch (err) {
          await sp.rollbackToSavepoint(SAVEPOINT).execute();
          throw err;
        }
      },
    }),
    updateTable: (table: unknown) => (trx as unknown as Record<string, (t: unknown) => unknown>)['updateTable'](table),
  };

  return { db: wrapper as unknown as Kysely<Models>, transactionCount: () => transactions };
}

/** Serialized MSAL token cache shape the service reads the refresh token out of. */
function msalCache(refreshTokenSecret: string | null): string {
  if (refreshTokenSecret === null) return JSON.stringify({ RefreshToken: {} });
  return JSON.stringify({ RefreshToken: { 'entry-key': { secret: refreshTokenSecret } } });
}

function stubTokenCache(refreshTokenSecret: string | null): void {
  vi.spyOn(ConfidentialClientApplication.prototype, 'getTokenCache').mockReturnValue({
    serialize: (): string => msalCache(refreshTokenSecret),
  } as unknown as ReturnType<ConfidentialClientApplication['getTokenCache']>);
}

describe('MsOAuthService (integration)', () => {
  const ctx = useTestTransaction();

  let tenantId: string;
  let userId: string;
  let campaignId: string;

  const CONFIG = {
    clientId: '11111111-2222-3333-4444-555555555555',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://api.example.test/auth/ms/callback',
    tenantId: 'common',
  };

  async function seedTenant(): Promise<{ campaignId: string; tenantId: string; userId: string }> {
    const t = rand();
    const u = rand();
    const c = rand();

    await ctx.trx
      .insertInto('tenants')
      .values({ id: t, name: `Tenant ${t}` })
      .execute();
    await ctx.trx
      .insertInto('authusers')
      .values({
        createdby_id: u,
        email: `user-${u}@example.com`,
        first_name: 'Test',
        id: u,
        last_name: 'User',
        password: 'not-a-real-hash',
        tenant_id: t,
        updatedby_id: u,
        verified: true,
      })
      .execute();
    await ctx.trx
      .insertInto('campaigns')
      .values({ admin_id: u, createdby_id: u, id: c, name: `Campaign ${c}`, tenant_id: t, updatedby_id: u })
      .execute();

    return { campaignId: c, tenantId: t, userId: u };
  }

  async function seedTokenRow(args: {
    accessToken: string;
    campaignId: string;
    expiresAt: Date;
    refreshToken: string;
    tenantId: string;
    userId: string;
  }): Promise<void> {
    await ctx.trx
      .insertInto('ms_oauth_tokens')
      .values({
        access_token: ENC(args.accessToken),
        campaign_id: args.campaignId,
        delta_link: NEEDS_FULL_SYNC,
        expires_at: args.expiresAt,
        ms_email: 'existing@example.com',
        refresh_token: ENC(args.refreshToken),
        tenant_id: args.tenantId,
        user_id: args.userId,
      })
      .execute();
  }

  async function readTokenRow(t: string, c: string) {
    return ctx.trx
      .selectFrom('ms_oauth_tokens')
      .selectAll()
      .where('tenant_id', '=', t)
      .where('campaign_id', '=', c)
      .executeTakeFirst();
  }

  async function readSyncJobs(t: string) {
    return ctx.trx.selectFrom('background_jobs').selectAll().where('tenant_id', '=', t).execute();
  }

  beforeEach(async () => {
    const seeded = await seedTenant();
    tenantId = seeded.tenantId;
    userId = seeded.userId;
    campaignId = seeded.campaignId;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleCallback', () => {
    it('stores both tokens encrypted and enqueues the initial sync job in one transaction', async () => {
      const expiresOn = new Date(Date.now() + 3600_000);
      vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode').mockResolvedValue({
        accessToken: 'ms-access-1',
        account: { username: 'mailbox@example.com' },
        expiresOn,
      } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByCode']>>);
      stubTokenCache('ms-refresh-1');

      const { db, transactionCount } = dbOnTransaction(ctx.trx);
      const service = new MsOAuthService(db, CONFIG);

      await service.handleCallback('auth-code', userId, tenantId, campaignId);

      const row = await readTokenRow(tenantId, campaignId);
      expect(row).toBeDefined();
      expect(row?.access_token).not.toBe('ms-access-1');
      expect(row?.refresh_token).not.toBe('ms-refresh-1');
      expect(row?.access_token).toBe(ENC('ms-access-1'));
      expect(row?.refresh_token).toBe(ENC('ms-refresh-1'));
      expect(row?.ms_email).toBe('mailbox@example.com');
      expect(row?.delta_link).toBe(NEEDS_FULL_SYNC);
      expect(row?.synced_at).toBeNull();

      const jobs = await readSyncJobs(tenantId);
      expect(jobs).toHaveLength(1);
      // background_jobs.payload is jsonb, so the driver hands it back already parsed.
      const payload: unknown = typeof jobs[0].payload === 'string' ? JSON.parse(jobs[0].payload) : jobs[0].payload;
      expect(payload).toMatchObject({ campaignId, requestedBy: userId, tenantId, type: 'ms_sync' });
      expect(jobs[0].status).toBe('pending');

      expect(transactionCount()).toBe(1);
    });

    it('keeps the previously stored refresh token when the MSAL cache has none', async () => {
      await seedTokenRow({
        accessToken: 'old-access',
        campaignId,
        expiresAt: new Date(Date.now() + 3600_000),
        refreshToken: 'long-lived-refresh',
        tenantId,
        userId,
      });

      vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode').mockResolvedValue({
        accessToken: 'ms-access-2',
        account: { username: 'mailbox@example.com' },
        expiresOn: new Date(Date.now() + 3600_000),
      } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByCode']>>);
      stubTokenCache(null);

      const { db } = dbOnTransaction(ctx.trx);
      const service = new MsOAuthService(db, CONFIG);

      await service.handleCallback('auth-code', userId, tenantId, campaignId);

      const row = await readTokenRow(tenantId, campaignId);
      expect(row?.refresh_token).toBe(ENC('long-lived-refresh'));
    });

    it('refuses the connection when neither the response nor the stored row has a refresh token', async () => {
      vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode').mockResolvedValue({
        accessToken: 'ms-access-4',
        account: { username: 'mailbox@example.com' },
        expiresOn: new Date(Date.now() + 3600_000),
      } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByCode']>>);
      stubTokenCache(null);

      const { db } = dbOnTransaction(ctx.trx);
      const service = new MsOAuthService(db, CONFIG);

      await expect(service.handleCallback('auth-code', userId, tenantId, campaignId)).rejects.toThrow(
        /Consent required to obtain refresh token/i,
      );
      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
      expect(await readSyncJobs(tenantId)).toHaveLength(0);
    });

    it('writes nothing when Microsoft returns no access token', async () => {
      vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode').mockResolvedValue({
        accessToken: '',
        account: null,
      } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByCode']>>);
      stubTokenCache('ms-refresh-x');

      const { db } = dbOnTransaction(ctx.trx);
      const service = new MsOAuthService(db, CONFIG);

      await expect(service.handleCallback('auth-code', userId, tenantId, campaignId)).rejects.toThrow(
        /Failed to acquire token from Microsoft/i,
      );
      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
      expect(await readSyncJobs(tenantId)).toHaveLength(0);
    });

    it('rolls the token upsert back when the sync-job enqueue fails', async () => {
      vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByCode').mockResolvedValue({
        accessToken: 'ms-access-3',
        account: { username: 'mailbox@example.com' },
        expiresOn: new Date(Date.now() + 3600_000),
      } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByCode']>>);
      stubTokenCache('ms-refresh-3');

      const { db } = dbOnTransaction(ctx.trx, (inner) => {
        const failing = {
          insertInto: (table: string) =>
            table === 'background_jobs'
              ? { values: () => ({ execute: () => Promise.reject(new Error('job insert failed')) }) }
              : (inner as unknown as Record<string, (t: string) => unknown>)['insertInto'](table),
        };
        return failing as unknown as Transaction<Models>;
      });
      const service = new MsOAuthService(db, CONFIG);

      await expect(service.handleCallback('auth-code', userId, tenantId, campaignId)).rejects.toThrow(
        /job insert failed/,
      );
      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
    });
  });

  describe('getValidToken', () => {
    it('returns the decrypted stored token without contacting Microsoft when it is not near expiry', async () => {
      await seedTokenRow({
        accessToken: 'cached-access',
        campaignId,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        refreshToken: 'stored-refresh',
        tenantId,
        userId,
      });
      const refresh = vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByRefreshToken');
      const service = new MsOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);

      expect(await service.getValidToken(tenantId, campaignId)).toBe('cached-access');
      expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes inside the one-minute early-refresh margin and persists the new tokens encrypted', async () => {
      // 30s of life left: still valid to Microsoft, but inside the 60s margin.
      await seedTokenRow({
        accessToken: 'stale-access',
        campaignId,
        expiresAt: new Date(Date.now() + 30_000),
        refreshToken: 'stored-refresh',
        tenantId,
        userId,
      });
      const refresh = vi
        .spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByRefreshToken')
        .mockResolvedValue({
          accessToken: 'fresh-access',
          expiresOn: new Date(Date.now() + 3600_000),
        } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByRefreshToken']>>);
      stubTokenCache('rotated-refresh');

      const service = new MsOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      expect(await service.getValidToken(tenantId, campaignId)).toBe('fresh-access');

      // The refresh request used the decrypted token, not the stored ciphertext.
      expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'stored-refresh' }));

      const row = await readTokenRow(tenantId, campaignId);
      expect(row?.access_token).toBe(ENC('fresh-access'));
      expect(row?.refresh_token).toBe(ENC('rotated-refresh'));
      expect(new Date(row?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now() + 60_000);
    });

    it('keeps the stored refresh token when the refreshed MSAL cache has none', async () => {
      await seedTokenRow({
        accessToken: 'stale-access',
        campaignId,
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'stored-refresh',
        tenantId,
        userId,
      });
      vi.spyOn(ConfidentialClientApplication.prototype, 'acquireTokenByRefreshToken').mockResolvedValue({
        accessToken: 'fresh-access',
        expiresOn: new Date(Date.now() + 3600_000),
      } as unknown as Awaited<ReturnType<ConfidentialClientApplication['acquireTokenByRefreshToken']>>);
      stubTokenCache(null);

      const service = new MsOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      await service.getValidToken(tenantId, campaignId);

      const row = await readTokenRow(tenantId, campaignId);
      expect(row?.refresh_token).toBe(ENC('stored-refresh'));
    });

    it('throws when the campaign has no connected mailbox', async () => {
      const service = new MsOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      await expect(service.getValidToken(tenantId, campaignId)).rejects.toThrow(/No Microsoft account connected/i);
    });
  });

  describe('disconnect', () => {
    it('deletes only the calling tenant and campaign row', async () => {
      const other = await seedTenant();
      const secondCampaignId = rand();
      await ctx.trx
        .insertInto('campaigns')
        .values({
          admin_id: userId,
          createdby_id: userId,
          id: secondCampaignId,
          name: 'Second campaign',
          tenant_id: tenantId,
          updatedby_id: userId,
        })
        .execute();

      const base = { accessToken: 'a', expiresAt: new Date(Date.now() + 3600_000), refreshToken: 'r' };
      await seedTokenRow({ ...base, campaignId, tenantId, userId });
      await seedTokenRow({ ...base, campaignId: secondCampaignId, tenantId, userId });
      await seedTokenRow({ ...base, campaignId: other.campaignId, tenantId: other.tenantId, userId: other.userId });

      const service = new MsOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      await service.disconnect(tenantId, campaignId);

      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
      expect(await readTokenRow(tenantId, secondCampaignId)).toBeDefined();
      expect(await readTokenRow(other.tenantId, other.campaignId)).toBeDefined();
    });
  });
});
