import {
  UpdateHouseholdsObj,
  getAllOptions,
  idSchema,
  MAX_BULK_IDS,
  MAX_IMPORT_ROWS,
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
      z.object({
        rows: z
          .array(
            z.object({
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
            }),
          )
          .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
        tags: z.array(z.string().trim().min(1).max(50)).optional(),
        skipped: z.number().int().nonnegative().optional(),
        file_name: z.string().trim().min(1).max(255).optional(),
        source_csv: z.string().max(10_000_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      ctx.res.status(202);
      return households.importRows(input, ctx.auth);
    }),

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

  countDistinctWards: authProcedure.query(({ ctx }) => households.countDistinctWards(ctx.auth)),

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
          pageSize: z.number().int().positive().optional().default(20),
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
