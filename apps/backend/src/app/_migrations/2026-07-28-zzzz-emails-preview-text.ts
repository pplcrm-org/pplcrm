import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Give `emails` a real snippet column, because the inbox has been rendering its dedupe key.
 *
 * `emails.preview` is NOT and never was a body snippet — it is the provider dedupe key
 * (`google:<id>` / `ms:<id>`). Every reconciliation path keys off it: the ingester's
 * duplicate check, the Message-ID adoption fallback, and the attachment materializer's
 * provider detection. But the inbox list template binds `{{ email.preview }}` as the grey
 * snippet line under the subject, and nothing ever mapped anything else into it — so every
 * synced message has been displaying `google:18f3a…` to the user.
 *
 * It went unnoticed because the demo seeder writes human snippet text into that same column,
 * so a fresh demo workspace looks perfect and only a connected mailbox shows the raw key.
 *
 * The fix is a separate column rather than a read-time join or a rename:
 * - Renaming `preview` would mean touching every dedupe path for a display concern, and any
 *   row written by an older build would silently stop matching.
 * - Joining `email_bodies.body_text` per row on a hot, indexed list query is the same
 *   unindexable-join trap the sort-indexes-hot-lists migration removed for `date_sent`.
 *
 * The backfill reuses `email_bodies.body_text` — the plain-text extract the ingester already
 * writes for search — so existing mail gets a correct snippet with no re-sync. Rows whose
 * body predates the extract (or was never stored) simply stay null, and the UI shows no
 * snippet, which is the honest result rather than a fabricated one.
 */
const SNIPPET_CHARS = 200;

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS preview_text text`.execute(db);

  // Collapse runs of whitespace so a snippet lifted from an HTML extract reads as one line.
  await sql`
    UPDATE public.emails e
       SET preview_text = left(regexp_replace(btrim(b.body_text), '\\s+', ' ', 'g'), ${sql.lit(SNIPPET_CHARS)})
      FROM public.email_bodies b
     WHERE b.email_id = e.id
       AND b.tenant_id = e.tenant_id
       AND e.preview_text IS NULL
       AND b.body_text IS NOT NULL
       AND btrim(b.body_text) <> ''
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.emails DROP COLUMN IF EXISTS preview_text`.execute(db);
}
