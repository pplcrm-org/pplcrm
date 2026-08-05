import { describe, expect, it } from 'vitest';

import {
  IMPORT_CHUNK_SIZE,
  chunkRows,
  importRowsFromLegacyJsonArray,
  importRowsFromNdjson,
  isLegacyJsonArrayPayload,
  iterateLines,
  toStoredImportRow,
} from './ndjson';

/** Inline NDJSON writer — the production writer (`serializeRowsToNdjson`) was deleted with the
 * legacy rows-in-body intake (2026-08-05); the readers stay to drain already-stored payloads,
 * so the read tests build their input the way the retired writer did. */
function ndjsonText(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

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

describe('importRowsFromNdjson round-trip over stored-payload text', () => {
  it('yields the exact same rows in the same order', () => {
    const rows = sampleRows(253);
    const text = ndjsonText(rows);
    const back = [...importRowsFromNdjson(text)];
    expect(back).toHaveLength(rows.length);
    expect(back).toEqual(rows);
  });

  it('reads JSON-escaped embedded newlines back as one row per line', () => {
    const rows = [{ notes: 'line one\nline two' }, { notes: 'plain' }];
    const text = ndjsonText(rows);
    expect(text.split('\n')).toHaveLength(2);
    expect([...importRowsFromNdjson(text)]).toEqual(rows);
  });

  it('handles an empty payload', () => {
    expect([...importRowsFromNdjson('')]).toEqual([]);
    expect(ndjsonText([])).toBe('');
  });
});

describe('isLegacyJsonArrayPayload', () => {
  it('detects a JSON array, with or without leading whitespace', () => {
    expect(isLegacyJsonArrayPayload('[{"a":"1"}]')).toBe(true);
    expect(isLegacyJsonArrayPayload('  \n\t[{"a":"1"}]')).toBe(true);
  });

  it('treats NDJSON (and empty text) as non-legacy', () => {
    expect(isLegacyJsonArrayPayload('{"a":"1"}\n{"a":"2"}')).toBe(false);
    expect(isLegacyJsonArrayPayload('')).toBe(false);
  });
});

describe('importRowsFromLegacyJsonArray', () => {
  it('parses a legacy array payload into the same rows', () => {
    const rows = sampleRows(7);
    expect(importRowsFromLegacyJsonArray(JSON.stringify(rows))).toEqual(rows);
  });

  it('rejects a payload that is not an array', () => {
    expect(() => importRowsFromLegacyJsonArray('{"a":"1"}')).toThrow(/not a JSON array/);
  });
});

describe('iterateLines', () => {
  it('skips blank lines and tolerates CRLF and trailing newlines', () => {
    const text = 'one\r\n\n  \ntwo\nthree\n';
    expect([...iterateLines(text)]).toEqual(['one', 'two', 'three']);
  });
});

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
