import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Indexes for the three retention deletions added on 2026-08-09 (REVIEW7 B3).
 *
 * `handlePruneRetention` deletes from `workflow_runs`, `notifications` and `companion_ops` by
 * `created_at` alone, with no tenant predicate — and every existing index on those tables leads
 * with `tenant_id` (or, for companion_ops, is only the primary key). So each 5,000-row batch of
 * the nightly prune was a full sequential scan, repeated until the table was clean — on the same
 * Burstable B1ms the 2026-08-09 migration added `idx_background_jobs_terminal_updated` to
 * protect from exactly this access pattern.
 *
 * Plain b-tree on `created_at` is enough: the prune's WHERE is `created_at < cutoff` (plus, for
 * workflow_runs, a NOT EXISTS probe that runs per candidate row against the enrollments PK).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS idx_workflow_runs_created_prune ON public.workflow_runs (created_at)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_created_prune ON public.notifications (created_at)`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_companion_ops_created_prune ON public.companion_ops (created_at)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_workflow_runs_created_prune`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_notifications_created_prune`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_companion_ops_created_prune`.execute(db);
}
