import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { applyColumnMapping, detectDelimiter, isSameRecord, openCsvStream } from './csv-stream';

async function collect(text: string | Buffer, delimiter?: ',' | '\t' | ';'): Promise<string[][]> {
  const buffer = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
  const { records } = await openCsvStream(Readable.from([buffer]), delimiter);
  const out: string[][] = [];
  for await (const record of records) out.push(record);
  return out;
}

describe('detectDelimiter', () => {
  it('detects a comma file', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
  });

  it('detects a tab file', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
  });

  it('detects a semicolon file', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';');
  });

  it('prefers the comma on a tie — same priority order as the browser worker', () => {
    // Zero of every candidate: the worker's candidate order makes comma the answer.
    expect(detectDelimiter('one\ntwo\n')).toBe(',');
  });

  it('ignores "Page N of M" print-artifact lines when scoring', () => {
    // The page line contains no delimiters at all; a semicolon body should still win over
    // the comma even though the page line eats one of the five sample slots.
    expect(detectDelimiter('Page 1 of 3\na;b;c\n1;2;3\n')).toBe(';');
  });

  it('is not confused by a leading BOM', () => {
    expect(detectDelimiter('﻿a;b\n1;2\n')).toBe(';');
  });
});

describe('openCsvStream', () => {
  it('parses quoted fields containing commas and newlines', async () => {
    const records = await collect('name,notes\n"Doe, Jane","line one\nline two"\n');
    expect(records).toEqual([
      ['name', 'notes'],
      ['Doe, Jane', 'line one\nline two'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header cell is clean', async () => {
    const records = await collect(Buffer.from('﻿first,second\na,b\n', 'utf8'));
    expect(records[0]).toEqual(['first', 'second']);
  });

  it('tolerates CRLF line endings', async () => {
    const records = await collect('a,b\r\n1,2\r\n');
    expect(records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank lines, all-blank records and "Page N of M" artifacts', async () => {
    const records = await collect('a,b\n\n , \nPage 1 of 2\n1,2\n');
    expect(records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('trims every cell, like the browser worker does', async () => {
    const records = await collect('a, b \n 1 ,2\n');
    expect(records).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('tolerates ragged rows (missing and extra columns)', async () => {
    const records = await collect('a,b,c\n1,2\n1,2,3,4\n');
    expect(records).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('detects the delimiter from the stream head and reports it', async () => {
    const { delimiter, records } = await openCsvStream(Readable.from([Buffer.from('a;b\n1;2\n', 'utf8')]));
    expect(delimiter).toBe(';');
    const out: string[][] = [];
    for await (const record of records) out.push(record);
    expect(out).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('uses a caller-supplied delimiter instead of detecting', async () => {
    // One semicolon-less line would auto-detect comma; the explicit tab must win.
    const records = await collect('a\tb,c\n1\t2,3\n', '\t');
    expect(records).toEqual([
      ['a', 'b,c'],
      ['1', '2,3'],
    ]);
  });

  it('streams files larger than the 64 KiB sniff buffer intact', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `name${i},${'x'.repeat(30)}`);
    const text = `name,notes\n${rows.join('\n')}\n`;
    // Feed as many small chunks to exercise the buffered-head + pump path.
    const buffer = Buffer.from(text, 'utf8');
    const chunks: Buffer[] = [];
    for (let i = 0; i < buffer.length; i += 8192) chunks.push(buffer.subarray(i, i + 8192));
    const { records } = await openCsvStream(Readable.from(chunks));
    let count = 0;
    let last: string[] = [];
    for await (const record of records) {
      count += 1;
      last = record;
    }
    expect(count).toBe(5001); // header + 5000 data rows
    expect(last[0]).toBe('name4999');
  });
});

describe('applyColumnMapping', () => {
  it('keeps only mapped columns, keyed by field', () => {
    const mapped = applyColumnMapping(['Jane', 'Doe', 'jane@example.com', 'ignored'], {
      '0': 'first_name',
      '2': 'email',
    });
    expect(mapped).toEqual({ first_name: 'Jane', email: 'jane@example.com' });
  });

  it('drops blank cells instead of writing empty fields', () => {
    expect(applyColumnMapping(['', '  ', 'x'], { '0': 'a', '1': 'b', '2': 'c' })).toEqual({ c: 'x' });
  });

  it('lets the earlier column win when two columns map to the same field', () => {
    expect(applyColumnMapping(['first', 'second'], { '0': 'email', '1': 'email' })).toEqual({ email: 'first' });
  });

  it('reads columns by position, so duplicate header names cannot collide', () => {
    // Two "Phone" columns in the file: index keys address each independently.
    expect(applyColumnMapping(['555-1', '555-2'], { '0': 'mobile', '1': 'home_phone' })).toEqual({
      mobile: '555-1',
      home_phone: '555-2',
    });
  });

  it('ignores indexes beyond the record length', () => {
    expect(applyColumnMapping(['only'], { '0': 'a', '5': 'b' })).toEqual({ a: 'only' });
  });
});

describe('isSameRecord', () => {
  it('matches only cell-for-cell identical records', () => {
    expect(isSameRecord(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSameRecord(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(isSameRecord(['a'], ['a', ''])).toBe(false);
  });
});
