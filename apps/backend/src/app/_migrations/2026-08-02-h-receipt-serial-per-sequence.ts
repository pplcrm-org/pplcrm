import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Receipt serial uniqueness is PER SEQUENCE, not per table.
 *
 * `uq_donation_receipts_serial` was `(tenant_id, year, serial) WHERE serial IS NOT NULL`, which was
 * correct while a single `receipt_counters` row fed every numbered document. Acknowledgements draw
 * on their own counter — deliberately, so the official tax-receipt run stays gap-free for an
 * auditor — so a workspace's first acknowledgement of the year and its first tax receipt of the
 * year are both serial 1, and the old index rejected the second one.
 *
 * Two partial unique indexes replace it, one per sequence. Each still guarantees no duplicate
 * serial inside its own numbering, and neither can collide with the other.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_donation_receipts_serial`.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_official_serial
      ON public.donation_receipts (tenant_id, year, serial)
      WHERE serial IS NOT NULL AND kind IN ('per_gift', 'cumulative')
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_ack_serial
      ON public.donation_receipts (tenant_id, year, serial)
      WHERE serial IS NOT NULL AND kind = 'acknowledgement'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_donation_receipts_ack_serial`.execute(db);
  await sql`DROP INDEX IF EXISTS uq_donation_receipts_official_serial`.execute(db);
  // Restoring the single index only succeeds once the acknowledgements whose serials collide with
  // official ones are gone — the acknowledgement migration's own down() removes them.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_serial
      ON public.donation_receipts (tenant_id, year, serial)
      WHERE serial IS NOT NULL
  `.execute(db);
}
