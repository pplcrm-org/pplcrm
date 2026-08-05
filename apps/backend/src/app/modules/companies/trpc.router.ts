import {
  idSchema,
  CompaniesImportMappingObj,
  CompaniesImportRowObj,
  CompanyInputObj,
  MAX_IMPORT_ROWS,
  MAX_PAGE_SIZE,
} from '../../../../../../libs/common/src';
import { z } from 'zod';
import { authProcedure, router } from '../../../trpc';
import { CompaniesController } from './controller';
import { createCrudRouter } from '../../lib/crud-router';

const companies = new CompaniesController();

const CompanyInputSchema = CompanyInputObj;

const crud = createCrudRouter(companies, CompanyInputSchema, CompanyInputSchema.partial());

export const CompaniesRouter = router({
  ...crud,

  // Tenant-scoped slug resolution for /companies/:slug URLs (spec §1).
  getBySlug: authProcedure
    .input(z.string().trim().min(1).max(200))
    .query(({ input, ctx }) => companies.getOneBySlug(input, ctx.auth)),

  // §7 "Enrich" / "Re-check Google" — queues a Google Places lookup job.
  enrich: authProcedure
    .input(z.object({ id: idSchema, force: z.boolean().optional() }))
    .mutation(({ input, ctx }) => companies.queueEnrichment(input.id, ctx.auth, input.force ?? false)),

  // Add-time preview: look up a company by name on Google without persisting.
  // Powers the New Company form's auto-fill on name blur.
  lookupEnrichment: authProcedure
    .input(z.object({ name: z.string().trim().min(1).max(200) }))
    .mutation(({ input }) => companies.lookupEnrichment(input.name)),

  // Background duplicate-name check for the add/edit form's advisory hint.
  nameExists: authProcedure
    .input(z.object({ name: z.string().trim().min(1).max(200), excludeId: idSchema.optional() }))
    .query(({ input, ctx }) => companies.nameExists(input.name, ctx.auth, input.excludeId)),

  import: authProcedure
    .input(
      // One input object serves both intakes; exactly-one-of rows/upload_handle is enforced by
      // superRefine rather than a union so RouterInputs indexing on the frontend keeps its
      // shape. Row shape lives in libs/common/src/lib/schemas/import-rows.schema.ts (it is the
      // same object as CompanyInputObj — the import has always validated rows as form payloads).
      z
        .object({
          // Legacy intake: mapped rows (plus the raw CSV text) in the mutation body.
          rows: z
            .array(CompaniesImportRowObj)
            .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`)
            .optional(),
          // Upload intake: the CSV was PUT to blob storage via imports.getUploadUrl; the
          // import_csv background job stream-parses it server-side.
          upload_handle: z.string().min(1).max(4096).optional(),
          // Stringified 0-based column index → import field key; required with upload_handle.
          mapping: CompaniesImportMappingObj.optional(),
          skipped: z.number().int().nonnegative().optional(),
          file_name: z.string().trim().min(1).max(255).optional(),
          source_csv: z.string().max(10_000_000).optional(),
        })
        .superRefine((val, ctx) => {
          const hasRows = val.rows !== undefined;
          const hasUpload = val.upload_handle !== undefined;
          if (hasRows === hasUpload) {
            ctx.addIssue({
              code: 'custom',
              message: 'Provide exactly one of rows (rows in the body) or upload_handle (uploaded file).',
            });
          }
          if (hasUpload && val.mapping === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['mapping'],
              message: 'A column mapping is required with upload_handle.',
            });
          }
        }),
    )
    .mutation(async ({ input, ctx }) => {
      ctx.res.status(202);
      if (input.upload_handle !== undefined) {
        return companies.importRows(
          { upload_handle: input.upload_handle, mapping: input.mapping ?? {}, file_name: input.file_name },
          ctx.auth,
        );
      }
      return companies.importRows(
        { rows: input.rows ?? [], skipped: input.skipped, file_name: input.file_name, source_csv: input.source_csv },
        ctx.auth,
      );
    }),

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
    .query(({ input, ctx }) => companies.getPotentialDuplicates(ctx.auth, input)),

  mergeCompanies: authProcedure
    .input(z.object({ target_id: idSchema, source_id: idSchema }))
    .mutation(({ input, ctx }) => companies.mergeCompanies(input.target_id, input.source_id, ctx.auth)),
});
