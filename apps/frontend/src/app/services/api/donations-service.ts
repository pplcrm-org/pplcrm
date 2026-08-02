import { Service } from '@angular/core';
import type { DonationAddressType, StripeConnectCountry } from '@common';
import { TRPCService } from './trpc-service';

@Service()
export class DonationsService extends TRPCService<'donations'> {
  // ── One-time donations ──────────────────────────────────────────────────────

  public listDonations() {
    return this.api.donations.listDonations.query();
  }

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

  public confirmDonation(sessionId: string) {
    return this.api.donations.confirmDonation.mutate({ sessionId });
  }

  /** Record an offline gift (Fig. 15 "Record donation" dialog) — cash, check, or bank transfer.
   * The mailing address is required: receipts must print one, so no gift is recorded without it. */
  public recordDonation(payload: {
    personId: string;
    amountCents: number;
    method: 'card' | 'check' | 'cash' | 'bank_transfer';
    address: DonationAddressType;
  }) {
    return this.api.donations.recordDonation.mutate(payload);
  }

  public confirmMockDonation(payload: {
    personId: string;
    amountCents: number;
    sessionId: string;
    province: string;
    country: string;
  }) {
    return this.api.donations.confirmMockDonation.mutate(payload);
  }

  // ── Recurring pledges ───────────────────────────────────────────────────────

  public createRecurringCheckout(payload: {
    personId: string;
    monthlyAmountCents: number;
    address: { country?: string; state?: string };
  }) {
    return this.api.donations.createRecurringCheckout.mutate(payload);
  }

  public confirmMockPledge(payload: {
    personId: string;
    monthlyAmountCents: number;
    mockSubId: string;
    province: string;
    country: string;
  }) {
    return this.api.donations.confirmMockPledge.mutate(payload);
  }

  public listPledges() {
    return this.api.donations.listPledges.query();
  }

  public getPersonPledges(personId: string) {
    return this.api.donations.getPersonPledges.query(personId);
  }

  public cancelPledge(pledgeId: string) {
    return this.api.donations.cancelPledge.mutate({ pledgeId });
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
