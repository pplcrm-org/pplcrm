import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { pruneExpiredExports } from './maintenance.handlers';

/**
 * Nothing pruned `data_exports`: every CSV a workspace ever produced sat in blob storage forever,
 * even though the privacy policy, the Help Center and the Exports page all state 30 days.
 *
 * The blob half is the part worth pinning. Deleting only the row would silently orphan the file —
 * the row holds the only copy of the storage key, so after that nothing can find it again.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('pruneExpiredExports', () => {
  let tenantId: string;
  let userId: string;
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  async function seedExport(createdAt: Date, storageKey: string | null): Promise<string> {
    const row = await db
      .insertInto('data_exports')
      .values({
        tenant_id: tenantId,
        user_id: userId,
        entity: 'persons',
        file_name: 'persons-export.csv',
        status: 'completed',
        row_count: 3,
        storage_key: storageKey,
        columns: null,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  const exportExists = async (id: string): Promise<boolean> =>
    !!(await db
      .selectFrom('data_exports')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst());

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Export Retention Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `member-${userId}@example.com`,
        password: 'not-a-real-hash',
        first_name: 'Export',
        last_name: 'Member',
        verified: true,
        role: 'user',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('data_exports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('deletes an aged export row and its blob, and leaves a fresh one alone', async () => {
    const agedKey = `exports/${tenantId}/aged.csv`;
    const freshKey = `exports/${tenantId}/fresh.csv`;
    const agedId = await seedExport(daysAgo(31), agedKey);
    const freshId = await seedExport(daysAgo(2), freshKey);

    await pruneExpiredExports(db);

    expect(await exportExists(agedId)).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith(agedKey);

    expect(await exportExists(freshId)).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalledWith(freshKey);
  });

  it('keeps an export that is exactly inside the 30-day window', async () => {
    const id = await seedExport(daysAgo(29), `exports/${tenantId}/inside.csv`);

    await pruneExpiredExports(db);

    expect(await exportExists(id)).toBe(true);
  });

  it('deletes an aged row that never produced a file', async () => {
    // Instant exports (downloaded straight to the browser) and failed jobs have no storage_key.
    const id = await seedExport(daysAgo(45), null);

    await pruneExpiredExports(db);

    expect(await exportExists(id)).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('keeps the row when its blob delete fails, so the next run retries instead of orphaning the file', async () => {
    const stuckKey = `exports/${tenantId}/stuck.csv`;
    deleteSpy.mockRejectedValue(new Error('storage unavailable'));
    const id = await seedExport(daysAgo(60), stuckKey);

    const result = await pruneExpiredExports(db);

    expect(await exportExists(id)).toBe(true);
    // The sweep is intentionally cross-tenant, so the counters are lower bounds: another spec's
    // leftovers could add to them. This tenant's row surviving is the assertion that matters.
    expect(result.blobFailures).toBeGreaterThanOrEqual(1);
  });

  it('a single failing blob does not strand the other rows in the batch', async () => {
    const stuckKey = `exports/${tenantId}/stuck.csv`;
    const okKey = `exports/${tenantId}/ok.csv`;
    deleteSpy.mockImplementation(async (key: string): Promise<void> => {
      if (key === stuckKey) throw new Error('storage unavailable');
    });

    const stuckId = await seedExport(daysAgo(60), stuckKey);
    const okId = await seedExport(daysAgo(60), okKey);

    await pruneExpiredExports(db);

    expect(await exportExists(stuckId)).toBe(true);
    expect(await exportExists(okId)).toBe(false);
  });
});
