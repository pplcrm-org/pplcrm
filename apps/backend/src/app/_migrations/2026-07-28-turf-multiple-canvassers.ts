import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Let several volunteers walk one turf at the same time.
 *
 * A turf used to hold exactly one active assignment: assigning a second volunteer
 * revoked the first, so a group canvassing one turf together was impossible. That
 * rule lived only in application code (`assignTurf` called `revokeForTurf`), never
 * in the schema.
 *
 * Replacing it with the constraint that is actually true: one LIVE link per
 * volunteer per turf, any number of volunteers per turf. Enforcing it in the
 * database rather than in a read-then-write check is what makes a self-claim race
 * impossible instead of merely unlikely — two concurrent requests for the same
 * volunteer and turf cannot both win.
 *
 * Partial (WHERE status = 'active') so the revoked rows kept for history never
 * collide: a volunteer can be re-issued a link on the same turf many times.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Collapse any duplicates already in the table before the index goes on, keeping
  // the newest active row per (turf, volunteer). Nothing should match today, but a
  // migration that assumes clean data fails on the one database that is not.
  await sql`
    UPDATE public.turf_assignments AS ta
       SET status = 'revoked', updated_at = now()
     WHERE ta.status = 'active'
       AND ta.volunteer_person_id IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.turf_assignments AS newer
          WHERE newer.tenant_id = ta.tenant_id
            AND newer.turf_id = ta.turf_id
            AND newer.volunteer_person_id = ta.volunteer_person_id
            AND newer.status = 'active'
            AND newer.id > ta.id
       )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_turf_assignments_active_volunteer
      ON public.turf_assignments (tenant_id, turf_id, volunteer_person_id)
      WHERE status = 'active' AND volunteer_person_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Dropping the index cannot restore single-occupancy: turfs may legitimately hold
  // several active assignments by now, and picking which volunteers to evict is not
  // a decision a migration should make.
  await sql`DROP INDEX IF EXISTS public.uq_turf_assignments_active_volunteer`.execute(db);
}
