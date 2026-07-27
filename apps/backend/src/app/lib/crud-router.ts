import {
  getAllOptions,
  idSchema,
  exportCsvInput,
  exportCsvResponse,
  MAX_BULK_IDS,
} from '../../../../../libs/common/src';
import { z } from 'zod';
import { authProcedure } from '../../trpc';
import type { BaseController } from './base.controller';

export function createCrudRouter<
  TController extends BaseController<any, any>,
  TInsertSchema extends z.ZodTypeAny,
  TUpdateSchema extends z.ZodTypeAny,
>(
  controller: TController,
  insertSchema: TInsertSchema,
  updateSchema: TUpdateSchema,
  // Plan-gated modules pass authProcedure.use(planFeatureGate(...)) so every CRUD mutation is
  // gated in one place; the gate middleware lets queries through untouched.
  procedure: typeof authProcedure = authProcedure,
) {
  return {
    getAll: procedure
      .input(getAllOptions)
      .query(({ input, ctx }) => controller.getAllWithCounts(ctx.auth.tenant_id, input)),
    getAllWithCounts: procedure
      .input(getAllOptions)
      .query(({ input, ctx }) => controller.getAllWithCounts(ctx.auth.tenant_id, input)),
    getById: procedure
      .input(idSchema)
      .query(({ input, ctx }) => controller.getOneById({ tenant_id: ctx.auth.tenant_id, id: input })),
    add: procedure.input(insertSchema).mutation(({ input, ctx }) =>
      controller.add({
        ...(input as Record<string, unknown>),
        tenant_id: ctx.auth.tenant_id,
        createdby_id: ctx.auth.user_id,
        updatedby_id: ctx.auth.user_id,
      }),
    ),
    create: procedure.input(insertSchema).mutation(({ input, ctx }) =>
      controller.add({
        ...(input as Record<string, unknown>),
        tenant_id: ctx.auth.tenant_id,
        createdby_id: ctx.auth.user_id,
        updatedby_id: ctx.auth.user_id,
      }),
    ),
    update: procedure.input(z.object({ id: idSchema, data: updateSchema })).mutation(({ input, ctx }) => {
      const { id, data } = input as unknown as { id: string; data: Record<string, unknown> };
      return controller.update({
        tenant_id: ctx.auth.tenant_id,
        id,
        row: { ...data, updatedby_id: ctx.auth.user_id },
      });
    }),
    delete: procedure
      .input(idSchema)
      .mutation(({ input, ctx }) => controller.delete(ctx.auth.tenant_id, input, ctx.auth.user_id)),
    deleteMany: procedure
      .input(
        z
          .array(idSchema)
          .min(1, 'At least one ID is required')
          .max(MAX_BULK_IDS, 'Too many items selected for one action'),
      )
      .mutation(({ input, ctx }) => controller.deleteMany(ctx.auth.tenant_id, input)),
    count: procedure.query(({ ctx }) => controller.getCount(ctx.auth.tenant_id)),
    exportCsv: procedure
      .input(exportCsvInput)
      .output(exportCsvResponse)
      .mutation(({ input, ctx }) =>
        controller.exportCsv({ tenant_id: ctx.auth.tenant_id, ...(input ?? {}) }, ctx.auth),
      ),
  };
}
