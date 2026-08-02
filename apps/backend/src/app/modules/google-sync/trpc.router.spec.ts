import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoogleSyncRouter } from './trpc.router';
import { GoogleOAuthService, NEEDS_FULL_SYNC } from './google-oauth.service';
import { GoogleSyncService } from './google-sync.service';
import { BaseRepository } from '../../lib/base.repo';
import { decodeOAuthState } from '../../lib/oauth-state';
import { env } from '../../../env';

/**
 * The router reads `(BaseRepository as any)['_db']` directly (not the
 * `dbInstance` getter) both to run the `isAuthed` role/verified check and to
 * do its own `background_jobs` bookkeeping. Stubbing the raw `_db` field
 * covers both call sites with one fake without touching the real Postgres
 * instance or making any Google network/API calls.
 */
function installMockDb(options: { activeJob?: unknown } = {}) {
  let lastTable: string | undefined;
  const qb: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
    executeTakeFirst: vi.fn().mockImplementation(() => {
      if (lastTable === 'authusers') return Promise.resolve({ role: 'owner', verified: true });
      // isAuthed also checks the session is still active (SECURITY-REVIEW.md 1.1).
      if (lastTable === 'sessions') return Promise.resolve({ id: 'sess', expires_at: null });
      if (lastTable === 'background_jobs') return Promise.resolve(options.activeJob);
      // The shared inbox is Grassroots+ (assertPlanFeature reads the tenant's plan; the gate
      // fails closed to free) — seed a paid plan or every gated procedure dies on FORBIDDEN.
      if (lastTable === 'tenants') return Promise.resolve({ subscription_plan: 'movement', demo_mode_at: null });
      return Promise.resolve(undefined);
    }),
  };
  const setTable = (table: string) => {
    lastTable = table;
    return qb;
  };
  const db = {
    selectFrom: vi.fn(setTable),
    insertInto: vi.fn(setTable),
    deleteFrom: vi.fn(setTable),
    updateTable: vi.fn(setTable),
  };
  (BaseRepository as any)._db = db;
  return db;
}

const AUTH = { tenant_id: '10', user_id: '20', session_id: 's1' };
const CAMPAIGN = '30';

describe('GoogleSyncRouter', () => {
  let originalDb: unknown;
  let originalCreds: { id: string | undefined; secret: string | undefined };

  beforeEach(() => {
    vi.restoreAllMocks();
    originalDb = (BaseRepository as any)._db;
    // The router refuses to run unconfigured; give it fake credentials for the
    // happy-path tests (no real Google calls are made — the services are mocked).
    originalCreds = { id: env.googleClientId, secret: env.googleClientSecret };
    (env as { googleClientId?: string }).googleClientId = 'test-google-client-id';
    (env as { googleClientSecret?: string }).googleClientSecret = 'test-google-client-secret';
  });

  afterEach(() => {
    (BaseRepository as any)._db = originalDb;
    (env as { googleClientId?: string }).googleClientId = originalCreds.id;
    (env as { googleClientSecret?: string }).googleClientSecret = originalCreds.secret;
  });

  it('getConnectionStatus reports configured=false without touching Google when credentials are absent', async () => {
    installMockDb();
    (env as { googleClientId?: string }).googleClientId = undefined;
    (env as { googleClientSecret?: string }).googleClientSecret = undefined;
    const statusSpy = vi.spyOn(GoogleOAuthService.prototype, 'getConnectionStatus');

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.getConnectionStatus({ campaignId: CAMPAIGN });

    expect(result).toMatchObject({ configured: false, connected: false, syncing: false });
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('getAuthUrl fails with user-facing copy when credentials are absent', async () => {
    installMockDb();
    (env as { googleClientId?: string }).googleClientId = undefined;
    (env as { googleClientSecret?: string }).googleClientSecret = undefined;

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    await expect(caller.getAuthUrl({ campaignId: CAMPAIGN })).rejects.toThrow(/not configured on this server/);
  });

  it('rejects unauthenticated callers', async () => {
    installMockDb();
    const caller = GoogleSyncRouter.createCaller({ auth: undefined } as any);
    await expect(caller.getAuthUrl({ campaignId: CAMPAIGN })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('getAuthUrl signs a state binding the caller and delegates to the oauth service', async () => {
    installMockDb();
    const spy = vi
      .spyOn(GoogleOAuthService.prototype, 'getAuthUrl')
      .mockReturnValue('https://accounts.google.com/o/oauth2/mock');

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.getAuthUrl({ campaignId: CAMPAIGN, returnTo: '/settings/integrations' });

    expect(result.url).toBe('https://accounts.google.com/o/oauth2/mock');
    expect(spy).toHaveBeenCalledTimes(1);

    const state = spy.mock.calls[0][0] as string;
    const decoded = decodeOAuthState(state);
    expect(decoded).toMatchObject({
      userId: '20',
      tenantId: '10',
      campaignId: CAMPAIGN,
      returnTo: '/settings/integrations',
    });
  });

  it('getConnectionStatus reports syncing=false when no background job is active', async () => {
    installMockDb({ activeJob: undefined });
    vi.spyOn(GoogleOAuthService.prototype, 'getConnectionStatus').mockResolvedValue({
      connected: true,
      googleEmail: 'user@example.com',
      syncedAt: null,
      lastSyncError: null,
      lastSyncErrorAt: null,
    });

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.getConnectionStatus({ campaignId: CAMPAIGN });

    expect(result.connected).toBe(true);
    expect(result.googleEmail).toBe('user@example.com');
    expect(result.syncing).toBe(false);
  });

  it('getConnectionStatus reports syncing=true when a background job is pending', async () => {
    installMockDb({ activeJob: { id: '99' } });
    vi.spyOn(GoogleOAuthService.prototype, 'getConnectionStatus').mockResolvedValue({
      connected: true,
      googleEmail: null,
      syncedAt: null,
      lastSyncError: null,
      lastSyncErrorAt: null,
    });

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.getConnectionStatus({ campaignId: CAMPAIGN });

    expect(result.syncing).toBe(true);
  });

  it('syncNow enqueues a background job when none is already pending', async () => {
    const db = installMockDb({ activeJob: undefined });
    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);

    const result = await caller.syncNow({ campaignId: CAMPAIGN });

    expect(result).toEqual({ inserted: 0, queued: true });
    expect(db.insertInto).toHaveBeenCalledWith('background_jobs');
  });

  it('syncNow does not enqueue a duplicate job when one is already pending', async () => {
    const db = installMockDb({ activeJob: { id: '5' } });
    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);

    const result = await caller.syncNow({ campaignId: CAMPAIGN });

    expect(result).toEqual({ inserted: 0, queued: true });
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('disconnect removes local emails first when requested, then disconnects the account', async () => {
    installMockDb();
    const removeSpy = vi.spyOn(GoogleSyncService.prototype, 'removeAllLocalEmails').mockResolvedValue(undefined);
    const disconnectSpy = vi.spyOn(GoogleOAuthService.prototype, 'disconnect').mockResolvedValue(undefined);

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.disconnect({ campaignId: CAMPAIGN, removeLocalEmails: true });

    expect(result).toEqual({ success: true });
    expect(removeSpy).toHaveBeenCalledWith('10', CAMPAIGN);
    expect(disconnectSpy).toHaveBeenCalledWith('10', CAMPAIGN);
  });

  it('disconnect skips local email removal by default', async () => {
    installMockDb();
    const removeSpy = vi.spyOn(GoogleSyncService.prototype, 'removeAllLocalEmails').mockResolvedValue(undefined);
    vi.spyOn(GoogleOAuthService.prototype, 'disconnect').mockResolvedValue(undefined);

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    await caller.disconnect({ campaignId: CAMPAIGN });

    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('propagates errors raised while disconnecting the account', async () => {
    installMockDb();
    vi.spyOn(GoogleOAuthService.prototype, 'disconnect').mockRejectedValue(new Error('db unavailable'));

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    await expect(caller.disconnect({ campaignId: CAMPAIGN })).rejects.toThrow();
  });

  it('resetSync marks the delta link as needing a full resync', async () => {
    installMockDb();
    const spy = vi.spyOn(GoogleOAuthService.prototype, 'saveDeltaLink').mockResolvedValue(undefined);

    const caller = GoogleSyncRouter.createCaller({ auth: AUTH } as any);
    const result = await caller.resetSync({ campaignId: CAMPAIGN });

    expect(result).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith('10', CAMPAIGN, NEEDS_FULL_SYNC);
  });
});
