import { describe, it, expect } from 'vitest';
import { BaseRepository } from '../../lib/base.repo';
import { executeJob } from './job-handlers';

describe('perform_scheduled_deletions Job Handler', () => {
  const db = (BaseRepository as any)._db;

  it('should delete completed background jobs older than 7 days, but preserve newer or non-completed ones', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

    // Generate unique queue names to select the jobs uniquely
    const prefix = Math.floor(Math.random() * 1000000);
    const qOldCompleted = `q-${prefix}-old-completed`;
    const qNewCompleted = `q-${prefix}-new-completed`;
    const qOldPending = `q-${prefix}-old-pending`;
    const qOldFailed = `q-${prefix}-old-failed`;

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
          updated_at: eightDaysAgo,
          run_at: eightDaysAgo,
        },
        {
          tenant_id: null,
          queue: qOldFailed,
          status: 'failed',
          payload: JSON.stringify({ type: 'test-job' }),
          updated_at: eightDaysAgo,
          run_at: eightDaysAgo,
        },
      ])
      .execute();

    try {
      // 2. Execute scheduled deletions job
      await executeJob({ type: 'perform_scheduled_deletions' }, db);

      // 3. Verify results
      const remainingJobs = await db
        .selectFrom('background_jobs' as any)
        .select(['queue', 'status'])
        .where('queue', 'in', [qOldCompleted, qNewCompleted, qOldPending, qOldFailed])
        .execute();

      const remainingQueues = remainingJobs.map((j: any) => j.queue);

      // Old completed job should be deleted
      expect(remainingQueues).not.toContain(qOldCompleted);

      // New completed job should remain
      expect(remainingQueues).toContain(qNewCompleted);

      // Old pending job should remain
      expect(remainingQueues).toContain(qOldPending);

      // Old failed job should remain
      expect(remainingQueues).toContain(qOldFailed);
    } finally {
      // Clean up any remaining test data
      await db
        .deleteFrom('background_jobs' as any)
        .where('queue', 'in', [qOldCompleted, qNewCompleted, qOldPending, qOldFailed])
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
