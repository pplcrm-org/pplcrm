import {
  PersonsImportMappingObj,
  UpdatePersonsObj,
  exportCsvInput,
  exportCsvResponse,
  getAllOptions,
  idSchema,
  MAX_BULK_IDS,
  MAX_PAGE_SIZE,
  PersonMergeImpactObj,
} from '../../../../../../libs/common/src';
import { z } from 'zod';
import { authProcedure, router } from '../../../trpc';
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

/** Bulk "Add tag" from the grid: one round trip for the whole selection instead of one
 *  mutation per person. Same id-array cap as deleteMany. */
function attachTagToMany() {
  return authProcedure
    .input(
      z.object({
        ids: z
          .array(idSchema)
          .min(1, 'At least one ID is required')
          .max(MAX_BULK_IDS, 'Too many items selected for one action'),
        tag_name: z.string().trim().min(1, 'Tag name cannot be empty').max(50, 'Tag name too long'),
        type: z.enum(['tag', 'issue']).default('tag').optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      personsService.attachTagToMany(input.ids, input.tag_name, input.type ?? 'tag', ctx.auth),
    );
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

/**
 * Ids-only twin of getAllWithAddress: same filters and sort, but each match costs ~50 bytes
 * instead of a kilobytes-wide row. Serves "select all matching" and the record-navigation
 * context; capped at MAX_SELECT_ALL_IDS server-side, with `capped` telling the client to say
 * "first N of M" instead of "all M".
 */
function getMatchingIds() {
  return authProcedure.input(getAllOptions).query(({ input, ctx }) => persons.getMatchingIds(ctx.auth, input));
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
  // Upload intake only (the legacy rows-in-body variant was removed 2026-08-05 once the wizard
  // stopped sending it): the browser PUT the raw CSV to blob storage via imports.getUploadUrl;
  // the mutation carries only the signed handle and the column mapping, and the import_csv
  // background job stream-parses the file server-side (no rows in the body, no source_csv,
  // no client-computed skips — the server derives all of those). Row shape (including the
  // electoral columns) lives in libs/common/src/lib/schemas/import-rows.schema.ts, shared with
  // the background job so both layers accept exactly the same fields.
  const Input = z.object({
    upload_handle: z.string().min(1).max(4096),
    // Stringified 0-based column index → import field key.
    mapping: PersonsImportMappingObj,
    tags: z.array(z.string().trim().min(1, 'Tag cannot be empty').max(50, 'Tag too long')).optional(),
    file_name: z.string().trim().min(1).max(255).optional(),
    // §17 CSV import wizard: how to handle rows whose email matches a person
    // that already exists — one choice for the whole batch (spec review step
    // is a single radio group, not a per-row decision).
    duplicate_decision: z.enum(['merge', 'skip', 'import_new']).optional().default('skip'),
    // Add every imported/merged person to this static list (created if it
    // doesn't exist yet). Resolved by exact, case-insensitive name match.
    list_name: z.string().trim().min(1).max(100).optional(),
  });

  return authProcedure.input(Input).mutation(async ({ input, ctx }) =>
    personsService.importRows(
      {
        upload_handle: input.upload_handle,
        mapping: input.mapping,
        tags: input.tags,
        file_name: input.file_name,
        duplicate_decision: input.duplicate_decision,
        list_name: input.list_name,
      },
      ctx.auth,
    ),
  );
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

/** Read-only companion to `mergePersons`: what this particular merge will cost, so the
 *  confirmation dialog can warn about a volunteer losing companion access only on the merges
 *  where that actually happens. */
function mergeImpact() {
  return authProcedure
    .input(z.object({ target_id: idSchema, source_id: idSchema }))
    .output(PersonMergeImpactObj)
    .query(({ input, ctx }) => personsService.getMergeImpact(input, ctx.auth));
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
  attachTagToMany: attachTagToMany(),
  detachTag: detachTag(),
  delete: deleteOne(),
  deleteMany: deleteMany(),
  getDistinctTags: getDistinctTags(),
  getByHouseholdId: getByHouseholdId(),
  getByCompanyId: getByCompanyId(),
  countByCompanyId: countByCompanyId(),
  countWithCompany: countWithCompany(),
  getAllWithAddress: getAllWithAddress(),
  getMatchingIds: getMatchingIds(),
  exportCsv: exportCsv(),
  getPotentialDuplicates: getPotentialDuplicates(),
  getDuplicateCounts: getDuplicateCounts(),
  mergePersons: mergePersons(),
  mergeImpact: mergeImpact(),
  moveEntireHousehold: moveEntireHousehold(),
  checkDuplicateEmails: checkDuplicateEmails(),
});
