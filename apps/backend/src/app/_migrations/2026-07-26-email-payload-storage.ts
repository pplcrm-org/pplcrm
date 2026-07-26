import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Email payload storage: move the bulk out of Postgres, stop hoarding attachment bytes.
 *
 * Two changes, both driven by the same problem — a synced mailbox used to pour its entire
 * history into Postgres and blob storage whether or not anyone ever looked at it.
 *
 * 1. Bodies. `body_html` is ~90% markup, styles and tracking junk. It moves to blob storage
 *    (`storage_key`), and Postgres keeps only a plain-text extract (`body_text`) — a fraction of
 *    the bytes and, unlike HTML, actually searchable. `body_html` stays nullable so very small
 *    bodies can remain inline (no blob round-trip for a two-line reply) and so existing rows keep
 *    working untouched: the read path prefers `body_html` and falls back to `storage_key`.
 *
 * 2. Attachments. `remote_ref` holds the provider's attachment identifier so a row can describe an
 *    attachment we have NOT downloaded. `file_id` (already nullable) stays null until someone
 *    actually opens it, at which point the payload is fetched, deduped and stored.
 *
 * The GIN index is on the extracted text, so a future inbox search is an indexed full-text lookup
 * rather than an unindexable ILIKE over markup. Nothing queries it yet; it exists so search can be
 * added later without a backfill.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.email_bodies ALTER COLUMN body_html DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE public.email_bodies ADD COLUMN IF NOT EXISTS storage_key text`.execute(db);
  await sql`ALTER TABLE public.email_bodies ADD COLUMN IF NOT EXISTS body_text text`.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_bodies_text_search
      ON public.email_bodies
      USING gin (to_tsvector('english', coalesce(body_text, '')))
  `.execute(db);

  await sql`ALTER TABLE public.email_attachments ADD COLUMN IF NOT EXISTS remote_ref text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.email_attachments DROP COLUMN IF EXISTS remote_ref`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_email_bodies_text_search`.execute(db);
  await sql`ALTER TABLE public.email_bodies DROP COLUMN IF EXISTS body_text`.execute(db);
  await sql`ALTER TABLE public.email_bodies DROP COLUMN IF EXISTS storage_key`.execute(db);
  // body_html is intentionally left nullable: rows written after `up` may have no inline HTML,
  // so restoring NOT NULL would fail. Reverting the storage split is a data migration, not a DDL one.
}
