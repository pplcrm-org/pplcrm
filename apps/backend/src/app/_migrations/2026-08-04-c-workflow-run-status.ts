import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Allow an automation step's run row to say "queued, not yet delivered".
 *
 * An automation `send_email` step writes one `workflow_runs` row and then queues a background job
 * that hands the message to SendGrid. The row was written as `success` at queue time, before
 * anything had been sent, and nothing ever corrected it — so a message the delivery job dropped
 * (the workspace was paused or suspended in the meantime, or the recipient unsubscribed between
 * queueing and delivery) or that failed every retry still showed as a successful run in the
 * automations screens. The same rows are what the "only send if they opened/did not open the
 * previous email" step condition reads, so a dropped message counted as one that was sent.
 *
 * `pending` gives the row an honest state between queueing and delivery. The delivery handler
 * moves it to `success` when SendGrid accepts the message, `skipped` when it deliberately drops
 * the send, and `failed` when the send throws.
 *
 * `down()` collapses any still-queued rows to `failed` first, because the narrower constraint
 * cannot accept them.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.workflow_runs DROP CONSTRAINT IF EXISTS chk_workflow_runs_status`.execute(db);
  await sql`
    ALTER TABLE public.workflow_runs
      ADD CONSTRAINT chk_workflow_runs_status
      CHECK (status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text, 'skipped'::text]))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE public.workflow_runs
       SET status = 'failed',
           error = coalesce(error, 'Delivery state unknown.')
     WHERE status = 'pending'
  `.execute(db);
  await sql`ALTER TABLE public.workflow_runs DROP CONSTRAINT IF EXISTS chk_workflow_runs_status`.execute(db);
  await sql`
    ALTER TABLE public.workflow_runs
      ADD CONSTRAINT chk_workflow_runs_status
      CHECK (status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text]))
  `.execute(db);
}
