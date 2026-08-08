import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../test-utils/exclusive-db-lock';
import { scheduleNextRun } from './reschedule';
import { BackgroundJobWorker } from './worker';

/**
 * Reliability guards on the background-job worker:
 *  - scheduleNextRun must not stack duplicate cron runs (a crash mid-reschedule would otherwise
 *    multiply a self-rescheduling job every stale window).
 *  - recoverStaleJobs must dead-letter a poison job that has exhausted its attempts instead of
 *    requeuing it forever, while still requeuing jobs that have retries left.
 *  - when the dead-lettered job is a recurring (cron) type, recoverStaleJobs must re-seed the
 *    chain's next run, or the cron silently stops until the next deploy.
 */

interface WorkerInternals {
  recoverStaleJobs(): Promise<void>;
}
const asInternals = (w: BackgroundJobWorker): WorkerInternals => w as unknown as WorkerInternals;

// recoverStaleJobs is a sweep over the WHOLE table, selected by age rather than by claim order:
// any 'processing' row whose locked_at is more than 30 minutes old, and any data_exports row left
// pending/processing for more than an hour. A priority band cannot exclude rows from an age
// filter, so this file takes the shared queue lock. Today no other spec file writes a row old
// enough for the sweep to touch (they all use `new Date()` for locked_at, and the one file that
// backdates a data_export marks it 'completed', which the sweep skips) — a spec that ever does
// must take this same lock, or this file's sweep will fail its rows out from under it.
//
// The lock also serializes this file against the two spec files that run a real claimer
// (job-claim.spec.ts, worker.retry-backoff.spec.ts).
useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);

describe('scheduleNextRun dedup', () => {
  const db = (BaseRepository as any)._db;
  const TYPE = 'cleanup_activities';

  afterEach(async () => {
    await db
      .deleteFrom('background_jobs')
      .where(sql`payload->>'type'`, '=', TYPE)
      .execute();
  });

  const countByStatus = async (status: string): Promise<number> => {
    const rows = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('status', '=', status)
      .where(sql`payload->>'type'`, '=', TYPE)
      .execute();
    return rows.length;
  };

  it('enqueues only one pending run even when called repeatedly', async () => {
    await scheduleNextRun(db, TYPE, 1000);
    await scheduleNextRun(db, TYPE, 1000);
    await scheduleNextRun(db, TYPE, 1000);
    expect(await countByStatus('pending')).toBe(1);
  });

  it('does not count the currently-processing job, so the chain can continue', async () => {
    // Simulate this cron job running (processing), with no pending successor yet.
    await db
      .insertInto('background_jobs')
      .values({
        tenant_id: null,
        queue: 'default',
        status: 'processing',
        payload: JSON.stringify({ type: TYPE }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();

    // The running handler schedules its next run — the processing row must not block it.
    await scheduleNextRun(db, TYPE, 1000);
    expect(await countByStatus('pending')).toBe(1);
  });
});

describe('recoverStaleJobs', () => {
  const db = (BaseRepository as any)._db;
  const worker = new BackgroundJobWorker();
  const prefix = `recover-${Math.floor(Math.random() * 1_000_000)}`;
  const staleLock = new Date(Date.now() - 40 * 60 * 1000); // older than the 30-min threshold
  // A real entry in CRON_JOBS, so dead-lettering it must re-seed the chain's next run.
  const CRON_TYPE = 'prune_retention';

  afterEach(async () => {
    await db.deleteFrom('background_jobs').where('queue', 'like', `${prefix}%`).execute();
    // The re-seeded next run is inserted by scheduleNextRun with queue 'default', so the
    // prefix-scoped delete above never catches it — clean it up by payload type.
    await db
      .deleteFrom('background_jobs')
      .where(sql`payload->>'type'`, '=', CRON_TYPE)
      .execute();
  });

  it('dead-letters an exhausted stale job and requeues one with retries left', async () => {
    const exhaustedQueue = `${prefix}-exhausted`;
    const retryableQueue = `${prefix}-retryable`;

    await db
      .insertInto('background_jobs')
      .values([
        {
          tenant_id: null,
          queue: exhaustedQueue,
          status: 'processing',
          payload: JSON.stringify({ type: 'test-recover' }),
          run_at: staleLock,
          locked_at: staleLock,
          locked_by: 'dead-worker',
          attempts: 3,
          max_attempts: 3,
        },
        {
          tenant_id: null,
          queue: retryableQueue,
          status: 'processing',
          payload: JSON.stringify({ type: 'test-recover' }),
          run_at: staleLock,
          locked_at: staleLock,
          locked_by: 'dead-worker',
          attempts: 1,
          max_attempts: 3,
        },
      ])
      .execute();

    await asInternals(worker).recoverStaleJobs();

    const statusOf = async (queue: string): Promise<string> => {
      const row = await db
        .selectFrom('background_jobs')
        .select('status')
        .where('queue', '=', queue)
        .executeTakeFirstOrThrow();
      return String(row.status);
    };

    expect(await statusOf(exhaustedQueue)).toBe('failed');
    expect(await statusOf(retryableQueue)).toBe('pending');
  });

  it('re-seeds the next run when a dead-lettered stale job is a cron type, but not for others', async () => {
    const cronQueue = `${prefix}-cron`;
    const nonCronQueue = `${prefix}-noncron`;

    // Start from a clean chain: a pre-existing pending run of the cron type would satisfy
    // scheduleNextRun's dedup and mask whether recovery actually re-seeded anything.
    await db
      .deleteFrom('background_jobs')
      .where(sql`payload->>'type'`, '=', CRON_TYPE)
      .execute();

    await db
      .insertInto('background_jobs')
      .values([
        {
          tenant_id: null,
          queue: cronQueue,
          status: 'processing',
          payload: JSON.stringify({ type: CRON_TYPE }),
          run_at: staleLock,
          locked_at: staleLock,
          locked_by: 'dead-worker',
          attempts: 3,
          max_attempts: 3,
        },
        {
          tenant_id: null,
          queue: nonCronQueue,
          status: 'processing',
          payload: JSON.stringify({ type: 'not-a-cron-type' }),
          run_at: staleLock,
          locked_at: staleLock,
          locked_by: 'dead-worker',
          attempts: 3,
          max_attempts: 3,
        },
      ])
      .execute();

    await asInternals(worker).recoverStaleJobs();

    // Both stale rows are dead-lettered…
    const deadRows = await db
      .selectFrom('background_jobs')
      .select(['queue', 'status'])
      .where('queue', 'in', [cronQueue, nonCronQueue])
      .execute();
    expect(deadRows.map((r: { status: string }) => String(r.status))).toEqual(['failed', 'failed']);

    // …and the cron type gets exactly one fresh pending row (inserted by scheduleNextRun).
    const cronPending = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('status', '=', 'pending')
      .where(sql`payload->>'type'`, '=', CRON_TYPE)
      .execute();
    expect(cronPending.length).toBe(1);

    // A non-cron type gets no replacement row.
    const nonCronPending = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('status', '=', 'pending')
      .where(sql`payload->>'type'`, '=', 'not-a-cron-type')
      .execute();
    expect(nonCronPending.length).toBe(0);
  });

  it('leaves a fresh (recently heartbeated) processing job alone', async () => {
    const freshQueue = `${prefix}-fresh`;
    await db
      .insertInto('background_jobs')
      .values({
        tenant_id: null,
        queue: freshQueue,
        status: 'processing',
        payload: JSON.stringify({ type: 'test-recover' }),
        run_at: new Date(),
        locked_at: new Date(), // just heartbeated — not stale
        locked_by: 'live-worker',
        attempts: 1,
        max_attempts: 3,
      })
      .execute();

    await asInternals(worker).recoverStaleJobs();

    const row = await db
      .selectFrom('background_jobs')
      .select('status')
      .where('queue', '=', freshQueue)
      .executeTakeFirstOrThrow();
    expect(String(row.status)).toBe('processing');
  });
});
