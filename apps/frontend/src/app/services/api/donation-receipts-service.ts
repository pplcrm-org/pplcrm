import { Service } from '@angular/core';
import type {
  CancelReceiptType,
  IssueCumulativeReceiptType,
  IssueReceiptType,
  ListReceiptsType,
  ReissueReceiptType,
} from '@common';
import { TRPCService } from './trpc-service';

/**
 * Donation receipts + year-end statements (`donationReceipts` router). Every procedure is
 * admin/owner-only server-side; the UI hides the actions from other roles rather than letting
 * them collect FORBIDDEN toasts.
 */
@Service()
export class DonationReceiptsService extends TRPCService<'donation_receipts'> {
  public issueReceipt(payload: IssueReceiptType) {
    return this.api.donationReceipts.issueReceipt.mutate(payload);
  }

  public issueCumulativeReceipt(payload: IssueCumulativeReceiptType) {
    return this.api.donationReceipts.issueCumulativeReceipt.mutate(payload);
  }

  public cancelReceipt(payload: CancelReceiptType) {
    return this.api.donationReceipts.cancelReceipt.mutate(payload);
  }

  public reissueReceipt(payload: ReissueReceiptType) {
    return this.api.donationReceipts.reissueReceipt.mutate(payload);
  }

  public listReceipts(filters: ListReceiptsType = {}) {
    return this.api.donationReceipts.listReceipts.query(filters);
  }

  public getSettingsStatus() {
    return this.api.donationReceipts.getReceiptSettingsStatus.query();
  }

  /** SPECIMEN-watermarked sample PDF (base64) rendered from the current settings. */
  public previewReceipt() {
    return this.api.donationReceipts.previewReceipt.query();
  }

  public runYearEndStatements(year: number) {
    return this.api.donationReceipts.runYearEndStatements.mutate({ year });
  }

  public getStatementRun(runId: string) {
    return this.api.donationReceipts.getStatementRun.query({ runId });
  }

  public listStatementRuns() {
    return this.api.donationReceipts.listStatementRuns.query();
  }
}
