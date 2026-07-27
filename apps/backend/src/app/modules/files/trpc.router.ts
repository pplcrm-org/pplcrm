import { idSchema, getAllOptions, MAX_BULK_IDS } from '../../../../../../libs/common/src';
import { z } from 'zod';
import { authProcedure, router } from '../../../trpc';
import { FilesController } from './controller';
import { signUploadHandle } from '../../lib/signed-download';
import {
  MAX_ENTITY_REF_LENGTH,
  MAX_FILENAME_LENGTH,
  MAX_MIME_TYPE_LENGTH,
  sanitizeFilename,
} from '../../lib/storage-key';
import crypto from 'crypto';

const files = new FilesController();

const filesGetAllOptions = getAllOptions
  .unwrap()
  .extend({
    /** Restrict to files linked to a specific entity, e.g. entityType: 'newsletter'. */
    entityType: z.string().optional(),
    entityId: z.string().optional(),
  })
  .optional();

export const FilesRouter = router({
  getAll: authProcedure.input(filesGetAllOptions).query(({ input, ctx }) => files.getAllFiles(ctx.auth, input)),

  getUsageSummary: authProcedure.query(({ ctx }) => files.getUsageSummary(ctx.auth)),

  getUploadUrl: authProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(MAX_FILENAME_LENGTH),
        mimeType: z.string().max(MAX_MIME_TYPE_LENGTH).nullable().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const fileUUID = crypto.randomUUID();
      // sanitizeFilename strips path separators — the raw filename is interpolated
      // into the blob key, and `../` in it would escape the tenant prefix.
      const storageKey = `uploads/${ctx.auth.tenant_id}/${fileUUID}_${sanitizeFilename(input.filename)}`;
      const uploadUrl = await files.generateUploadSasUrl(storageKey);
      // The key itself is deliberately NOT returned — the client hands back the
      // signed handle instead, so it can never choose which blob it registers.
      return { uploadUrl, uploadHandle: signUploadHandle(storageKey, ctx.auth.tenant_id) };
    }),

  registerFile: authProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(MAX_FILENAME_LENGTH),
        mimeType: z.string().max(MAX_MIME_TYPE_LENGTH).nullable().optional(),
        uploadHandle: z.string(),
        sha256Hex: z
          .string()
          .regex(/^[0-9a-f]{64}$/i, 'Expected a hex SHA-256 digest')
          .nullable()
          .optional(),
        entityType: z.string().max(MAX_ENTITY_REF_LENGTH).nullable().optional(),
        entityId: z.string().max(MAX_ENTITY_REF_LENGTH).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => files.registerFile(input, ctx.auth)),

  delete: authProcedure
    .input(idSchema)
    .mutation(({ input, ctx }) => files.delete(ctx.auth.tenant_id, input, ctx.auth.user_id)),

  deleteMany: authProcedure
    .input(
      z
        .array(idSchema)
        .min(1, 'At least one ID is required')
        .max(MAX_BULK_IDS, 'Too many items selected for one action'),
    )
    .mutation(({ input, ctx }) => files.deleteMany(ctx.auth.tenant_id, input, ctx.auth.user_id)),
});
