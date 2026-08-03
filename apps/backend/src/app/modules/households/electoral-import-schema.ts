import { z } from 'zod';

/**
 * The electoral columns a CSV import row may carry, as Zod fields.
 *
 * This exists because a Zod object silently drops every key it does not name. Both import
 * endpoints — `persons.import` and `households.import` — validate each row against an object
 * schema, so a column the wizard mapped and sent is discarded at the network boundary unless the
 * schema lists it by name. That is not a validation failure the caller can see: the request
 * succeeds and the districts are simply gone.
 *
 * Spread into both row schemas so the two importers cannot accept different columns:
 *
 * ```ts
 * const ImportRow = z.object({ first_name: …, …, ...ELECTORAL_IMPORT_ROW_FIELDS });
 * ```
 *
 * The keys match `IMPORTED_AREA_SETS` in `./electoral-areas.ts`, which is what reads the values
 * back out of a row, and `ELECTORAL_IMPORT_FIELDS` in
 * `libs/uxcommon/src/components/csv-import/persons-field-mapping.ts`, which is what the import
 * wizard maps a spreadsheet header onto. `electoral-import-schema.spec.ts` fails if this list and
 * `IMPORTED_AREA_SETS` stop agreeing.
 *
 * 100 characters is generous for an area name. Real values are short — "OH-3", "18", "Ward 5",
 * "Precinct 12", "Ottawa Centre" — and a longer cell is far more likely to be a mis-mapped column
 * than a real district, so the limit doubles as a guard against a whole notes column being written
 * in as boundary names.
 */
const areaName = () => z.string().trim().max(100).optional();

export const ELECTORAL_IMPORT_ROW_FIELDS = {
  electoral_district: areaName(),
  congressional_district: areaName(),
  legislative_district: areaName(),
  state_house_district: areaName(),
  state_senate_district: areaName(),
  ward: areaName(),
  precinct: areaName(),
};
