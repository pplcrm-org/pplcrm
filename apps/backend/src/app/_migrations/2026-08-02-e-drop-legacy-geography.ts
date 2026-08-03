import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Removes the four free-text electoral-geography columns that nothing reads any more.
 *
 * `households.district`, `households.precinct` and `households.ward` held one area name each, so an
 * address could record exactly three answers. A single address is normally inside more than three
 * boundaries at once — a congressional district AND two legislative districts AND a council district
 * AND a precinct — so each geocoding pass overwrote whatever the previous one had found.
 * `2026-08-02-b-boundary-sets.ts` replaced them with `household_districts`, one row per household
 * per map, and left the three columns in place so that the code writing the new table and the code
 * reading the old columns could be changed in separate reviewable steps.
 *
 * `turfs.ward` held the free-text area name a turf was cut around.
 * `2026-08-02-d-turf-boundaries.ts` replaced it with `turfs.boundary_set_id` (which map) plus
 * `turfs.boundary_name` (which area of that map), copying every existing `ward` value into
 * `boundary_name`, and likewise left the old column alone.
 *
 * Both of those steps are now finished: every read and every write in the repository goes through
 * `household_districts` and the two `turfs.boundary_*` columns. This migration is the cleanup that
 * those two migrations' comments said would follow.
 *
 * WHAT `down()` CAN AND CANNOT RESTORE
 * ------------------------------------
 * Re-adding a dropped column cannot bring back the values that were in it, so `down()` is honest
 * about the two cases rather than pretending to be a full inverse:
 *
 * - `turfs.ward` IS restored, from `turfs.boundary_name`. That is exact rather than approximate:
 *   migration `d` set `boundary_name` from `ward` for every row that had one, so copying it back is
 *   returning the same string to where it came from.
 * - The three `households` columns come back EMPTY. Their data lives in `household_districts`, which
 *   can hold several areas per household, and there is no correct rule for choosing which one of
 *   them belongs in a column named `ward` — that ambiguity is the whole defect the new table fixed.
 *   Inventing a pick here would silently reintroduce it, so the columns are recreated as NULL and
 *   any caller rolling back is expected to keep reading `household_districts`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.households
      DROP COLUMN IF EXISTS district,
      DROP COLUMN IF EXISTS precinct,
      DROP COLUMN IF EXISTS ward
  `.execute(db);

  await sql`ALTER TABLE public.turfs DROP COLUMN IF EXISTS ward`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.households
      ADD COLUMN IF NOT EXISTS district text,
      ADD COLUMN IF NOT EXISTS precinct text,
      ADD COLUMN IF NOT EXISTS ward     text
  `.execute(db);

  await sql`ALTER TABLE public.turfs ADD COLUMN IF NOT EXISTS ward text`.execute(db);
  await sql`
    UPDATE public.turfs SET ward = boundary_name WHERE ward IS NULL AND boundary_name IS NOT NULL
  `.execute(db);
}
