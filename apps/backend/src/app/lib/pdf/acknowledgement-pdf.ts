import {
  COLOR_MUTED,
  COLOR_TEXT,
  PDF_MARGIN,
  formatDateLong,
  formatMoney,
  horizontalRule,
  labeledRow,
  renderPdf,
  watermark,
} from './pdf-common';

/**
 * The plain donation acknowledgement — sent the moment a gift is recorded, in every workspace.
 *
 * Deliberately NOT regime-driven, unlike receipt-pdf.ts. This document makes no claim about tax
 * treatment, so it prints no registration number, no authorized signature and no statutory footer,
 * and it needs none of the workspace configuration those require. That is the whole point of it: a
 * municipal campaign, a United States committee, or a charity that has not finished its receipt
 * setup can all still tell a donor their gift arrived.
 *
 * The disclaimer line is not optional decoration. Donors do try to claim ordinary receipts, so the
 * document has to say plainly what it is not, directly under the heading where it will be read.
 */

export interface AcknowledgementPdfInput {
  /** Sequence from the acknowledgement counter, e.g. "A-2026-00042". Never an official serial. */
  number: string;
  orgName: string;
  orgAddress?: string;
  donorName: string;
  /** Empty when no address is on file — an acknowledgement does not require one. */
  donorAddressLines: string[];
  /** YYYY-MM-DD, the date the gift was received. */
  giftDate: string;
  issuedAt: Date;
  amountCents: number;
  /** 'card' | 'check' | 'cash' | 'bank_transfer'. */
  method: string;
  currency?: string;
  /**
   * True when the workspace has a receipting regime configured, so the donor can be told a tax
   * receipt is coming. Omitted wording is better than a promise a workspace cannot keep.
   */
  taxReceiptExpected?: boolean;
  /** Prints the CANCELLED overlay and reason — a re-download after the gift was refunded. */
  cancelled?: { reason: string; at: Date } | null;
}

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};

const DISCLAIMER = 'This receipt confirms your gift. It is not an official receipt for income tax purposes.';

export function buildAcknowledgementPdf(input: AcknowledgementPdfInput): Promise<Buffer> {
  return renderPdf((doc) => {
    if (input.cancelled) watermark(doc, 'CANCELLED');

    doc.font('Helvetica-Bold').fontSize(15).fillColor(COLOR_TEXT).text(input.orgName, PDF_MARGIN, PDF_MARGIN);
    if (input.orgAddress) doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text(input.orgAddress);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_TEXT).text('Donation receipt');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED).text(DISCLAIMER);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_TEXT).text(`No. ${input.number}`);
    doc.moveDown(0.5);
    horizontalRule(doc);

    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text('Received from');
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_TEXT).text(input.donorName);
    for (const line of input.donorAddressLines) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT).text(line);
    }
    doc.moveDown(0.8);

    labeledRow(doc, 'Date gift received', formatDateLong(input.giftDate));
    labeledRow(doc, 'Payment method', METHOD_LABELS[input.method] ?? input.method);
    labeledRow(doc, 'Amount received', formatMoney(input.amountCents, input.currency));
    if (input.cancelled) {
      labeledRow(doc, 'Cancelled', `${formatDateLong(input.cancelled.at)} — ${input.cancelled.reason}`);
    }

    doc.moveDown(1.2);
    horizontalRule(doc);
    if (input.taxReceiptExpected && !input.cancelled) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLOR_MUTED)
        .text(`An official tax receipt for ${input.giftDate.slice(0, 4)} follows after the year ends.`);
    }
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLOR_MUTED)
      .text(`Issued ${formatDateLong(input.issuedAt)} · Thank you for your support.`);
  });
}
