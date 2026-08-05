import { z } from 'zod';

import { CompanyInputObj } from './companies.schema';

/**
 * The per-entity CSV-import row schemas, shared between the tRPC import mutations and (later)
 * the background job that validates rows server-side. Moved out of the four routers so both
 * layers validate against the exact same shapes.
 *
 * These are wire/row shapes, not the AddX/UpdateX triad: every field is the string a CSV cell
 * carries, bounded but otherwise unparsed. Do not tighten or loosen a field here without
 * treating it as an API change to the matching `<entity>.import` mutation.
 */

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
 * The keys match `IMPORTED_AREA_SETS` in the backend's `modules/households/electoral-areas.ts`,
 * which is what reads the values back out of a row, and `ELECTORAL_IMPORT_FIELDS` in
 * `libs/uxcommon/src/components/csv-import/persons-field-mapping.ts`, which is what the import
 * wizard maps a spreadsheet header onto. The backend's `electoral-import-schema.spec.ts` fails
 * if this list and `IMPORTED_AREA_SETS` stop agreeing.
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

/** One mapped CSV row of a People import (`persons.import`). */
export const PersonsImportRowObj = z.object({
  first_name: z.string().trim().max(100).optional(),
  middle_names: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  email: z.string().trim().max(255).optional(),
  email2: z.string().trim().max(255).optional(),
  mobile: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(10000).optional(),
  home_phone: z.string().trim().max(30).optional(),
  street_num: z.string().trim().max(30).optional(),
  street1: z.string().trim().max(150).optional(),
  street2: z.string().trim().max(150).optional(),
  apt: z.string().trim().max(30).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  zip: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
  // Company name from a mapped CSV column — matched case-insensitively to an
  // existing company, created (attributed to this import) when there's no match.
  company: z.string().trim().max(200).optional(),
  // Raw comma/semicolon-separated tag names from a mapped CSV column,
  // applied per person on top of the batch-level `tags` the mutation carries.
  tags: z.string().trim().max(500).optional(),
  // Electoral columns the file itself named. A purchased US voter file is one row per voter, so
  // it is imported here rather than through the households importer, and it routinely already
  // carries the congressional district, both state legislative district numbers, the precinct and
  // the ward on every row. Taking them writes `household_districts` rows straight out of the
  // file, with no address lookup and nothing billed.
  //
  // These MUST be listed. A Zod object drops every key it does not name, so without them the
  // mapped columns are silently discarded here and the service behind this endpoint never sees
  // them. The names match ELECTORAL_IMPORT_FIELDS in
  // libs/uxcommon/src/components/csv-import/persons-field-mapping.ts (what the wizard sends) and
  // IMPORTED_AREA_SETS in modules/households/electoral-areas.ts (what reads them back out).
  ...ELECTORAL_IMPORT_ROW_FIELDS,
});
export type PersonsImportRowType = z.infer<typeof PersonsImportRowObj>;

/** One mapped CSV row of a Households import (`households.import`). */
export const HouseholdsImportRowObj = z.object({
  street_num: z.string().trim().max(50).optional().nullable(),
  apt: z.string().trim().max(50).optional().nullable(),
  street1: z.string().trim().max(200).optional().nullable(),
  street2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  zip: z.string().trim().max(20).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  home_phone: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
  // Electoral columns the file itself named — district, ward, precinct and the US
  // legislative district numbers. They MUST be listed: a Zod object drops every key it
  // does not name, so a column the wizard mapped and sent would be discarded here and
  // the controller behind this endpoint would never see it. Shared with the people
  // importer so the two accept exactly the same columns.
  ...ELECTORAL_IMPORT_ROW_FIELDS,
});
export type HouseholdsImportRowType = z.infer<typeof HouseholdsImportRowObj>;

/**
 * One mapped CSV row of a Companies import (`companies.import`) — the same shape the add/edit
 * form sends, which is what that mutation has always validated rows against.
 */
export const CompaniesImportRowObj = CompanyInputObj;
export type CompaniesImportRowType = z.infer<typeof CompaniesImportRowObj>;

/** One mapped CSV row of a Tasks import (`tasks.import`). */
export const TasksImportRowObj = z.object({
  name: z.string().trim().min(1, 'Task name is required').max(200, 'Task name is too long'),
  details: z.string().trim().max(10000).optional().nullable(),
  status: z.string().trim().max(50).optional().nullable(),
  priority: z.string().trim().max(50).optional().nullable(),
  due_at: z.string().trim().max(50).optional().nullable(),
  assigned_to: z.string().trim().max(50).optional().nullable(),
});
export type TasksImportRowType = z.infer<typeof TasksImportRowObj>;

/**
 * A CSV header cell as a mapping key. Headers are user data straight out of the file's first
 * line, so the only constraints are non-empty and bounded.
 */
const importCsvHeaderSchema = z.string().min(1).max(200);

/**
 * Import column mappings: CSV header → importable field key, one schema per entity so the value
 * set is constrained to exactly that entity's row-schema keys. `.keyof()` derives the allowed
 * keys from the row schema itself, so adding a field to a row schema automatically makes it
 * mappable — there is no second string list to keep in sync.
 *
 * Not consumed anywhere yet: the staged import redesign's server-side CSV parsing will validate
 * the wizard's saved mapping against these before applying it to file rows.
 */
export const PersonsImportMappingObj = z.record(importCsvHeaderSchema, PersonsImportRowObj.keyof());
export type PersonsImportMappingType = z.infer<typeof PersonsImportMappingObj>;

export const HouseholdsImportMappingObj = z.record(importCsvHeaderSchema, HouseholdsImportRowObj.keyof());
export type HouseholdsImportMappingType = z.infer<typeof HouseholdsImportMappingObj>;

export const CompaniesImportMappingObj = z.record(importCsvHeaderSchema, CompaniesImportRowObj.keyof());
export type CompaniesImportMappingType = z.infer<typeof CompaniesImportMappingObj>;

export const TasksImportMappingObj = z.record(importCsvHeaderSchema, TasksImportRowObj.keyof());
export type TasksImportMappingType = z.infer<typeof TasksImportMappingObj>;
