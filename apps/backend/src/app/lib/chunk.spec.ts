import { describe, expect, it } from 'vitest';

import { ID_CHUNK_SIZE, chunk } from './chunk';

describe('chunk', () => {
  it('splits into consecutive slices with the remainder last, preserving order', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunk([1], 2)).toEqual([[1]]);
  });

  it('returns no chunks for an empty list, so a caller loop simply does not run', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('defaults to the id-list chunk size, which stays under the bind-parameter cap', () => {
    expect(ID_CHUNK_SIZE * 6).toBeLessThan(65535); // six bound columns per row still fits
    const ids = Array.from({ length: ID_CHUNK_SIZE + 1 }, (_, i) => i);
    const out = chunk(ids);
    expect(out.map((c) => c.length)).toEqual([ID_CHUNK_SIZE, 1]);
  });

  it('refuses a size that could never terminate or would mis-slice', () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -2)).toThrow();
    expect(() => chunk([1], 2.5)).toThrow();
  });
});
