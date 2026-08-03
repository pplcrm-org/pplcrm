import { z } from 'zod';
import { idSchema } from './core.schema';
import { RECEIPT_REGIME_IDS } from '../receipt-regimes';

/**
 * Everything a donor is sent about their giving: the plain acknowledgement that goes out the moment
 * a gift is recorded, official tax receipts, and year-end giving statements. See
 * libs/common/src/lib/receipt-regimes/ for the per-regime prescribed contents and issuance rules the
 * tax documents follow — an acknowledgement follows none of them, which is the point of it.
 */

/**
 * 'acknowledgement' is the unconditional thank-you-for-your-gift document — numbered from its own
 * sequence, tied to no tax regime, and explicitly not a tax receipt. 'per_gift' and 'cumulative'
 * are numbered official tax receipts; 'statement' is an unnumbered year-end summary.
 */
export const RECEIPT_KINDS = ['acknowledgement', 'per_gift', 'cumulative', 'statement'] as const;
export const RECEIPT_KIND_LABELS: Record<(typeof RECEIPT_KINDS)[number], string> = {
  acknowledgement: 'Acknowledgement',
  per_gift: 'Tax receipt',
  cumulative: 'Annual tax receipt',
  statement: 'Giving statement',
};

/**
 * The kinds that are official tax documents. Anything asking "does this gift already have a tax
 * receipt" must test against these — testing `kind !== 'statement'` was correct only while
 * acknowledgements did not exist, and now silently counts every gift as receipted.
 */
export const OFFICIAL_RECEIPT_KINDS = ['per_gift', 'cumulative'] as const;

/** Receipts are never deleted: corrections go through cancel (with reason) and reissue. */
export const RECEIPT_STATUSES = ['issued', 'cancelled'] as const;

export const receiptKindSchema = z.enum(RECEIPT_KINDS);
export const receiptStatusSchema = z.enum(RECEIPT_STATUSES);
export const receiptRegimeIdSchema = z.enum(RECEIPT_REGIME_IDS);
export type ReceiptKind = z.infer<typeof receiptKindSchema>;
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

const receiptYearSchema = z.number().int().min(2000, 'Enter a four-digit year').max(2100, 'Enter a four-digit year');

/** Advantage = what the donor got back (dinner, auction item); eligible amount = gift − advantage. */
const advantageFields = {
  advantageCents: z.number().int().min(0).optional(),
  advantageDescription: z.string().trim().max(500, 'Keep the description under 500 characters').optional(),
};

export const IssueReceiptObj = z.object({
  donationId: idSchema,
  ...advantageFields,
});
export type IssueReceiptType = z.infer<typeof IssueReceiptObj>;

/** Annual cumulative mode: one official receipt covering a donor's un-receipted gifts in a year. */
export const IssueCumulativeReceiptObj = z.object({
  personId: idSchema,
  year: receiptYearSchema,
  ...advantageFields,
});
export type IssueCumulativeReceiptType = z.infer<typeof IssueCumulativeReceiptObj>;

export const CancelReceiptObj = z.object({
  receiptId: idSchema,
  reason: z.string().trim().min(3, 'Give a short reason').max(500, 'Keep the reason under 500 characters'),
});
export type CancelReceiptType = z.infer<typeof CancelReceiptObj>;

export const ReissueReceiptObj = z.object({
  receiptId: idSchema,
  /** Required only when the predecessor is still issued (it gets cancelled first). */
  reason: z.string().trim().min(3, 'Give a short reason').max(500, 'Keep the reason under 500 characters').optional(),
});
export type ReissueReceiptType = z.infer<typeof ReissueReceiptObj>;

/** Re-queue the PDF render for a receipt whose render job failed. Stores only — sends no email. */
export const RetryReceiptPdfObj = z.object({
  receiptId: idSchema,
});
export type RetryReceiptPdfType = z.infer<typeof RetryReceiptPdfObj>;

export const ListReceiptsObj = z.object({
  donationId: idSchema.optional(),
  personId: idSchema.optional(),
  year: receiptYearSchema.optional(),
  status: receiptStatusSchema.optional(),
  /**
   * Restrict to these document kinds. The receipts ledger passes the three tax/summary kinds by
   * default: one acknowledgement per gift would bury everything else in the list.
   */
  kinds: z.array(receiptKindSchema).min(1).optional(),
  /** Cancelled-needing-reissue rows (`reissue_required`) only. */
  needsAttention: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
export type ListReceiptsType = z.infer<typeof ListReceiptsObj>;

export const RunYearEndStatementsObj = z.object({
  year: receiptYearSchema,
});
export type RunYearEndStatementsType = z.infer<typeof RunYearEndStatementsObj>;

export const StatementRunIdObj = z.object({
  runId: idSchema,
});
export type StatementRunIdType = z.infer<typeof StatementRunIdObj>;
