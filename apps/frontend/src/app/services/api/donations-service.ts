import { Service, inject } from '@angular/core';
import type { DonationAddressType, StripeConnectCountry } from '@common';
import type { ExportCsvInputType, ExportCsvResponseType, getAllOptionsType } from '../../../../../../libs/common/src';
import { AbstractAPIService } from './abstract-api.service';
import { DonationsChangedService } from './donations-changed.service';
import type { RouterOutputs } from './trpc-types';

/** Which slice of the ledger the grid asks for — the One-time tab excludes pledge installments. */
export type DonationsListScope = 'all' | 'one-time';

export type DonationLedgerRow = RouterOutputs['donations']['getAll']['rows'][number];
export type DonationLedgerSummary = RouterOutputs['donations']['getLedgerSummary'];

@Service()
export class DonationsService extends AbstractAPIService<'donations', Record<string, unknown>> {
  protected override readonly endpointName = 'donations';

  /**
   * Raised after every successful write below, so a donations grid that did not initiate the write
   * still reloads. See {@link DonationsChangedService} for why the grid's own refresh signal is not
   * enough on its own.
   */
  private readonly changed = inject(DonationsChangedService);

  /**
   * Fixed scope this instance's getAll requests carry, sent as the `donation_scope` filter-model
   * key. The donations page provides a component-scoped instance and sets this once from its
   * route, so the All and One-time tabs never share one mutable scope.
   */
  public listScope: DonationsListScope = 'all';

  // ── The donations grid (AbstractAPIService contract) ────────────────────────

  public getAll(options?: getAllOptionsType): Promise<RouterOutputs['donations']['getAll']> {
    const opts: getAllOptionsType = {
      ...(options ?? {}),
      filterModel: { ...(options?.filterModel ?? {}), donation_scope: { value: this.listScope } },
    };
    return this.api.donations.getAll.query(opts, { signal: this.ac.signal });
  }

  /** Donations have no archive concept — the grid never shows the archive toggle. */
  public getAllArchived(_options?: getAllOptionsType): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    return Promise.resolve({ rows: [], count: 0 });
  }

  public count(): Promise<number> {
    return this.getAll({ startRow: 0, endRow: 1 }).then((res) => res.count ?? 0);
  }

  /** Gifts are recorded through the Record-donation dialog, never through the grid. */
  public add(_row: Record<string, unknown>): Promise<unknown> {
    return Promise.reject(new Error('Record donations through the Record donation dialog'));
  }

  public addMany(_rows: Record<string, unknown>[]): Promise<unknown> {
    return Promise.resolve([]);
  }

  /** Amounts and receipt state have legal side effects — edits go through the gift page only. */
  public update(_id: string, _data: Record<string, unknown>): Promise<unknown> {
    return Promise.reject(new Error('Donations cannot be edited inline'));
  }

  public getById(id: string): Promise<unknown> {
    return this.getDonation(id);
  }

  public attachTag(_id: string, _tag_name: string): Promise<unknown> {
    return Promise.resolve();
  }

  public detachTag(_id: string, _tag_name: string): Promise<unknown> {
    return Promise.resolve(false);
  }

  public getTags(_id: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  public exportCsv(_input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return Promise.reject(new Error('Donation export is not available yet'));
  }

  /** Header-tile aggregates for the donations page, computed server-side. */
  public getLedgerSummary(scope: DonationsListScope): Promise<DonationLedgerSummary> {
    return this.api.donations.getLedgerSummary.query({ scope }, { signal: this.ac.signal });
  }

  // ── One-time donations ──────────────────────────────────────────────────────

  public getHistory(personId: string) {
    return this.api.donations.getPersonDonationHistory.query(personId);
  }

  /** One gift + receipt state, for the /donations/:id detail page. */
  public getDonation(donationId: string) {
    return this.api.donations.getDonation.query(donationId);
  }

  public getStats(personId: string) {
    return this.api.donations.getDonationStats.query(personId);
  }

  public checkEligibility(payload: {
    personId: string;
    amountCents: number;
    address: { country?: string; state?: string };
    isRecurring?: boolean;
    remainingMonths?: number;
  }) {
    return this.api.donations.checkEligibility.query(payload);
  }

  public createCheckout(payload: {
    personId: string;
    amountCents: number;
    address: { country?: string; state?: string };
  }) {
    return this.api.donations.createCheckout.mutate(payload);
  }

  public async confirmDonation(sessionId: string) {
    const donation = await this.api.donations.confirmDonation.mutate({ sessionId });
    this.changed.notify();
    return donation;
  }

  /** Record an offline gift (Fig. 15 "Record donation" dialog) — cash, check, or bank transfer.
   * The mailing address is required: receipts must print one, so no gift is recorded without it. */
  public async recordDonation(payload: {
    personId: string;
    amountCents: number;
    method: 'card' | 'check' | 'cash' | 'bank_transfer';
    /** Which fund the gift joins (§15). Omitted means the office fund. */
    campaign_id?: string;
    /** "YYYY-MM-DD", the day the gift was received. Omitted means today; a future date is refused. */
    gift_date?: string;
    address: DonationAddressType;
  }) {
    const donation = await this.api.donations.recordDonation.mutate(payload);
    this.changed.notify();
    return donation;
  }

  public async confirmMockDonation(payload: {
    personId: string;
    amountCents: number;
    sessionId: string;
    province: string;
    country: string;
  }) {
    const donation = await this.api.donations.confirmMockDonation.mutate(payload);
    this.changed.notify();
    return donation;
  }

  // ── Recurring pledges ───────────────────────────────────────────────────────

  public createRecurringCheckout(payload: {
    personId: string;
    monthlyAmountCents: number;
    address: { country?: string; state?: string };
  }) {
    return this.api.donations.createRecurringCheckout.mutate(payload);
  }

  public async confirmMockPledge(payload: {
    personId: string;
    monthlyAmountCents: number;
    mockSubId: string;
    province: string;
    country: string;
  }) {
    const pledge = await this.api.donations.confirmMockPledge.mutate(payload);
    this.changed.notify();
    return pledge;
  }

  public listPledges() {
    return this.api.donations.listPledges.query();
  }

  public getPersonPledges(personId: string) {
    return this.api.donations.getPersonPledges.query(personId);
  }

  /** Cancelling a pledge changes the "Monthly Donors" tile on the ledger, so it ticks too. */
  public async cancelPledge(pledgeId: string) {
    const result = await this.api.donations.cancelPledge.mutate({ pledgeId });
    this.changed.notify();
    return result;
  }

  // ── Donation periods ────────────────────────────────────────────────────────

  public getDonationPeriods() {
    return this.api.donations.getDonationPeriods.query();
  }

  public createDonationPeriod(payload: {
    name: string;
    start_date: string;
    end_date?: string | null;
    limit_amount: number;
  }) {
    return this.api.donations.createDonationPeriod.mutate(payload);
  }

  public updateDonationPeriod(payload: {
    id: string;
    name?: string;
    start_date?: string;
    end_date?: string | null;
    limit_amount?: number;
    is_active?: boolean;
  }) {
    return this.api.donations.updateDonationPeriod.mutate(payload);
  }

  public deleteDonationPeriod(id: string) {
    return this.api.donations.deleteDonationPeriod.mutate({ id });
  }

  /** Country / residency-acknowledged / Connect-readiness context that drives the donation settings disclaimers. */
  public getResidencyContext() {
    return this.api.donations.getResidencyContext.query();
  }

  // ── Donor giving portal (staff side) ────────────────────────────────────────

  /** Link state for the giving-portal panel on the person record. */
  public getPortalLinkStatus(personId: string) {
    return this.api.donorPortal.getLinkStatus.query({ personId });
  }

  /** Stops every live giving-portal link for this person immediately. */
  public revokePortalLinks(personId: string) {
    return this.api.donorPortal.revokeLinks.mutate({ personId });
  }

  /**
   * Mint a giving-portal link (and email it when the person has an address). Adds a link — it
   * never invalidates earlier ones. Returns the raw URL once so the panel can offer Copy link.
   */
  public sendPortalLink(personId: string) {
    return this.api.donorPortal.sendLink.mutate({ personId });
  }

  // ── Stripe Connect (hosted onboarding; no tenant-held secrets) ────────────────

  public getStripeConnectStatus() {
    return this.api.donations.getStripeConnectStatus.query();
  }

  /** Create the connected account (first call) and return the Stripe-hosted onboarding URL. */
  public startStripeOnboarding(country: StripeConnectCountry) {
    return this.api.donations.startStripeOnboarding.mutate({ country });
  }

  /** Express-dashboard login link for the "Open Stripe dashboard" button. */
  public createStripeLoginLink() {
    return this.api.donations.createStripeLoginLink.mutate();
  }

  public disconnectStripe() {
    return this.api.donations.disconnectStripe.mutate();
  }
}
