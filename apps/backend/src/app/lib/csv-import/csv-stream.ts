/**
 * Streaming CSV parsing for the upload-based import path (`import_csv` background jobs).
 *
 * The browser preview parses the file with the hand-written worker in
 * `libs/uxcommon/src/components/csv-import/csv.worker.ts`; this module is the server-side
 * counterpart and must agree with it on the observable choices — delimiter detection, cell
 * trimming, blank-row and "Page N of M" print-artifact skipping — so what the wizard showed is
 * what the job imports. Parsing itself is `csv-parse` rather than a port of the worker, because
 * the worker splits on lines first and therefore cannot handle quoted fields containing
 * newlines; here correctness at full-file scale is the point.
 */
import { parse } from 'csv-parse';
import { once } from 'node:events';

/** Delimiters considered by detection — same candidate set, same order, as the browser worker. */
export const CSV_DELIMITERS = [',', '\t', ';'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** Print-artifact lines some spreadsheet exports carry; both parsers drop them. */
const PAGE_MARKER_RE = /^\s*Page\s+\d+\s+of\s+\d+\s*$/i;

/** How many leading lines delimiter detection scores — matches the browser worker. */
const DETECT_SAMPLE_LINES = 5;

/** Bytes buffered from the stream head to detect the delimiter before parsing starts. */
const SAMPLE_BYTES = 64 * 1024;

/** Strip a UTF-8 BOM so detection sees the same first line the parser will. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('CSV source stream produced a non-binary chunk');
}

/**
 * Pick the delimiter the same way the browser worker's `detectDelimiter` does: score each
 * candidate by its occurrence count across the first five lines (page-marker lines skipped but
 * still consuming their window slot), highest score wins, ties resolved by candidate order
 * (comma first). Keeping the exact semantics is what guarantees the server parses the file the
 * way the wizard previewed it.
 */
export function detectDelimiter(sampleText: string): CsvDelimiter {
  const lines = stripBom(sampleText).replace(/\r\n?/g, '\n').split('\n');
  let best: { ch: CsvDelimiter; score: number } = { ch: ',', score: -1 };
  for (const ch of CSV_DELIMITERS) {
    let score = 0;
    for (let i = 0; i < Math.min(lines.length, DETECT_SAMPLE_LINES); i++) {
      const line = lines[i] ?? '';
      if (PAGE_MARKER_RE.test(line)) continue;
      score += line.split(ch).length - 1;
    }
    if (score > best.score) best = { ch, score };
  }
  return best.ch;
}

export interface CsvStream {
  /** The delimiter actually used — detected from the stream head unless the caller knew it. */
  delimiter: CsvDelimiter;
  /**
   * Every record of the file as trimmed cell arrays, in order, with all-blank records and
   * single-cell "Page N of M" artifacts dropped. The first yielded record is the header row.
   */
  records: AsyncGenerator<string[], void, undefined>;
}

/**
 * Open a CSV byte stream as an async record generator.
 *
 * Buffers at most {@link SAMPLE_BYTES} to detect the delimiter (skipped when `knownDelimiter`
 * is given — the import job detects once in its counting pass and reuses the answer in the
 * insert pass so both passes read the file identically), then feeds the buffered head and the
 * rest of the stream through `csv-parse` with `bom` (UTF-8 BOM stripped), `relax_column_count`
 * (ragged rows tolerated, as the browser worker tolerates them) and `relax_quotes` (a stray
 * quote degrades to a literal character instead of failing the file).
 */
export async function openCsvStream(stream: NodeJS.ReadableStream, knownDelimiter?: CsvDelimiter): Promise<CsvStream> {
  const iterator = (stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const buffered: Buffer[] = [];
  let bufferedBytes = 0;
  let sourceDone = false;
  while (bufferedBytes < SAMPLE_BYTES) {
    const next = await iterator.next();
    if (next.done) {
      sourceDone = true;
      break;
    }
    const chunk = toBuffer(next.value);
    buffered.push(chunk);
    bufferedBytes += chunk.length;
  }
  const delimiter = knownDelimiter ?? detectDelimiter(Buffer.concat(buffered).toString('utf8'));
  return { delimiter, records: recordGenerator(iterator, buffered, sourceDone, delimiter) };
}

async function* recordGenerator(
  iterator: AsyncIterator<unknown>,
  buffered: readonly Buffer[],
  sourceDone: boolean,
  delimiter: CsvDelimiter,
): AsyncGenerator<string[], void, undefined> {
  const parser = parse({
    bom: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  });

  // Writer side: replay the sniffed head, then pump the rest of the source, honouring
  // backpressure. Never rejects — a failure destroys the parser, which surfaces the error to
  // the reader side below as a thrown iteration error.
  const pump = (async (): Promise<void> => {
    try {
      for (const chunk of buffered) {
        if (!parser.write(chunk)) await once(parser, 'drain');
      }
      if (!sourceDone) {
        let next = await iterator.next();
        while (!next.done) {
          if (!parser.write(toBuffer(next.value))) await once(parser, 'drain');
          next = await iterator.next();
        }
      }
      parser.end();
    } catch (err) {
      parser.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  let finished = false;
  try {
    for await (const record of parser as AsyncIterable<unknown>) {
      if (!Array.isArray(record)) continue;
      const cells = record.map((cell) => String(cell ?? '').trim());
      if (cells.every((cell) => cell === '')) continue;
      if (cells.length === 1 && PAGE_MARKER_RE.test(cells[0] ?? '')) continue;
      yield cells;
    }
    await pump;
    finished = true;
  } finally {
    if (!finished) {
      // The consumer stopped early (or iteration threw): tear the parser down so the pump's
      // pending write/drain settles instead of dangling.
      parser.destroy(new Error('CSV record consumer stopped before the end of the file'));
      await pump.catch(() => undefined);
    }
  }
}

/**
 * Apply a saved column mapping (stringified 0-based column index → import field key) to one
 * record, mirroring the wizard's `mappedRows`: values trimmed, blank cells dropped, and when
 * two columns map to the same field the earlier column wins.
 */
export function applyColumnMapping(
  record: readonly string[],
  mapping: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const indexes = Object.keys(mapping)
    .map((key) => Number(key))
    .filter((idx) => Number.isInteger(idx) && idx >= 0)
    .sort((a, b) => a - b);
  for (const idx of indexes) {
    const field = mapping[String(idx)];
    if (!field) continue;
    const value = (record[idx] ?? '').trim();
    if (value && !(field in out)) out[field] = value;
  }
  return out;
}

/** Cell-for-cell equality — used to drop mid-file repeats of the header row, as the worker does. */
export function isSameRecord(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((cell, idx) => cell === b[idx]);
}
