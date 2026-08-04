import PDFDocument from 'pdfkit';

/**
 * Shared frame for the receipt/statement PDFs. Built-in Helvetica only (standard-14 fonts ship
 * with every PDF reader, and WinAnsi covers the French accents in Canadian names) — no font
 * files in the container. Letter size to match what a Canadian church office prints.
 */

export const PDF_MARGIN = 54; // 0.75" — comfortable print margin
const PAGE_WIDTH = 612; // Letter, points
export const CONTENT_WIDTH = PAGE_WIDTH - PDF_MARGIN * 2;

export const COLOR_TEXT = '#1a1a1a';
export const COLOR_MUTED = '#555555';
export const COLOR_RULE = '#cccccc';

/** Run a layout callback against a fresh document and resolve the finished bytes. */
export function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PDF_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Cents → "$1,234.56" (en-CA). Receipts print exact amounts; never round. */
export function formatMoney(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

/**
 * A Postgres `date` COLUMN value → the calendar date it stores, "YYYY-MM-DD".
 *
 * The `pg` driver turns a `date` column into a JS Date at midnight in the *server's* local zone, so
 * the stored calendar date is exactly that Date's local year/month/day. Re-formatting that instant
 * in another zone moves it a day (on a UTC server, Toronto formatting prints the day before).
 *
 * Use this for `date` columns — gift dates. Use `torontoDateString` for real timestamps
 * (`issued_at`, `cancelled_at`, "now"), where the instant genuinely has to be converted to Toronto.
 */
export function dateColumnString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A TIMESTAMP → its calendar date in Toronto (Canada-only feature; avoids UTC New-Year drift). */
export function torontoDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // en-CA yields YYYY-MM-DD
}

/** "YYYY-MM-DD" (or a Date) → "January 5, 2026" for print. */
export function formatDateLong(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T12:00:00Z`) : value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: typeof value === 'string' ? 'UTC' : 'America/Toronto',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function horizontalRule(doc: PDFKit.PDFDocument, y?: number): void {
  const ruleY = y ?? doc.y;
  doc
    .save()
    .moveTo(PDF_MARGIN, ruleY)
    .lineTo(PDF_MARGIN + CONTENT_WIDTH, ruleY)
    .lineWidth(0.75)
    .strokeColor(COLOR_RULE)
    .stroke()
    .restore();
  doc.y = ruleY + 10;
}

/** One "Label   value" row in the details block. */
export function labeledRow(doc: PDFKit.PDFDocument, label: string, value: string, labelWidth = 190): void {
  const y = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_MUTED).text(label, PDF_MARGIN, y, { width: labelWidth });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLOR_TEXT)
    .text(value, PDF_MARGIN + labelWidth, y, { width: CONTENT_WIDTH - labelWidth });
  doc.moveDown(0.45);
  doc.x = PDF_MARGIN;
}

/** Large rotated overlay for SPECIMEN previews and CANCELLED copies. */
export function watermark(doc: PDFKit.PDFDocument, text: string): void {
  doc
    .save()
    .rotate(-30, { origin: [306, 396] })
    .font('Helvetica-Bold')
    .fontSize(72)
    .fillColor('#d0d0d0')
    .opacity(0.45)
    .text(text, 0, 360, { width: PAGE_WIDTH, align: 'center' })
    .opacity(1)
    .restore();
  doc.x = PDF_MARGIN;
}
