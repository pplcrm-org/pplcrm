import { describe, it, expect, vi } from 'vitest';
import { BaseRepository } from '../../lib/base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../test-utils/exclusive-db-lock';

// The import handlers are stubbed for the whole file: the dispatch tests below only care about
// WHICH handler a payload reaches, and the real ones download blobs and write to several tables.
// Nothing else in this file touches them.
vi.mock('./handlers/import.handlers', () => ({
  handleImportCsvJob: vi.fn(async () => undefined),
  handleLegacyImportJob: vi.fn(async () => undefined),
}));

import { handleImportCsvJob, handleLegacyImportJob } from './handlers/import.handlers';
import { executeJob } from './job-handlers';

// prune_retention is a DELETE over the WHOLE background_jobs table selected by age (completed past
// 7 days, failed past 30), which is the sweep-by-age case the lock exists for. Both directions of
// the hazard are real: the sweep can delete a row another file committed, and — the one that
// actually bit — the DELETE blocks on any row a concurrently running claimer holds in an open
// transaction, so the test sat waiting and was killed at the 5s timeout (CI run 31288548511).
// A priority band cannot help here: an age filter does not look at priority.
useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);

describe('prune_retention Job Handler (sole owner of background_jobs retention)', () => {
  const db = (BaseRepository as any)._db;

  it('prunes completed jobs after 7 days and failed jobs after 30, preserving everything newer or pending', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const eightDaysAgo = new Date(Date.now() - 8 * DAY);
    const sixDaysAgo = new Date(Date.now() - 6 * DAY);
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * DAY);

    // Generate unique queue names to select the jobs uniquely
    const prefix = Math.floor(Math.random() * 1000000);
    const qOldCompleted = `q-${prefix}-old-completed`;
    const qNewCompleted = `q-${prefix}-new-completed`;
    const qOldPending = `q-${prefix}-old-pending`;
    const qOldFailed = `q-${prefix}-old-failed`;
    const qAncientFailed = `q-${prefix}-ancient-failed`;
    const allQueues = [qOldCompleted, qNewCompleted, qOldPending, qOldFailed, qAncientFailed];

    // 1. Insert test jobs
    await db
      .insertInto('background_jobs' as any)
      .values([
        {
          tenant_id: null,
          queue: qOldCompleted,
          status: 'completed',
          payload: JSON.stringify({ type: 'test-job' }),
          updated_at: eightDaysAgo,
          run_at: eightDaysAgo,
        },
        {
          tenant_id: null,
          queue: qNewCompleted,
          status: 'completed',
          payload: JSON.stringify({ type: 'test-job' }),
          updated_at: sixDaysAgo,
          run_at: sixDaysAgo,
        },
        {
          tenant_id: null,
          queue: qOldPending,
          status: 'pending',
          payload: JSON.stringify({ type: 'test-job' }),
          // Far-future run_at so no concurrently-running claim test can ever grab this row;
          // retention looks only at status + updated_at, so this doesn't affect the assertion.
          updated_at: eightDaysAgo,
          run_at: new Date(Date.now() + 365 * DAY),
        },
        {
          tenant_id: null,
          queue: qOldFailed,
          status: 'failed',
          payload: JSON.stringify({ type: 'test-job' }),
          updated_at: eightDaysAgo,
          run_at: eightDaysAgo,
        },
        {
          tenant_id: null,
          queue: qAncientFailed,
          status: 'failed',
          payload: JSON.stringify({ type: 'test-job' }),
          updated_at: thirtyOneDaysAgo,
          run_at: thirtyOneDaysAgo,
        },
      ])
      .execute();

    try {
      // 2. Execute the retention prune job
      await executeJob({ type: 'prune_retention' }, db);

      // 3. Verify results
      const remainingJobs = await db
        .selectFrom('background_jobs' as any)
        .select(['queue', 'status'])
        .where('queue', 'in', allQueues)
        .execute();

      const remainingQueues = remainingJobs.map((j: any) => j.queue);

      // Completed past the 7-day window should be deleted
      expect(remainingQueues).not.toContain(qOldCompleted);

      // Completed inside the 7-day window should remain
      expect(remainingQueues).toContain(qNewCompleted);

      // Pending jobs are never pruned, regardless of age
      expect(remainingQueues).toContain(qOldPending);

      // Failed jobs get the longer 30-day dead-letter window: 8 days old remains…
      expect(remainingQueues).toContain(qOldFailed);

      // …but past 30 days they are pruned too
      expect(remainingQueues).not.toContain(qAncientFailed);
    } finally {
      // Clean up any remaining test data
      await db
        .deleteFrom('background_jobs' as any)
        .where('queue', 'in', allQueues)
        .execute();
    }
  });
});

describe('process_drip_workflows Job Handler', () => {
  // scheduleNextRun opens a transaction, takes a pg advisory lock via raw sql`…`.execute(trx)
  // (which needs a minimal Kysely executor on the trx), dedup-checks for a pending run, then
  // inserts the next one — this trx mock mirrors that shape and captures the inserted run_at.
  const makeSchedulerTrx = (captureRunAt: (runAt: Date) => void): any => ({
    getExecutor: () => ({
      transformQuery: (node: any) => node,
      compileQuery: () => ({ sql: '', parameters: [] }),
      executeQuery: async () => ({ rows: [] }),
    }),
    selectFrom: () => ({
      select: () => ({
        where: () => ({ where: () => ({ executeTakeFirst: async () => undefined }) }),
      }),
    }),
    insertInto: () => ({
      values: (vals: any) => {
        captureRunAt(vals.run_at);
        return { execute: async () => undefined };
      },
    }),
  });

  it('should limit initial fetch to 500 and reschedule instantly if exactly 500 records are found', async () => {
    let limitValue: number | null = null;
    let insertedRunAt: Date | null = null;

    const mockDb: any = {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              limit: (lim: number) => {
                limitValue = lim;
                return {
                  execute: async () => Array.from({ length: 500 }, (_, i) => ({ id: i })),
                };
              },
            }),
          }),
        }),
      }),
      transaction: () => ({
        execute: async (cb: any) =>
          cb(
            makeSchedulerTrx((runAt) => {
              insertedRunAt = runAt;
            }),
          ),
      }),
      insertInto: () => ({
        values: (vals: any) => {
          insertedRunAt = vals.run_at;
          return {
            execute: async () => {
              /* mock: no-op */
            },
          };
        },
      }),
    };

    await executeJob({ type: 'process_drip_workflows' }, mockDb);

    expect(limitValue).toBe(500);
    expect(insertedRunAt).toBeInstanceOf(Date);
    if (!insertedRunAt) throw new Error('insertedRunAt was not captured');
    const diff = Math.abs(insertedRunAt.getTime() - Date.now());
    expect(diff).toBeLessThan(5000); // within 5 seconds
  });

  it('should schedule next run in 10 minutes if fewer than 500 records are found', async () => {
    let insertedRunAt: Date | null = null;

    const mockDb: any = {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              limit: () => ({
                execute: async () => Array.from({ length: 10 }, (_, i) => ({ id: i })),
              }),
            }),
          }),
        }),
      }),
      transaction: () => ({
        execute: async (cb: any) =>
          cb(
            makeSchedulerTrx((runAt) => {
              insertedRunAt = runAt;
            }),
          ),
      }),
      insertInto: () => ({
        values: (vals: any) => {
          insertedRunAt = vals.run_at;
          return {
            execute: async () => {
              /* mock: no-op */
            },
          };
        },
      }),
    };

    await executeJob({ type: 'process_drip_workflows' }, mockDb);

    expect(insertedRunAt).toBeInstanceOf(Date);
    if (!insertedRunAt) throw new Error('insertedRunAt was not captured');
    const targetTime = Date.now() + 10 * 60 * 1000;
    const diff = Math.abs(insertedRunAt.getTime() - targetTime);
    expect(diff).toBeLessThan(5000); // within 5 seconds
  });
});

/**
 * Dispatch of import payloads, including the one-release drain shim for jobs queued before the
 * 2026-08-05 upload-based CSV path.
 *
 * Those older rows carry no `type` key at all — they were recognised by having `import_id` +
 * `storage_key`. When that branch was deleted, such a row fell through to
 * "Unsupported background job type: unknown", retried to exhaustion, dead-lettered, and the
 * stale-job sweep then marked the member's data_imports row failed. The shim finishes them
 * instead. Delete these two tests with the shim.
 */
describe('executeJob import dispatch', () => {
  const db = (BaseRepository as any)._db;

  const legacyPayload = {
    import_id: '4242',
    storage_key: 'imports/payload/1/legacy.ndjson',
    tenant_id: '1',
    user_id: '2',
    source: 'persons',
    skipped: 3,
    tags: ['Imported-20260801'],
    file_name: 'contacts.csv',
    duplicate_decision: 'skip',
  };

  it('routes a typeless pre-2026-08-05 import payload to the legacy drain handler', async () => {
    vi.mocked(handleLegacyImportJob).mockClear();

    await executeJob(legacyPayload, db);

    expect(handleLegacyImportJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleLegacyImportJob).mock.calls[0]?.[0]).toMatchObject({
      import_id: '4242',
      storage_key: 'imports/payload/1/legacy.ndjson',
      source: 'persons',
    });
    expect(handleImportCsvJob).not.toHaveBeenCalled();
  });

  it('passes the running job row id to the CSV handler so it can spot a rival continuation', async () => {
    vi.mocked(handleImportCsvJob).mockClear();

    await executeJob(
      {
        type: 'import_csv',
        import_id: '77',
        tenant_id: '1',
        user_id: '2',
        source: 'persons',
        storage_key: 'imports/source/1/a.csv',
        mapping: { '0': 'first_name' },
      },
      db,
      'job-row-99',
    );

    expect(vi.mocked(handleImportCsvJob).mock.calls[0]?.[2]).toEqual({ jobId: 'job-row-99' });
  });

  it('still dead-letters a payload whose declared type is unknown', async () => {
    await expect(executeJob({ type: 'no-such-job-type' }, db)).rejects.toThrow(
      'Unsupported background job type: no-such-job-type',
    );
  });

  it('still dead-letters a typeless payload that is not the legacy import shape', async () => {
    await expect(executeJob({ some: 'other', shape: true }, db)).rejects.toThrow(
      'Unsupported background job type: unknown',
    );
  });
});
