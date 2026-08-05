import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Crash-resume cursor for CSV imports: how many data rows of the import's row source have been
 * durably consumed (committed as inserts/merges, or counted as skips/errors). Written in the same
 * per-chunk update that records the running counters, so a worker crash at any point re-enters at
 * the last committed chunk instead of re-importing from row zero. 0 = fresh import (no resume).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.data_imports
      ADD COLUMN IF NOT EXISTS processed_row_offset bigint NOT NULL DEFAULT 0
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.data_imports DROP COLUMN IF EXISTS processed_row_offset`.execute(db);
}
