import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Canvassing-with-modes, phase 2 (the turfs-absorb-deliveries plan, pointer-column
 * design — operator decision 2026-09-06).
 *
 * `delivery_requests.turf_id` = the active delivery outing currently carrying this
 * request. A request is "out for delivery" iff the column is set; the cut claims
 * requests with `UPDATE … SET turf_id = $new WHERE turf_id IS NULL`, so two concurrent
 * cuts cannot take the same household — the same strength of guarantee the retired
 * pending-stop unique index gave the route era. Cleared when a delivery turf retires or
 * a request is declined/manually delivered while out; KEPT on delivered requests as
 * provenance (the pool query filters on open statuses, so a kept pointer is inert).
 *
 * FK ON DELETE SET NULL: a deleted turf must drop its requests back into the pool, not
 * block the delete or strand them. The partial index serves the two hot lookups — "this
 * turf's requests" (retire/refresh) and the pool's `turf_id IS NULL` scans' complement.
 *
 * `turfs.delivery_purpose` says what a delivery outing carries — 'yard_sign', 'flyer',
 * or 'both'. NULL on every non-delivery turf. Stored (not derived from the pointed
 * requests) so refresh-from-pool still knows what to pull after everything delivered.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.delivery_requests ADD COLUMN IF NOT EXISTS turf_id bigint`.execute(db);
  await sql`ALTER TABLE public.turfs ADD COLUMN IF NOT EXISTS delivery_purpose text`.execute(db);
  await sql`
    ALTER TABLE public.turfs ADD CONSTRAINT chk_turfs_delivery_purpose
      CHECK ((delivery_purpose IS NULL) OR (delivery_purpose = ANY (ARRAY['yard_sign'::text, 'flyer'::text, 'both'::text])))
  `.execute(db);
  await sql`
    ALTER TABLE public.delivery_requests ADD CONSTRAINT fk_delivery_requests_turf
      FOREIGN KEY (turf_id) REFERENCES public.turfs(id) ON DELETE SET NULL
  `.execute(db);
  await sql`
    CREATE INDEX idx_delivery_requests_turf
      ON public.delivery_requests USING btree (tenant_id, turf_id)
      WHERE (turf_id IS NOT NULL)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.turfs DROP CONSTRAINT IF EXISTS chk_turfs_delivery_purpose`.execute(db);
  await sql`ALTER TABLE public.turfs DROP COLUMN IF EXISTS delivery_purpose`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_delivery_requests_turf`.execute(db);
  await sql`ALTER TABLE public.delivery_requests DROP CONSTRAINT IF EXISTS fk_delivery_requests_turf`.execute(db);
  await sql`ALTER TABLE public.delivery_requests DROP COLUMN IF EXISTS turf_id`.execute(db);
}
