import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Deliveries §14 — enforce "one open delivery request per household" at the database.
 *
 * The create paths (web form + companion) check-then-insert with no uniqueness, so two
 * concurrent submissions for the same household both pass the pre-check and create two open
 * requests — the household then gets two stops on two routes. This adds the missing partial
 * UNIQUE index over the OPEN statuses ('new', 'approved'); 'declined'/'delivered' are terminal
 * and may legitimately repeat per household. A backend agent is separately making the insert
 * catch the resulting 23505.
 *
 * Before creating the index we de-duplicate existing open rows per (tenant_id, household_id).
 * The keeper is, in order of preference:
 *   1. a request already referenced by a delivery_route_stops row (i.e. "routed"), else
 *   2. the newest (highest id).
 * We delete ONLY non-routed duplicates. `fk_delivery_route_stops_request` is ON DELETE CASCADE,
 * so deleting a routed request would silently destroy an active route stop — we never do that.
 * In the pathological case of a household with two routed open requests, both survive the
 * dedupe and the CREATE UNIQUE INDEX below fails loudly, surfacing it for human review rather
 * than quietly deleting a routed stop.
 *
 * Runs with no app.tenant_id GUC set, so RLS permits every row (see pplcrm-migrations).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    WITH ranked AS (
      SELECT
        dr.id,
        (EXISTS (SELECT 1 FROM public.delivery_route_stops s WHERE s.request_id = dr.id)) AS is_routed,
        row_number() OVER (
          PARTITION BY dr.tenant_id, dr.household_id
          ORDER BY
            (EXISTS (SELECT 1 FROM public.delivery_route_stops s WHERE s.request_id = dr.id)) DESC,
            dr.id DESC
        ) AS rn
      FROM public.delivery_requests dr
      WHERE dr.status IN ('new', 'approved')
    )
    DELETE FROM public.delivery_requests d
    USING ranked
    WHERE d.id = ranked.id
      AND ranked.rn > 1
      AND ranked.is_routed = false
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_requests_open_per_household
      ON public.delivery_requests (tenant_id, household_id)
      WHERE status IN ('new', 'approved')
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.uq_delivery_requests_open_per_household`.execute(db);
}
