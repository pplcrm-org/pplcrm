import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Claim-order priority for background jobs.
 *
 * The worker claims ready jobs in id order (global FIFO). A large CSV import's segment fans out
 * thousands of geocode/workflow-trigger jobs before it enqueues its own `import_csv` continuation
 * job, so the continuation — the job the user is actually watching on the History page — queued
 * behind ~10,000 of its predecessor's fan-out jobs (~15 minutes of dead time per segment at
 * 25,000 rows). `run_at` cannot break the tie: the fan-out and the continuation are all enqueued
 * "now".
 *
 * `priority` (higher first, default 0, then id ASC as before) lets the import continuation jump
 * its own fan-out. Only import continuations enqueue above 0; every other job keeps FIFO. The
 * per-tenant in-flight cap in claimNextPendingJob is untouched, so a prioritized job still cannot
 * take more of the pool for its tenant.
 *
 * The old claim index (run_at, id) WHERE pending existed solely for the claim query, whose order
 * is now (priority DESC, id); replace it with a matching one.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.background_jobs ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0 NOT NULL`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS idx_background_jobs_claim`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_background_jobs_claim
      ON public.background_jobs (priority DESC, id)
      WHERE status = 'pending'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_background_jobs_claim`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_background_jobs_claim
      ON public.background_jobs (run_at, id)
      WHERE status = 'pending'
  `.execute(db);
  await sql`ALTER TABLE public.background_jobs DROP COLUMN IF EXISTS priority`.execute(db);
}
