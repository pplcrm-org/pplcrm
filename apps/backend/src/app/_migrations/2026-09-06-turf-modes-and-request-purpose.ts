import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Canvassing-with-modes, phase 0 (the turfs-absorb-deliveries plan).
 *
 * - `turfs.mode`: what the outing is for — 'canvass' (every-door persuasion), 'gotv'
 *   (remind supporters to vote), 'delivery' (signs/flyers cut from the request pool).
 *   Every existing turf really is a persuasion canvass, so the DEFAULT backfills correctly.
 * - `turfs.travel`: how the volunteer moves — 'walk' (street-grouped list) or 'drive'
 *   (ordered route view). Existing turfs are all walked.
 * - `delivery_requests.purpose`: what the household is owed — 'yard_sign' | 'flyer'.
 *   Every existing request is a yard-sign request. (GOTV is deliberately NOT a request
 *   purpose — it is a turf mode; nobody "requests" a reminder.)
 * - The open-per-household unique index becomes per (household, purpose): one open task
 *   OF EACH KIND per household, still tenant-wide across campaigns. Strictly weaker than
 *   the old index, so existing data cannot violate it. The matching code change renames
 *   OPEN_HOUSEHOLD_UNIQUE_INDEX in modules/deliveries/controller.ts in the same commit.
 * - `campaigns.gotv_script` / `campaigns.delivery_script`: per-mode door scripts for the
 *   companion; NULL falls back to `canvass_script`.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.turfs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'canvass'`.execute(db);
  await sql`
    ALTER TABLE public.turfs ADD CONSTRAINT chk_turfs_mode
      CHECK ((mode = ANY (ARRAY['canvass'::text, 'gotv'::text, 'delivery'::text])))
  `.execute(db);
  await sql`ALTER TABLE public.turfs ADD COLUMN IF NOT EXISTS travel text NOT NULL DEFAULT 'walk'`.execute(db);
  await sql`
    ALTER TABLE public.turfs ADD CONSTRAINT chk_turfs_travel
      CHECK ((travel = ANY (ARRAY['walk'::text, 'drive'::text])))
  `.execute(db);

  await sql`
    ALTER TABLE public.delivery_requests ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'yard_sign'
  `.execute(db);
  await sql`
    ALTER TABLE public.delivery_requests ADD CONSTRAINT chk_delivery_requests_purpose
      CHECK ((purpose = ANY (ARRAY['yard_sign'::text, 'flyer'::text])))
  `.execute(db);

  await sql`DROP INDEX IF EXISTS public.uq_delivery_requests_open_per_household`.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_delivery_requests_open_per_household_purpose
      ON public.delivery_requests USING btree (tenant_id, household_id, purpose)
      WHERE (status = ANY (ARRAY['new'::text, 'approved'::text]))
  `.execute(db);

  await sql`ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS gotv_script text`.execute(db);
  await sql`ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS delivery_script text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.campaigns DROP COLUMN IF EXISTS delivery_script`.execute(db);
  await sql`ALTER TABLE public.campaigns DROP COLUMN IF EXISTS gotv_script`.execute(db);

  await sql`DROP INDEX IF EXISTS public.uq_delivery_requests_open_per_household_purpose`.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_delivery_requests_open_per_household
      ON public.delivery_requests USING btree (tenant_id, household_id)
      WHERE (status = ANY (ARRAY['new'::text, 'approved'::text]))
  `.execute(db);

  await sql`ALTER TABLE public.delivery_requests DROP CONSTRAINT IF EXISTS chk_delivery_requests_purpose`.execute(db);
  await sql`ALTER TABLE public.delivery_requests DROP COLUMN IF EXISTS purpose`.execute(db);

  await sql`ALTER TABLE public.turfs DROP CONSTRAINT IF EXISTS chk_turfs_travel`.execute(db);
  await sql`ALTER TABLE public.turfs DROP COLUMN IF EXISTS travel`.execute(db);
  await sql`ALTER TABLE public.turfs DROP CONSTRAINT IF EXISTS chk_turfs_mode`.execute(db);
  await sql`ALTER TABLE public.turfs DROP COLUMN IF EXISTS mode`.execute(db);
}
