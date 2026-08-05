import { idSchema } from '../../../../../../libs/common/src';
import { z } from 'zod';

import { authProcedure, router } from '../../../trpc';
import { MAX_FILENAME_LENGTH, MAX_MIME_TYPE_LENGTH } from '../../lib/storage-key';
import { ImportsController } from './controller';

const imports = new ImportsController();

export const ImportsRouter = router({
  getAll: authProcedure.query(({ ctx }) => imports.list(ctx.auth)),
  getUploadUrl: authProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(MAX_FILENAME_LENGTH),
        mimeType: z.string().max(MAX_MIME_TYPE_LENGTH).nullable().optional(),
      }),
    )
    .query(({ input, ctx }) => imports.getUploadUrl(ctx.auth, input)),
  delete: authProcedure
    .input(
      z.object({
        id: idSchema,
        deleteContacts: z.boolean().optional(),
        deletePeople: z.boolean().optional(),
        deleteHouseholds: z.boolean().optional(),
        deleteCompanies: z.boolean().optional(),
        deleteTasks: z.boolean().optional(),
      }),
    )
    .mutation(({ input, ctx }) => imports.deleteImport(input, ctx.auth)),
});
