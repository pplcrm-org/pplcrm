import { describe, expect, it } from 'vitest';

import {
  ELECTORAL_HEADER_TO_FIELD,
  ELECTORAL_IMPORT_FIELDS,
  ELECTORAL_IMPORT_FIELD_LABELS,
  PERSONS_MAPPABLE_FIELDS,
  autoMapPersonsHeader,
} from './persons-field-mapping';

/**
 * A purchased US voter file is one row per voter, so it is imported through the People importer.
 * Until these fields existed here, the People importer had no way to accept the district columns
 * such a file already carries, and the commonest real-world route to a working map did not work.
 */
describe('People importer: electoral columns', () => {
  it('offers every electoral field in the column-mapping dropdown', () => {
    for (const field of ELECTORAL_IMPORT_FIELDS) {
      expect(PERSONS_MAPPABLE_FIELDS).toContain(field);
    }
  });

  it('has a human label for every electoral field', () => {
    for (const field of ELECTORAL_IMPORT_FIELDS) {
      expect(ELECTORAL_IMPORT_FIELD_LABELS[field]).toBeTruthy();
    }
  });

  it('auto-maps the header spellings a voter file actually uses', () => {
    expect(autoMapPersonsHeader('CD')).toBe('congressional_district');
    expect(autoMapPersonsHeader('Cong. District')).toBe('congressional_district');
    expect(autoMapPersonsHeader('CONGRESSIONAL DISTRICT')).toBe('congressional_district');
    expect(autoMapPersonsHeader('Legislative District')).toBe('legislative_district');
    expect(autoMapPersonsHeader('State House District')).toBe('state_house_district');
    expect(autoMapPersonsHeader('Assembly District')).toBe('state_house_district');
    expect(autoMapPersonsHeader('State Senate District')).toBe('state_senate_district');
    expect(autoMapPersonsHeader('Precinct')).toBe('precinct');
    expect(autoMapPersonsHeader('VTD')).toBe('precinct');
    expect(autoMapPersonsHeader('Ward')).toBe('ward');
    expect(autoMapPersonsHeader('Riding')).toBe('electoral_district');
    expect(autoMapPersonsHeader('Polling Division')).toBe('precinct');
  });

  it('refuses to guess bare "HD" and "SD"', () => {
    // "SD" is South Dakota often enough that reading it as a state house district would quietly
    // point a whole column at the wrong boundary. An unmapped column the person is asked about is
    // the better failure.
    expect(autoMapPersonsHeader('HD')).toBe('');
    expect(autoMapPersonsHeader('SD')).toBe('');
  });

  it('leaves the existing people mappings untouched', () => {
    // The electoral table is merged in first precisely so that nothing below it can be displaced.
    expect(autoMapPersonsHeader('State')).toBe('state');
    expect(autoMapPersonsHeader('Province')).toBe('state');
    expect(autoMapPersonsHeader('Region')).toBe('state');
    expect(autoMapPersonsHeader('Postal Code')).toBe('zip');
    expect(autoMapPersonsHeader('Phone')).toBe('mobile');
    expect(autoMapPersonsHeader('Company')).toBe('company');
  });

  it('only ever maps a header onto a field the dropdown offers', () => {
    for (const header of Object.keys(ELECTORAL_HEADER_TO_FIELD)) {
      expect(PERSONS_MAPPABLE_FIELDS).toContain(autoMapPersonsHeader(header));
    }
  });
});
