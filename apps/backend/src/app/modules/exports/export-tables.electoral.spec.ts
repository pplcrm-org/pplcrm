import { describe, expect, it } from 'vitest';

import { EXPORT_TABLE_COLUMNS, electoralExportColumns } from './export-tables';

/**
 * Naming rules for the electoral columns a households CSV carries.
 *
 * Each header is used twice — once as a Postgres column alias and once, unquoted, in the CSV header
 * line — and both of those quietly corrupt some strings. These tests pin the ways that goes wrong:
 * a label longer than a Postgres identifier, a label containing a comma or a quote, a label that
 * starts like a spreadsheet formula, and two maps whose labels collide with each other or with a
 * real column of `households`.
 */
describe('electoralExportColumns', () => {
  it('gives a workspace with no boundary maps no extra columns', () => {
    expect(electoralExportColumns([], ['id', 'city'])).toEqual([]);
  });

  it('names one column per boundary map, using the map label a person already sees', () => {
    const columns = electoralExportColumns(
      [
        { id: '10', label: 'Ottawa wards 2022' },
        { id: '11', label: 'Precincts / polling divisions (from a spreadsheet)' },
      ],
      ['id', 'city'],
    );

    expect(columns.map((c) => c.header)).toEqual([
      'Ottawa wards 2022',
      'Precincts / polling divisions (from a spreadsheet)',
    ]);
    expect(columns.map((c) => c.setId)).toEqual(['10', '11']);
    // The SQL alias is generated, never derived from the label, so no label can be a SQL identifier.
    expect(columns.map((c) => c.alias)).toEqual(['electoral_area_0', 'electoral_area_1']);
  });

  it('strips the characters that would break the unquoted CSV header line', () => {
    const [column] = electoralExportColumns([{ id: '10', label: 'Wards, "old" map\nrevised' }]);

    expect(column?.header).toBe('Wards old map revised');
    expect(column?.header).not.toContain(',');
    expect(column?.header).not.toContain('"');
    expect(column?.header).not.toContain('\n');
  });

  it('guards a header that would execute as a spreadsheet formula', () => {
    // Cell values get an apostrophe prefix in escapeCsvCell (lib/csv.ts); the header line is
    // written unquoted and skips that function, so the guard has to be applied to the label here.
    const columns = electoralExportColumns([
      { id: '10', label: '=1+1' },
      { id: '11', label: '+SUM(A1:A9)' },
      { id: '12', label: '-2' },
      { id: '13', label: '@cmd' },
    ]);

    expect(columns.map((c) => c.header)).toEqual(["'=1+1", "'+SUM(A1:A9)", "'-2", "'@cmd"]);
  });

  it('keeps a header short enough that Postgres will not truncate the alias', () => {
    const longLabel = 'Congressional districts for the one hundred and nineteenth Congress, revised';
    const [column] = electoralExportColumns([{ id: '10', label: longLabel }]);

    // Postgres truncates an identifier at 63 bytes. A truncated alias comes back on the row under a
    // name the CSV writer never asks for, so every cell in the column would be blank.
    expect(Buffer.byteLength(column?.header ?? '', 'utf8')).toBeLessThanOrEqual(63);
    expect(longLabel.startsWith(column?.header ?? '')).toBe(true);
  });

  it('counts multi-byte characters as bytes, not as characters', () => {
    const [column] = electoralExportColumns([
      { id: '10', label: 'Circonscriptions québécoises — édition révisée 2026 et suivantes' },
    ]);

    expect(Buffer.byteLength(column?.header ?? '', 'utf8')).toBeLessThanOrEqual(63);
  });

  it('disambiguates two maps that share a label', () => {
    const columns = electoralExportColumns([
      { id: '10', label: 'Wards' },
      { id: '11', label: 'Wards' },
      { id: '12', label: 'Wards' },
    ]);

    expect(columns.map((c) => c.header)).toEqual(['Wards', 'Wards (2)', 'Wards (3)']);
  });

  it('never reuses the name of a column already in the CSV', () => {
    // Two columns with the same name would collide: the CSV writer looks each one up by name on the
    // streamed row, so the second would silently print the first one's value.
    const columns = electoralExportColumns([{ id: '10', label: 'notes' }], EXPORT_TABLE_COLUMNS['households'] ?? []);

    expect(columns[0]?.header).toBe('notes (2)');
  });

  it('falls back to a positional name when a label is blank', () => {
    const columns = electoralExportColumns([{ id: '10', label: '   ' }]);

    expect(columns[0]?.header).toBe('Boundary map 1');
  });
});
