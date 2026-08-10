import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Delete-path indexes for the boundary tables, plus one for the nightly background_jobs prune
 * (REVIEW6 T2-6 and T2-7).
 *
 * The boundary tables were created after 2026-08-04-a-fk-ri-indexes swept the schema, so they
 * missed its rule: every FK column referenced by an ON DELETE action needs a leading index, or the
 * referential check sequential-scans the child table once per deleted parent row — inside the
 * user's request. The trigger here is routine: deleting or re-uploading one boundary set cascades
 * into `boundary_features` and `household_districts` (up to one row per household per map) and
 * SET-NULLs into `campaign_areas`; deleting an uploaded file SET-NULLs into `boundary_sets`.
 * The existing indexes on these tables all lead with tenant_id, household_id, or campaign_id, so
 * none serves the FK check. Same `_ri` naming as the 2026-08-04 migration.
 *
 * `idx_background_jobs_terminal_updated` serves the retention prune's two scans (completed rows
 * past 7 days, failed rows past 30 days). The table's three existing indexes are all partial on
 * pending/processing or led by tenant_id, so the nightly prune — on the busiest table in the
 * schema — was a full scan.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_household_districts_set_ri
      ON public.household_districts (set_id)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_boundary_features_set_ri
      ON public.boundary_features (set_id)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_boundary_sets_file_ri
      ON public.boundary_sets (file_id)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaign_areas_set_ri
      ON public.campaign_areas (set_id)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_background_jobs_terminal_updated
      ON public.background_jobs (status, updated_at)
      WHERE status IN ('completed', 'failed')
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_household_districts_set_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_boundary_features_set_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_boundary_sets_file_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_campaign_areas_set_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_background_jobs_terminal_updated`.execute(db);
}
