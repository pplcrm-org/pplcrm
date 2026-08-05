// CSV/TSV parsing web worker (shared)
// Receives: { type: 'parse', text: string }
// Posts: { type: 'result', headers: string[], rows: Array<Record<string,string>> } or { type: 'error', message }
//
// The tokenizer parses the whole text with quote-aware state, so a quoted field may
// contain the delimiter and line breaks and still counts as ONE record — matching the
// server's csv-parse behavior. (The old version split into lines before parsing quotes,
// which counted a row with a quoted line break as two rows.)

/** Lines like "Page 3 of 12" that some report exports interleave between data rows. */
const PAGE_MARKER = /^\s*Page\s+\d+\s+of\s+\d+\s*$/i;

/**
 * Bounds past which an opening quote is judged never to have been closed. A quoted cell
 * longer than this, or spanning more lines than this, is far outside anything a real
 * notes/description/details column produces, so the quote is re-read as literal text and
 * the record ends at the next line break. Nothing is dropped when this trips: the parser
 * rewinds to the opening quote and re-reads every character, so the only thing that
 * changes is where the record ends.
 */
const MAX_QUOTED_CELL_CHARS = 100_000;
const MAX_QUOTED_CELL_LINES = 500;

export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** One tokenized record: its trimmed cells plus the raw source text it came from. */
interface CsvRecord {
  cells: string[];
  raw: string;
}

export function detectDelimiter(sample: string[]): string {
  const candidates = [',', '\t', ';'];
  let best: { ch: string; score: number } = { ch: ',', score: -1 };
  for (const ch of candidates) {
    let score = 0;
    for (let i = 0; i < Math.min(sample.length, 5); i++) {
      const line = sample[i] ?? '';
      if (PAGE_MARKER.test(line)) continue;
      score += line.split(ch).length - 1 || 0;
    }
    if (score > best.score) best = { ch, score };
  }
  return best.ch;
}

/**
 * Split `text` (already newline-normalized) into records with quote-aware state:
 * inside double quotes, delimiters and line breaks are field content, and `""` is an
 * escaped quote. Cells are trimmed exactly as the old per-line splitter trimmed them;
 * `raw` keeps each record's source text (minus the terminating newline) so callers can
 * apply the same page-marker and repeated-header checks the line-based parser applied.
 */
function tokenize(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let current = '';
  let raw = '';
  let inQuotes = false;
  // Captured when a quote opens so an unbalanced one can be undone instead of swallowing
  // the rest of the file into one record. No cell or record is emitted while inside
  // quotes, so restoring `current` and `raw` restores the whole parser position.
  let quoteStart = -1;
  let quoteStartCurrent = '';
  let quoteStartRaw = '';
  let quotedChars = 0;
  let quotedLines = 0;
  let quotesAreLiteral = false;

  const endRecord = (): void => {
    cells.push(current);
    records.push({ cells: cells.map((s) => s.trim()), raw });
    cells = [];
    current = '';
    raw = '';
    quotesAreLiteral = false;
  };

  /** Re-scan from the opening quote with quoting switched off until the next line break. */
  const rewindUnbalancedQuote = (): number => {
    current = quoteStartCurrent;
    raw = quoteStartRaw;
    inQuotes = false;
    quotesAreLiteral = true;
    return quoteStart - 1; // the loop's i++ lands back on the opening quote
  };

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length) {
      // Ran out of text with a quote still open: unbalanced, so undo it.
      if (inQuotes) {
        i = rewindUnbalancedQuote();
        continue;
      }
      break;
    }
    const ch = text[i];
    if (inQuotes) {
      quotedChars++;
      if (ch === '\n') quotedLines++;
      if (quotedChars > MAX_QUOTED_CELL_CHARS || quotedLines > MAX_QUOTED_CELL_LINES) {
        i = rewindUnbalancedQuote();
        continue;
      }
      raw += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          raw += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && !quotesAreLiteral) {
      inQuotes = true;
      quoteStart = i;
      quoteStartCurrent = current;
      quoteStartRaw = raw;
      quotedChars = 0;
      quotedLines = 0;
      raw += ch;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
      raw += ch;
    } else if (ch === '\n') {
      endRecord();
    } else {
      current += ch;
      raw += ch;
    }
  }
  if (raw.length > 0 || cells.length > 0 || current.length > 0) endRecord();

  return records;
}

/** Parse a whole CSV/TSV text into headers + rows. Exported for direct unit testing. */
export function parseCsvText(text: string): ParsedCsv {
  const normalized = text.replace(/\r\n?/g, '\n');
  // Delimiter detection samples physical lines, exactly as before — a quoted line break
  // only splits the sample, never changes which delimiter dominates the first rows.
  const delimiter = detectDelimiter(normalized.split('\n'));
  const records = tokenize(normalized, delimiter);

  const headerRecord = records.find((r) => !!r.raw && !PAGE_MARKER.test(r.raw));
  const headers = headerRecord ? headerRecord.cells : [];
  const rows: Array<Record<string, string>> = [];

  for (const record of records) {
    if (!record.raw) continue;
    if (headerRecord && record.raw === headerRecord.raw) continue; // header + repeated header lines
    if (PAGE_MARKER.test(record.raw)) continue;
    if (record.cells.every((c) => !c || c.trim().length === 0)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = record.cells[idx] ?? ''));
    rows.push(row);
  }

  return { headers, rows };
}

// Worker wiring — absent when this module is imported directly in a unit test.
const ctx =
  typeof self === 'undefined'
    ? undefined
    : (self as unknown as { onmessage: (e: MessageEvent) => void; postMessage: (msg: unknown) => void });

if (ctx && typeof Window === 'undefined') {
  ctx.onmessage = (e: MessageEvent) => {
    try {
      const { type, text } = (e.data || {}) as { type?: string; text?: string };
      if (type !== 'parse' || typeof text !== 'string') return;
      const { headers, rows } = parseCsvText(text);
      ctx.postMessage({ type: 'result', headers, rows });
    } catch (err) {
      ctx.postMessage({ type: 'error', message: err instanceof Error && err.message ? err.message : 'Parse failed' });
    }
  };
}
