import type { ControlledTransaction } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll } from 'vitest';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../base.repo';

/**
 * Advisory-lock keys, one per shared resource that specs must not contend over. Keep them unique
 * and stable -- two unrelated spec files sharing a key would serialize for no reason.
 */
export const DB_TEST_LOCKS = {
  /**
   * The `background_jobs` table as a whole queue.
   *
   * Only for specs that touch the queue globally: one that asserts which row `claimNextPendingJob`
   * picks out of the whole table, or one that runs a sweep selecting rows by age. Four files
   * qualify today: job-claim.spec.ts, worker.retry-backoff.spec.ts, worker.reliability.spec.ts,
   * and job-handlers.spec.ts, whose prune_retention sweep DELETEs by age across the whole table.
   *
   * A spec that merely LEAVES a `pending` row behind does NOT need this, and should not take it —
   * that would serialize roughly thirty files for nothing. The claim order is
   * `priority DESC, id ASC`, so the three files above insert their own rows in a priority band
   * (1000 and up) well above anything production enqueues, which is what keeps another file's
   * leftover row from being picked ahead of theirs.
   *
   * The exception is a sweep selected by age rather than order: a priority band cannot exclude
   * rows from an age filter. If a spec ever commits a `background_jobs` row whose `locked_at` is
   * more than 30 minutes old, or a pending/processing `data_exports` row older than an hour, it
   * must take this lock so worker.reliability.spec.ts's recovery sweep cannot fail its rows.
   *
   * A whole-table sweep is also on the receiving end of the hazard, not just the causing end: its
   * statement blocks on any row a concurrent claimer holds in an open transaction. That is how
   * job-handlers.spec.ts's prune_retention test hit the 5s timeout before it took this lock.
   */
  BACKGROUND_JOB_QUEUE: 81_400_001,
  /** The `receipt_counters` table: counter-concurrency specs commit real transactions and read
   *  the counter globally, so they must not interleave with another file doing the same. */
  RECEIPT_COUNTERS: 81_400_002,
} as const;

/** A spec file may sit behind a contended lock for as long as the other holder's whole run takes. */
const LOCK_WAIT_TIMEOUT_MS = 120_000;

/**
 * Serializes this spec file against every other file holding the same key.
 *
 * Backend specs run against one shared local Postgres, and Vitest runs spec *files* in parallel.
 * `useTestTransaction()` handles the common case -- rows a test writes stay invisible to everyone
 * else. It cannot help when the code under test reads the table *globally*: `claimNextPendingJob`
 * picks the lowest-id runnable row in the whole table, so a `pending` row another spec file
 * committed mid-run is a real, claimable job and breaks a FIFO assertion (and gets stolen out from
 * under that other file). No amount of per-test cleanup fixes it -- the window is the overlap
 * between two files, not between two tests.
 *
 * So the contending files take turns instead. The lock is held by a transaction opened in
 * `beforeAll` and rolled back in `afterAll`: Kysely's `startTransaction()` pins one pooled
 * connection for its lifetime, which is what makes the lock outlive a single query, and
 * `pg_advisory_xact_lock` releases automatically when that transaction ends -- including when the
 * process is killed mid-run, so a crashed file can't wedge the next one.
 *
 * Usage -- call once at the top level of the file, outside any `describe`:
 * ```ts
 * useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);
 * ```
 */
export function useExclusiveDbLock(key: number): void {
  let holder: ControlledTransaction<Models> | undefined;

  beforeAll(async () => {
    holder = await BaseRepository.dbInstance.startTransaction().execute();
    await sql`select pg_advisory_xact_lock(${key}::bigint)`.execute(holder);
  }, LOCK_WAIT_TIMEOUT_MS);

  afterAll(async () => {
    if (holder && !holder.isCommitted && !holder.isRolledBack) {
      await holder.rollback().execute();
    }
    holder = undefined;
  });
}
