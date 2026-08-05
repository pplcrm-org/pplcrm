/**
 * Shared CSV-parsing fixtures asserting that the TWO CSV parsers in this repo agree.
 *
 * There are two independent parsers of the same uploaded file:
 *  - the server streaming parser (`apps/backend/src/app/lib/csv-import/csv-stream.ts`, csv-parse
 *    based), which the `import_csv` background job uses to actually import the rows, and
 *  - the browser preview parser (`libs/uxcommon/src/components/csv-import/csv.worker.ts`, a
 *    hand-written quote-aware tokenizer), which the import wizard uses to show the file.
 *
 * Every fixture here is asserted against by BOTH sides — the backend spec
 * `apps/backend/src/app/lib/csv-import/csv-parser-agreement.spec.ts` and the uxcommon spec
 * `libs/uxcommon/src/components/csv-import/csv-parser-agreement.spec.ts` — so a change that makes
 * the parsers disagree on delimiter detection, row splitting, quoting, trimming, or the shared
 * drop rules (blank rows, "Page N of M" artifacts, repeated headers) fails a test on the side
 * that drifted.
 *
 * This module lives in libs/common because it is the only package both sides may import
 * (uxcommon must not be imported by the backend, and vice versa). It is deliberately NOT
 * exported from the `@common` barrel: it is test-only data, consumed by the two specs via a
 * direct path import, and keeping it out of the barrel keeps it out of the production surface.
 *
 * Known, deliberate limits of the shared expectations:
 *  - No ragged rows: the server keeps extra/missing cells as-is while the browser preview keys
 *    cells by header (padding short rows, dropping extras). Each side pins its own behavior in
 *    its own spec; the shared fixtures only cover shapes where one expectation fits both.
 *  - A quoted line break is expressed with LF: the browser worker normalizes CRLF everywhere
 *    (including inside quotes) while the server preserves quoted bytes verbatim, so a quoted
 *    CRLF parses as "a\r\nb" on the server and "a\nb" in the preview. Both still count ONE row.
 */

/** The delimiter candidate set both detectors score, in the shared priority order. */
export type CsvFixtureDelimiter = ',' | '\t' | ';';

export interface CsvParserFixture {
  /** Test name on both sides. */
  name: string;
  /** The raw file text exactly as uploaded — BOM, CRLF, missing trailing newline included. */
  text: string;
  /** The delimiter both detectors must choose for this text. */
  delimiter: CsvFixtureDelimiter;
  /** The header cells both parsers must produce. */
  headers: string[];
  /**
   * The data rows both parsers must produce, as trimmed cell arrays in file order, after the
   * shared drop rules: blank/all-blank records, single-cell "Page N of M" artifacts, and
   * mid-file repeats of the header row.
   */
  rows: string[][];
}

export const CSV_PARSER_FIXTURES: readonly CsvParserFixture[] = [
  {
    name: 'a quoted field containing a line break is one row',
    text: 'name,notes\nAmira,"line one\nline two"\nDana,plain\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'line one\nline two'],
      ['Dana', 'plain'],
    ],
  },
  {
    name: 'a quoted field containing the delimiter stays one cell',
    text: 'name,notes\n"Doe, Jane",ok\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [['Doe, Jane', 'ok']],
  },
  {
    name: 'doubled quotes inside a quoted field unescape to one quote',
    text: 'name,notes\nAmira,"She said ""hi"""\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [['Amira', 'She said "hi"']],
  },
  {
    name: 'CRLF line endings terminate rows like LF',
    text: 'name,notes\r\nAmira,one\r\nDana,two\r\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'one'],
      ['Dana', 'two'],
    ],
  },
  {
    name: 'a UTF-8 BOM never reaches the first header cell',
    text: '﻿name,notes\nAmira,ok\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [['Amira', 'ok']],
  },
  {
    name: 'a semicolon-delimited file is detected and split on semicolons',
    text: 'name;notes\nAmira;ok\nDana;fine\n',
    delimiter: ';',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'ok'],
      ['Dana', 'fine'],
    ],
  },
  {
    name: 'a tab-delimited file is detected and split on tabs',
    text: 'name\tnotes\nAmira\tok\nDana\tfine\n',
    delimiter: '\t',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'ok'],
      ['Dana', 'fine'],
    ],
  },
  {
    name: '"Page N of M" print-artifact lines are dropped',
    text: 'name,notes\nAmira,a\nPage 1 of 2\nDana,b\nPage 2 of 2\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'a'],
      ['Dana', 'b'],
    ],
  },
  {
    name: 'a mid-file repeat of the header row is dropped',
    text: 'name,notes\nAmira,a\nname,notes\nDana,b\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'a'],
      ['Dana', 'b'],
    ],
  },
  {
    name: 'blank lines and all-blank records are dropped',
    text: 'name,notes\n\nAmira,a\n , \nDana,b\n\n',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [
      ['Amira', 'a'],
      ['Dana', 'b'],
    ],
  },
  {
    name: 'a final record with no trailing newline still parses',
    text: 'name,notes\nAmira,ok',
    delimiter: ',',
    headers: ['name', 'notes'],
    rows: [['Amira', 'ok']],
  },
];

/**
 * The fixture's expected rows in the browser preview's shape: one object per row, keyed by
 * header. Derived from the shared cell-array expectation so the two shapes cannot drift.
 */
export function csvFixtureRowsAsObjects(fixture: CsvParserFixture): Array<Record<string, string>> {
  return fixture.rows.map((cells) =>
    Object.fromEntries(fixture.headers.map((header, idx) => [header, cells[idx] ?? ''])),
  );
}
