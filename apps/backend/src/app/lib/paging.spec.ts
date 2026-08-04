import { describe, expect, it } from 'vitest';

import { MAX_PAGE_SIZE, MAX_ROW_OFFSET } from '../../../../../libs/common/src';
import { clampPageLimit, clampRowOffset, resolvePageWindow } from './paging';

describe('clampRowOffset', () => {
  it('passes a normal offset through', () => {
    expect(clampRowOffset(0)).toBe(0);
    expect(clampRowOffset(75)).toBe(75);
  });

  it('turns anything Postgres would reject into 0', () => {
    expect(clampRowOffset(-1)).toBe(0);
    expect(clampRowOffset(Number.NaN)).toBe(0);
    expect(clampRowOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampRowOffset(undefined)).toBe(0);
    expect(clampRowOffset(null)).toBe(0);
    expect(clampRowOffset('25')).toBe(0);
  });

  it('floors a fractional offset instead of sending a float to Postgres', () => {
    expect(clampRowOffset(25.7)).toBe(25);
  });

  it('caps at MAX_ROW_OFFSET', () => {
    expect(clampRowOffset(MAX_ROW_OFFSET + 1_000)).toBe(MAX_ROW_OFFSET);
  });
});

describe('clampPageLimit', () => {
  it('passes a normal page size through', () => {
    expect(clampPageLimit(25)).toBe(25);
    expect(clampPageLimit(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('caps an oversized request at MAX_PAGE_SIZE', () => {
    expect(clampPageLimit(MAX_PAGE_SIZE + 1)).toBe(MAX_PAGE_SIZE);
    expect(clampPageLimit(10_000_000)).toBe(MAX_PAGE_SIZE);
  });

  it('honours a smaller per-caller ceiling but never a larger one', () => {
    expect(clampPageLimit(500, 100)).toBe(100);
    expect(clampPageLimit(10_000_000, MAX_PAGE_SIZE * 100)).toBe(MAX_PAGE_SIZE);
  });

  it('returns 0 for anything unusable, so a malformed request reads nothing', () => {
    expect(clampPageLimit(-5)).toBe(0);
    expect(clampPageLimit(Number.NaN)).toBe(0);
    expect(clampPageLimit(undefined)).toBe(0);
    expect(clampPageLimit('100')).toBe(0);
  });
});

describe('resolvePageWindow', () => {
  it('resolves an ordinary grid page unchanged', () => {
    expect(resolvePageWindow({ startRow: 50, endRow: 75 })).toEqual({ offset: 50, limit: 25 });
  });

  it('caps the span, which is the whole point — startRow and endRow are each legal on their own', () => {
    expect(resolvePageWindow({ startRow: 0, endRow: 10_000_000 })).toEqual({
      offset: 0,
      limit: MAX_PAGE_SIZE,
    });
  });

  it('falls back to the given default when no paging is supplied at all', () => {
    expect(resolvePageWindow(undefined, 100)).toEqual({ offset: 0, limit: 100 });
    expect(resolvePageWindow({}, 100)).toEqual({ offset: 0, limit: 100 });
  });

  it('defaults to MAX_PAGE_SIZE when no default is given', () => {
    expect(resolvePageWindow({})).toEqual({ offset: 0, limit: MAX_PAGE_SIZE });
  });

  it('never lets a caller-supplied default exceed MAX_PAGE_SIZE', () => {
    expect(resolvePageWindow({}, 10_000_000).limit).toBe(MAX_PAGE_SIZE);
  });

  it('honours endRow === startRow as a genuine count-only request', () => {
    // The list member-count path asks for { startRow: 0, endRow: 0 } and reads only `count`.
    expect(resolvePageWindow({ startRow: 0, endRow: 0 }, 100)).toEqual({ offset: 0, limit: 0 });
  });

  it('falls back to the default when endRow is below startRow', () => {
    expect(resolvePageWindow({ startRow: 100, endRow: 10 }, 50)).toEqual({ offset: 100, limit: 50 });
  });

  it('sanitises negative and fractional input rather than passing it to Postgres', () => {
    expect(resolvePageWindow({ startRow: -10, endRow: 25 }, 100)).toEqual({ offset: 0, limit: 25 });
    expect(resolvePageWindow({ startRow: 10.9, endRow: 35.9 }, 100)).toEqual({ offset: 10, limit: 25 });
  });
});
