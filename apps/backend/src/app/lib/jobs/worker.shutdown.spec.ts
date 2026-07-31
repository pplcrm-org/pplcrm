import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { BackgroundJobWorker } from './worker';

/**
 * Graceful shutdown of the background-job worker: stop() waits for in-flight jobs up to an
 * internal deadline (kept under shutdown.ts's 25s force-exit), and past that deadline it releases
 * the still-running rows back to 'pending' — run_at pushed 90s out (past the force-exit window,
 * so the zombie handler is dead before any re-claim) and the claim-time attempts increment
 * refunded (a deploy kill is not a real execution failure). A clean drain inside the deadline
 * must leave every row untouched by the release path.
 *
 * No useExclusiveDbLock here, deliberately: claimNextPendingJob is mocked (below), so this file
 * never claims from the shared queue, and the rows it commits are never claimable by concurrent
 * spec files — 'processing' rows aren't claimable, and the released row's run_at is 90s in the
 * future, which claimNextPendingJob's `run_at <= now` filter excludes.
 */

const mocks = vi.hoisted(() => ({
  // Rows the test hands to the mocked claimer; empty means "queue drained".
  claimQueue: [] as unknown[],
}));

vi.mock('./job-handlers', () => ({
  // A hung handler: never resolves, standing in for a long job still running at deploy time.
  executeJob: vi.fn(() => new Promise<never>(() => undefined)),
}));

vi.mock('./job-claim', () => ({
  // Hand out only rows this test explicitly queued, so the spec never claims (and later releases)
  // background_jobs rows that belong to other spec files sharing the one test database.
  claimNextPendingJob: vi.fn(() => Promise.resolve(mocks.claimQueue.shift() ?? null)),
}));

interface WorkerInternals {
  activeJobsCount: number;
  inFlightJobIds: Set<string>;
  isRunning: boolean;
  shutdownDrainDeadlineMs: number;
  shutdownResolver: (() => void) | null;
  processNextJob(): Promise<boolean>;
}
const asInternals = (w: BackgroundJobWorker): WorkerInternals => w as unknown as WorkerInternals;

describe('BackgroundJobWorker shutdown release', () => {
  const db = (BaseRepository as any)._db;
  const prefix = `shutdown-${Math.floor(Math.random() * 1_000_000)}`;

  afterEach(async () => {
    mocks.claimQueue.length = 0;
    await db.deleteFrom('background_jobs').where('queue', 'like', `${prefix}%`).execute();
  });

  const insertProcessingRow = async (queue: string): Promise<any> =>
    db
      .insertInto('background_jobs')
      .values({
        tenant_id: null,
        queue,
        status: 'processing',
        payload: JSON.stringify({ type: 'test-shutdown-release' }),
        run_at: new Date(),
        locked_at: new Date(),
        locked_by: 'test-worker',
        attempts: 2, // as left by claim: 1 prior try + this claim's increment
        max_attempts: 3,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

  it('releases a still-running job back to pending with the attempt refunded and run_at delayed', async () => {
    const inserted = await insertProcessingRow(`${prefix}-hung`);

    const worker = new BackgroundJobWorker();
    const w = asInternals(worker);
    w.isRunning = true;
    w.shutdownDrainDeadlineMs = 100; // don't wait the real 15s in a unit test

    // Drive one slot the way drain() would: the mocked claim returns our row, the mocked handler
    // hangs forever, so the job stays in flight.
    mocks.claimQueue.push(inserted);
    w.activeJobsCount = 1;
    void w.processNextJob();
    await vi.waitFor(() => expect(w.inFlightJobIds.has(String(inserted.id))).toBe(true), { timeout: 2000 });

    const before = Date.now();
    await worker.stop();

    const row = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('id', '=', inserted.id)
      .executeTakeFirstOrThrow();
    expect(String(row.status)).toBe('pending');
    expect(Number(row.attempts)).toBe(1); // 2 − 1: the deploy kill's claim was refunded
    expect(row.locked_at).toBeNull();
    expect(row.locked_by).toBeNull();
    // run_at pushed out by the 90s release delay — comfortably in the future, not an
    // immediately-runnable requeue.
    expect(new Date(row.run_at).getTime()).toBeGreaterThan(before + 60_000);
  });

  it('does not touch the job row when the drain completes inside the deadline', async () => {
    const inserted = await insertProcessingRow(`${prefix}-clean`);

    const worker = new BackgroundJobWorker();
    const w = asInternals(worker);
    w.isRunning = true;

    // Synthetic in-flight state, released the way processSlot's finally would release it.
    w.activeJobsCount = 1;
    w.inFlightJobIds.add(String(inserted.id));

    const stopPromise = worker.stop();
    // stop() assigns the resolver synchronously before its first await.
    expect(w.shutdownResolver).not.toBeNull();
    w.inFlightJobIds.delete(String(inserted.id));
    w.activeJobsCount = 0;
    w.shutdownResolver?.();
    await stopPromise;

    const row = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('id', '=', inserted.id)
      .executeTakeFirstOrThrow();
    // The clean-drain path must not release anything: the row keeps the state the (simulated)
    // still-finishing job left it in.
    expect(String(row.status)).toBe('processing');
    expect(Number(row.attempts)).toBe(2);
    expect(String(row.locked_by)).toBe('test-worker');
  });
});
