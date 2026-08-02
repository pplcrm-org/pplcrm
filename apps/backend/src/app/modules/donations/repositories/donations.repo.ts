import type { Selectable } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';

/**
 * Receipt coverage derived from donation_receipt_items ⋈ donation_receipts (statements never
 * count as coverage). 'receipted' = a live official receipt covers the gift; 'cancelled' = only
 * cancelled receipts cover it (needs attention / reissue); 'none' = never receipted.
 */
export interface DonationReceiptState {
  receipt_status: 'receipted' | 'cancelled' | 'none';
  receipt_id: string | null;
  receipt_number: string | null;
}

export class DonationsRepo extends BaseRepository<'donations'> {
  constructor() {
    super('donations');
  }

  /**
   * Receipt state for a batch of donations in one query. Prefers the live (issued) receipt when
   * one exists; otherwise reports the most recent cancelled one so the UI can offer reissue.
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
      .select(['dri.donation_id', 'dr.id as receipt_id', 'dr.receipt_number', 'dr.status', 'dr.issued_at'])
      .where('dri.tenant_id', '=', tenantId)
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.kind', '!=', 'statement')
      .where('dri.donation_id', 'in', donationIds)
      .orderBy('dr.issued_at', 'asc')
      .execute();

    for (const row of rows) {
      const existing = state.get(row.donation_id);
      // Later rows overwrite earlier ones unless we'd replace a live receipt with a cancelled one.
      if (existing?.receipt_status === 'receipted' && row.status !== 'issued') continue;
      state.set(row.donation_id, {
        receipt_status: row.status === 'issued' ? 'receipted' : 'cancelled',
        receipt_id: row.receipt_id,
        receipt_number: row.receipt_number,
      });
    }
    return state;
  }

  /** Merge receipt state onto donation rows (default 'none' for never-receipted gifts). */
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
   * Retrieve all donations for a tenant, joined with live donor details, ordered by date descending.
   * Uses a LEFT JOIN so donations whose contact was later deleted (person_id = NULL) are still returned.
   * The snapshot columns (first_name / last_name / email) recorded on the donation row serve as the
   * fallback when the linked person has since been deleted.
   */
  public async getTenantDonationsList(tenantId: string) {
    const rows = await this.db
      .selectFrom('donations')
      .leftJoin('persons', 'persons.id', 'donations.person_id')
      .select([
        'donations.id',
        'donations.tenant_id',
        'donations.person_id',
        // Non-null on the installments of a monthly pledge — how the Donations page splits its
        // "All" tab from the one-time-only tab.
        'donations.pledge_id',
        'donations.amount',
        'donations.status',
        'donations.stripe_session_id',
        'donations.method',
        'donations.state',
        'donations.country',
        'donations.created_at',
        this.db.fn.coalesce('persons.first_name', 'donations.first_name').as('person_first_name'),
        this.db.fn.coalesce('persons.last_name', 'donations.last_name').as('person_last_name'),
        this.db.fn.coalesce('persons.email', 'donations.email').as('person_email'),
      ])
      .where('donations.tenant_id', '=', tenantId)
      .orderBy('donations.created_at', 'desc')
      .execute();
    return this.withReceiptState(tenantId, rows);
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
