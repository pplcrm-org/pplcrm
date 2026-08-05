import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  CSV_PARSER_FIXTURES,
  type CsvParserFixture,
} from '../../../../../../libs/common/src/lib/testing/csv-parser-fixtures';
import { detectDelimiter, isSameRecord, openCsvStream } from './csv-stream';

/**
 * Server half of the parser-agreement contract: every shared fixture in
 * libs/common/src/lib/testing/csv-parser-fixtures.ts is parsed here through the same steps the
 * `import_csv` job uses (openCsvStream, then the streamValidCsvRows header/repeat drop), and the
 * result must match the SAME expectations the browser preview parser is held to in
 * libs/uxcommon/src/components/csv-import/csv-parser-agreement.spec.ts. A change that makes the
 * two parsers disagree fails one of the two files.
 */

async function parseWithServerPipeline(fixture: CsvParserFixture): Promise<{ headers: string[]; rows: string[][] }> {
  const { records } = await openCsvStream(Readable.from([Buffer.from(fixture.text, 'utf8')]));
  let headers: string[] | null = null;
  const rows: string[][] = [];
  for await (const record of records) {
    if (headers === null) {
      headers = record;
      continue;
    }
    // streamValidCsvRows drops mid-file repeats of the header row exactly this way.
    if (isSameRecord(record, headers)) continue;
    rows.push(record);
  }
  return { headers: headers ?? [], rows };
}

describe('server CSV parser vs the shared browser/server fixtures', () => {
  for (const fixture of CSV_PARSER_FIXTURES) {
    it(fixture.name, async () => {
      expect(detectDelimiter(fixture.text)).toBe(fixture.delimiter);
      const parsed = await parseWithServerPipeline(fixture);
      expect(parsed.headers).toEqual(fixture.headers);
      expect(parsed.rows).toEqual(fixture.rows);
    });
  }
});
