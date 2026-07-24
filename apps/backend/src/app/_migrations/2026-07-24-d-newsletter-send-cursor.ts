import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Newsletters §: keyset pagination for the batch send.
 *
 * The batch worker paged recipients with `ORDER BY email OFFSET n` over a LIVE set — recipients
 * that unsubscribe/suppress mid-send shift the window left (a recipient is silently skipped) and
 * new confirmed sign-ups sorting before the cursor shift it right (an already-sent recipient is
 * emailed twice). This adds a `send_cursor` column holding the last email address successfully
 * sent, so the worker can resume with `WHERE email > send_cursor` — a monotonic walk that neither
 * skips nor repeats when the underlying set changes between batches.
 *
 * Runs with no app.tenant_id GUC set, so RLS permits every row (see pplcrm-migrations).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.newsletters ADD COLUMN IF NOT EXISTS send_cursor text`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.newsletters DROP COLUMN IF EXISTS send_cursor`.execute(db);
}
