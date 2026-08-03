import {
  CancelReceiptObj,
  IssueCumulativeReceiptObj,
  IssueReceiptObj,
  ListReceiptsObj,
  ReissueReceiptObj,
  RetryReceiptPdfObj,
  RunYearEndStatementsObj,
  StatementRunIdObj,
} from '@common';
import { adminOrOwnerProcedure, router } from '../../../../trpc';
import { planFeatureGate } from '../../billing/plan-gate';
import { DonationReceiptsController } from './controller';

const controller = new DonationReceiptsController();

/**
 * Receipts inherit the donations plan gate (Grassroots+, mutations blocked below), and every
 * procedure — reads included — is admin/owner-only: receipts and statements span campaigns, and
 * only the workspace's declared signatory issues them, so a campaign-pinned Editor gets FORBIDDEN
 * rather than a cross-campaign giving history.
 */
const receiptProcedure = adminOrOwnerProcedure.use(planFeatureGate('donations'));

export const DonationReceiptsRouter = router({
  issueReceipt: receiptProcedure.input(IssueReceiptObj).mutation(({ ctx, input }) =>
    controller.issueReceipt(ctx.auth, input.donationId, {
      advantageCents: input.advantageCents,
      advantageDescription: input.advantageDescription,
    }),
  ),

  issueCumulativeReceipt: receiptProcedure.input(IssueCumulativeReceiptObj).mutation(({ ctx, input }) =>
    controller.issueCumulativeReceipt(ctx.auth, input.personId, input.year, {
      advantageCents: input.advantageCents,
      advantageDescription: input.advantageDescription,
    }),
  ),

  cancelReceipt: receiptProcedure
    .input(CancelReceiptObj)
    .mutation(({ ctx, input }) => controller.cancelReceipt(ctx.auth, input.receiptId, input.reason)),

  reissueReceipt: receiptProcedure
    .input(ReissueReceiptObj)
    .mutation(({ ctx, input }) => controller.reissueReceipt(ctx.auth, input.receiptId, input.reason)),

  retryReceiptPdf: receiptProcedure
    .input(RetryReceiptPdfObj)
    .mutation(({ ctx, input }) => controller.retryReceiptPdf(ctx.auth, input.receiptId)),

  listReceipts: receiptProcedure
    .input(ListReceiptsObj)
    .query(({ ctx, input }) => controller.listReceipts(ctx.auth.tenant_id, input)),

  getReceiptSettingsStatus: receiptProcedure.query(({ ctx }) =>
    controller.getReceiptSettingsStatus(ctx.auth.tenant_id),
  ),

  previewReceipt: receiptProcedure.query(({ ctx }) => controller.previewReceipt(ctx.auth.tenant_id)),

  runYearEndStatements: receiptProcedure
    .input(RunYearEndStatementsObj)
    .mutation(({ ctx, input }) => controller.runYearEndStatements(ctx.auth, input.year)),

  getStatementRun: receiptProcedure
    .input(StatementRunIdObj)
    .query(({ ctx, input }) => controller.getStatementRun(ctx.auth.tenant_id, input.runId)),

  listStatementRuns: receiptProcedure.query(({ ctx }) => controller.listStatementRuns(ctx.auth.tenant_id)),
});
