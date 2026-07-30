import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Two facts a canvasser can only learn at the door, and had nowhere to put.
 *
 * `deceased_at` and `senior` are first-class person columns rather than tags, for the same
 * reason `volunteer_status` and `staff_status` stopped being tags (§15): they are structured
 * facts the app itself reasons about — a deceased person must stop receiving mail, and a
 * seniors-only list has to be a rule, not a hand-curated tag membership.
 *
 * Both are NULLABLE on purpose and neither has a default. `senior = NULL` means "nobody has
 * said", which is not the same claim as `senior = false` ("we asked, they are under 65") —
 * a default of false would silently assert the second about every row in the table. The
 * partial indexes match the only queries anyone runs against them ("who is deceased", "who
 * is a senior"), so the common all-NULL case costs nothing.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.persons
      ADD COLUMN IF NOT EXISTS deceased_at timestamptz,
      ADD COLUMN IF NOT EXISTS senior      boolean
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_persons_deceased
        ON public.persons (tenant_id)
     WHERE deceased_at IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_persons_senior
        ON public.persons (tenant_id)
     WHERE senior IS TRUE
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_persons_senior`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_persons_deceased`.execute(db);
  await sql`
    ALTER TABLE public.persons
      DROP COLUMN IF EXISTS senior,
      DROP COLUMN IF EXISTS deceased_at
  `.execute(db);
}
