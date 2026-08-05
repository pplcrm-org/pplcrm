import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { pruneExpiredImportSourceFiles } from './maintenance.handlers';

/**
 * Nothing pruned the retained original upload of an import before this sweep existed: every CSV a
 * member ever fed the import wizard sat in blob storage forever, even though the privacy policy,
 * the Help Center and `persons.service.ts` all say 90 days. See `pruneExpiredImportSourceFiles`.
 *
 * Unlike the export sweep, only the blob and the `source_file_key` column are cleared — the
 * `data_imports` row itself is permanent import history and is never deleted here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('pruneExpiredImportSourceFiles', () => {
  let tenantId: string;
  let userId: string;
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  async function seedTenant(): Promise<{ tenantId: string; userId: string }> {
    const tid = rand();
    const uid = rand();
    await db.insertInto('tenants').values({ id: tid, name: 'Import Retention Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: uid,
        tenant_id: tid,
        email: `member-${uid}@example.com`,
        password: 'not-a-real-hash',
        first_name: 'Import',
        last_name: 'Member',
        verified: true,
        role: 'user',
        createdby_id: uid,
        updatedby_id: uid,
      })
      .execute();
    return { tenantId: tid, userId: uid };
  }

  async function seedImport(opts: {
    tenantId: string;
    userId: string;
    processedAt: Date;
    sourceFileKey: string | null;
    status?: string;
  }): Promise<string> {
    const row = await db
      .insertInto('data_imports')
      .values({
        tenant_id: opts.tenantId,
        createdby_id: opts.userId,
        updatedby_id: opts.userId,
        file_name: 'contacts.csv',
        source: 'persons',
        row_count: 10,
        inserted_count: 10,
        error_count: 0,
        skipped_count: 0,
        households_created: 0,
        status: opts.status ?? 'completed',
        metadata: null,
        source_file_key: opts.sourceFileKey,
        source_file_size: opts.sourceFileKey ? 1024 : null,
        processed_at: opts.processedAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  const getImport = async (
    tid: string,
    id: string,
  ): Promise<{ id: string; source_file_key: string | null } | undefined> =>
    db
      .selectFrom('data_imports')
      .select(['id', 'source_file_key'])
      .where('tenant_id', '=', tid)
      .where('id', '=', id)
      .executeTakeFirst();

  beforeEach(async () => {
    const seeded = await seedTenant();
    tenantId = seeded.tenantId;
    userId = seeded.userId;
    deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('data_imports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('clears an aged import source key and deletes its blob, leaving a fresh one alone', async () => {
    const agedKey = `imports/source/${tenantId}/aged.csv`;
    const freshKey = `imports/source/${tenantId}/fresh.csv`;
    const agedId = await seedImport({ tenantId, userId, processedAt: daysAgo(91), sourceFileKey: agedKey });
    const freshId = await seedImport({ tenantId, userId, processedAt: daysAgo(2), sourceFileKey: freshKey });

    const result = await pruneExpiredImportSourceFiles(db);

    const aged = await getImport(tenantId, agedId);
    expect(aged).toBeDefined(); // the data_imports row itself is history and must survive
    expect(aged?.source_file_key).toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith(agedKey);

    const fresh = await getImport(tenantId, freshId);
    expect(fresh?.source_file_key).toBe(freshKey);
    expect(deleteSpy).not.toHaveBeenCalledWith(freshKey);
    expect(result.rows).toBeGreaterThanOrEqual(1);
  });

  it('keeps a source file that is exactly inside the 90-day window', async () => {
    const key = `imports/source/${tenantId}/inside.csv`;
    const id = await seedImport({ tenantId, userId, processedAt: daysAgo(89), sourceFileKey: key });

    await pruneExpiredImportSourceFiles(db);

    const row = await getImport(tenantId, id);
    expect(row?.source_file_key).toBe(key);
    expect(deleteSpy).not.toHaveBeenCalledWith(key);
  });

  it('does not touch an already-cleared import (no source file left to sweep)', async () => {
    const id = await seedImport({ tenantId, userId, processedAt: daysAgo(120), sourceFileKey: null });

    await pruneExpiredImportSourceFiles(db);

    const row = await getImport(tenantId, id);
    expect(row).toBeDefined();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('leaves the row (and its key) alone when the blob delete fails, so the next run retries', async () => {
    const stuckKey = `imports/source/${tenantId}/stuck.csv`;
    deleteSpy.mockRejectedValue(new Error('storage unavailable'));
    const id = await seedImport({ tenantId, userId, processedAt: daysAgo(120), sourceFileKey: stuckKey });

    const result = await pruneExpiredImportSourceFiles(db);

    const row = await getImport(tenantId, id);
    expect(row?.source_file_key).toBe(stuckKey);
    // Cross-tenant sweep, so the counter is a lower bound shared with any concurrent spec file —
    // this tenant's key surviving is the assertion that matters.
    expect(result.blobFailures).toBeGreaterThanOrEqual(1);
  });

  it('a single failing blob does not strand the other rows in the batch', async () => {
    const stuckKey = `imports/source/${tenantId}/stuck.csv`;
    const okKey = `imports/source/${tenantId}/ok.csv`;
    deleteSpy.mockImplementation(async (key: string): Promise<void> => {
      if (key === stuckKey) throw new Error('storage unavailable');
    });

    const stuckId = await seedImport({ tenantId, userId, processedAt: daysAgo(120), sourceFileKey: stuckKey });
    const okId = await seedImport({ tenantId, userId, processedAt: daysAgo(120), sourceFileKey: okKey });

    await pruneExpiredImportSourceFiles(db);

    expect((await getImport(tenantId, stuckId))?.source_file_key).toBe(stuckKey);
    expect((await getImport(tenantId, okId))?.source_file_key).toBeNull();
  });

  it("does not touch another tenant's fresh import while sweeping this tenant's aged one", async () => {
    const other = await seedTenant();
    try {
      const agedKey = `imports/source/${tenantId}/aged.csv`;
      const otherFreshKey = `imports/source/${other.tenantId}/fresh.csv`;
      const agedId = await seedImport({ tenantId, userId, processedAt: daysAgo(91), sourceFileKey: agedKey });
      const otherFreshId = await seedImport({
        tenantId: other.tenantId,
        userId: other.userId,
        processedAt: daysAgo(1),
        sourceFileKey: otherFreshKey,
      });

      await pruneExpiredImportSourceFiles(db);

      expect((await getImport(tenantId, agedId))?.source_file_key).toBeNull();
      const otherFresh = await getImport(other.tenantId, otherFreshId);
      expect(otherFresh?.source_file_key).toBe(otherFreshKey);
      expect(deleteSpy).not.toHaveBeenCalledWith(otherFreshKey);
    } finally {
      await db.deleteFrom('data_imports').where('tenant_id', '=', other.tenantId).execute();
      await db.deleteFrom('authusers').where('tenant_id', '=', other.tenantId).execute();
      await db.deleteFrom('tenants').where('id', '=', other.tenantId).execute();
    }
  });

  /**
   * PRODUCTION-RISK FINDING (not a fix — pinning actual behavior per task instructions):
   *
   * `pruneExpiredImportSourceFiles`'s query filters only on `source_file_key IS NOT NULL AND
   * processed_at < now() - 90 days` — it does not filter on `status` at all. `processed_at` is set
   * once at row creation (upload-intake.ts, at 'pending' status) and again only when the import
   * reaches a terminal state ('completed'/'failed' — import.handlers.ts markImportCompleted /
   * failImport). It is never touched while a row sits in 'pending' or 'processing'.
   *
   * So an import that never reaches a terminal status (e.g. its worker crashed and was never
   * resumed) keeps the `processed_at` timestamp from its original creation, and once that origin
   * timestamp is >90 days old this sweep deletes its blob — same as a completed one. The
   * background_jobs job payload for a resumable import carries the *same* storage key
   * (`upload-intake.ts` sets both `data_imports.source_file_key` and the job's `storage_key` from
   * one `storageKey` value), so a resume attempt after that point would try to download a blob this
   * sweep already deleted. There is no code path in `pruneExpiredImportSourceFiles` that exempts
   * 'pending'/'processing' rows.
   *
   * This does not contradict the published 90-day retention policy in the literal sense (files are
   * still gone at 90 days as stated) — it is the "over-deletes" risk called out in the production
   * review: a stuck-but-still-queued import's source file is not protected. Left un-skipped and
   * assertion-backed below so this is a real regression test of current behavior, not a to-do.
   */
  it('[FINDING] deletes the source blob of an import still stuck in "processing" past 90 days', async () => {
    const stuckKey = `imports/source/${tenantId}/still-processing.csv`;
    const id = await seedImport({
      tenantId,
      userId,
      processedAt: daysAgo(91),
      sourceFileKey: stuckKey,
      status: 'processing',
    });

    await pruneExpiredImportSourceFiles(db);

    const row = await getImport(tenantId, id);
    expect(row?.source_file_key).toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith(stuckKey);
  });
});
