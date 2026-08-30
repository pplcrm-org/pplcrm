/**
 * Postgres caps one statement at 65,535 bind parameters, and Kysely binds every element of a
 * `where('col', 'in', ids)` array as its own parameter. Any id list that can grow with tenant
 * data (a smart list's whole membership, a turf's doors after refreshes) therefore has to be
 * split before it reaches a query — one oversized list makes the statement fail outright, not
 * degrade. 10,000 stays far under the cap while keeping the round-trip count low (a 100k-id
 * universe is 10 queries).
 */
export const ID_CHUNK_SIZE = 10_000;

/** Split `items` into consecutive slices of at most `size` (the last one may be shorter). */
export function chunk<T>(items: readonly T[], size: number = ID_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk: size must be a positive integer, got ${String(size)}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
