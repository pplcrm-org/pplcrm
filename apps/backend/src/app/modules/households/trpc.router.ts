import {
  HouseholdsImportMappingObj,
  UpdateHouseholdsObj,
  getAllOptions,
  idSchema,
  MAX_BULK_IDS,
  MAX_PAGE_SIZE,
} from '../../../../../../libs/common/src';

import { z } from 'zod';

import { authProcedure, router } from '../../../trpc';
import { HouseholdsController } from './controller';
import { createCrudRouter } from '../../lib/crud-router';

const households = new HouseholdsController();

const crud = createCrudRouter(households, UpdateHouseholdsObj, UpdateHouseholdsObj);

export const HouseholdsRouter = router({
  ...crud,

  getAll: authProcedure.query(({ ctx }) => households.getAll(ctx.auth.tenant_id)),

  add: authProcedure.input(UpdateHouseholdsObj).mutation(({ input, ctx }) => households.addHousehold(input, ctx.auth)),

  import: authProcedure
    .input(
      // Upload intake only (the legacy rows-in-body variant was removed 2026-08-05 once the
      // wizard stopped sending it): the CSV was PUT to blob storage via imports.getUploadUrl;
      // the import_csv background job stream-parses it server-side. Row shape (including the
      // electoral columns) lives in libs/common/src/lib/schemas/import-rows.schema.ts, shared
      // with the people importer so the two accept exactly the same columns.
      z.object({
        upload_handle: z.string().min(1).max(4096),
        // Stringified 0-based column index → import field key.
        mapping: HouseholdsImportMappingObj,
        tags: z.array(z.string().trim().min(1).max(50)).optional(),
        file_name: z.string().trim().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      ctx.res.status(202);
      return households.importRows(
        {
          upload_handle: input.upload_handle,
          mapping: input.mapping,
          tags: input.tags,
          file_name: input.file_name,
        },
        ctx.auth,
      );
    }),

  // Overrides the generic CRUD delete on purpose. That one deletes the row directly, which both
  // fails on the persons foreign key when the household still has members and lets the tenant's
  // permanent placeholder household be deleted. See HouseholdsController.deleteOneForTenant.
  delete: authProcedure.input(idSchema).mutation(({ input, ctx }) => households.deleteOneForTenant(ctx.auth, input)),

  deleteMany: authProcedure
    .input(
      z
        .array(idSchema)
        .min(1, 'At least one ID is required')
        .max(MAX_BULK_IDS, 'Too many items selected for one action'),
    )
    .mutation(({ input, ctx }) => households.deleteManyForTenant(ctx.auth, input)),

  attachTag: authProcedure
    .input(
      z.object({
        id: idSchema,
        tag_name: z.string().trim().min(1, 'Tag name cannot be empty').max(50, 'Tag name too long'),
        type: z.enum(['tag', 'issue']).default('tag').optional(),
      }),
    )
    .mutation(({ input, ctx }) => households.attachTag(input.id, input.tag_name, input.type ?? 'tag', ctx.auth)),

  /** Bulk "Add tag" from the grid: one round trip for the whole selection. */
  attachTagToMany: authProcedure
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
    .mutation(({ input, ctx }) => households.attachTagToMany(input.ids, input.tag_name, input.type ?? 'tag', ctx.auth)),

  detachTag: authProcedure
    .input(
      z.object({
        id: idSchema,
        tag_name: z.string().trim().min(1, 'Tag name cannot be empty').max(50, 'Tag name too long'),
        type: z.enum(['tag', 'issue']).default('tag').optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      households.detachTag(ctx.auth.tenant_id, input.id, input.tag_name, input.type ?? 'tag', ctx.auth.user_id),
    ),

  getTags: authProcedure
    .input(z.union([idSchema, z.object({ id: idSchema, type: z.enum(['tag', 'issue']).optional() })]))
    .query(({ input, ctx }) => {
      const id = typeof input === 'string' ? input : input.id;
      const type = typeof input === 'string' ? undefined : input.type;
      return households.getTags(id, ctx.auth, type);
    }),

  // `z.any()` here let entirely unvalidated input reach the query builder — including
  // `advancedFilterModel`, which getAllOptions otherwise validates through queryBuilderNodeSchema.
  getAllWithPeopleCount: authProcedure
    .input(getAllOptions)
    .query(({ input, ctx }) => households.getAllWithPeopleCount(ctx.auth, input)),

  getPeopleCount: authProcedure.input(idSchema).query(({ input, ctx }) => households.getPeopleCount(input, ctx.auth)),

  getLastCanvass: authProcedure.input(idSchema).query(({ input, ctx }) => households.getLastCanvass(input, ctx.auth)),

  // `campaignId` scopes the distinct-area count to that campaign's seat map, matching the
  // campaign-worded grain sentence around it. Absent (older clients), the workspace fallback
  // set is used.
  countDistinctWards: authProcedure
    .input(z.object({ campaignId: z.string().optional() }).optional())
    .query(({ input, ctx }) => households.countDistinctWards(ctx.auth, input?.campaignId)),

  // Whether one address is in the campaign's territory, for the household and person record pages.
  // `campaignId` is explicit for the same reason it is above: the request's pinned campaign is only
  // set for non-admin users, so relying on it would answer nothing for an owner or admin.
  seatStatus: authProcedure
    .input(z.object({ householdId: z.string(), campaignId: z.string().nullable().optional() }))
    .query(({ input, ctx }) => households.seatStatus(ctx.auth, input)),

  getUnhoused: authProcedure.query(({ ctx }) => households.getUnhoused(ctx.auth)),

  // Tenant-scoped slug resolution for /households/:slug URLs (spec §1).
  getBySlug: authProcedure
    .input(z.string().trim().min(1).max(200))
    .query(({ input, ctx }) => households.getOneBySlug(input, ctx.auth)),

  getPotentialDuplicates: authProcedure
    .input(
      z
        .object({
          page: z.number().int().positive().optional().default(1),
          // Bounded like every other page size: this becomes a SQL LIMIT directly.
          pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).optional().default(20),
        })
        .optional(),
    )
    .query(({ input, ctx }) => households.getPotentialDuplicates(ctx.auth, input)),

  mergeHouseholds: authProcedure
    .input(z.object({ target_id: idSchema, source_id: idSchema }))
    .mutation(({ input, ctx }) => households.mergeHouseholds(input.target_id, input.source_id, ctx.auth)),

  getLastFingerprintRecomputation: authProcedure.query(({ ctx }) =>
    households.getLastFingerprintRecomputation(ctx.auth.tenant_id),
  ),

  recomputeAddressFingerprints: authProcedure.mutation(({ ctx }) =>
    households.recomputeAddressFingerprints(ctx.auth.tenant_id),
  ),
});
