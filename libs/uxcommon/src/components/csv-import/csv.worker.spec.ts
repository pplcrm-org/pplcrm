import { describe, expect, it } from 'vitest';

import { detectDelimiter, parseCsvText } from './csv.worker';

/**
 * The tokenizer must agree with the server's csv-parse: a quoted field may contain the
 * delimiter and line breaks, and still count as ONE row. The old line-based splitter
 * counted a quoted line break as two rows, which is the bug these tests pin.
 */
describe('parseCsvText', () => {
  it('counts a row containing a quoted line break as one row', () => {
    const { headers, rows } = parseCsvText('name,notes\nAmira,"line one\nline two"\nDana,plain\n');

    expect(headers).toEqual(['name', 'notes']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Amira', notes: 'line one\nline two' });
    expect(rows[1]).toEqual({ name: 'Dana', notes: 'plain' });
  });

  it('keeps a quoted delimiter inside the field', () => {
    const { rows } = parseCsvText('name,notes\nAmira,"Hello, world"\n');

    expect(rows).toEqual([{ name: 'Amira', notes: 'Hello, world' }]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const { rows } = parseCsvText('name,notes\nAmira,"She said ""hi"""\n');

    expect(rows).toEqual([{ name: 'Amira', notes: 'She said "hi"' }]);
  });

  it('normalizes CRLF line endings, including inside quoted fields', () => {
    const { rows } = parseCsvText('name,notes\r\nAmira,"one\r\ntwo"\r\nDana,plain\r\n');

    expect(rows).toEqual([
      { name: 'Amira', notes: 'one\ntwo' },
      { name: 'Dana', notes: 'plain' },
    ]);
  });

  it('trims each cell, as the line-based parser did', () => {
    const { rows } = parseCsvText('name,notes\n  Amira  ,  ok  \n');

    expect(rows).toEqual([{ name: 'Amira', notes: 'ok' }]);
  });

  it('skips page-marker lines and repeated header lines from paginated exports', () => {
    const { rows } = parseCsvText('name,notes\nAmira,a\nPage 1 of 2\nname,notes\nDana,b\n');

    expect(rows).toEqual([
      { name: 'Amira', notes: 'a' },
      { name: 'Dana', notes: 'b' },
    ]);
  });

  it('skips blank lines and lines whose cells are all empty', () => {
    const { rows } = parseCsvText('name,notes\n\nAmira,a\n , \n');

    expect(rows).toEqual([{ name: 'Amira', notes: 'a' }]);
  });

  it('parses a final record with no trailing newline', () => {
    const { rows } = parseCsvText('name,notes\nAmira,ok');

    expect(rows).toEqual([{ name: 'Amira', notes: 'ok' }]);
  });

  it('fills missing trailing cells with empty strings', () => {
    const { rows } = parseCsvText('name,notes\nAmira\n');

    expect(rows).toEqual([{ name: 'Amira', notes: '' }]);
  });

  it('still parses tab- and semicolon-delimited files', () => {
    expect(parseCsvText('name\tnotes\nAmira\tok\n').rows).toEqual([{ name: 'Amira', notes: 'ok' }]);
    expect(parseCsvText('name;notes\nAmira;ok\n').rows).toEqual([{ name: 'Amira', notes: 'ok' }]);
  });
});

describe('detectDelimiter', () => {
  it('picks the delimiter that dominates the first sample lines', () => {
    expect(detectDelimiter(['a,b,c', '1,2,3'])).toBe(',');
    expect(detectDelimiter(['a\tb\tc', '1\t2\t3'])).toBe('\t');
    expect(detectDelimiter(['a;b;c', '1;2;3'])).toBe(';');
  });

  it('ignores page-marker lines when sampling', () => {
    expect(detectDelimiter(['Page 1 of 2', 'a;b;c', '1;2;3'])).toBe(';');
  });
});
