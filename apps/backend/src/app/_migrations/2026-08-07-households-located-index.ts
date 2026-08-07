import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Index the households a workspace has coordinates for, by where they are.
 *
 * The boundary drawing map now asks "which located households are inside this rectangle" every time
 * someone pans or zooms, and it asks it again for the density grid. Without an index that reaches
 * `lat`, every one of those reads is a full scan of the tenant's households. On a demo tenant that
 * is free; on a provincial candidate's workspace it is thirty-five thousand rows per pan.
 *
 * Partial on `lat`/`lng` being present, because a household without coordinates can never satisfy a
 * rectangle and only makes the index bigger. `lng` rides along as a second column so the same index
 * answers the longitude half without going back to the table.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_households_tenant_located
      ON public.households (tenant_id, lat, lng)
      WHERE lat IS NOT NULL AND lng IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_households_tenant_located`.execute(db);
}
