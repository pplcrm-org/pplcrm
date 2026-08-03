import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * A canvassing turf records which boundary it was cut against.
 *
 * The turf-cutting engine never lets one turf span two boundaries, because a boundary line in
 * practice follows a river, a rail line or an arterial road — the things a canvasser cannot walk
 * across. That reasoning is unchanged. What changes is where the boundary value comes from.
 *
 * `turfs.ward` held a free-text ward name copied from `households.ward`, which was filled from a
 * placeholder file containing three rectangles over downtown Chicago. In any real deployment every
 * household's ward was null, so every door landed in one bucket and the partition did nothing.
 *
 * The boundary now comes from `household_districts`, and which map is used differs per campaign: a
 * polling division for a Canadian federal riding, a precinct for a US legislative district, a ward
 * for a Toronto council race. So a turf has to record two things rather than one:
 *
 * `boundary_set_id`  Which map the turf was cut against. Needed when refreshing a turf's doors from
 *                    its smart list — new members are only added if they fall inside the SAME area
 *                    of the SAME map, and "the same area" is meaningless without knowing the map.
 *                    NULL means the workspace held no usable map when the turf was cut, so the
 *                    clustering was purely geographic. That is a real and supported state, not an
 *                    error: it is what every workspace with no boundary data gets, and the
 *                    user-facing surfaces label such a turf as unbounded rather than inventing a
 *                    boundary name for it.
 *
 * `boundary_name`    The name of the specific area — 'Ward 12', 'Poll 043'. Kept as text rather than
 *                    a reference to a `boundary_features` row so that deleting or redrawing a map
 *                    does not erase the record of what the turf was cut around.
 *
 * ON DELETE SET NULL on the set is deliberate for the same reason: deleting the map leaves the turf
 * intact and still named after the area it covers, and only the "which map" link goes away.
 *
 * `turfs.ward` is NOT dropped here. It stays, unread, until a separate cleanup change removes it,
 * so the code that writes the new columns and the code that stops reading the old one can be
 * reviewed apart.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.turfs
      ADD COLUMN IF NOT EXISTS boundary_set_id bigint,
      ADD COLUMN IF NOT EXISTS boundary_name   text
  `.execute(db);

  await sql`
    ALTER TABLE public.turfs DROP CONSTRAINT IF EXISTS fk_turfs_boundary_set
  `.execute(db);
  await sql`
    ALTER TABLE public.turfs
      ADD CONSTRAINT fk_turfs_boundary_set
      FOREIGN KEY (boundary_set_id) REFERENCES public.boundary_sets(id) ON DELETE SET NULL
  `.execute(db);

  // Existing turfs were cut against whatever `ward` held, so that value is exactly the area name the
  // new column means. Their `boundary_set_id` stays NULL because no boundary set existed to cut
  // them against — which is the truth about how they were made.
  await sql`
    UPDATE public.turfs SET boundary_name = ward WHERE boundary_name IS NULL AND ward IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.turfs DROP CONSTRAINT IF EXISTS fk_turfs_boundary_set`.execute(db);
  await sql`
    ALTER TABLE public.turfs
      DROP COLUMN IF EXISTS boundary_name,
      DROP COLUMN IF EXISTS boundary_set_id
  `.execute(db);
}
