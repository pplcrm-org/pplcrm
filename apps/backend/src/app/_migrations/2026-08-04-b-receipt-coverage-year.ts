import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * `donation_receipts.year` meant two different things, and the year-end batch believed the wrong one.
 *
 * For a numbered document (acknowledgement, per-gift receipt, cumulative receipt) `year` is the
 * NUMBERING year: the receipt draws its serial from the `receipt_counters` row for the year it is
 * ISSUED in, and `uq_donation_receipts_official_serial` / `uq_donation_receipts_ack_serial` place
 * that serial inside the issue year's sequence. That is correct and this migration does not touch it
 * — gap-free serials are the whole reason the counter exists.
 *
 * For a statement, `year` is the year the summary COVERS, written straight from the batch's year
 * argument.
 *
 * The two meanings diverge exactly when a year-end batch for gift year 2025 runs in 2026, which is
 * when every year-end batch runs:
 *
 *   - the cumulative tax receipt is stored with year = 2026 (its serial's year),
 *   - the giving summary for the same donor-year is stored with year = 2025.
 *
 * Both of the batch's "have we already done this donor" tests compared `year` to the GIFT year, so
 * the cumulative receipt was invisible to them:
 *
 *   - `listStatementDonors` (receipts.repo.ts) excluded a donor only on a matching year=2025 row, so
 *     a rerun re-listed every donor who already held a 2025 tax receipt. Their gifts were all
 *     covered, so the cumulative insert raised ConflictError, the code fell through to the summary
 *     path, and the donor was mailed a redundant giving summary.
 *   - `emailPendingStatements` (receipts.handlers.ts) looked for un-emailed year=2025 documents, so a
 *     cumulative receipt whose email the hourly send cap had blocked was never picked up again — an
 *     official tax receipt stored and silently never sent.
 *
 * `coverage_year` separates the two: the calendar year of the gifts a document covers, on every
 * kind. The counter, the serial and the two serial-uniqueness indexes stay on the issue year; the
 * batch's idempotency and its email-catch-up move to the coverage year.
 *
 * NULLABLE on purpose. The demo seeder (modules/demo/demo-seed.ts) writes receipt rows directly and
 * does not set the column, so every read is `coalesce(coverage_year, year)` — which is the right
 * answer for those rows anyway, since the seeder stamps `year` with the gift's year. The backfill
 * below leaves no NULL behind on existing data.
 *
 * BACKFILL choice, per kind:
 *   - statement          → coverage_year = year. `year` has always been the covered year here.
 *   - acknowledgement,
 *     per_gift,
 *     cumulative         → the year of the gifts the receipt covers, taken from
 *                          `donation_receipt_items.gift_date` (frozen at issue time, already a
 *                          Toronto-calendar date). A receipt only ever covers gifts from one
 *                          calendar year — `getUnreceiptedSucceededDonations` is year-scoped and a
 *                          per-gift/acknowledgement receipt covers a single gift — so max() over the
 *                          items is that year.
 *   - anything with no items (none should exist) → the receipt's own `gift_date`, else `year`. This
 *     is a last resort that reproduces the old, wrong-for-cumulative behavior rather than leaving a
 *     NULL that reads as "unknown".
 *
 * UNIQUE-INDEX decision: `uq_donation_receipts_statement` was `(tenant_id, person_id, year) WHERE
 * kind = 'statement' AND status = 'issued'` — the schema comment calls it the batch's idempotency
 * key on rerun, and `generateStatementForDonor` relies on the 23505 it raises to make a replayed
 * generation a no-op. The invariant it is meant to enforce is one live summary per donor per COVERED
 * year, so it moves onto the coverage year. It is equivalent today (a statement's coverage_year is
 * written equal to its year) but it stops being a coincidence: if statements are ever stamped with an
 * issue year, an index on `year` would quietly permit two summaries for one covered year. It is
 * created over `coalesce(coverage_year, year)` so a row that never set the column (the demo seeder)
 * is still deduplicated rather than treated as distinct-because-NULL.
 *
 * The serial indexes are deliberately NOT touched: a serial belongs to the year whose counter issued
 * it, and moving them to the coverage year would break gap-free numbering.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.donation_receipts
      ADD COLUMN IF NOT EXISTS coverage_year integer
  `.execute(db);

  // Statements: `year` is already the covered year.
  await sql`
    UPDATE public.donation_receipts
       SET coverage_year = year
     WHERE kind = 'statement'
       AND coverage_year IS NULL
  `.execute(db);

  // Every other kind: the year of the gifts on the receipt.
  await sql`
    UPDATE public.donation_receipts dr
       SET coverage_year = covered.gift_year
      FROM (
        SELECT dri.tenant_id,
               dri.receipt_id,
               max(extract(year FROM dri.gift_date))::int AS gift_year
          FROM public.donation_receipt_items dri
         GROUP BY dri.tenant_id, dri.receipt_id
      ) AS covered
     WHERE covered.receipt_id = dr.id
       AND covered.tenant_id = dr.tenant_id
       AND dr.coverage_year IS NULL
  `.execute(db);

  // Last resort for a receipt with no items at all.
  await sql`
    UPDATE public.donation_receipts
       SET coverage_year = coalesce(extract(year FROM gift_date)::int, year)
     WHERE coverage_year IS NULL
  `.execute(db);

  // One LIVE statement per donor per COVERED year (was: per numbering year).
  await sql`DROP INDEX IF EXISTS uq_donation_receipts_statement`.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_statement_coverage
      ON public.donation_receipts (tenant_id, person_id, (coalesce(coverage_year, year)))
      WHERE kind = 'statement' AND status = 'issued'
  `.execute(db);

  // The year-end batch's two coverage-year lookups: "which donors still need a document" and
  // "which documents are generated but not emailed".
  await sql`
    CREATE INDEX IF NOT EXISTS idx_donation_receipts_year_end
      ON public.donation_receipts (tenant_id, (coalesce(coverage_year, year)))
      WHERE kind IN ('statement', 'cumulative') AND status = 'issued'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_donation_receipts_year_end`.execute(db);
  await sql`DROP INDEX IF EXISTS uq_donation_receipts_statement_coverage`.execute(db);
  // Safe to restore: a statement's coverage_year is always written equal to its year, so no pair of
  // live statements can collide on (tenant_id, person_id, year) that did not already collide above.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_donation_receipts_statement
      ON public.donation_receipts (tenant_id, person_id, year)
      WHERE kind = 'statement' AND status = 'issued'
  `.execute(db);
  await sql`
    ALTER TABLE public.donation_receipts
      DROP COLUMN IF EXISTS coverage_year
  `.execute(db);
}
