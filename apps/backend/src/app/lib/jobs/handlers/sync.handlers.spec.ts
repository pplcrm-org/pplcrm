import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { GoogleSyncService } from '../../../modules/google-sync/google-sync.service';
import { MsSyncService } from '../../../modules/ms-sync/ms-sync.service';
import { useTestTransaction } from '../../test-utils/db-test-isolation';
import type { JobPayloadOf } from '../job-payloads';
import { handleGoogleSync, handleMsSync, handleScheduleSyncJobs } from './sync.handlers';

/**
 * The shared inbox is a Grassroots+ feature (plans.ts GATED_FEATURES.inbox) that is checked
 * TWICE by design: once when `handleScheduleSyncJobs` fans out sync jobs for every connected
 * mailbox, and again inside `handleGoogleSync`/`handleMsSync` when a queued job actually runs --
 * so a downgrade that happens between enqueue and processing still stops the sync, even for a
 * job that is already sitting in the queue. These tests pin both chokepoints.
 *
 * `handleScheduleSyncJobs` also calls `scheduleNextRun`, which opens its own
 * `db.transaction()` -- calling `.transaction()` on an already-open `Transaction` throws in
 * Kysely, so (as in inbox-purge.handlers.spec.ts) it is mocked out here; re-scheduling the cron
 * itself is not what this spec is about. With that mocked, everything else the handler does is a
 * plain insert/select against `ctx.trx`, so `useTestTransaction()` is sufficient and no
 * background_jobs row this file writes is ever visible outside a single test.
 */
vi.mock('../reschedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reschedule')>();
  return { ...actual, scheduleNextRun: vi.fn().mockResolvedValue(undefined) };
});

/**
 * MsOAuthService's constructor eagerly builds an MSAL `ConfidentialClientApplication` from
 * whatever client id/secret it's given, which throws `invalid_client_credential` against the
 * empty/placeholder MS OAuth env vars this test run has -- before `handleMsSync` ever reaches
 * `MsSyncService.syncTenant` (already spied on below). Nothing in this file touches
 * MsOAuthService's real behavior, so it's mocked out entirely with a no-op constructor.
 */
vi.mock('../../../modules/ms-sync/ms-oauth.service', () => ({
  MsOAuthService: class {},
}));

const ctx = useTestTransaction();

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface SeededTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly campaignId: string;
}

async function seedTenant(trx: Transaction<Models>, plan: string): Promise<SeededTenant> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();

  await trx
    .insertInto('tenants')
    .values({ id: tenantId, name: `Sync Tenant ${tenantId}`, subscription_plan: plan })
    .execute();

  await trx
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `member-${userId}@example.com`,
      password: 'not-a-real-hash',
      first_name: 'Sync',
      last_name: 'Member',
      verified: true,
      role: 'user',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await trx
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: `Sync Campaign ${campaignId}`,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return { tenantId, userId, campaignId };
}

async function seedGoogleToken(trx: Transaction<Models>, tenantId: string, campaignId: string): Promise<void> {
  await trx
    .insertInto('google_oauth_tokens')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      google_email: `mailbox-${tenantId}@example.com`,
    })
    .execute();
}

async function seedMsToken(trx: Transaction<Models>, tenantId: string, campaignId: string): Promise<void> {
  await trx
    .insertInto('ms_oauth_tokens')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ms_email: `mailbox-${tenantId}@example.com`,
    })
    .execute();
}

async function findSyncJobs(
  trx: Transaction<Models>,
  type: 'google_sync' | 'ms_sync',
  tenantId: string,
  campaignId: string,
): Promise<{ id: string; status: string }[]> {
  const rows = await trx
    .selectFrom('background_jobs')
    .select(['id', 'status'])
    .where(sql`payload->>'type'`, '=', type)
    .where(sql`payload->>'tenantId'`, '=', tenantId)
    .where(sql`payload->>'campaignId'`, '=', campaignId)
    .execute();
  return rows.map((r) => ({ id: String(r.id), status: r.status }));
}

describe('handleScheduleSyncJobs (enqueue-time plan gate)', () => {
  it('does not enqueue a sync job for a tenant below the required plan, even with mailbox tokens connected', async () => {
    const { tenantId, campaignId } = await seedTenant(ctx.trx, 'free');
    await seedGoogleToken(ctx.trx, tenantId, campaignId);

    await handleScheduleSyncJobs(ctx.trx);

    expect(await findSyncJobs(ctx.trx, 'google_sync', tenantId, campaignId)).toHaveLength(0);
  });

  it('enqueues one job per connected mailbox for a tenant at/above the plan, and does not duplicate on a second scheduler tick', async () => {
    const { tenantId, campaignId } = await seedTenant(ctx.trx, 'grassroots');
    await seedGoogleToken(ctx.trx, tenantId, campaignId);
    await seedMsToken(ctx.trx, tenantId, campaignId);

    await handleScheduleSyncJobs(ctx.trx);

    const firstGoogle = await findSyncJobs(ctx.trx, 'google_sync', tenantId, campaignId);
    const firstMs = await findSyncJobs(ctx.trx, 'ms_sync', tenantId, campaignId);
    expect(firstGoogle).toHaveLength(1);
    expect(firstMs).toHaveLength(1);
    expect(firstGoogle[0]?.status).toBe('pending');

    // Calling the scheduler again must not stack a second job on top of the still-pending one --
    // this is the dedupe query over existing pending/processing jobs for the same mailbox.
    await handleScheduleSyncJobs(ctx.trx);

    expect(await findSyncJobs(ctx.trx, 'google_sync', tenantId, campaignId)).toHaveLength(1);
    expect(await findSyncJobs(ctx.trx, 'ms_sync', tenantId, campaignId)).toHaveLength(1);
  });

  it('scopes each enqueued job to its own mailbox — never cross-assigns tenant/campaign pairs', async () => {
    const tenantA = await seedTenant(ctx.trx, 'movement');
    const tenantB = await seedTenant(ctx.trx, 'movement');
    await seedGoogleToken(ctx.trx, tenantA.tenantId, tenantA.campaignId);
    await seedGoogleToken(ctx.trx, tenantB.tenantId, tenantB.campaignId);

    await handleScheduleSyncJobs(ctx.trx);

    expect(await findSyncJobs(ctx.trx, 'google_sync', tenantA.tenantId, tenantA.campaignId)).toHaveLength(1);
    expect(await findSyncJobs(ctx.trx, 'google_sync', tenantB.tenantId, tenantB.campaignId)).toHaveLength(1);
    // Swapped pairing must not exist.
    expect(await findSyncJobs(ctx.trx, 'google_sync', tenantA.tenantId, tenantB.campaignId)).toHaveLength(0);
    expect(await findSyncJobs(ctx.trx, 'google_sync', tenantB.tenantId, tenantA.campaignId)).toHaveLength(0);
  });
});

describe('handleGoogleSync / handleMsSync (processing-time plan gate)', () => {
  let googleSyncSpy: ReturnType<typeof vi.spyOn>;
  let msSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    googleSyncSpy = vi.spyOn(GoogleSyncService.prototype, 'syncTenant').mockResolvedValue({ inserted: 0 });
    msSyncSpy = vi.spyOn(MsSyncService.prototype, 'syncTenant').mockResolvedValue({ inserted: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handleGoogleSync no-ops for a job whose tenant has since downgraded off the plan', async () => {
    const { tenantId, campaignId } = await seedTenant(ctx.trx, 'free');
    const payload: JobPayloadOf<'google_sync'> = { type: 'google_sync', tenantId, campaignId, requestedBy: 'system' };

    await expect(handleGoogleSync(payload, ctx.trx)).resolves.toBeUndefined();

    expect(googleSyncSpy).not.toHaveBeenCalled();
  });

  it('handleMsSync no-ops for a job whose tenant has since downgraded off the plan', async () => {
    const { tenantId, campaignId } = await seedTenant(ctx.trx, 'free');
    const payload: JobPayloadOf<'ms_sync'> = { type: 'ms_sync', tenantId, campaignId, requestedBy: 'system' };

    await expect(handleMsSync(payload, ctx.trx)).resolves.toBeUndefined();

    expect(msSyncSpy).not.toHaveBeenCalled();
  });

  it('handleGoogleSync proceeds to sync for a tenant still on a plan with the shared inbox', async () => {
    const { tenantId, campaignId } = await seedTenant(ctx.trx, 'grassroots');
    const payload: JobPayloadOf<'google_sync'> = { type: 'google_sync', tenantId, campaignId, requestedBy: 'system' };

    await handleGoogleSync(payload, ctx.trx);

    expect(googleSyncSpy).toHaveBeenCalledTimes(1);
    expect(googleSyncSpy).toHaveBeenCalledWith(tenantId, campaignId, 'system');
  });

  it('handleMsSync proceeds to sync for a tenant still on a plan with the shared inbox', async () => {
    const { tenantId, campaignId } = await seedTenant(ctx.trx, 'movement');
    const payload: JobPayloadOf<'ms_sync'> = { type: 'ms_sync', tenantId, campaignId, requestedBy: 'system' };

    await handleMsSync(payload, ctx.trx);

    expect(msSyncSpy).toHaveBeenCalledTimes(1);
    expect(msSyncSpy).toHaveBeenCalledWith(tenantId, campaignId, 'system');
  });
});
