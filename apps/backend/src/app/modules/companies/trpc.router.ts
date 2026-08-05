import {
  idSchema,
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
      z.object({
        // Row shape lives in libs/common/src/lib/schemas/import-rows.schema.ts (it is the same
        // object as CompanyInputObj — the import has always validated rows as form payloads).
        rows: z.array(CompaniesImportRowObj).max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
        skipped: z.number().int().nonnegative().optional(),
        file_name: z.string().trim().min(1).max(255).optional(),
        source_csv: z.string().max(10_000_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      ctx.res.status(202);
      return companies.importRows(input, ctx.auth);
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
