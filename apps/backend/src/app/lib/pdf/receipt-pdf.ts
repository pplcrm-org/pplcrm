import type { ReceiptRegimeSpec } from '@common';
import {
  CONTENT_WIDTH,
  COLOR_MUTED,
  COLOR_TEXT,
  PDF_MARGIN,
  formatDateLong,
  formatMoney,
  horizontalRule,
  labeledRow,
  renderPdf,
  torontoDateString,
  watermark,
} from './pdf-common';

/**
 * Official receipt PDF (per-gift and annual-cumulative). Layout is driven by the regime spec
 * (libs/common/src/lib/receipt-regimes/) — the prescribed title, issuer-role wording, footer
 * lines, and which regime-specific fields print all come from there, so the legal content stays
 * reviewable as data instead of living in this drawing code.
 */

export interface ReceiptIssuerSnapshot {
  org_legal_name?: string;
  org_address?: string;
  registration_number?: string;
  place_of_issue?: string;
  signatory_name?: string;
  signatory_title?: string;
  agent_name?: string;
  electoral_district?: string;
  polling_day?: string;
}

export interface ReceiptPdfInput {
  regime: ReceiptRegimeSpec;
  receiptNumber: string;
  kind: 'per_gift' | 'cumulative';
  issuedAt: Date;
  /** Per-gift: the date received. Cumulative prints the items table instead. */
  giftDate: string | null;
  items: { gift_date: string; amount_cents: number }[];
  amountCents: number;
  advantageCents: number;
  eligibleCents: number;
  advantageDescription: string | null;
  donorName: string;
  donorAddressLines: string[];
  issuer: ReceiptIssuerSnapshot;
  /** Predecessor's number when this receipt cancels and replaces one (printed — CRA requires both serials). */
  replacesReceiptNumber?: string | null;
  /** Set when re-downloading a cancelled receipt — prints the CANCELLED watermark + reason. */
  cancelled?: { reason: string; at: Date } | null;
  /** SPECIMEN watermark for the settings preview. */
  specimen?: boolean;
  signatureImage?: Buffer | null;
  currency?: string;
  /** Alberta prints an explicit eligibility line (showsTaxCreditEligibility). */
  taxCreditEligible?: boolean;
}

export function buildReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const { regime, issuer } = input;
  return renderPdf((doc) => {
    if (input.specimen) watermark(doc, 'SPECIMEN');
    if (input.cancelled) watermark(doc, 'CANCELLED');

    // Issuer block — organization name and address as registered.
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(COLOR_TEXT)
      .text(issuer.org_legal_name ?? '', PDF_MARGIN, PDF_MARGIN);
    if (issuer.org_address) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text(issuer.org_address);
    }
    doc.moveDown(0.8);

    // Prescribed title + serial.
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_TEXT).text(regime.receiptTitle);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(10.5).text(`Receipt No. ${input.receiptNumber}`);
    if (input.replacesReceiptNumber) {
      doc.moveDown(0.2);
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(`This receipt cancels and replaces receipt No. ${input.replacesReceiptNumber}.`);
    }
    doc.moveDown(0.5);
    horizontalRule(doc);

    // Donor block.
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text('Received from');
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_TEXT).text(input.donorName);
    for (const line of input.donorAddressLines) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT).text(line);
    }
    doc.moveDown(0.8);

    // Gift details.
    if (input.kind === 'per_gift' && input.giftDate) {
      labeledRow(doc, 'Date gift received', formatDateLong(input.giftDate));
    }
    labeledRow(doc, 'Date receipt issued', formatDateLong(input.issuedAt));
    if (issuer.place_of_issue) labeledRow(doc, 'Place receipt issued', issuer.place_of_issue);
    if (issuer.registration_number) labeledRow(doc, regime.registrationNumberLabel, issuer.registration_number);
    if (issuer.agent_name) labeledRow(doc, regime.issuerRole, issuer.agent_name);
    // "Electoral district" is hard-coded ON PURPOSE and must stay that way. It is the wording the
    // receipting regulation prescribes for this field (B.C. Reg 343/95 s.2 names the candidate's
    // electoral district), not interface wording, so it must NOT follow the campaign's chosen seat
    // word from `seatLabelFor`. A campaign that calls its seat a Ward or a Constituency still gets
    // a receipt that reads "Electoral district"; printing the campaign's word instead would put a
    // term on a legal document that the regulation does not use. Only the VALUE is per-campaign —
    // it comes from the gift's campaign seat, falling back to the workspace setting.
    if (issuer.electoral_district) labeledRow(doc, 'Electoral district', issuer.electoral_district);
    if (issuer.polling_day) labeledRow(doc, 'Polling day', formatDateLong(issuer.polling_day));

    // Cumulative receipts itemize the covered gifts.
    if (input.kind === 'cumulative' && input.items.length > 0) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLOR_TEXT).text('Gifts covered by this receipt');
      doc.moveDown(0.25);
      for (const item of input.items) {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT).text(formatDateLong(item.gift_date), PDF_MARGIN, y);
        doc.text(formatMoney(item.amount_cents, input.currency), PDF_MARGIN, y, {
          width: CONTENT_WIDTH,
          align: 'right',
        });
        doc.moveDown(0.15);
      }
      doc.x = PDF_MARGIN;
      doc.moveDown(0.4);
    }

    labeledRow(doc, 'Total amount received', formatMoney(input.amountCents, input.currency));
    if (input.advantageCents > 0) {
      labeledRow(
        doc,
        'Amount of advantage',
        `${formatMoney(input.advantageCents, input.currency)}${
          input.advantageDescription ? ` — ${input.advantageDescription}` : ''
        }`,
      );
    }
    labeledRow(doc, 'Eligible amount', formatMoney(input.eligibleCents, input.currency));
    if (regime.showsTaxCreditEligibility) {
      labeledRow(doc, 'Eligible for tax credit', input.taxCreditEligible === false ? 'No' : 'Yes');
    }
    if (input.cancelled) {
      labeledRow(doc, 'Cancelled', `${formatDateLong(input.cancelled.at)} — ${input.cancelled.reason}`);
    }

    // Signature block — facsimile image plus the signatory's printed name and role.
    doc.moveDown(1.2);
    if (input.signatureImage) {
      try {
        doc.image(input.signatureImage, PDF_MARGIN, doc.y, { fit: [160, 48] });
        doc.y += 52;
      } catch {
        // A corrupt image must not block the receipt — the printed name still identifies the signer.
      }
    }
    const signatory = issuer.signatory_name ?? issuer.agent_name ?? '';
    const signatoryLine = issuer.signatory_title ? `${signatory}, ${issuer.signatory_title}` : signatory;
    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT).text(signatoryLine, PDF_MARGIN, doc.y);
    doc.font('Helvetica').fontSize(8.5).fillColor(COLOR_MUTED).text('Authorized signature');

    // Regime footer (e.g. the CRA name + website reference).
    doc.moveDown(1.2);
    horizontalRule(doc);
    for (const line of regime.footerLines) {
      doc.font('Helvetica').fontSize(8.5).fillColor(COLOR_MUTED).text(line);
    }
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLOR_MUTED)
      .text(`Issued ${torontoDateString(input.issuedAt)} · Keep this receipt for your records.`);
  });
}
