import {
  getAllOptions,
  exportCsvInput,
  exportCsvResponse,
  LogInteractionObj,
  refinePageSpan,
  rowOffsetSchema,
} from '../../../../../../libs/common/src';
import { z } from 'zod';
import { authProcedure, router } from '../../../trpc';
import { ActivityController } from './controller';

const activity = new ActivityController();

export const ActivityRouter = router({
  getFeed: authProcedure.input(getAllOptions).query(({ input, ctx }) => activity.getFeed(ctx.auth, input)),
  getActivities: authProcedure
    .input(
      // Bare `z.number()` let a negative, fractional or ten-million-row request through to
      // Kysely's .offset()/.limit(). The shared row schemas bound each field; refinePageSpan
      // bounds the distance between them, which is what becomes the SQL LIMIT.
      z
        .object({
          entity: z.string(),
          entityId: z.string().min(1),
          startRow: rowOffsetSchema.optional(),
          endRow: rowOffsetSchema.optional(),
        })
        .superRefine(refinePageSpan),
    )
    .query(({ input, ctx }) =>
      activity.getActivities(ctx.auth.tenant_id, input.entity, input.entityId, {
        startRow: input.startRow,
        endRow: input.endRow,
      }),
    ),
  exportCsv: authProcedure
    .input(exportCsvInput)
    .output(exportCsvResponse)
    .mutation(({ input, ctx }) => activity.exportCsv({ tenant_id: ctx.auth.tenant_id, ...(input ?? {}) }, ctx.auth)),
  logInteraction: authProcedure
    .input(LogInteractionObj)
    .mutation(({ input, ctx }) => activity.logInteraction(ctx.auth, input)),
});
