import { describe, expect, it } from 'vitest';

import {
  ELECTORAL_HEADER_TO_FIELD,
  ELECTORAL_IMPORT_FIELDS as PEOPLE_ELECTORAL_FIELDS,
  ELECTORAL_IMPORT_FIELD_LABELS as PEOPLE_ELECTORAL_LABELS,
  autoMapPersonsHeader,
} from '@uxcommon/components/csv-import/persons-field-mapping';

import {
  ELECTORAL_IMPORT_FIELDS as HOUSEHOLD_ELECTORAL_FIELDS,
  ELECTORAL_IMPORT_FIELD_LABELS as HOUSEHOLD_ELECTORAL_LABELS,
  IMPORT_ENTITY_CONFIGS,
} from './import-entity-config';

/**
 * The People importer and the Households importer both accept electoral columns, and they must
 * accept exactly the same ones under exactly the same field keys — the backend reads the row
 * payload of both under those names. There is one list — declared in
 * `libs/uxcommon/src/components/csv-import/persons-field-mapping.ts` and re-exported by
 * `import-entity-config.ts` in this folder — and this file fails if anyone replaces the
 * re-export with a fork that drifts apart.
 */
describe('electoral import fields are identical for People and Households', () => {
  it('offers the same field keys in both importers', () => {
    expect([...PEOPLE_ELECTORAL_FIELDS].sort()).toEqual([...HOUSEHOLD_ELECTORAL_FIELDS].sort());
  });

  it('labels those fields the same way in both importers', () => {
    expect(PEOPLE_ELECTORAL_LABELS).toEqual(HOUSEHOLD_ELECTORAL_LABELS);
  });

  it('maps every recognised header spelling to the same field in both importers', () => {
    const households = IMPORT_ENTITY_CONFIGS.households.autoMapHeader;
    for (const header of Object.keys(ELECTORAL_HEADER_TO_FIELD)) {
      expect(autoMapPersonsHeader(header)).toBe(households(header));
    }
  });

  it('refuses to guess bare "HD" and "SD" in both importers', () => {
    // "SD" is South Dakota often enough that guessing it would silently point a whole column at the
    // wrong boundary.
    expect(autoMapPersonsHeader('HD')).toBe('');
    expect(autoMapPersonsHeader('SD')).toBe('');
    expect(IMPORT_ENTITY_CONFIGS.households.autoMapHeader('HD')).toBe('');
    expect(IMPORT_ENTITY_CONFIGS.households.autoMapHeader('SD')).toBe('');
  });

  it('lists the electoral fields in both importers’ column-mapping dropdowns', () => {
    for (const field of PEOPLE_ELECTORAL_FIELDS) {
      expect(IMPORT_ENTITY_CONFIGS.people.mappableFields).toContain(field);
      expect(IMPORT_ENTITY_CONFIGS.households.mappableFields).toContain(field);
    }
  });
});
