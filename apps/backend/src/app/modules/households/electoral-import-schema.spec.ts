import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Fail-open verification is unit-tested in import-verification.spec.ts; stubbed here so these
// tests never resolve DNS.
vi.mock('../../lib/jobs/handlers/import-verification', () => ({
  runImportEmailVerification: vi.fn(async () => null),
}));

import type { Kysely } from 'kysely';
import {
  HouseholdsImportMappingObj,
  HouseholdsImportRowObj,
  PersonsImportMappingObj,
  PersonsImportRowObj,
} from '../../../../../../libs/common/src';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { handleImportCsvJob } from '../../lib/jobs/handlers/import.handlers';
import { ImportsRepo } from '../imports/repositories/imports.repo';
import { PersonsService } from '../persons/services/persons.service';
import { StorageService } from '../../lib/storage.service';
import { HouseholdsController } from './controller';
import { IMPORTED_AREA_SETS } from './electoral-areas';
import { ELECTORAL_IMPORT_ROW_FIELDS } from './electoral-import-schema';

/**
 * The bug this file exists to prevent: import rows are validated against a Zod object, and a
 * Zod object silently DROPS every key it does not name. So a district column the wizard mapped
 * was discarded, the import still succeeded, and the districts simply never arrived — nothing
 * failed and nothing was logged.
 *
 * Since the upload-based intake replaced rows-in-body (2026-08-05), the boundary is in two
 * places: the mutation's MAPPING schema (which field keys a column may map to) and the
 * `import_csv` job's row validation (which mapped keys survive to the entity processors).
 * These tests pin both: the mapping schemas accept every electoral field, and a CSV streamed
 * through the real job handler delivers the district columns to the processors intact.
 */

/** A voter file's district columns, as the import wizard maps them. */
const DISTRICT_COLUMNS = {
  electoral_district: 'Ottawa Centre',
  congressional_district: 'OH-3',
  legislative_district: '18',
  state_house_district: '21',
  state_senate_district: '15',
  ward: 'Ward 5',
  precinct: 'Precinct 12',
};

const DISTRICT_FIELDS = Object.keys(DISTRICT_COLUMNS);

/** Scripted DB stand-in (same idiom as import.handlers.csv.spec.ts): undefined everywhere =
 * fresh run, no tenant plan row (fails closed to Free's cap — far above these tiny files). */
function makeScriptedDb(): Kysely<Models> {
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where', 'values']) b[m] = vi.fn(() => b);
  b.insertInto = vi.fn(() => b);
  b.execute = vi.fn(async () => []);
  b.executeTakeFirst = vi.fn(async () => undefined);
  return b as Kysely<Models>;
}

function mockCsvBlob(text: string): void {
  const buffer = Buffer.from(text, 'utf8');
  vi.spyOn(StorageService.prototype, 'downloadStream').mockImplementation(async () => ({
    stream: Readable.from([Buffer.from(buffer)]),
    contentLength: buffer.length,
  }));
}

/** CSV whose data row carries every district value, plus the entity's own lead columns. */
function districtCsv(leadHeaders: string[], leadValues: string[]): string {
  const headers = [...leadHeaders, ...DISTRICT_FIELDS];
  const values = [...leadValues, ...DISTRICT_FIELDS.map((f) => DISTRICT_COLUMNS[f as keyof typeof DISTRICT_COLUMNS])];
  return `${headers.join(',')}\n${values.map((v) => `"${v}"`).join(',')}\n`;
}

/** Index mapping: lead columns to their fields, then each district column to its own field. */
function districtMapping(leadFields: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  leadFields.forEach((f, i) => (mapping[String(i)] = f));
  DISTRICT_FIELDS.forEach((f, i) => (mapping[String(leadFields.length + i)] = f));
  return mapping;
}

describe('electoral import columns survive to the entity processors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the mapping schemas accept every electoral field as a mapping target', () => {
    for (const field of DISTRICT_FIELDS) {
      expect(PersonsImportMappingObj.safeParse({ '0': field }).success).toBe(true);
      expect(HouseholdsImportMappingObj.safeParse({ '0': field }).success).toBe(true);
    }
  });

  it('keeps every district column on a People import', async () => {
    vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as any);
    const fed: Record<string, string>[] = [];
    vi.spyOn(PersonsService.prototype, 'processImportRows').mockImplementation(
      async (_i, _t, _u, _c, _tags, _skipped, rows) => {
        for await (const row of rows) fed.push(row);
        return {} as any;
      },
    );
    mockCsvBlob(districtCsv(['first_name', 'street1'], ['Ada', 'Evergreen Terrace']));

    await handleImportCsvJob(
      {
        type: 'import_csv',
        import_id: '11',
        tenant_id: '1',
        user_id: '2',
        source: 'persons',
        storage_key: 'imports/source/1/abc.csv',
        mapping: districtMapping(['first_name', 'street1']),
        campaign_id: '3',
        tags: [],
        file_name: 'voterfile.csv',
        duplicate_decision: 'skip',
        list_name: null,
      },
      makeScriptedDb(),
    );

    expect(fed).toHaveLength(1);
    expect(fed[0]).toMatchObject(DISTRICT_COLUMNS);
  });

  it('keeps every district column on a Households import', async () => {
    vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as any);
    const fed: Record<string, string>[] = [];
    vi.spyOn(HouseholdsController.prototype, 'processImportRows').mockImplementation(
      async (_i, _t, _u, _c, _tags, _skipped, rows) => {
        for await (const row of rows) fed.push(row);
        return {} as any;
      },
    );
    mockCsvBlob(districtCsv(['street1', 'city'], ['Evergreen Terrace', 'Columbus']));

    await handleImportCsvJob(
      {
        type: 'import_csv',
        import_id: '12',
        tenant_id: '1',
        user_id: '2',
        source: 'households',
        storage_key: 'imports/source/1/abc.csv',
        mapping: districtMapping(['street1', 'city']),
        campaign_id: '3',
        tags: [],
        file_name: 'addresses.csv',
        duplicate_decision: null,
        list_name: null,
      },
      makeScriptedDb(),
    );

    expect(fed).toHaveLength(1);
    expect(fed[0]).toMatchObject(DISTRICT_COLUMNS);
  });

  it('names exactly the fields the row reader looks for', () => {
    // `readImportedAreas` reads a row under the keys in IMPORTED_AREA_SETS. A key named here but
    // not there is never read; a key there but not here never gets past the row schema.
    expect(Object.keys(ELECTORAL_IMPORT_ROW_FIELDS).sort()).toEqual(
      IMPORTED_AREA_SETS.map((spec) => spec.field).sort(),
    );
  });

  it('still refuses a column the row schemas do not name', () => {
    // The dropping behaviour is deliberate everywhere else — this confirms the schemas were
    // widened by exactly the seven electoral columns, not opened up to arbitrary keys.
    const person = PersonsImportRowObj.parse({ first_name: 'Ada', not_a_real_column: 'x' });
    expect(person).not.toHaveProperty('not_a_real_column');
    const household = HouseholdsImportRowObj.parse({ street1: 'Evergreen Terrace', not_a_real_column: 'x' });
    expect(household).not.toHaveProperty('not_a_real_column');
    // And the mapping schemas refuse to target it at all.
    expect(PersonsImportMappingObj.safeParse({ '0': 'not_a_real_column' }).success).toBe(false);
    expect(HouseholdsImportMappingObj.safeParse({ '0': 'not_a_real_column' }).success).toBe(false);
  });
});
