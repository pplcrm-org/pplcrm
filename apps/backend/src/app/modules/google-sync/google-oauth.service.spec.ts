import type { Kysely, Transaction } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { useTestTransaction } from '../../lib/test-utils/db-test-isolation';

// The real OAUTH_TOKEN_ENC_KEY is unset in the test environment, which makes the
// production encryptSecret() an identity function -- so "the token is not stored
// in plaintext" would be unfalsifiable here. This replaces it with a reversible
// marker so the spec can prove the service routes both tokens through the
// encryption boundary on write and back through decryption on read. The real
// AES-GCM implementation is covered by apps/backend/src/app/lib/secret-crypto.spec.ts.
vi.mock('../../lib/secret-crypto', () => ({
  encryptSecret: (plaintext: string): string => (plaintext ? `enc-test(${plaintext})` : plaintext),
  decryptSecret: (stored: string): string =>
    stored.startsWith('enc-test(') && stored.endsWith(')') ? stored.slice('enc-test('.length, -1) : stored,
}));

import { GoogleOAuthService, NEEDS_FULL_SYNC } from './google-oauth.service';

const ENC = (plaintext: string): string => `enc-test(${plaintext})`;

/** Kysely's ControlledTransaction savepoint API, narrowed to what this spec drives. */
interface SavepointCapable {
  savepoint(name: string): { execute(): Promise<SavepointTransaction> };
}
interface SavepointTransaction extends Transaction<Models> {
  releaseSavepoint(name: string): { execute(): Promise<unknown> };
  rollbackToSavepoint(name: string): { execute(): Promise<unknown> };
}

const SAVEPOINT = 'google_oauth_spec';
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/**
 * GoogleOAuthService.handleCallback calls `db.transaction()`, which Kysely forbids
 * on a Transaction object -- so the rolled-back spec transaction cannot simply be
 * handed to the service. This wrapper hands the service a db-shaped object whose
 * `transaction()` opens a real savepoint on the spec transaction, giving genuine
 * commit/rollback semantics inside the throwaway transaction.
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

interface FetchCall {
  body: string;
  url: string;
}

/** Stand in for Google's token and userinfo endpoints. */
function stubGoogleFetch(options: {
  profileEmail?: string | null;
  tokenError?: string;
  tokenResponse?: Record<string, unknown>;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: unknown }) => {
      calls.push({ body: String(init?.body ?? ''), url: String(url) });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        if (options.tokenError) {
          return { ok: false, status: 400, text: async (): Promise<string> => options.tokenError ?? '' };
        }
        return { json: async (): Promise<unknown> => options.tokenResponse ?? {}, ok: true, status: 200 };
      }
      return {
        json: async (): Promise<unknown> => ({ email: options.profileEmail ?? null }),
        ok: options.profileEmail !== undefined,
        status: 200,
      };
    }),
  );
  return calls;
}

describe('GoogleOAuthService (integration)', () => {
  const ctx = useTestTransaction();

  let tenantId: string;
  let userId: string;
  let campaignId: string;

  const CONFIG = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://api.example.test/auth/google/callback',
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
      .values({
        admin_id: u,
        createdby_id: u,
        id: c,
        name: `Campaign ${c}`,
        tenant_id: t,
        updatedby_id: u,
      })
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
      .insertInto('google_oauth_tokens')
      .values({
        access_token: ENC(args.accessToken),
        campaign_id: args.campaignId,
        delta_link: NEEDS_FULL_SYNC,
        expires_at: args.expiresAt,
        google_email: 'existing@example.com',
        refresh_token: ENC(args.refreshToken),
        tenant_id: args.tenantId,
        user_id: args.userId,
      })
      .execute();
  }

  async function readTokenRow(t: string, c: string) {
    return ctx.trx
      .selectFrom('google_oauth_tokens')
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('handleCallback', () => {
    it('stores both tokens encrypted and enqueues the initial sync job in one transaction', async () => {
      stubGoogleFetch({
        profileEmail: 'mailbox@example.com',
        tokenResponse: { access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' },
      });
      const { db, transactionCount } = dbOnTransaction(ctx.trx);
      const service = new GoogleOAuthService(db, CONFIG);

      await service.handleCallback('auth-code', userId, tenantId, campaignId);

      const row = await readTokenRow(tenantId, campaignId);
      expect(row).toBeDefined();
      // Not at rest in plaintext, but recoverable.
      expect(row?.access_token).not.toBe('access-1');
      expect(row?.refresh_token).not.toBe('refresh-1');
      expect(row?.access_token).toBe(ENC('access-1'));
      expect(row?.refresh_token).toBe(ENC('refresh-1'));
      expect(row?.google_email).toBe('mailbox@example.com');
      expect(row?.delta_link).toBe(NEEDS_FULL_SYNC);
      expect(row?.synced_at).toBeNull();

      const jobs = await readSyncJobs(tenantId);
      expect(jobs).toHaveLength(1);
      // background_jobs.payload is jsonb, so the driver hands it back already parsed.
      const payload: unknown = typeof jobs[0].payload === 'string' ? JSON.parse(jobs[0].payload) : jobs[0].payload;
      expect(payload).toMatchObject({
        campaignId,
        requestedBy: userId,
        tenantId,
        type: 'google_sync',
      });
      expect(jobs[0].status).toBe('pending');

      // Both writes went through a single transaction (transactional outbox).
      expect(transactionCount()).toBe(1);
    });

    it('keeps the previously stored refresh token when Google omits one on re-consent', async () => {
      await seedTokenRow({
        accessToken: 'old-access',
        campaignId,
        expiresAt: new Date(Date.now() + 3600_000),
        refreshToken: 'long-lived-refresh',
        tenantId,
        userId,
      });

      // Google only returns refresh_token on first consent; a re-auth omits it.
      stubGoogleFetch({
        profileEmail: 'mailbox@example.com',
        tokenResponse: { access_token: 'access-2', expires_in: 3600 },
      });
      const { db } = dbOnTransaction(ctx.trx);
      const service = new GoogleOAuthService(db, CONFIG);

      await service.handleCallback('auth-code', userId, tenantId, campaignId);

      const row = await readTokenRow(tenantId, campaignId);
      expect(row?.access_token).toBe(ENC('access-2'));
      // Preserved, and re-encrypted exactly once (not double-wrapped).
      expect(row?.refresh_token).toBe(ENC('long-lived-refresh'));
      expect(row?.refresh_token).not.toContain('enc-test(enc-test(');
    });

    it('refuses the connection when neither the response nor the database has a refresh token', async () => {
      stubGoogleFetch({
        profileEmail: 'mailbox@example.com',
        tokenResponse: { access_token: 'access-3', expires_in: 3600 },
      });
      const { db } = dbOnTransaction(ctx.trx);
      const service = new GoogleOAuthService(db, CONFIG);

      await expect(service.handleCallback('auth-code', userId, tenantId, campaignId)).rejects.toThrow(
        /Consent required/i,
      );

      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
      expect(await readSyncJobs(tenantId)).toHaveLength(0);
    });

    it('rolls the token upsert back when the sync-job enqueue fails', async () => {
      stubGoogleFetch({
        profileEmail: 'mailbox@example.com',
        tokenResponse: { access_token: 'access-4', expires_in: 3600, refresh_token: 'refresh-4' },
      });
      // Break only the background_jobs insert inside the service's transaction.
      const { db } = dbOnTransaction(ctx.trx, (inner) => {
        const failing = {
          insertInto: (table: string) =>
            table === 'background_jobs'
              ? { values: () => ({ execute: () => Promise.reject(new Error('job insert failed')) }) }
              : (inner as unknown as Record<string, (t: string) => unknown>)['insertInto'](table),
        };
        return failing as unknown as Transaction<Models>;
      });
      const service = new GoogleOAuthService(db, CONFIG);

      await expect(service.handleCallback('auth-code', userId, tenantId, campaignId)).rejects.toThrow(
        /job insert failed/,
      );

      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
    });

    it('does not write anything when Google rejects the code exchange', async () => {
      stubGoogleFetch({ tokenError: 'invalid_grant' });
      const { db } = dbOnTransaction(ctx.trx);
      const service = new GoogleOAuthService(db, CONFIG);

      await expect(service.handleCallback('bad-code', userId, tenantId, campaignId)).rejects.toThrow(/invalid_grant/);
      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
      expect(await readSyncJobs(tenantId)).toHaveLength(0);
    });
  });

  describe('getValidToken', () => {
    it('returns the decrypted stored token without calling Google when it is not near expiry', async () => {
      await seedTokenRow({
        accessToken: 'cached-access',
        campaignId,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        refreshToken: 'stored-refresh',
        tenantId,
        userId,
      });
      const calls = stubGoogleFetch({ tokenResponse: {} });
      const service = new GoogleOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);

      expect(await service.getValidToken(tenantId, campaignId)).toBe('cached-access');
      expect(calls).toHaveLength(0);
    });

    it('refreshes inside the one-minute early-refresh margin and persists the new token encrypted', async () => {
      // 30s of life left: still valid to Google, but inside the 60s margin.
      await seedTokenRow({
        accessToken: 'stale-access',
        campaignId,
        expiresAt: new Date(Date.now() + 30_000),
        refreshToken: 'stored-refresh',
        tenantId,
        userId,
      });
      const calls = stubGoogleFetch({
        tokenResponse: { access_token: 'fresh-access', expires_in: 3600 },
      });
      const service = new GoogleOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);

      expect(await service.getValidToken(tenantId, campaignId)).toBe('fresh-access');

      // The refresh call sent the decrypted refresh token, not the stored ciphertext.
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toContain('grant_type=refresh_token');
      expect(calls[0].body).toContain('refresh_token=stored-refresh');

      const row = await readTokenRow(tenantId, campaignId);
      expect(row?.access_token).toBe(ENC('fresh-access'));
      expect(new Date(row?.expires_at ?? 0).getTime()).toBeGreaterThan(Date.now() + 60_000);
    });

    it('keeps the stored refresh token when the refresh response omits a new one', async () => {
      await seedTokenRow({
        accessToken: 'stale-access',
        campaignId,
        expiresAt: new Date(Date.now() - 1000),
        refreshToken: 'stored-refresh',
        tenantId,
        userId,
      });
      stubGoogleFetch({ tokenResponse: { access_token: 'fresh-access', expires_in: 3600 } });
      const service = new GoogleOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);

      await service.getValidToken(tenantId, campaignId);

      const row = await readTokenRow(tenantId, campaignId);
      expect(row?.refresh_token).toBe(ENC('stored-refresh'));
    });

    it('throws when the campaign has no connected mailbox', async () => {
      const service = new GoogleOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      await expect(service.getValidToken(tenantId, campaignId)).rejects.toThrow(/No Google account connected/i);
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
      await seedTokenRow({
        ...base,
        campaignId: other.campaignId,
        tenantId: other.tenantId,
        userId: other.userId,
      });

      const service = new GoogleOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      await service.disconnect(tenantId, campaignId);

      expect(await readTokenRow(tenantId, campaignId)).toBeUndefined();
      expect(await readTokenRow(tenantId, secondCampaignId)).toBeDefined();
      expect(await readTokenRow(other.tenantId, other.campaignId)).toBeDefined();
    });
  });

  describe('getAuthUrl', () => {
    it('carries the signed state and asks for offline access', () => {
      const service = new GoogleOAuthService(ctx.trx as unknown as Kysely<Models>, CONFIG);
      const url = new URL(service.getAuthUrl('signed-state-value'));

      expect(url.searchParams.get('state')).toBe('signed-state-value');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    });
  });
});
