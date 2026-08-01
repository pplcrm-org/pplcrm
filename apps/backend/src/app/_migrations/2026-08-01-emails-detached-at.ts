import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Record that a synced message is no longer present in the mailbox folder upstream, WITHOUT
 * destroying it.
 *
 * Before this column the sync had only one way to react to a message leaving the folder it was
 * synced from: hard-delete the row and every child table. A folder-scoped Microsoft Graph delta
 * marks a message `@removed` when it LEAVES that folder — archived, moved, or filed by a rule —
 * not only when it is deleted, so ordinary mailbox housekeeping destroyed the CRM's copy along
 * with the internal comments the team wrote, the staff member it was assigned to, its open/closed
 * triage status and its favourite flag.
 *
 * `emails.deleted_at` could NOT be reused for this. That column means "the user moved this to the
 * CRM's own trash": it is written by the move-to-trash path and cleared by restore-from-trash, and
 * it always travels with `folder_id = Trash`. Setting it here would make a message the user
 * archived in Outlook appear in their CRM trash, which is a different and wrong claim.
 *
 * NULL = still present in the synced folder. Non-NULL = the provider stopped listing it there, at
 * that time. The row and every child row stay exactly as they were.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS detached_at timestamp with time zone`.execute(db);

  // The folder listing is the hot query (tenant + campaign + folder, newest first) and now carries
  // `detached_at IS NULL`. A partial index on the same key keeps it index-only for the common case
  // and stays smaller than idx_emails_inbox_sort, which it shadows for attached rows.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emails_inbox_sort_attached
      ON public.emails (tenant_id, campaign_id, folder_id, date_sent DESC, id DESC)
      WHERE detached_at IS NULL
  `.execute(db);

  // The nightly retention sweep scans for old detached rows across every tenant. Detached rows are
  // the small minority, so a partial index on just those makes that sweep cheap.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emails_detached_at
      ON public.emails (detached_at)
      WHERE detached_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_emails_detached_at`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_emails_inbox_sort_attached`.execute(db);
  await sql`ALTER TABLE public.emails DROP COLUMN IF EXISTS detached_at`.execute(db);
}
