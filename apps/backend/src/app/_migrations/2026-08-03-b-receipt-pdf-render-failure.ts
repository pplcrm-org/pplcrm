import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Record on the receipt itself that its PDF could not be produced.
 *
 * A receipt's PDF is rendered and stored by a background job. Until that job succeeds the row has
 * no `file_id`, and the screens read a missing `file_id` as "still being generated" — which is true
 * for a few seconds and false forever after the job runs out of attempts. Storage being unreachable
 * is enough to put every receipt in a workspace in that state, and nothing in the product said so:
 * the download button sat disabled with the tooltip "PDF is being generated" indefinitely.
 *
 * Two columns hold what the screens need to tell the two situations apart, and the worker's
 * permanent-failure path fills them in.
 *
 *   pdf_failed_at — when the render job gave up. NULL means it has not (yet) failed.
 *   pdf_error     — the last error, truncated, so an admin can see it is (for example) a storage
 *                   outage rather than something about the receipt itself.
 *
 * Both are cleared when a PDF is finally stored, so a successful retry leaves no stale marker.
 *
 * The backfill at the end stamps receipts whose render job already dead-lettered before these
 * columns existed. Without it those receipts stay indistinguishable from pending ones — the exact
 * problem this migration exists to fix — and the retry button never appears for them.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.donation_receipts
      ADD COLUMN IF NOT EXISTS pdf_failed_at timestamp with time zone,
      ADD COLUMN IF NOT EXISTS pdf_error text
  `.execute(db);

  // Receipts with no stored PDF whose render job is already dead-lettered.
  await sql`
    UPDATE public.donation_receipts dr
       SET pdf_failed_at = j.updated_at,
           pdf_error = left(coalesce(j.error, 'The PDF could not be generated.'), 500)
      FROM public.background_jobs j
     WHERE j.status = 'failed'
       AND j.payload->>'type' = 'render-receipt-pdf'
       AND j.payload->>'receipt_id' = dr.id::text
       AND j.tenant_id = dr.tenant_id
       AND dr.file_id IS NULL
       AND dr.pdf_failed_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.donation_receipts
      DROP COLUMN IF EXISTS pdf_error,
      DROP COLUMN IF EXISTS pdf_failed_at
  `.execute(db);
}
