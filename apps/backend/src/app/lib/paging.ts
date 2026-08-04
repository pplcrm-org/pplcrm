import { MAX_PAGE_SIZE, MAX_ROW_OFFSET } from '../../../../../libs/common/src';

/**
 * The backstop for list paging.
 *
 * `getAllOptions` (libs/common) already refuses a request whose `endRow - startRow` span is
 * bigger than one page, and that is where a caller gets a clear 400. This module is the second
 * layer: every repository that turns `startRow`/`endRow` into a SQL `LIMIT` runs the numbers
 * through here first, so a caller that reaches a repository without passing the schema — an
 * internal caller, a REST handler, a future router that forgets the shared input — still cannot
 * ask Postgres for an unbounded read.
 *
 * Repositories used to hand-roll this, sixteen slightly different ways: some defaulted to 100
 * rows, some to 50, three emitted no `LIMIT` clause at all when both paging fields were absent,
 * and exactly one clamped the span. That is why this lives in one place.
 */

/** SQL `OFFSET` and `LIMIT` for one list query. */
export interface PageWindow {
  /** Rows to skip. Always a non-negative integer. */
  readonly offset: number;
  /** Rows to return. Always an integer in `[0, MAX_PAGE_SIZE]`. */
  readonly limit: number;
}

/**
 * Coerce a caller-supplied row index into a `OFFSET` value Postgres will accept.
 *
 * A negative or fractional number is a client bug, not an attack, but it reaches Postgres as a
 * bound parameter and raises `LIMIT must not be negative` / `invalid input syntax for type
 * bigint` — a 500 and a log entry rather than an answer. Anything unusable becomes 0.
 */
export function clampRowOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_ROW_OFFSET);
}

/**
 * Coerce a requested row count into a `LIMIT` value, never above `max` (default `MAX_PAGE_SIZE`).
 * Anything unusable becomes 0, so a malformed request returns nothing rather than everything.
 */
export function clampPageLimit(value: unknown, max: number = MAX_PAGE_SIZE): number {
  const ceiling = Math.max(0, Math.min(Math.floor(max), MAX_PAGE_SIZE));
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), ceiling);
}

/**
 * Resolve the AG-Grid-style `startRow`/`endRow` pair into a bounded `{ offset, limit }`.
 *
 * `endRow` is exclusive, so the requested span is `endRow - startRow`. An `endRow` that is
 * missing, unusable, or below `startRow` falls back to `defaultLimit` — which is what a caller
 * that sends no paging at all gets, and is the reason such a caller can no longer read a whole
 * table. An `endRow` equal to `startRow` is honoured as a genuine "count only, no rows" request;
 * the list member-count path relies on that.
 */
export function resolvePageWindow(
  options: { startRow?: number | null; endRow?: number | null } | undefined,
  defaultLimit: number = MAX_PAGE_SIZE,
): PageWindow {
  const offset = clampRowOffset(options?.startRow);
  const endRow = options?.endRow;
  const requested =
    typeof endRow === 'number' && Number.isFinite(endRow) && endRow >= offset ? endRow - offset : defaultLimit;
  return { offset, limit: clampPageLimit(requested) };
}
