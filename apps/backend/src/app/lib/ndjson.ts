/**
 * NDJSON helpers for the stored CSV-import payload.
 *
 * Import payloads used to be stored as ONE giant JSON array; the job handler
 * then materialized blob → UTF-8 string → parsed array (three full copies) and
 * kept every row object alive for the whole import. At the supported scale
 * (200k-household imports — see lib/gis/geocode-queue.ts) that can OOM-kill the
 * worker container.
 *
 * The payload is now written as NDJSON (one JSON object per line) and read
 * back lazily: the base string is unavoidable with a Buffer download, but rows
 * are parsed one line at a time via index-scanning generators, so only the
 * current chunk of rows exists beyond that string.
 */

/** One stored import row: a flat object of string cell values keyed by column name. */
export type StoredImportRow = Record<string, string>;

/** Rows per downstream processing chunk — matches the historical slice size in every processImportRows. */
export const IMPORT_CHUNK_SIZE = 100;

// 2026-08-05: `serializeRowsToNdjson` and `NDJSON_CONTENT_TYPE` were deleted with the legacy
// rows-in-body import intake — nothing writes NDJSON payload blobs anymore. The READERS below
// stay for now: `handleImportJob` (lib/jobs/handlers/import.handlers.ts) still drains legacy
// jobs enqueued before that deploy, whose payload blobs are already in storage. Once that
// handler is deleted (next release), the NDJSON/legacy-array readers can go with it;
// `chunkRows` and `IMPORT_CHUNK_SIZE` are used by every processImportRows and stay regardless.

/**
 * True when the payload text is the legacy single-JSON-array format (first
 * non-whitespace character is `[`). NDJSON payloads start with `{`.
 */
export function isLegacyJsonArrayPayload(text: string): boolean {
  return /^\s*\[/.test(text);
}

/**
 * Lazily yield the non-blank lines of `text` by scanning indexes — never
 * `String.split('\n')`, which would materialize every line at once.
 */
export function* iterateLines(text: string): Generator<string, void, undefined> {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    // Tolerate CRLF line endings even though the writer only emits '\n'.
    const sliceEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    const line = text.slice(start, sliceEnd);
    if (/\S/.test(line)) yield line;
    start = end + 1;
  }
}

/**
 * Narrow one parsed payload element to a row object. Non-object elements mean
 * a corrupt payload and throw; non-string cell values (JSON has no undefined,
 * and the writers only ever serialize string cells) are dropped, which is how
 * the downstream sanitizers treat them anyway.
 */
export function toStoredImportRow(value: unknown): StoredImportRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Import payload row is not a JSON object');
  }
  const row: StoredImportRow = {};
  for (const [key, cell] of Object.entries(value)) {
    if (typeof cell === 'string') row[key] = cell;
  }
  return row;
}

/** Lazily parse an NDJSON payload into rows, one line at a time. */
export function* importRowsFromNdjson(text: string): Generator<StoredImportRow, void, undefined> {
  for (const line of iterateLines(text)) {
    yield toStoredImportRow(JSON.parse(line));
  }
}

/**
 * Parse a legacy single-JSON-array payload into rows. Materializes the whole
 * array — only used for payloads already in storage from before the NDJSON
 * switch.
 */
export function importRowsFromLegacyJsonArray(text: string): StoredImportRow[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('Legacy import payload is not a JSON array');
  }
  return parsed.map(toStoredImportRow);
}

/**
 * Batch any (a)sync row source into arrays of at most `size`, yielding each
 * batch as soon as it fills so the source is never fully materialized.
 */
export async function* chunkRows<T>(
  source: Iterable<T> | AsyncIterable<T>,
  size: number,
): AsyncGenerator<T[], void, undefined> {
  let chunk: T[] = [];
  for await (const item of source) {
    chunk.push(item);
    if (chunk.length >= size) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk;
}
