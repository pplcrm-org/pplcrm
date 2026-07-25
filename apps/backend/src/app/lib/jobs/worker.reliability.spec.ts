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
 */

interface WorkerInternals {
  recoverStaleJobs(): Promise<void>;
}
const asInternals = (w: BackgroundJobWorker): WorkerInternals => w as unknown as WorkerInternals;

// These specs commit pending/processing rows that a concurrent claimer would happily pick up,
// which is exactly what breaks job-claim.spec.ts's global-FIFO assertions. Take turns.
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

  afterEach(async () => {
    await db.deleteFrom('background_jobs').where('queue', 'like', `${prefix}%`).execute();
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
