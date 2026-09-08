import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Turfs-absorb-deliveries Phase 4: the driving-route system retires. Delivery work goes
 * out as delivery-mode turfs, so every live route (draft / assigned / in_progress) is
 * converted into one drive delivery turf carrying the same doors in the same visit order:
 *
 *  - one turf per live route (mode 'delivery', travel 'drive', purpose 'yard_sign' — the
 *    only kind routes ever carried), named after the route, status 'draft';
 *  - the route's pending stops become the turf's doors, seq order preserved as walk_order;
 *  - each pending stop's open request is claimed by the new turf (the stored
 *    out-for-delivery pointer), unless another turf already claimed it;
 *  - the pending stops are then marked 'skipped' and the route 'canceled' — the same
 *    states route cancellation always produced, so history reads consistently.
 *
 * Volunteers are NOT re-attached automatically: turf links are personal and assigning one
 * sends a message, which a migration must not do. Staff assign the converted turfs from
 * the Canvassing page, which sends each volunteer their new link.
 *
 * The delivery_routes / delivery_route_stops tables stay: terminal rows are history the
 * dashboard's "signs delivered" number still reads.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE
      r RECORD;
      new_turf_id bigint;
    BEGIN
      FOR r IN
        SELECT * FROM public.delivery_routes
        WHERE status IN ('draft', 'assigned', 'in_progress')
        ORDER BY id
      LOOP
        INSERT INTO public.turfs
          (tenant_id, campaign_id, name, status, mode, travel, delivery_purpose,
           createdby_id, updatedby_id)
        VALUES
          (r.tenant_id, r.campaign_id, r.name, 'draft', 'delivery', 'drive', 'yard_sign',
           r.createdby_id, r.updatedby_id)
        RETURNING id INTO new_turf_id;

        INSERT INTO public.turf_households
          (tenant_id, turf_id, household_id, walk_order, createdby_id, updatedby_id)
        SELECT s.tenant_id, new_turf_id, dr.household_id,
               ROW_NUMBER() OVER (ORDER BY s.seq),
               r.createdby_id, r.updatedby_id
        FROM public.delivery_route_stops s
        JOIN public.delivery_requests dr
          ON dr.id = s.request_id AND dr.tenant_id = s.tenant_id
        WHERE s.route_id = r.id AND s.tenant_id = r.tenant_id AND s.status = 'pending'
        ON CONFLICT DO NOTHING;

        UPDATE public.delivery_requests dr
        SET turf_id = new_turf_id
        FROM public.delivery_route_stops s
        WHERE s.request_id = dr.id AND s.tenant_id = dr.tenant_id
          AND s.route_id = r.id AND s.status = 'pending'
          AND dr.status IN ('new', 'approved') AND dr.turf_id IS NULL;

        UPDATE public.delivery_route_stops
        SET status = 'skipped', reason = 'Other'
        WHERE route_id = r.id AND tenant_id = r.tenant_id AND status = 'pending';

        UPDATE public.delivery_routes
        SET status = 'canceled'
        WHERE id = r.id AND tenant_id = r.tenant_id;
      END LOOP;
    END $$;
  `.execute(db);
}

export async function down(): Promise<void> {
  // Irreversible by design: the conversion collapses route state into turf state and the
  // originals are canceled, not deleted. Rolling back the code does not need the routes
  // to come back to life — the tables and their rows are untouched history.
}
