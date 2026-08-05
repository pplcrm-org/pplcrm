import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../test-utils/exclusive-db-lock';
import { claimNextPendingJob } from './job-claim';
import { BackgroundJobWorker } from './worker';

/**
 * Retry backoff, dead-lettering, and the business-record side effects of a dead-lettered job.
 *
 * The failure path in `processNextJob` is what stands between "one handler threw" and "a newsletter
 * is stuck in 'sending' forever". These specs pin:
 *  - a throwing handler puts the row back to 'pending' with `run_at` pushed into the future, and the
 *    delay grows with each attempt (linear x30s for ordinary jobs, doubling for mail-shaped jobs);
 *  - the attempt that reaches `max_attempts` dead-letters the row to status='failed', which
 *    `claimNextPendingJob` (status='pending' only) can never hand out again;
 *  - dead-lettering a `send-newsletter` job moves the owning newsletter out of 'sending' to
 *    'paused', so the owner can resume it instead of being stranded;
 *  - the handler's error message is stored on the job row on both the retry and the dead-letter
 *    path.
 *
 * The handler is mocked so it fails on demand; the claimer is real, because the attempts increment
 * the backoff formula reads happens inside `claimNextPendingJob`, not in the worker.
 */

const mocks = vi.hoisted(() => ({
  // Message the stubbed handler throws with; also what must land in background_jobs.error.
  handlerErrorMessage: 'boom from the stubbed handler',
}));

vi.mock('./job-handlers', () => ({
  executeJob: vi.fn(() => Promise.reject(new Error(mocks.handlerErrorMessage))),
}));

interface WorkerInternals {
  processNextJob(): Promise<boolean>;
}
const asInternals = (w: BackgroundJobWorker): WorkerInternals => w as unknown as WorkerInternals;

// This file commits real 'pending' rows and then lets the real claimer pick "the next runnable job
// in the whole table". Any pending row another spec file committed would be claimed (and failed)
// instead, so every file touching this queue takes turns behind one advisory lock.
useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);

const db = (BaseRepository as any)._db;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface JobRow {
  attempts: number;
  error: string | null;
  id: string;
  locked_at: Date | null;
  locked_by: string | null;
  run_at: Date;
  status: string;
}

const readJob = async (id: string): Promise<JobRow> =>
  db.selectFrom('background_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

/** Seconds from now until the row becomes runnable again. */
const delaySecondsOf = (row: JobRow, from: number): number => (new Date(row.run_at).getTime() - from) / 1000;

describe('worker retry backoff (handler throws, attempts left)', () => {
  const queuePrefix = `retry-backoff-${Math.floor(Math.random() * 1_000_000)}`;
  const worker = new BackgroundJobWorker();

  afterEach(async () => {
    await db.deleteFrom('background_jobs').where('queue', 'like', `${queuePrefix}%`).execute();
  });

  const insertPendingJob = async (queue: string, payloadType: string, maxAttempts: number): Promise<string> => {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: null,
        queue,
        status: 'pending',
        payload: JSON.stringify({ type: payloadType }),
        run_at: new Date(),
        attempts: 0,
        max_attempts: maxAttempts,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  /** Make the row runnable again so the next round can claim it without waiting out the backoff. */
  const makeRunnableNow = async (id: string): Promise<void> => {
    await db.updateTable('background_jobs').set({ run_at: new Date() }).where('id', '=', id).execute();
  };

  it('reschedules a failed job to pending with the attempt counted, the lock cleared and the error stored', async () => {
    const id = await insertPendingJob(`${queuePrefix}-once`, 'test-retry-backoff', 3);

    const before = Date.now();
    expect(await asInternals(worker).processNextJob()).toBe(true);
    const row = await readJob(id);

    expect(String(row.status)).toBe('pending');
    expect(Number(row.attempts)).toBe(1); // incremented at claim time, not refunded on failure
    expect(row.locked_at).toBeNull();
    expect(row.locked_by).toBeNull();
    expect(String(row.error)).toBe(mocks.handlerErrorMessage);
    // Not immediately runnable again: the retry is pushed into the future.
    expect(new Date(row.run_at).getTime()).toBeGreaterThan(before);
  });

  it('grows the retry delay with each attempt for an ordinary job (30s per attempt)', async () => {
    const id = await insertPendingJob(`${queuePrefix}-linear`, 'test-retry-backoff', 4);
    const delays: number[] = [];

    for (let round = 0; round < 3; round++) {
      await makeRunnableNow(id);
      const before = Date.now();
      expect(await asInternals(worker).processNextJob()).toBe(true);
      const row = await readJob(id);
      expect(String(row.status)).toBe('pending');
      expect(Number(row.attempts)).toBe(round + 1);
      delays.push(delaySecondsOf(row, before));
    }

    // Strictly growing, and on the documented 30s-per-attempt shape (loose bounds: the delay is
    // measured against wall-clock, so a slow round shortens the observed value slightly).
    expect(delays[0]).toBeGreaterThan(25);
    expect(delays[0]).toBeLessThan(35);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
    expect(delays[1]).toBeLessThan(65);
    expect(delays[2]).toBeLessThan(95);
  });

  it('doubles the retry delay for a mail-shaped job, so it backs off faster than an ordinary job', async () => {
    const id = await insertPendingJob(`${queuePrefix}-mail`, 'send-transactional-email', 4);
    const delays: number[] = [];

    for (let round = 0; round < 3; round++) {
      await makeRunnableNow(id);
      const before = Date.now();
      expect(await asInternals(worker).processNextJob()).toBe(true);
      delays.push(delaySecondsOf(await readJob(id), before));
    }

    // 2^attempts * 30 => 60s, 120s, 240s.
    expect(delays[0]).toBeGreaterThan(55);
    expect(delays[0]).toBeLessThan(65);
    // Each delay is roughly double the previous one, and always more than the +30s linear step.
    expect(delays[1]).toBeGreaterThan(delays[0] * 1.8);
    expect(delays[2]).toBeGreaterThan(delays[1] * 1.8);
  });
});

describe('worker dead-lettering (attempts exhausted)', () => {
  const queuePrefix = `dead-letter-${Math.floor(Math.random() * 1_000_000)}`;
  const worker = new BackgroundJobWorker();

  afterEach(async () => {
    await db.deleteFrom('background_jobs').where('queue', 'like', `${queuePrefix}%`).execute();
  });

  const insertPendingJob = async (queue: string, maxAttempts: number): Promise<string> => {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: null,
        queue,
        status: 'pending',
        payload: JSON.stringify({ type: 'test-dead-letter' }),
        run_at: new Date(),
        attempts: 0,
        max_attempts: maxAttempts,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  it("marks the job 'failed' with the error stored and the lock cleared once max_attempts is reached", async () => {
    const id = await insertPendingJob(`${queuePrefix}-final`, 1);

    expect(await asInternals(worker).processNextJob()).toBe(true);

    const row = await readJob(id);
    expect(String(row.status)).toBe('failed');
    expect(Number(row.attempts)).toBe(1);
    expect(row.locked_at).toBeNull();
    expect(row.locked_by).toBeNull();
    // The dead-letter path prefixes the stored error with a short support reference (see below)
    // but the original handler error text is still present in full.
    expect(String(row.error)).toMatch(/^\[ref:[A-Z0-9]{8}\] /);
    expect(String(row.error)).toContain(mocks.handlerErrorMessage);
  });

  it('never hands a dead-lettered job to a claimer again, even though it is the oldest row', async () => {
    const deadId = await insertPendingJob(`${queuePrefix}-poison`, 1);
    // A younger row: after the poison job dies, FIFO (lowest id) would still prefer the poison row
    // if 'failed' were claimable, so claiming this one proves the dead row is out of the queue.
    const sentinelId = await insertPendingJob(`${queuePrefix}-sentinel`, 3);

    expect(await asInternals(worker).processNextJob()).toBe(true);
    expect(String((await readJob(deadId)).status)).toBe('failed');

    const claimed = await claimNextPendingJob(db, 'test-worker-after-dead-letter', 2);
    expect(String(claimed?.id)).toBe(sentinelId);

    // With the sentinel taken too, nothing of ours is claimable; the dead row must not come back.
    const again = await claimNextPendingJob(db, 'test-worker-after-dead-letter', 2);
    expect(again?.id == null || String(again.id) !== deadId).toBe(true);
    if (again && String(again.id) !== deadId) {
      // Defensive: a row we did not create (another spec file's) would otherwise be left locked.
      await db
        .updateTable('background_jobs')
        .set({ status: 'pending', locked_at: null, locked_by: null, attempts: Number(again.attempts) - 1 })
        .where('id', '=', again.id)
        .execute();
    }
  });
});

describe('dead-lettered newsletter send releases the newsletter from sending', () => {
  const queuePrefix = `dl-newsletter-${Math.floor(Math.random() * 1_000_000)}`;
  const worker = new BackgroundJobWorker();

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let newsletterId: string;

  const seed = async (newsletterStatus: string): Promise<void> => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    newsletterId = rand();

    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'Dead-letter Newsletter Tenant', subscription_plan: 'free' })
      .execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `dl-${userId}@example.com`,
        password: 'password',
        first_name: 'Dead',
        last_name: 'Letter',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('newsletters')
      .values({
        id: newsletterId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Weekly update',
        subject: 'Weekly update',
        status: newsletterStatus,
        send_offset: 250,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  };

  const insertSendJob = async (queue: string, maxAttempts: number): Promise<string> => {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue,
        status: 'pending',
        payload: JSON.stringify({ type: 'send-newsletter', newsletterId, tenantId }),
        run_at: new Date(),
        attempts: 0,
        max_attempts: maxAttempts,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  const newsletterStatus = async (): Promise<string> => {
    const row = await db
      .selectFrom('newsletters')
      .select(['status', 'send_offset'])
      .where('id', '=', newsletterId)
      .executeTakeFirstOrThrow();
    return String(row.status);
  };

  afterEach(async () => {
    await db.deleteFrom('background_jobs').where('queue', 'like', `${queuePrefix}%`).execute();
    await db.deleteFrom('newsletters').where('id', '=', newsletterId).execute();
    await db.deleteFrom('campaigns').where('id', '=', campaignId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it("moves a newsletter stuck in 'sending' to 'paused' when its send job is dead-lettered", async () => {
    await seed('sending');
    const jobId = await insertSendJob(`${queuePrefix}-sending`, 1);

    expect(await asInternals(worker).processNextJob()).toBe(true);

    expect(String((await readJob(jobId)).status)).toBe('failed');
    expect(await newsletterStatus()).toBe('paused');

    // The resume cursor survives, so resuming continues instead of re-emailing everyone.
    const row = await db
      .selectFrom('newsletters')
      .select('send_offset')
      .where('id', '=', newsletterId)
      .executeTakeFirstOrThrow();
    expect(Number(row.send_offset)).toBe(250);
  });

  it("also releases a newsletter stuck in 'queuing'", async () => {
    await seed('queuing');
    await insertSendJob(`${queuePrefix}-queuing`, 1);

    expect(await asInternals(worker).processNextJob()).toBe(true);

    expect(await newsletterStatus()).toBe('paused');
  });

  it("leaves a newsletter that is already 'sent' alone", async () => {
    await seed('sent');
    await insertSendJob(`${queuePrefix}-sent`, 1);

    expect(await asInternals(worker).processNextJob()).toBe(true);

    expect(await newsletterStatus()).toBe('sent');
  });

  it('does not pause the newsletter while the send job still has retries left', async () => {
    await seed('sending');
    const jobId = await insertSendJob(`${queuePrefix}-retrying`, 3);

    expect(await asInternals(worker).processNextJob()).toBe(true);

    // Still retryable, so the newsletter must stay in flight rather than being paused early.
    expect(String((await readJob(jobId)).status)).toBe('pending');
    expect(await newsletterStatus()).toBe('sending');
  });

  // The dead-letter path now stamps a short reference id as a `[ref:XXXXXXXX]` prefix on the
  // stored error, so a user who reports "my newsletter paused itself" carries an identifier that
  // can be matched to the 'Job exceeded maximum attempts' log line (same generation pattern as the
  // ms_sync/google_sync correlationId, but this one is also persisted on the job row).
  it('records a correlationId on the dead-lettered job row so support can find the log line', async () => {
    await seed('sending');
    const jobId = await insertSendJob(`${queuePrefix}-correlation`, 1);

    await asInternals(worker).processNextJob();

    const row = await readJob(jobId);
    expect(String(row.error)).toMatch(/^\[ref:[A-Z0-9]{8}\] /);
    expect(String(row.error)).toContain(mocks.handlerErrorMessage);
  });
});
