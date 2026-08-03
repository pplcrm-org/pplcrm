import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * An address-to-coordinates memo, so the same address is never paid for twice.
 *
 * The governing distinction is that matching an address to a boundary is free and geocoding is not.
 * Point-in-polygon matching is pure CPU with no external call, so it can be re-run whenever a map
 * changes. Turning an address into coordinates is billed per request by Google, so every one of
 * those requests has to be either avoided or metered.
 *
 * The metering already exists and is deliberately untouched by this migration:
 * `enqueueGeocodeJobs()` in apps/backend/src/app/lib/gis/geocode-queue.ts is the single choke point
 * for both the bulk import and the single-address edit. It applies the plan gate
 * (`planAllowsGeocoding`) and spreads each job's `run_at` across days at `GEOCODE_DAILY_BUDGET` per
 * tenant per day (apps/backend/src/env.ts, default 25,000). Spreading beats a counter that refuses
 * work, because nothing is ever lost — a very large import simply arrives over several days. Do not
 * duplicate that mechanism and do not add a competing counter table.
 *
 * WHAT THIS TABLE DEFENDS AGAINST: the repeat-import cost attack.
 * --------------------------------------------------------------
 * Today, importing 5,000 addresses, deleting the households, and importing the same file again pays
 * for 10,000 lookups covering 5,000 distinct addresses — and the loop can be repeated indefinitely.
 * The daily budget does not stop it; it only slows it down, and the second pass is pure waste
 * because the answers were already bought once.
 *
 * `geocode_cache` is keyed on the address fingerprint — the same normalised value the household row
 * carries in `households.address_fp_full` — and is DELIBERATELY NOT tied to a household by foreign
 * key or by anything else. It must SURVIVE HOUSEHOLD DELETION, because surviving deletion is the
 * entire defence. Deleting the household deletes the household; the memo of what that address
 * geocoded to remains, and the re-import costs nothing.
 *
 * `status` records 'zero_results' as well as 'success', and that is not an optimisation. Caching
 * only the successes leaves every unresolvable address — typos, fictional streets, deliberately
 * malformed rows — billable on every single pass, forever. A permanent negative answer is worth
 * exactly as much as a positive one.
 *
 * The cache is per tenant rather than shared. A global cache would be a cross-tenant read: learning
 * that some other workspace has already looked up a specific street address discloses that
 * workspace's data. One first lookup per tenant is the correct price for not making that trade.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.geocode_cache (
      id                bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id         bigint      NOT NULL,
      address_fp        text        NOT NULL,
      status            text        NOT NULL,
      lat               double precision,
      lng               double precision,
      formatted_address text,
      type              text,
      looked_up_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT geocode_cache_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT geocode_cache_id_key UNIQUE (id),
      CONSTRAINT uq_geocode_cache_address UNIQUE (tenant_id, address_fp),
      CONSTRAINT chk_geocode_cache_status CHECK (status IN ('success', 'zero_results'))
    )
  `.execute(db);

  // Ageing the cache out: coordinates bought years ago may deserve a re-check even though the
  // address text is unchanged. Also the only way to report how much of a tenant's cache is cold.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_geocode_cache_age
      ON public.geocode_cache (tenant_id, looked_up_at)
  `.execute(db);

  // Tenant isolation, same NULLIF-escape shape as every other table in this schema. This table is
  // written mainly by the background-job worker, which runs with no app.tenant_id GUC and is
  // permitted by the first branch — so the explicit .where('tenant_id', ...) on those queries is
  // the real lock and this policy is the backstop.
  await sql`ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.geocode_cache FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation ON public.geocode_cache`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation ON public.geocode_cache
      USING (
        NULLIF(current_setting('app.tenant_id', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
      )
      WITH CHECK (
        NULLIF(current_setting('app.tenant_id', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
      )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.geocode_cache`.execute(db);
}
