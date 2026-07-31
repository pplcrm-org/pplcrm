import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Data residency: record the answer each workspace gave at signup.
 *
 * Four values, not three. 'any' means "I have no requirement about where my data lives" and
 * is both the DEFAULT and the honest description of every workspace that existed before the
 * question was asked — none of them stated a preference, so none of them get one invented.
 * It is also why no separate backfill is needed.
 *
 * A CHECK constraint rather than free text, so an unrecognised value cannot reach the column
 * and quietly become a residency claim nobody honours. Keep it in step with
 * `DATA_REGION_CHOICES` in libs/common/src/lib/data-residency.ts.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.tenants
      ADD COLUMN IF NOT EXISTS data_region text NOT NULL DEFAULT 'any'
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenants_data_region_check'
      ) THEN
        ALTER TABLE public.tenants
          ADD CONSTRAINT tenants_data_region_check
          CHECK (data_region IN ('any', 'ca', 'us', 'eu'));
      END IF;
    END $$
  `.execute(db);

  // Supports the operational question this column exists to answer: who asked for a specific
  // region, so ops can find the ones waiting on a region that is not open yet and the ones who
  // must move when one opens. Partial, because workspaces with no preference are the
  // overwhelming majority and are never the subject of that query.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenants_data_region_stated
      ON public.tenants (data_region)
      WHERE data_region <> 'any'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_tenants_data_region_stated`.execute(db);
  await sql`ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_data_region_check`.execute(db);
  await sql`ALTER TABLE public.tenants DROP COLUMN IF EXISTS data_region`.execute(db);
}
