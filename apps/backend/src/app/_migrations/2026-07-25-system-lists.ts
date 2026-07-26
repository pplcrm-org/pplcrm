import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Built-in ("system") lists — §8. Every campaign context gets an
 * "All Subscribers" and an "All Volunteers" smart list that the product owns:
 * always present, never deletable, and not part of the demo dataset (so they
 * survive exiting demo mode).
 *
 * The marker is a nullable `system_key` rather than a `deletable` boolean like
 * `tags` has, because the key also identifies *which* built-in a row is — that
 * is what makes re-seeding idempotent. `deletable` is derived from it at the
 * read boundary (lists.repo emits `deletable: system_key === null`, which the
 * datagrid's generic non-deletable guard already understands).
 *
 * Schema only: the rows themselves are seeded by `ensureSystemLists()`
 * (modules/lists/system-lists.ts) — at signup for new tenants, and lazily on
 * the first Lists read for existing ones. Keeping the row contents out of the
 * migration means the definitions can evolve without rewriting history.
 */

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS system_key text`.execute(db);

  await sql`ALTER TABLE public.lists DROP CONSTRAINT IF EXISTS chk_lists_system_key`.execute(db);
  await sql`
    ALTER TABLE public.lists
      ADD CONSTRAINT chk_lists_system_key
      CHECK ((system_key IS NULL) OR (system_key = ANY (ARRAY['all_subscribers'::text, 'all_volunteers'::text])))
  `.execute(db);

  // One of each built-in per campaign context. Partial, so ordinary lists (NULL
  // key) are unaffected — this is what makes the seeder's ON CONFLICT DO NOTHING
  // safe to call on every Lists read.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_lists_system_key
      ON public.lists (tenant_id, campaign_id, system_key)
      WHERE system_key IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.uq_lists_system_key`.execute(db);
  await sql`ALTER TABLE public.lists DROP CONSTRAINT IF EXISTS chk_lists_system_key`.execute(db);
  await sql`ALTER TABLE public.lists DROP COLUMN IF EXISTS system_key`.execute(db);
}
