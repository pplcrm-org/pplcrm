import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * A convergence marker for the nightly boundary sweep, plus two missing indexes.
 *
 * `households.boundary_checked_at` — when a boundary match pass last examined this household.
 * ------------------------------------------------------------------------------------------
 * The nightly sweep's job is to catch households the event-driven paths missed. It used to define
 * "missed" as "holds no `household_districts` row for any target layer", and that definition can
 * never converge: a household whose coordinates genuinely fall outside every polygon — a rural
 * address beside a city ward map is the ordinary case — gains no row from being matched, so the
 * sweep re-selected it and re-ran the same point-in-polygon tests every night, forever, for every
 * such household in every workspace. The work is free per pass, but it grows with the number of
 * households instead of with the number of changes.
 *
 * The marker makes "checked and found in nothing" distinguishable from "never checked": every
 * household a match pass processes is stamped, matched or not, and the sweep selects only the
 * households whose stamp is NULL or older than the newest `updated_at` among the layers being
 * matched. A workspace whose maps have not changed therefore sweeps down to zero, and editing a map
 * bumps that map's `updated_at`, which makes every stamp older than it and re-checks everything —
 * exactly the two behaviours wanted. NULL (not a backfill) is correct for existing rows: they have
 * never been examined under this scheme, and their first sweep pass stamps them.
 *
 * `households (tenant_id, id)` — the index the match pass's keyset pagination assumed.
 * ------------------------------------------------------------------------------------
 * Every match and validation pass pages households with `tenant_id = X AND id > cursor ORDER BY
 * id`. The primary key is `(id, tenant_id)` — id first — so that shape had no supporting index and
 * each page was a scan. One composite index serves every page of every pass.
 *
 * `turfs (boundary_set_id)` — the index backing an ON DELETE SET NULL foreign key.
 * --------------------------------------------------------------------------------
 * `fk_turfs_boundary_set` (2026-08-02-d) nulls `turfs.boundary_set_id` when a boundary set is
 * deleted. Postgres does not create an index for the referencing side of a foreign key, so every
 * boundary-set delete scanned all of `turfs` to find the rows to null.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.households ADD COLUMN IF NOT EXISTS boundary_checked_at timestamptz
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_households_tenant_keyset
      ON public.households (tenant_id, id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_turfs_boundary_set
      ON public.turfs (boundary_set_id)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_turfs_boundary_set`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_households_tenant_keyset`.execute(db);
  await sql`ALTER TABLE public.households DROP COLUMN IF EXISTS boundary_checked_at`.execute(db);
}
