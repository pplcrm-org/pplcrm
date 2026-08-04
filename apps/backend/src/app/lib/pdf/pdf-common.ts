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

/** Vertical space a horizontal rule consumes: the line plus the gap below it. */
export const RULE_HEIGHT = 10;

/**
 * Height of `text` at the current font, measured away from the page bottom. `heightOfString` walks
 * the same line wrapper the real draw uses and stops counting once its running `y` passes the
 * bottom margin — which is exactly the position callers ask about — so measuring in place
 * under-reports the tall rows that need a page break.
 */
export function textHeight(doc: PDFKit.PDFDocument, text: string, width: number): number {
  const savedY = doc.y;
  doc.y = doc.page.margins.top;
  const height = doc.heightOfString(text, { width });
  doc.y = savedY;
  return height;
}

/**
 * Start a new page when `height` points of content would not fit above the bottom margin, and run
 * `onNewPage` (a table's column headers) on the fresh page.
 *
 * A row built from several absolutely-positioned `doc.text(..., x, y)` cells cannot rely on
 * pdfkit's automatic break: each cell breaks on its own and redraws itself at the top of a new
 * page, tearing one row across two or three sheets. Callers measure the row and break first.
 * The test is the same one pdfkit applies per line (`y + lineHeight > maxY`), so a document that
 * fits on one page today still fits on one page.
 */
export function ensureSpace(doc: PDFKit.PDFDocument, height: number, onNewPage?: () => void): boolean {
  if (doc.y + height <= doc.page.maxY()) return false;
  doc.addPage();
  onNewPage?.();
  return true;
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
  doc.y = ruleY + RULE_HEIGHT;
}

/** One "Label   value" row in the details block. */
export function labeledRow(doc: PDFKit.PDFDocument, label: string, value: string, labelWidth = 190): void {
  // Label and value are two independently positioned cells, so break before the row rather than
  // letting each cell break on its own and land on a different page.
  doc.font('Helvetica').fontSize(9.5);
  ensureSpace(doc, Math.max(textHeight(doc, label, labelWidth), textHeight(doc, value, CONTENT_WIDTH - labelWidth)));
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

/**
 * Large rotated overlay for SPECIMEN previews and CANCELLED copies.
 *
 * Returns the document to the caller's cursor and to the body font before returning: pdfkit keeps
 * the current font, size and fill colour in JavaScript state that `restore()` does not roll back,
 * and this runs from the `pageAdded` handler below, which can fire in the middle of someone else's
 * paragraph.
 */
export function watermark(doc: PDFKit.PDFDocument, text: string): void {
  const { x, y } = doc;
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
  doc.font('Helvetica').fontSize(9.5).fillColor(COLOR_TEXT);
  doc.x = x;
  doc.y = y;
}

/** Draw the overlay on the current page and on every page added after this call. */
export function watermarkEveryPage(doc: PDFKit.PDFDocument, text: string): void {
  watermark(doc, text);
  doc.on('pageAdded', () => watermark(doc, text));
}
