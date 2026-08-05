/**
 * Shared row-shape helpers for the streamed CSV import pipeline: the flat row
 * object the per-entity processors consume, and chunking of a lazy row source.
 *
 * (This file was `ndjson.ts` until 2026-08-05, when the readers for the legacy
 * pre-mapped payload blobs were deleted with the rest of the legacy import
 * path; only these format-agnostic helpers remained, so the file was renamed.)
 */

/** One import row: a flat object of string cell values keyed by column name. */
export type StoredImportRow = Record<string, string>;

/** Rows per downstream processing chunk — matches the historical slice size in every processImportRows. */
export const IMPORT_CHUNK_SIZE = 100;

/**
 * Narrow one parsed row value to the flat row shape. Non-object values mean a
 * corrupt row and throw; non-string cell values are dropped, which is how the
 * downstream sanitizers treat them anyway.
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
