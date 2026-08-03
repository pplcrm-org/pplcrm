import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Give a receipt to every gift recorded before receipts existed.
 *
 * A donation receipt is written by a background job enqueued in the same transaction as the gift.
 * That covers gifts recorded from now on and nothing before, so a workspace that has been running
 * for a while shows the donor "nothing sent" on rows that predate the feature — including every
 * demo workspace created before it, because demo data is seeded once at signup and never revisited.
 *
 * This enqueues one sweep per workspace that has at least one receiptable gift. The sweep stores
 * each PDF and sends NO email: a donor receiving a receipt for a gift from four months ago would be
 * worse than the gap it fills.
 *
 * Why a job rather than SQL here: a receipt needs the donor snapshot, the organization name with
 * its settings fallback, and a serial from the acknowledgement counter. Reproducing that in SQL
 * would be a second implementation of the same rules, free to drift from the first.
 *
 * Workspaces with no admin on file are skipped. Every receipt records who created it, there is no
 * sensible value to invent, and a workspace in that state has no one to look at the result.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    INSERT INTO public.background_jobs (tenant_id, queue, status, payload, run_at, max_attempts)
    SELECT DISTINCT
      d.tenant_id,
      'default',
      'pending',
      jsonb_build_object(
        'type', 'backfill-donation-acknowledgements',
        'tenant_id', d.tenant_id::text,
        'user_id', t.admin_id::text
      ),
      now(),
      3
    FROM public.donations d
    JOIN public.tenants t ON t.id = d.tenant_id
    WHERE d.status = 'succeeded'
      AND d.person_id IS NOT NULL
      AND t.admin_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Only the queued sweeps are removable. Receipts an already-run sweep created are ordinary
  // receipts and are left alone — the acknowledgement migration's own down() removes those.
  await sql`
    DELETE FROM public.background_jobs
      WHERE status = 'pending'
        AND payload->>'type' = 'backfill-donation-acknowledgements'
  `.execute(db);
}
