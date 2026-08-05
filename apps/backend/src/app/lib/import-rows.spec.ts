import { describe, expect, it } from 'vitest';

import { IMPORT_CHUNK_SIZE, chunkRows, toStoredImportRow } from './import-rows';

function sampleRows(count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({
    first_name: `First-${i}`,
    last_name: `Last-${i}`,
    email: `person${i}@example.com`,
    notes: i % 7 === 0 ? 'has "quotes" and\nnewlines and, commas' : '',
  }));
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe('toStoredImportRow', () => {
  it('keeps string cells and drops non-string cells', () => {
    expect(toStoredImportRow({ a: 'x', b: 2, c: null, d: 'y' })).toEqual({ a: 'x', d: 'y' });
  });

  it('throws on non-object elements', () => {
    expect(() => toStoredImportRow('nope')).toThrow(/not a JSON object/);
    expect(() => toStoredImportRow(['nope'])).toThrow(/not a JSON object/);
    expect(() => toStoredImportRow(null)).toThrow(/not a JSON object/);
  });
});

describe('chunkRows', () => {
  it('splits a source that is not a multiple of the chunk size without losing rows', async () => {
    const rows = sampleRows(2 * IMPORT_CHUNK_SIZE + 5);
    const chunks = await collect(chunkRows(rows, IMPORT_CHUNK_SIZE));
    expect(chunks.map((c) => c.length)).toEqual([IMPORT_CHUNK_SIZE, IMPORT_CHUNK_SIZE, 5]);
    expect(chunks.flat()).toEqual(rows);
  });

  it('handles exact multiples and empty sources', async () => {
    expect((await collect(chunkRows(sampleRows(IMPORT_CHUNK_SIZE), IMPORT_CHUNK_SIZE))).map((c) => c.length)).toEqual([
      IMPORT_CHUNK_SIZE,
    ]);
    expect(await collect(chunkRows([], IMPORT_CHUNK_SIZE))).toEqual([]);
  });

  it('consumes a lazy generator chunk by chunk, never all at once', async () => {
    let produced = 0;
    function* gen(): Generator<Record<string, string>, void, undefined> {
      for (let i = 0; i < 250; i++) {
        produced++;
        yield { n: String(i) };
      }
    }
    const iterator = chunkRows(gen(), 100);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (!first.done) expect(first.value).toHaveLength(100);
    // Only the first chunk (plus the one row buffered by the generator protocol
    // at most) has been pulled from the source so far.
    expect(produced).toBeLessThanOrEqual(101);
    const rest = await collect(iterator);
    expect(rest.map((c) => c.length)).toEqual([100, 50]);
    expect(produced).toBe(250);
  });
});
