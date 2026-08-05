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

  const endRecord = (): void => {
    cells.push(current);
    records.push({ cells: cells.map((s) => s.trim()), raw });
    cells = [];
    current = '';
    raw = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
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
    } else if (ch === '"') {
      inQuotes = true;
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
