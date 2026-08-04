import {
  UpdatePersonsObj,
  exportCsvInput,
  exportCsvResponse,
  getAllOptions,
  idSchema,
  MAX_BULK_IDS,
  MAX_IMPORT_ROWS,
  MAX_PAGE_SIZE,
} from '../../../../../../libs/common/src';
import { z } from 'zod';
import { authProcedure, router } from '../../../trpc';
import { ELECTORAL_IMPORT_ROW_FIELDS } from '../households/electoral-import-schema';
import { PersonsController } from './controller';
import { PersonsService } from './services/persons.service';

const persons = new PersonsController();
const personsService = new PersonsService();

function add() {
  return authProcedure.input(UpdatePersonsObj).mutation(({ input, ctx }) => personsService.addPerson(input, ctx.auth));
}

function attachTag() {
  return authProcedure
    .input(
      z.object({
        id: idSchema,
        tag_name: z.string().trim().min(1, 'Tag name cannot be empty').max(50, 'Tag name too long'),
        type: z.enum(['tag', 'issue']).default('tag').optional(),
      }),
    )
    .mutation(({ input, ctx }) => personsService.attachTag(input.id, input.tag_name, input.type ?? 'tag', ctx.auth));
}

function count() {
  return authProcedure.query(({ ctx }) => persons.getCount(ctx.auth.tenant_id));
}

const deleteOneInput = z.union([
  idSchema,
  z.object({
    id: idSchema,
    force: z.boolean().optional(),
  }),
]);

function deleteOne() {
  return authProcedure.input(deleteOneInput).mutation(({ input, ctx }) => {
    const id = typeof input === 'string' ? input : input.id;
    const force = typeof input === 'string' ? false : !!input.force;
    return persons.delete(ctx.auth.tenant_id, id, ctx.auth.user_id, force);
  });
}

const deleteManyInput = z.union([
  z.array(idSchema).min(1, 'At least one ID is required').max(MAX_BULK_IDS, 'Too many items selected for one action'),
  z.object({
    ids: z
      .array(idSchema)
      .min(1, 'At least one ID is required')
      .max(MAX_BULK_IDS, 'Too many items selected for one action'),
    force: z.boolean().optional(),
  }),
]);

function deleteMany() {
  return authProcedure.input(deleteManyInput).mutation(({ input, ctx }) => {
    const ids = Array.isArray(input) ? input : input.ids;
    const force = Array.isArray(input) ? false : !!input.force;
    return persons.deleteMany(ctx.auth.tenant_id, ids, force);
  });
}

function detachTag() {
  return authProcedure
    .input(
      z.object({
        id: idSchema,
        tag_name: z.string().trim().min(1, 'Tag name cannot be empty').max(50, 'Tag name too long'),
        type: z.enum(['tag', 'issue']).default('tag').optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      personsService.detachTag({
        tenant_id: ctx.auth.tenant_id,
        person_id: input.id,
        name: input.tag_name,
        type: input.type ?? 'tag',
        user_id: ctx.auth.user_id,
      }),
    );
}

function getAll() {
  return authProcedure.input(getAllOptions).query(({ input, ctx }) => persons.getAll(ctx.auth.tenant_id, input));
}

function getAllWithAddress() {
  return authProcedure.input(getAllOptions).query(({ input, ctx }) => persons.getAllWithAddress(ctx.auth, input));
}

function getByHouseholdId() {
  return authProcedure
    .input(z.object({ id: idSchema, options: getAllOptions }))
    .query(({ input, ctx }) => persons.getByHouseholdId(input.id, ctx.auth, input.options));
}

function getByCompanyId() {
  return authProcedure
    .input(z.object({ id: idSchema, options: getAllOptions }))
    .query(({ input, ctx }) => persons.getByCompanyId(input.id, ctx.auth, input.options));
}

function countByCompanyId() {
  return authProcedure
    .input(z.object({ id: idSchema }))
    .query(({ input, ctx }) => persons.countByCompanyId(input.id, ctx.auth));
}

function countWithCompany() {
  return authProcedure.query(({ ctx }) => persons.countWithCompany(ctx.auth));
}

function getById() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => persons.getOneById({ tenant_id: ctx.auth.tenant_id, id: input }));
}

/** Tenant-scoped resolution by opaque public_id for /people/:slug URLs (spec §1). */
function getByPublicId() {
  return authProcedure
    .input(z.string().trim().min(1).max(200))
    .query(({ input, ctx }) => persons.getByPublicId(input, ctx.auth));
}

function getActivity() {
  return authProcedure.input(idSchema).query(({ input, ctx }) => personsService.getPersonActivity(input, ctx.auth));
}

// Distinct tags
function getDistinctTags() {
  return authProcedure
    .input(z.enum(['tag', 'issue']).optional())
    .query(({ input, ctx }) => persons.getDistinctTags(ctx.auth, input));
}

function exportCsv() {
  return authProcedure
    .input(exportCsvInput)
    .output(exportCsvResponse)
    .mutation(({ input, ctx }) => persons.exportCsv({ tenant_id: ctx.auth.tenant_id, ...(input ?? {}) }, ctx.auth));
}

function getTags() {
  return authProcedure
    .input(z.union([idSchema, z.object({ id: idSchema, type: z.enum(['tag', 'issue']).optional() })]))
    .query(({ input, ctx }) => {
      const id = typeof input === 'string' ? input : input.id;
      const type = typeof input === 'string' ? undefined : input.type;
      return persons.getTags(id, ctx.auth, type);
    });
}

function update() {
  return authProcedure
    .input(z.object({ id: idSchema, data: UpdatePersonsObj }))
    .mutation(({ input, ctx }) => personsService.updatePerson(input.id, input.data, ctx.auth));
}

function removeHousehold() {
  return authProcedure.input(idSchema).mutation(({ input, ctx }) => personsService.removeHousehold(input, ctx.auth));
}

function importMany() {
  const ImportRow = z.object({
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
    // applied per person on top of the batch-level `tags` below.
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

  const Input = z.object({
    rows: z.array(ImportRow).max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
    tags: z.array(z.string().trim().min(1, 'Tag cannot be empty').max(50, 'Tag too long')).optional(),
    skipped: z.number().int().nonnegative().optional(),
    file_name: z.string().trim().min(1).max(255).optional(),
    // §17 CSV import wizard: how to handle rows whose email matches a person
    // that already exists — one choice for the whole batch (spec review step
    // is a single radio group, not a per-row decision).
    duplicate_decision: z.enum(['merge', 'skip', 'import_new']).optional().default('skip'),
    // Add every imported/merged person to this static list (created if it
    // doesn't exist yet). Resolved by exact, case-insensitive name match.
    list_name: z.string().trim().min(1).max(100).optional(),
    // Raw uploaded CSV text, retained 90 days for the History page's
    // per-import re-download (spec §17 footer copy).
    source_csv: z.string().max(10_000_000).optional(),
    // Rows the wizard's Review step already excluded/cleaned client-side
    // (bad-email "Skip" decision) — recorded so History's "download skipped
    // rows" export covers them too, not just server-detected skips.
    client_skip_reasons: z
      .array(
        z.object({
          row: z.number().int().nonnegative(),
          email: z.string().optional(),
          reason: z.string().max(200),
        }),
      )
      .max(500)
      .optional(),
  });

  return authProcedure.input(Input).mutation(async ({ input, ctx }) => personsService.importRows(input, ctx.auth));
}

function checkDuplicateEmails() {
  return authProcedure
    .input(z.object({ emails: z.array(z.string().trim().max(255)).max(2000) }))
    .query(({ input, ctx }) => personsService.checkDuplicateEmails(ctx.auth, input.emails));
}

function getPotentialDuplicates() {
  return authProcedure
    .input(
      z
        .object({
          page: z.number().int().positive().optional().default(1),
          // Bounded like every other page size: this becomes a SQL LIMIT directly.
          pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).optional().default(20),
        })
        .optional(),
    )
    .query(({ input, ctx }) => personsService.getPotentialDuplicates(ctx.auth, input));
}

function getDuplicateCounts() {
  return authProcedure.query(({ ctx }) => personsService.getDuplicateCounts(ctx.auth));
}

function mergePersons() {
  return authProcedure
    .input(z.object({ target_id: idSchema, source_id: idSchema }))
    .mutation(({ input, ctx }) => personsService.mergePersons(input, ctx.auth));
}

function moveEntireHousehold() {
  return authProcedure
    .input(
      z.object({
        fromHouseholdId: idSchema,
        toHouseholdId: idSchema,
      }),
    )
    .mutation(({ input, ctx }) =>
      persons.moveEntireHousehold(input.fromHouseholdId, input.toHouseholdId, ctx.auth.tenant_id),
    );
}

export const PersonsRouter = router({
  add: add(),
  count: count(),
  getAll: getAll(),
  update: update(),
  removeHousehold: removeHousehold(),
  import: importMany(),
  getTags: getTags(),
  getById: getById(),
  getByPublicId: getByPublicId(),
  getActivity: getActivity(),
  attachTag: attachTag(),
  detachTag: detachTag(),
  delete: deleteOne(),
  deleteMany: deleteMany(),
  getDistinctTags: getDistinctTags(),
  getByHouseholdId: getByHouseholdId(),
  getByCompanyId: getByCompanyId(),
  countByCompanyId: countByCompanyId(),
  countWithCompany: countWithCompany(),
  getAllWithAddress: getAllWithAddress(),
  exportCsv: exportCsv(),
  getPotentialDuplicates: getPotentialDuplicates(),
  getDuplicateCounts: getDuplicateCounts(),
  mergePersons: mergePersons(),
  moveEntireHousehold: moveEntireHousehold(),
  checkDuplicateEmails: checkDuplicateEmails(),
});
