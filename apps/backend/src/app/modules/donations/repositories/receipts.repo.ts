import { OFFICIAL_RECEIPT_KINDS } from '@common';
import { sql, type Insertable, type RawBuilder, type Selectable, type Transaction } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';

/**
 * The calendar year a document COVERS, as SQL.
 *
 * `donation_receipts.year` is the numbering year — the `receipt_counters` year the serial came
 * from, i.e. the year the document was issued. `coverage_year` is the year of the gifts it covers.
 * They differ whenever a year-end batch for last year's gifts runs in the new year, which is every
 * year-end batch, so "documents for tax year N" must be asked of the coverage year.
 *
 * The fallback to `year` covers rows written before the column existed and rows written by code
 * that does not set it (the demo seeder), where `year` is the gift year anyway.
 */
export function coverageYearRef(alias = 'donation_receipts'): RawBuilder<number> {
  return sql<number>`coalesce(${sql.ref(`${alias}.coverage_year`)}, ${sql.ref(`${alias}.year`)})`;
}

/**
 * Which `receipt_counters` sequence a number comes from. Per-gift and cumulative TAX receipts share
 * the 'official' sequence, because an auditor reconciling a year expects one unbroken run of
 * serials. Acknowledgements are numbered too — support needs something to quote back — but from
 * their own sequence, so issuing one can never advance or interleave with the official run.
 */
export type ReceiptCounterKind = 'official' | 'acknowledgement';

/** Mutable copy for query builders: `OFFICIAL_RECEIPT_KINDS` is a readonly tuple. */
const OFFICIAL_KINDS: string[] = [...OFFICIAL_RECEIPT_KINDS];

/** Fields the issue flow inserts (id/serial defaults come from the caller building the row). */
export type NewReceiptRow = Insertable<Models['donation_receipts']>;
export type ReceiptRow = Selectable<Models['donation_receipts']>;

export interface ReceiptItemInput {
  donation_id: string;
  amount_cents: number;
  /** YYYY-MM-DD — the date the gift was received. */
  gift_date: string;
}

export class ReceiptsRepo extends BaseRepository<'donation_receipts'> {
  constructor() {
    super('donation_receipts');
  }

  /**
   * Take the next gap-free serial for (tenant, year, counter kind). MUST run inside the same
   * transaction as the receipt insert: a rollback returns the number, and concurrent issuers
   * serialize on the counter row lock. `INSERT … ON CONFLICT DO UPDATE` is the one statement that
   * atomically handles insert-if-absent — plain FOR UPDATE locks nothing when the row does not
   * exist yet (see lib/jobs/reschedule.ts for the worked explanation).
   */
  public async nextSerial(
    trx: Transaction<Models>,
    tenantId: string,
    year: number,
    counterKind: ReceiptCounterKind = 'official',
  ): Promise<number> {
    const result = await sql<{ n: number }>`
      INSERT INTO receipt_counters (tenant_id, year, kind, n)
      VALUES (${tenantId}, ${year}, ${counterKind}, 1)
      ON CONFLICT (tenant_id, year, kind)
      DO UPDATE SET n = receipt_counters.n + 1
      RETURNING n
    `.execute(trx);
    const n = result.rows[0]?.n;
    if (!n) throw new Error('receipt counter returned no value');
    return Number(n);
  }

  /** Insert a receipt plus its covered gifts in one shot (caller supplies the open transaction). */
  public async insertReceiptWithItems(
    trx: Transaction<Models>,
    receipt: NewReceiptRow,
    items: ReceiptItemInput[],
  ): Promise<ReceiptRow> {
    const inserted = await trx.insertInto('donation_receipts').values(receipt).returningAll().executeTakeFirstOrThrow();
    if (items.length > 0) {
      await trx
        .insertInto('donation_receipt_items')
        .values(
          items.map((item) => ({
            tenant_id: receipt.tenant_id,
            receipt_id: inserted.id,
            donation_id: item.donation_id,
            amount_cents: item.amount_cents,
            gift_date: item.gift_date,
          })),
        )
        .execute();
    }
    return inserted;
  }

  /** Official TAX receipts covering a donation, live ones first. Acknowledgements are not these. */
  public async getOfficialReceiptsForDonation(
    tenantId: string,
    donationId: string,
    trx?: Transaction<Models>,
  ): Promise<ReceiptRow[]> {
    return (trx ?? this.db)
      .selectFrom('donation_receipt_items as dri')
      .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
      .selectAll('dr')
      .where('dri.tenant_id', '=', tenantId)
      .where('dr.tenant_id', '=', tenantId)
      .where('dri.donation_id', '=', donationId)
      .where('dr.kind', 'in', OFFICIAL_KINDS)
      .orderBy(sql`CASE WHEN dr.status = 'issued' THEN 0 ELSE 1 END`)
      .orderBy('dr.issued_at', 'desc')
      .execute();
  }

  /** The live acknowledgement covering a donation, if one exists (the idempotency check). */
  public async getLiveAcknowledgementForDonation(
    tenantId: string,
    donationId: string,
    trx?: Transaction<Models>,
  ): Promise<ReceiptRow | undefined> {
    return (trx ?? this.db)
      .selectFrom('donation_receipt_items as dri')
      .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
      .selectAll('dr')
      .where('dri.tenant_id', '=', tenantId)
      .where('dr.tenant_id', '=', tenantId)
      .where('dri.donation_id', '=', donationId)
      .where('dr.kind', '=', 'acknowledgement')
      .where('dr.status', '=', 'issued')
      .executeTakeFirst();
  }

  /**
   * EVERY live document covering a donation — acknowledgement, tax receipt and statement alike.
   * The refund hook's input: a reversed gift must not leave any of them standing.
   */
  public async getLiveReceiptsForDonation(
    tenantId: string,
    donationId: string,
    trx?: Transaction<Models>,
  ): Promise<ReceiptRow[]> {
    return (trx ?? this.db)
      .selectFrom('donation_receipt_items as dri')
      .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
      .selectAll('dr')
      .where('dri.tenant_id', '=', tenantId)
      .where('dr.tenant_id', '=', tenantId)
      .where('dri.donation_id', '=', donationId)
      .where('dr.status', '=', 'issued')
      .execute();
  }

  public async getReceiptById(tenantId: string, receiptId: string): Promise<ReceiptRow | undefined> {
    return this.getSelect()
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .executeTakeFirst();
  }

  /** Items (covered gifts) for one receipt, oldest gift first — the PDF's line-item table. */
  public async getItems(tenantId: string, receiptId: string): Promise<Selectable<Models['donation_receipt_items']>[]> {
    return this.db
      .selectFrom('donation_receipt_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('receipt_id', '=', receiptId)
      .orderBy('gift_date', 'asc')
      .execute();
  }

  /**
   * Post-issue setters. Issued receipts are immutable by rule — these narrow updates
   * (PDF file, render-failure marker, emailed stamp, cancel fields, reissue flag) are the ONLY
   * writes this repo exposes, so nothing can quietly rewrite an issued receipt's contents.
   */
  public async setFile(tenantId: string, receiptId: string, fileId: string): Promise<void> {
    await this.db
      .updateTable('donation_receipts')
      // Storing the PDF clears any earlier failure: a retry that worked must not leave the row
      // looking broken, and the screens treat pdf_failed_at as authoritative.
      .set({ file_id: fileId, pdf_failed_at: null, pdf_error: null, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .execute();
  }

  /**
   * Record that the render job gave up. Called from the worker's permanent-failure path only —
   * an intermediate attempt failing is not interesting, because the job will try again.
   *
   * The `file_id IS NULL` guard matters: a job can also fail after the PDF was stored (the email
   * step), and marking those rows would tell an admin the document is missing when it is not.
   */
  public async markRenderFailed(tenantId: string, receiptId: string, error: string): Promise<void> {
    await this.db
      .updateTable('donation_receipts')
      .set({ pdf_failed_at: new Date(), pdf_error: error.slice(0, 500), updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .where('file_id', 'is', null)
      .execute();
  }

  /** Drop the failure marker when a fresh render job is queued, so the row reads "generating". */
  public async clearRenderFailure(tenantId: string, receiptId: string, trx?: Transaction<Models>): Promise<void> {
    await (trx ?? this.db)
      .updateTable('donation_receipts')
      .set({ pdf_failed_at: null, pdf_error: null, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .execute();
  }

  public async markEmailed(tenantId: string, receiptId: string): Promise<void> {
    await this.db
      .updateTable('donation_receipts')
      .set({ emailed_at: new Date(), updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .execute();
  }

  public async cancelReceipt(
    tenantId: string,
    receiptId: string,
    userId: string,
    reason: string,
    options?: { reissueRequired?: boolean; trx?: Transaction<Models> },
  ): Promise<void> {
    await (options?.trx ?? this.db)
      .updateTable('donation_receipts')
      .set({
        status: 'cancelled',
        cancelled_reason: reason,
        cancelled_at: new Date(),
        cancelled_by: userId,
        reissue_required: options?.reissueRequired ?? false,
        updated_at: new Date(),
        updatedby_id: userId,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .where('status', '=', 'issued')
      .execute();
  }

  public async clearReissueRequired(trx: Transaction<Models>, tenantId: string, receiptId: string): Promise<void> {
    await trx
      .updateTable('donation_receipts')
      .set({ reissue_required: false, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', receiptId)
      .execute();
  }

  /**
   * Succeeded gifts for a person-year not yet covered by a live official TAX receipt — what an
   * annual cumulative receipt gathers. Runs inside the issue transaction (after the counter
   * lock serialized concurrent issuers) so two racing cumulative issues cannot double-cover.
   *
   * The kind filter must name the tax kinds explicitly. Every gift carries an acknowledgement, so
   * a `kind != 'statement'` test here would report every gift as already receipted and the annual
   * receipt would cover nothing.
   */
  public async getUnreceiptedSucceededDonations(
    tenantId: string,
    personId: string,
    year: number,
    trx?: Transaction<Models>,
  ): Promise<Selectable<Models['donations']>[]> {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
    return (trx ?? this.db)
      .selectFrom('donations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .where('status', '=', 'succeeded')
      .where('created_at', '>=', startOfYear)
      .where('created_at', '<=', endOfYear)
      .where(({ eb, not, exists }) =>
        not(
          exists(
            eb
              .selectFrom('donation_receipt_items as dri')
              .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
              .select('dri.id')
              .whereRef('dri.donation_id', '=', 'donations.id')
              .whereRef('dri.tenant_id', '=', 'donations.tenant_id')
              .where('dr.status', '=', 'issued')
              .where('dr.kind', 'in', OFFICIAL_KINDS),
          ),
        ),
      )
      .orderBy('created_at', 'asc')
      .execute();
  }

  /**
   * Succeeded gifts that carry no live acknowledgement — the backfill's work list.
   *
   * Every gift recorded since acknowledgements existed already has one, so on a healthy workspace
   * this returns nothing and the backfill finishes in one pass. It exists for the gifts recorded
   * before, which would otherwise never be acknowledged: the document is written by a job enqueued
   * at the moment a gift is recorded, and nothing revisits older rows.
   *
   * Ascending id keyset rather than OFFSET, so a gift arriving mid-run cannot push another past a
   * page boundary unseen.
   */
  public async listUnacknowledgedDonations(
    tenantId: string,
    afterDonationId: string | null,
    limit: number,
  ): Promise<{ id: string }[]> {
    let query = this.db
      .selectFrom('donations')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'succeeded')
      .where('person_id', 'is not', null)
      .where(({ eb, not, exists }) =>
        not(
          exists(
            eb
              .selectFrom('donation_receipt_items as dri')
              .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
              .select('dri.id')
              .whereRef('dri.donation_id', '=', 'donations.id')
              .whereRef('dri.tenant_id', '=', 'donations.tenant_id')
              .where('dr.kind', '=', 'acknowledgement')
              .where('dr.status', '=', 'issued'),
          ),
        ),
      );
    if (afterDonationId) query = query.where('id', '>', afterDonationId);
    return query.orderBy('id', 'asc').limit(limit).execute();
  }

  /** The receipts/statements list with donor names, filterable; newest first. */
  public async listReceipts(
    tenantId: string,
    filters: {
      donationId?: string;
      personId?: string;
      year?: number;
      status?: string;
      kinds?: readonly string[];
      needsAttention?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    let query = this.db
      .selectFrom('donation_receipts')
      .selectAll('donation_receipts')
      .where('donation_receipts.tenant_id', '=', tenantId);

    if (filters.donationId) {
      query = query.where(({ eb, exists }) =>
        exists(
          eb
            .selectFrom('donation_receipt_items as dri')
            .select('dri.id')
            .whereRef('dri.receipt_id', '=', 'donation_receipts.id')
            .whereRef('dri.tenant_id', '=', 'donation_receipts.tenant_id')
            .where('dri.donation_id', '=', String(filters.donationId)),
        ),
      );
    }
    if (filters.personId) query = query.where('person_id', '=', filters.personId);
    // Coverage year, not numbering year: someone filtering the ledger by 2025 wants the documents
    // for 2025's gifts, including the cumulative receipts the 2026 batch issued for them.
    if (filters.year) query = query.where(coverageYearRef(), '=', filters.year);
    if (filters.status) query = query.where('status', '=', filters.status);
    if (filters.kinds?.length) query = query.where('kind', 'in', [...filters.kinds]);
    if (filters.needsAttention) query = query.where('reissue_required', '=', true);

    return query
      .orderBy('issued_at', 'desc')
      .limit(Math.min(filters.limit ?? 50, 200))
      .offset(filters.offset ?? 0)
      .execute();
  }

  /**
   * Year-end batch: the next donors (ascending person_id keyset — never OFFSET, so donors
   * appearing/disappearing mid-run cannot skip a boundary) with ≥1 succeeded gift in the year and
   * no live year-end document yet.
   *
   * "Year-end document" means a statement OR a cumulative tax receipt, because the run now issues
   * whichever of the two a donor qualifies for. Excluding only statements would hand a donor who
   * already holds a tax receipt a redundant summary on every rerun.
   *
   * The match is on the COVERAGE year. A cumulative receipt for 2025 gifts carries year = 2026 (the
   * year its serial was issued in), so comparing `dr.year` to the gift year missed it entirely and
   * a rerun mailed every tax-receipt donor a redundant summary — every one of their gifts was
   * already covered, so the cumulative insert failed and the code fell through to the summary path.
   */
  public async listStatementDonors(
    tenantId: string,
    year: number,
    afterPersonId: string | null,
    limit: number,
  ): Promise<{ person_id: string }[]> {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
    let query = this.db
      .selectFrom('donations')
      .select('person_id')
      .distinct()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'succeeded')
      .where('person_id', 'is not', null)
      .where('created_at', '>=', startOfYear)
      .where('created_at', '<=', endOfYear)
      .where(({ eb, not, exists }) =>
        not(
          exists(
            eb
              .selectFrom('donation_receipts as dr')
              .select('dr.id')
              .whereRef('dr.tenant_id', '=', 'donations.tenant_id')
              .whereRef('dr.person_id', '=', 'donations.person_id')
              .where('dr.kind', 'in', ['statement', 'cumulative'])
              .where('dr.status', '=', 'issued')
              .where(coverageYearRef('dr'), '=', year),
          ),
        ),
      );
    if (afterPersonId) query = query.where('person_id', '>', afterPersonId);
    return query.orderBy('person_id', 'asc').limit(limit).execute() as Promise<{ person_id: string }[]>;
  }

  /** How many donors gave (succeeded) in a year — the run's donors_total denominator. */
  public async countStatementDonors(tenantId: string, year: number): Promise<number> {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
    const result = await this.db
      .selectFrom('donations')
      .select(({ fn }) => [fn.count<string | number>(sql`DISTINCT person_id`).as('total')])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'succeeded')
      .where('person_id', 'is not', null)
      .where('created_at', '>=', startOfYear)
      .where('created_at', '<=', endOfYear)
      .executeTakeFirst();
    return Number(result?.total ?? 0);
  }

  /** A person's succeeded gifts inside a calendar year, oldest first — statement line items. */
  public async getSucceededDonationsForPersonYear(
    tenantId: string,
    personId: string,
    year: number,
  ): Promise<Selectable<Models['donations']>[]> {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
    return this.db
      .selectFrom('donations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .where('status', '=', 'succeeded')
      .where('created_at', '>=', startOfYear)
      .where('created_at', '<=', endOfYear)
      .orderBy('created_at', 'asc')
      .execute();
  }
}
