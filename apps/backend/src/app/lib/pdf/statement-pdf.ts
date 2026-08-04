import {
  CONTENT_WIDTH,
  COLOR_MUTED,
  COLOR_TEXT,
  PDF_MARGIN,
  RULE_HEIGHT,
  ensureSpace,
  formatDateLong,
  formatMoney,
  horizontalRule,
  renderPdf,
} from './pdf-common';

/**
 * Year-end giving statement — a per-donor summary of a calendar year's gifts. Deliberately NOT
 * an official receipt: it carries no serial number and prints an explicit "not an official
 * receipt" line, so it can go to every donor in every regime (including Quebec, where the
 * workspace cannot issue receipts at all).
 */

export interface StatementPdfInput {
  year: number;
  orgName: string;
  orgAddress?: string;
  donorName: string;
  donorAddressLines: string[];
  gifts: { gift_date: string; amount_cents: number; method: string }[];
  totalCents: number;
  currency?: string;
  generatedAt: Date;
}

/** Gap between the last gift row and the rule above the total, in lines. */
const TOTAL_RULE_GAP = 0.3;

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};

export function buildStatementPdf(input: StatementPdfInput): Promise<Buffer> {
  return renderPdf((doc) => {
    doc.font('Helvetica-Bold').fontSize(15).fillColor(COLOR_TEXT).text(input.orgName, PDF_MARGIN, PDF_MARGIN);
    if (input.orgAddress) doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text(input.orgAddress);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_TEXT).text(`${input.year} giving statement`);
    doc.moveDown(0.5);
    horizontalRule(doc);

    doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text('Prepared for');
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_TEXT).text(input.donorName);
    for (const line of input.donorAddressLines) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT).text(line);
    }
    doc.moveDown(0.8);

    // Gifts table: date · method · amount.
    const amountX = PDF_MARGIN + CONTENT_WIDTH - 100;
    const methodX = PDF_MARGIN + 180;
    const drawTableHeader = (): void => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR_MUTED);
      const headerY = doc.y;
      doc.text('Date', PDF_MARGIN, headerY);
      doc.text('Method', methodX, headerY);
      doc.text('Amount', amountX, headerY, { width: 100, align: 'right' });
      doc.moveDown(0.3);
      horizontalRule(doc);
    };
    const startRow = (): void => {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT);
    };
    drawTableHeader();

    // Heights of the two row shapes, measured before the first row so the fit checks below are the
    // true drawn height rather than an estimate that could push a one-page statement onto two.
    doc.font('Helvetica-Bold').fontSize(10.5);
    const totalRowHeight = doc.currentLineHeight(true);
    startRow();
    const giftRowHeight = doc.currentLineHeight(true);

    for (const gift of input.gifts) {
      // Date, method and amount are three separate cells; break the whole row or none of it, and
      // repeat the column headers on the page the row moves to.
      ensureSpace(doc, giftRowHeight, () => {
        drawTableHeader();
        startRow();
      });
      const y = doc.y;
      doc.text(formatDateLong(gift.gift_date), PDF_MARGIN, y);
      doc.text(METHOD_LABELS[gift.method] ?? gift.method, methodX, y);
      doc.text(formatMoney(gift.amount_cents, input.currency), amountX, y, { width: 100, align: 'right' });
      doc.moveDown(0.2);
    }
    doc.x = PDF_MARGIN;
    // The total is a label cell and an amount cell under a rule: keep all three together.
    ensureSpace(doc, giftRowHeight * TOTAL_RULE_GAP + RULE_HEIGHT + totalRowHeight);
    doc.moveDown(TOTAL_RULE_GAP);
    horizontalRule(doc);

    const totalY = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(COLOR_TEXT)
      .text(`Total gifts in ${input.year}`, PDF_MARGIN, totalY);
    doc.text(formatMoney(input.totalCents, input.currency), amountX, totalY, { width: 100, align: 'right' });
    doc.x = PDF_MARGIN;

    doc.moveDown(1.5);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLOR_MUTED)
      .text('This statement is a summary of gifts received and is not an official receipt for income tax purposes.');
    doc.text(`Generated ${formatDateLong(input.generatedAt)}.`);
  });
}
