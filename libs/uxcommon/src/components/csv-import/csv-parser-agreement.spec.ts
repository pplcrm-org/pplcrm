import { describe, expect, it } from 'vitest';

import { CSV_PARSER_FIXTURES, csvFixtureRowsAsObjects } from '../../../../common/src/lib/testing/csv-parser-fixtures';
import { detectDelimiter, parseCsvText } from './csv.worker';

/**
 * Browser half of the parser-agreement contract: every shared fixture in
 * libs/common/src/lib/testing/csv-parser-fixtures.ts is parsed here with the preview worker's
 * parser, and the result must match the SAME expectations the server streaming parser is held to
 * in apps/backend/src/app/lib/csv-import/csv-parser-agreement.spec.ts. A change that makes the
 * two parsers disagree fails one of the two files.
 */
describe('browser CSV parser vs the shared browser/server fixtures', () => {
  for (const fixture of CSV_PARSER_FIXTURES) {
    it(fixture.name, () => {
      // Delimiter detection samples physical lines, exactly as parseCsvText itself samples them.
      const sampleLines = fixture.text.replace(/\r\n?/g, '\n').split('\n');
      expect(detectDelimiter(sampleLines)).toBe(fixture.delimiter);

      const { headers, rows } = parseCsvText(fixture.text);
      expect(headers).toEqual(fixture.headers);
      expect(rows).toEqual(csvFixtureRowsAsObjects(fixture));
    });
  }
});
