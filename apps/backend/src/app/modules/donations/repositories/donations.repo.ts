import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { GridColumnFilter } from '../../../../../../../libs/common/src';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { AnyQB, JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';

/**
 * What document covers a gift, derived from donation_receipt_items ⋈ donation_receipts. Year-end
 * summaries never count — they are not per-gift documents.
 *
 * The four states, in the order they win when several documents cover one gift:
 *
 * - `receipted` — a live official TAX receipt. The strongest thing a gift can have.
 * - `cancelled` — only cancelled tax receipts cover it, so it needs attention or a reissue.
 * - `acknowledged` — the plain acknowledgement every gift gets, and no tax receipt.
 * - `none` — nothing at all. After acknowledgements this should be rare: it means the gift was
 *   recorded before this feature existed, or its acknowledgement job has not run yet.
 */
export interface DonationReceiptState {
  receipt_status: 'receipted' | 'cancelled' | 'acknowledged' | 'none';
  receipt_id: string | null;
  receipt_number: string | null;
}

/** Strongest-first, so a later row only overwrites an earlier one when it outranks it. */
const RECEIPT_STATE_RANK: Record<DonationReceiptState['receipt_status'], number> = {
  receipted: 3,
  cancelled: 2,
  acknowledged: 1,
  none: 0,
};

/** Donor identity as the ledger shows it: the live person record when the gift is still linked,
 * else the snapshot recorded on the donation row. Plain SQL strings because the advanced-filter
 * builder interpolates them via sql.raw() — server-side constants only, never client input (S-8). */
const DONOR_NAME_SQL = `TRIM(COALESCE(persons.first_name, donations.first_name, '') || ' ' || COALESCE(persons.last_name, donations.last_name, ''))`;
const DONOR_EMAIL_SQL = `COALESCE(persons.email, donations.email, '')`;

/** Allow-list mapping the grid's filterable fields (column chips, "+ Add filter", the query
 * builder) to real SQL. A field missing here is silently unfiltered rather than an error —
 * same contract as every other grid. `created_at::text` makes "date contains 2026-07" work. */
const DONATION_FILTER_COLUMNS: Record<string, { col: string; isCast?: boolean }> = {
  donor_name: { col: DONOR_NAME_SQL, isCast: true },
  person_email: { col: DONOR_EMAIL_SQL, isCast: true },
  method: { col: 'donations.method' },
  created_at: { col: 'donations.created_at::text', isCast: true },
  amount: { col: '(donations.amount / 100.0)::text', isCast: true },
};

/** Plain donations columns the client may sort by; joined/derived columns are mapped explicitly. */
const DONATION_SORTABLE_COLUMNS = ['amount', 'method', 'created_at', 'country', 'state'];

/** Bounded window for a getAll with no explicit page — the grid's "capture every matching id"
 * call (record prev/next navigation) sends no startRow/endRow. Past this many gifts the detail
 * pager just doesn't appear; the alternative is an unbounded fetch on every row click. */
const DONATION_UNPAGED_WINDOW = 1000;

export class DonationsRepo extends BaseRepository<'donations'> {
  constructor() {
    super('donations');
  }

  /**
   * Receipt state for a batch of donations in one query, strongest document per gift.
   *
   * A gift normally carries both an acknowledgement and, once the year-end run or the manual button
   * has issued one, a tax receipt. The ranking picks the tax receipt in that case, so the ledger
   * shows the document that matters most to the donor rather than whichever row sorted last.
   */
  public async getReceiptStateForDonations(
    tenantId: string,
    donationIds: string[],
  ): Promise<Map<string, DonationReceiptState>> {
    const state = new Map<string, DonationReceiptState>();
    if (donationIds.length === 0) return state;

    const rows = await this.db
      .selectFrom('donation_receipt_items as dri')
      .innerJoin('donation_receipts as dr', 'dr.id', 'dri.receipt_id')
      .select(['dri.donation_id', 'dr.id as receipt_id', 'dr.receipt_number', 'dr.status', 'dr.kind', 'dr.issued_at'])
      .where('dri.tenant_id', '=', tenantId)
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.kind', '!=', 'statement')
      .where('dri.donation_id', 'in', donationIds)
      .orderBy('dr.issued_at', 'asc')
      .execute();

    for (const row of rows) {
      // A cancelled acknowledgement contributes nothing: the gift was reversed, and the tax-receipt
      // states already carry "needs attention" for anything that did.
      if (row.kind === 'acknowledgement' && row.status !== 'issued') continue;
      const status: DonationReceiptState['receipt_status'] =
        row.kind === 'acknowledgement' ? 'acknowledged' : row.status === 'issued' ? 'receipted' : 'cancelled';
      const existing = state.get(row.donation_id);
      if (existing && RECEIPT_STATE_RANK[existing.receipt_status] >= RECEIPT_STATE_RANK[status]) continue;
      state.set(row.donation_id, {
        receipt_status: status,
        receipt_id: row.receipt_id,
        receipt_number: row.receipt_number,
      });
    }
    return state;
  }

  /** Merge receipt state onto donation rows (default 'none' when no document covers the gift). */
  public async withReceiptState<T extends { id: string }>(
    tenantId: string,
    donations: T[],
  ): Promise<(T & DonationReceiptState)[]> {
    const state = await this.getReceiptStateForDonations(
      tenantId,
      donations.map((d) => d.id),
    );
    return donations.map((d) => ({
      ...d,
      ...(state.get(d.id) ?? { receipt_status: 'none' as const, receipt_id: null, receipt_number: null }),
    }));
  }

  /**
   * Get the cumulative sum of successful donations for a person in a given year.
   * Amounts are represented in cents.
   */
  public async getPersonCumulativeDonations(tenantId: string, personId: string, year: number): Promise<number> {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

    const result = await this.getSelect()
      .select(({ fn }) => [fn.sum<string | number>('amount').as('total')])
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .where('status', '=', 'succeeded')
      .where('created_at', '>=', startOfYear)
      .where('created_at', '<=', endOfYear)
      .executeTakeFirst();

    return Number(result?.total || 0);
  }

  /**
   * Get the cumulative sum of successful donations for a person within an explicit date range.
   * Used when a donation_period has been configured.
   */
  public async getPersonCumulativeDonationsForPeriod(
    tenantId: string,
    personId: string,
    startDate: Date,
    endDate: Date | null,
  ): Promise<number> {
    let query = this.getSelect()
      .select(({ fn }) => [fn.sum<string | number>('amount').as('total')])
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .where('status', '=', 'succeeded')
      .where('created_at', '>=', startDate);

    if (endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      query = query.where('created_at', '<=', endOfDay);
    }

    const result = await query.executeTakeFirst();
    return Number(result?.total || 0);
  }

  /**
   * Retrieve the list of donations for a given person, ordered by date descending.
   */
  public async getPersonDonationsList(
    tenantId: string,
    personId: string,
  ): Promise<(Selectable<Models['donations']> & DonationReceiptState)[]> {
    const rows = await this.getSelect()
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .orderBy('created_at', 'desc')
      .execute();
    return this.withReceiptState(tenantId, rows);
  }

  /**
   * One page of the donations ledger for the grid: succeeded gifts only, joined with live donor
   * details (snapshot fallback for deleted contacts), searched/filtered/sorted server-side.
   *
   * The `donation_scope` filter-model key is how the One-time tab excludes monthly-pledge
   * installments (`pledge_id` non-null) without a second endpoint. Receipt state is merged after
   * the page is cut — it spans two more tables, and filtering or sorting by it is deliberately
   * unsupported rather than paid for on every page load.
   */
  public override async getAllWithCounts(
    input: { tenant_id: string; options?: QueryParams<'donations' | 'persons'> },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as Record<string, GridColumnFilter | undefined>;
    const oneTimeOnly =
      String((filterModel['donation_scope'] as { value?: unknown } | undefined)?.value) === 'one-time';

    const startRow = typeof options.startRow === 'number' ? Math.max(0, options.startRow) : 0;
    const endRowCandidate =
      typeof options.endRow === 'number' && options.endRow > startRow
        ? options.endRow
        : startRow + DONATION_UNPAGED_WINDOW;
    const limit = endRowCandidate - startRow;

    const applyFilters = (qb: AnyQB): AnyQB => {
      let q: AnyQB = qb
        .leftJoin('persons', 'persons.id', 'donations.person_id')
        .where('donations.tenant_id', '=', tenantId)
        // The ledger is money actually received; refunded/disputed gifts drop out of it.
        .where('donations.status', '=', 'succeeded')
        .$if(oneTimeOnly, (b: AnyQB) => b.where('donations.pledge_id', 'is', null))
        .$if(!!searchStr, (b: AnyQB) =>
          b.where(
            sql<boolean>`(
              LOWER(${sql.raw(DONOR_NAME_SQL)}) LIKE ${searchStr} OR
              LOWER(${sql.raw(DONOR_EMAIL_SQL)}) LIKE ${searchStr} OR
              LOWER(donations.method) LIKE ${searchStr}
            )`,
          ),
        );
      for (const [field, mapping] of Object.entries(DONATION_FILTER_COLUMNS)) {
        const filter = filterModel[field];
        if (!filter) continue;
        q = mapping.isCast
          ? this.applyCastColumnFilter(q, sql.raw(mapping.col), filter)
          : this.applyColumnFilter(q, mapping.col, filter);
      }
      return this.applyAdvancedFilters(q, options.advancedFilterModel, DONATION_FILTER_COLUMNS);
    };

    const countRow = await applyFilters(this.getSelect(trx) as AnyQB)
      .select([sql<string>`COUNT(donations.id)`.as('total')])
      .executeTakeFirst();
    const count = Number((countRow as { total?: unknown } | undefined)?.total ?? 0);

    const rows = (await applyFilters(this.getSelect(trx) as AnyQB)
      .select([
        'donations.id',
        'donations.tenant_id',
        'donations.person_id',
        'donations.pledge_id',
        'donations.amount',
        'donations.status',
        'donations.method',
        'donations.state',
        'donations.country',
        'donations.created_at',
        sql`${sql.raw(DONOR_NAME_SQL)}`.as('donor_name'),
        this.db.fn.coalesce('persons.first_name', 'donations.first_name').as('person_first_name'),
        this.db.fn.coalesce('persons.last_name', 'donations.last_name').as('person_last_name'),
        this.db.fn.coalesce('persons.email', 'donations.email').as('person_email'),
      ])
      .$if(Array.isArray(options.sortModel) && options.sortModel.length > 0, (builder: AnyQB) =>
        (options.sortModel ?? []).reduce((acc: AnyQB, sort: { colId: string; sort: 'asc' | 'desc' }) => {
          const direction: 'asc' | 'desc' = sort.sort === 'desc' ? 'desc' : 'asc';
          switch (sort.colId) {
            case 'donor_name':
              return acc.orderBy(sql.raw(DONOR_NAME_SQL), direction);
            case 'person_email':
              return acc.orderBy(sql.raw(DONOR_EMAIL_SQL), direction);
            default:
              return DONATION_SORTABLE_COLUMNS.includes(sort.colId)
                ? acc.orderBy(`donations.${sort.colId}`, direction)
                : acc;
          }
        }, builder),
      )
      .$if(!options.sortModel || options.sortModel.length === 0, (builder: AnyQB) =>
        builder.orderBy('donations.created_at', 'desc'),
      )
      .offset(startRow)
      .limit(limit)
      .execute()) as ({ id: string } & Record<string, unknown>)[];

    const withState = await this.withReceiptState(tenantId, rows);
    return { rows: withState, count };
  }

  /**
   * The header tiles of the donations page in one place, computed in SQL so the page no longer
   * needs every donation row client-side. Months are calendar months in the server's timezone
   * (UTC in production) — a gift recorded near midnight on the month boundary may land in the
   * neighbouring month compared to the browser's local clock.
   */
  public async getLedgerSummary(
    tenantId: string,
    scope: 'all' | 'one-time',
  ): Promise<{
    totalCents: number;
    totalCount: number;
    thisMonthCents: number;
    thisMonthCount: number;
    lastMonthCents: number;
    acknowledgedThisMonth: number;
    activePledgeCount: number;
  }> {
    const monthStart = sql`date_trunc('month', now())`;
    const prevMonthStart = sql`date_trunc('month', now()) - interval '1 month'`;

    const totalsQuery = this.getSelect()
      .select([
        sql<string>`COALESCE(SUM(donations.amount), 0)`.as('total_cents'),
        sql<string>`COUNT(*)`.as('total_count'),
        sql<string>`COALESCE(SUM(donations.amount) FILTER (WHERE donations.created_at >= ${monthStart}), 0)`.as(
          'this_month_cents',
        ),
        sql<string>`COUNT(*) FILTER (WHERE donations.created_at >= ${monthStart})`.as('this_month_count'),
        sql<string>`COALESCE(SUM(donations.amount) FILTER (WHERE donations.created_at >= ${prevMonthStart} AND donations.created_at < ${monthStart}), 0)`.as(
          'last_month_cents',
        ),
      ])
      .where('donations.tenant_id', '=', tenantId)
      .where('donations.status', '=', 'succeeded')
      .$if(scope === 'one-time', (b) => b.where('donations.pledge_id', 'is', null));

    // "Thanked" = an issued acknowledgement or an issued tax receipt covers the gift. Year-end
    // statements never count, and a receipt that was cancelled (and not replaced) doesn't either —
    // same definition the ledger's receipt column uses.
    const acknowledgedQuery = this.getSelect()
      .select(({ fn }) => [fn.count<string>('donations.id').as('total')])
      .where('donations.tenant_id', '=', tenantId)
      .where('donations.status', '=', 'succeeded')
      .$if(scope === 'one-time', (b) => b.where('donations.pledge_id', 'is', null))
      .where(sql<boolean>`donations.created_at >= ${monthStart}`)
      .where(
        sql<boolean>`EXISTS (
          SELECT 1
          FROM donation_receipt_items dri
          JOIN donation_receipts dr ON dr.id = dri.receipt_id
          WHERE dri.donation_id = donations.id
            AND dri.tenant_id = ${tenantId}
            AND dr.tenant_id = ${tenantId}
            AND dr.status = 'issued'
            AND dr.kind != 'statement'
        )`,
      );

    const activePledgesQuery = this.db
      .selectFrom('donation_pledges')
      .select(({ fn }) => [fn.count<string>('id').as('total')])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'active');

    const [totals, acknowledged, pledges] = await Promise.all([
      totalsQuery.executeTakeFirst(),
      acknowledgedQuery.executeTakeFirst(),
      activePledgesQuery.executeTakeFirst(),
    ]);

    return {
      totalCents: Number(totals?.total_cents ?? 0),
      totalCount: Number(totals?.total_count ?? 0),
      thisMonthCents: Number(totals?.this_month_cents ?? 0),
      thisMonthCount: Number(totals?.this_month_count ?? 0),
      lastMonthCents: Number(totals?.last_month_cents ?? 0),
      acknowledgedThisMonth: Number(acknowledged?.total ?? 0),
      activePledgeCount: Number(pledges?.total ?? 0),
    };
  }

  /**
   * Find the donation a refund/dispute webhook refers to. A Stripe Charge carries the payment
   * intent (matched against `stripe_payment_intent_id`), and a subscription-installment charge
   * also carries the invoice id (which we store as `stripe_session_id`) — so we try both.
   * Tenant-scoped: the caller passes the tenant that owns the webhook token.
   */
  public async findByPaymentIntentOrInvoice(
    tenantId: string,
    paymentIntentId: string | null,
    invoiceId: string | null,
  ): Promise<Selectable<Models['donations']> | undefined> {
    if (!paymentIntentId && !invoiceId) return undefined;
    let query = this.getSelect().selectAll().where('tenant_id', '=', tenantId);
    if (paymentIntentId && invoiceId) {
      query = query.where((eb) =>
        eb.or([eb('stripe_payment_intent_id', '=', paymentIntentId), eb('stripe_session_id', '=', invoiceId)]),
      );
    } else if (paymentIntentId) {
      query = query.where('stripe_payment_intent_id', '=', paymentIntentId);
    } else if (invoiceId) {
      query = query.where('stripe_session_id', '=', invoiceId);
    }
    return query.orderBy('created_at', 'desc').executeTakeFirst();
  }
}
