import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Give the companion idempotency ledger somewhere to keep what an op RETURNED.
 *
 * `companion_ops` recorded only that an op id had been applied. That is enough to
 * answer "did this happen?" but not "what did it produce?", and one op type produces
 * something the phone cannot work without: `person_create` returns the real id of the
 * person added at the door, which every survey recorded against that person then needs.
 *
 * When the response to the first send was lost (a dropped mobile connection — the exact
 * situation the offline queue exists for), the re-send conflicted on the ledger and the
 * device got a bare `duplicate` ack with no id, so the queued survey kept pointing at a
 * client-side `tmp-…` placeholder that nothing could ever resolve, and the whole queue
 * stopped draining.
 *
 * Deliberately a generic `result` jsonb rather than a `result_person_id` column: the
 * acknowledgement is already a small open record (`{op_id, status, error?, person_id?}`),
 * and the next op type that has to hand something back — a created household, a task id —
 * should be a change to the shared Zod shape, not another ALTER TABLE against a hot
 * write-once ledger. Nullable with no default: most ops return nothing, and `NULL` says
 * that without asserting an empty object was stored.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.companion_ops ADD COLUMN IF NOT EXISTS result jsonb`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.companion_ops DROP COLUMN IF EXISTS result`.execute(db);
}
