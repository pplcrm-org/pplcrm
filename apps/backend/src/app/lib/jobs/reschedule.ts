import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type { JobType } from './job-payloads';

const MINUTE_MS = 60 * 1000;
export const FIVE_MINUTES_MS = 5 * MINUTE_MS;
export const TEN_MINUTES_MS = 10 * MINUTE_MS;
export const DAY_MS = 24 * 60 * MINUTE_MS;

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Re-queues a parameterless periodic job to run again after `delayMs`.
 * Used by the self-rescheduling cron-style jobs (cleanup, dedupe, sync scheduling, …).
 *
 * Dedup guard: a self-rescheduling handler calls this at the end of its own run, and if it
 * crashes after this insert but before the worker marks it 'completed', the stale-recovery
 * requeues it and it re-runs — inserting a second next-run each time, so the cron would
 * multiply without bound. Only enqueue when no PENDING run of this type already exists (the
 * currently-'processing' job — this one — is intentionally NOT counted, or it would block its
 * own chain).
 *
 * A plain `SELECT ... FOR UPDATE` can't serialize this: when there is no pending row yet, it locks
 * nothing, so two concurrent schedulers of the same type both see "none" and both insert, forking
 * the chain. We take a transaction-scoped advisory lock keyed by the job type first — that
 * serializes on the type itself (not on a row), so the second scheduler blocks until the first
 * commits and then correctly sees the row it inserted.
 */
export async function scheduleNextRun(db: Kysely<Models>, type: JobType, delayMs: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${type}))`.execute(trx);

    const existing = await trx
      .selectFrom('background_jobs')
      .select('id')
      .where('status', '=', 'pending')
      .where(sql`payload->>'type'`, '=', type)
      .executeTakeFirst();
    if (existing) return; // a future run of this cron job is already queued — don't stack another

    await trx
      .insertInto('background_jobs')
      .values({
        tenant_id: null,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({ type }),
        run_at: new Date(Date.now() + delayMs),
        max_attempts: DEFAULT_MAX_ATTEMPTS,
      })
      .execute();
  });
}
