import { BaseController } from '../../lib/base.controller';
import { CompaniesRepo } from './repositories/companies.repo';
import {
  CompaniesEnrichmentService,
  enrichmentIsSettled,
  parseEnrichment,
  type CompanyLookupResult,
} from './services/companies-enrichment.service';
import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import type {
  Models,
  OperationDataType,
  TypeId,
  TypeTenantId,
} from '../../../../../../libs/common/src/lib/kysely.models';
import type { Transaction } from 'kysely';
import { slugifyRecordName } from '../../../../../../libs/common/src';
import { backfillMissingSlugs, uniqueSlug } from '../../lib/slug';
import { chunkRows, IMPORT_CHUNK_SIZE, NDJSON_CONTENT_TYPE, serializeRowsToNdjson } from '../../lib/ndjson';
import { ImportsRepo } from '../imports/repositories/imports.repo';
import { createUploadImport } from '../imports/upload-intake';
import { StorageService } from '../../lib/storage.service';
import { TRPCError } from '@trpc/server';
import { logger } from '../../logger';

/** The writable company fields accepted by the legacy add/update helpers (mirrors CompanyInputObj). */
interface CompanyWriteFields {
  name: string;
  description?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  industry?: string | null;
  notes?: string | null;
}

export class CompaniesController extends BaseController<'companies', CompaniesRepo> {
  constructor() {
    super(new CompaniesRepo());
  }

  /** Record slug for /companies/:slug URLs (spec §1) — shared strategy in lib/slug.ts. */
  public override async add(row: OperationDataType<'companies', 'insert'>, trx?: Transaction<Models>) {
    const rowObj = row as Record<string, unknown>;
    if (rowObj['slug'] == null && rowObj['tenant_id'] != null) {
      rowObj['slug'] = await uniqueSlug(slugifyRecordName(String(rowObj['name'] ?? ''), 'company'), (candidate) =>
        this.getRepo().slugExists(String(rowObj['tenant_id']), candidate),
      );
    }
    return super.add(row, trx);
  }

  /** Rename regenerates the record slug (spec §1) — old numeric-ID URLs still resolve. */
  public override async update(input: {
    tenant_id: string;
    id: string;
    row: OperationDataType<'companies', 'update'>;
  }) {
    const row = input.row as Record<string, unknown>;
    if ('name' in row) {
      row['slug'] = await uniqueSlug(slugifyRecordName(String(row['name'] ?? ''), 'company'), (candidate) =>
        this.getRepo().slugExists(input.tenant_id, candidate, input.id),
      );
    }
    return super.update(input);
  }

  public override async getOneById(input: { tenant_id: string; id: string }): Promise<any> {
    const company = (await super.getOneById(input)) as any;
    if (company) {
      await this.queueEnrichmentOnView(input.tenant_id, String(company.id), company.enrichment);
    }
    return company;
  }

  /**
   * Opening a company's page queues a Google Places lookup when we have no answer on file yet.
   *
   * This runs on every single detail-page load and each lookup costs two billable Google calls
   * (a text search, then a place-details fetch), so it is guarded three ways:
   *
   * 1. we already have Google's answer, or Google refused the request — nothing to gain;
   * 2. no API key is configured — the job could only no-op;
   * 3. a job for this company is already pending or running.
   *
   * Guard 3 is the one that was missing. Without it, every view between the first one and the
   * first job completing queued another job for the same company. The daily sweep in
   * CompaniesEnrichmentService has always had this check, for the same reason.
   *
   * It is a check-then-insert, not a lock, so two page loads landing at the same instant can
   * still both queue. That bounds duplicates to genuinely concurrent requests instead of every
   * request in the window, which is what this needs to do.
   */
  private async queueEnrichmentOnView(tenantId: string, companyId: string, rawEnrichment: unknown): Promise<void> {
    if (enrichmentIsSettled(parseEnrichment(rawEnrichment))) return;
    if (!CompaniesEnrichmentService.isConfigured()) return;

    try {
      if (await CompaniesEnrichmentService.hasPendingEnrichmentJob(this.getRepo().db, tenantId, companyId)) return;
      await this.getRepo()
        .db.insertInto('background_jobs')
        .values({
          tenant_id: tenantId,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'enrich_company_google',
            company_id: companyId,
            tenant_id: String(tenantId),
          }),
          run_at: new Date(),
          max_attempts: 3,
        })
        .execute();
    } catch (err) {
      // Viewing a company must never fail because enrichment could not be queued.
      logger.error({ err }, 'Failed to queue google enrichment job on getOneById');
    }
  }

  /**
   * Queue a Google Places enrichment lookup for one company (§7 "Enrich" /
   * "Re-check Google" button). Transactional-outbox: verify the company is in
   * the tenant, then insert the background job. `force` re-runs even if the
   * company was already enriched.
   */
  public async queueEnrichment(id: string, auth: IAuthKeyPayload, force = false): Promise<{ queued: boolean }> {
    const company = await this.getRepo()
      .db.selectFrom('companies')
      .select('id')
      .where('id', '=', id)
      .where('tenant_id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!company) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Company not found' });
    }

    await this.getRepo()
      .db.insertInto('background_jobs')
      .values({
        tenant_id: auth.tenant_id,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'enrich_company_google',
          company_id: String(id),
          tenant_id: String(auth.tenant_id),
          force,
        }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();

    return { queued: true };
  }

  /**
   * Interactive add-time preview: look up a company by name on Google Places and
   * return the fields without persisting anything (no company row exists yet).
   * Powers the "auto-fill on name blur" behavior in the New Company form.
   */
  public lookupEnrichment(name: string): Promise<CompanyLookupResult> {
    return CompaniesEnrichmentService.lookupByName(name);
  }

  /**
   * Background duplicate-name check for the add/edit form. Case-insensitive,
   * tenant-scoped, and (in edit) ignores the record being edited. Drives the
   * "a company by that name already exists" hint — advisory only, never blocks
   * saving, since same-named companies can be legitimate.
   */
  public nameExists(name: string, auth: IAuthKeyPayload, excludeId?: string): Promise<boolean> {
    return this.getRepo().nameExists(auth.tenant_id, name, excludeId);
  }

  public addCompany(payload: CompanyWriteFields, auth: IAuthKeyPayload) {
    const row = {
      name: payload.name,
      description: payload.description ?? null,
      website: payload.website ?? null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      industry: payload.industry ?? null,
      notes: payload.notes ?? null,
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    } as OperationDataType<'companies', 'insert'>;
    return this.add(row);
  }

  public updateCompany(id: string, row: Partial<CompanyWriteFields>, auth: IAuthKeyPayload) {
    const rowWithUpdatedBy = {
      ...row,
      updatedby_id: auth.user_id,
    } as OperationDataType<'companies', 'update'>;
    return this.update({ tenant_id: auth.tenant_id, id, row: rowWithUpdatedBy });
  }

  public async getAllCompanies(auth: IAuthKeyPayload, options?: any) {
    return this.getAllWithCounts(auth.tenant_id, options);
  }

  public getOneBySlug(slug: string, auth: IAuthKeyPayload) {
    return this.getRepo().getOneBySlug({ tenant_id: auth.tenant_id, slug });
  }

  private readonly importsRepo = new ImportsRepo();
  private readonly storageService = new StorageService();

  public async getPotentialDuplicates(auth: IAuthKeyPayload, options?: { page?: number; pageSize?: number }) {
    return this.getRepo().getPotentialDuplicates(auth.tenant_id, options);
  }

  public async mergeCompanies(target_id: string, source_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().mergeCompanies({
      tenant_id: auth.tenant_id,
      target_id,
      source_id,
      user_id: auth.user_id,
    });
  }

  public async importRows(
    input:
      | {
          rows: Array<{
            name: string;
            description?: string | null;
            website?: string | null;
            email?: string | null;
            phone?: string | null;
            industry?: string | null;
            notes?: string | null;
          }>;
          skipped?: number;
          file_name?: string | null;
          source_csv?: string | null;
        }
      | {
          /** Upload-based intake: the CSV is already in blob storage (imports.getUploadUrl). */
          upload_handle: string;
          /** Stringified 0-based CSV column index → import field key (CompaniesImportMappingObj). */
          mapping: Record<string, string>;
          file_name?: string | null;
        },
    auth: IAuthKeyPayload,
  ) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const autoTag = `Imported-Companies-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    if ('upload_handle' in input) {
      const created = await createUploadImport({
        auth,
        importsRepo: this.importsRepo,
        storageService: this.storageService,
        source: 'companies',
        input,
        fallbackFileName: `${autoTag}.csv`,
        tagName: null,
      });
      return {
        inserted: 0,
        errors: 0,
        skipped: 0,
        file_name: created.file_name,
        import_id: created.import_id,
        tenant_id: auth.tenant_id,
        status: 'pending',
      };
    }

    const skippedFromClient = Math.max(0, Math.floor(input.skipped ?? 0));
    const requestedFileName = (input.file_name ?? '').trim();
    const baseFileName = requestedFileName || `${autoTag}.csv`;
    const totalRows = input.rows.length + skippedFromClient;

    const importRow = {
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      file_name: baseFileName,
      source: 'companies',
      tag_name: null,
      tag_id: null,
      row_count: totalRows,
      inserted_count: 0,
      error_count: 0,
      skipped_count: skippedFromClient,
      households_created: 0,
      status: 'pending',
      metadata: null,
      processed_at: now,
    } as unknown as OperationDataType<'data_imports', 'insert'>;

    const savedImport = await this.importsRepo.add({ row: importRow });
    if (!savedImport || !savedImport.id) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create data import record',
      });
    }

    const importRecordId = String(savedImport.id);
    const storageKey = `imports/payloads/${auth.tenant_id}/${importRecordId}.json`;

    try {
      // NDJSON (one row object per line) so the import job can stream rows
      // instead of parsing one giant array — see lib/ndjson.ts.
      const payloadBuffer = serializeRowsToNdjson(input.rows);
      await this.storageService.upload(storageKey, payloadBuffer, NDJSON_CONTENT_TYPE);
    } catch (err) {
      logger.error({ err }, 'Failed to upload import payload to storage');
      await this.importsRepo.delete({
        tenant_id: auth.tenant_id as TypeTenantId<'data_imports'>,
        id: importRecordId as TypeId<'data_imports'>,
      });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to store import payload on server storage',
      });
    }

    // Keep the original upload downloadable for 90 days (spec §17 History
    // page footer). Best-effort: a failure here shouldn't fail the import.
    let sourceFileKey: string | null = null;
    let sourceFileSize: number | null = null;
    if (input.source_csv) {
      try {
        const sourceBuffer = Buffer.from(input.source_csv, 'utf8');
        sourceFileKey = `imports/source/${auth.tenant_id}/${importRecordId}.csv`;
        sourceFileSize = sourceBuffer.byteLength;
        await this.storageService.upload(sourceFileKey, sourceBuffer, 'text/csv');
      } catch (err) {
        logger.error({ err }, 'Failed to retain original CSV upload for the import history page');
        sourceFileKey = null;
        sourceFileSize = null;
      }
    }

    await this.importsRepo.update({
      tenant_id: auth.tenant_id,
      id: importRecordId,
      row: {
        metadata: JSON.stringify({ storage_key: storageKey }),
        source_file_key: sourceFileKey,
        source_file_size: sourceFileSize,
      } as unknown as OperationDataType<'data_imports', 'update'>,
    });

    await this.importsRepo.db
      .insertInto('background_jobs')
      .values({
        tenant_id: auth.tenant_id,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          import_id: importRecordId,
          storage_key: storageKey,
          skipped: skippedFromClient,
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          file_name: baseFileName,
          source: 'companies',
        }),
        run_at: new Date(),
      })
      .execute();

    return {
      inserted: 0,
      errors: 0,
      skipped: skippedFromClient,
      file_name: baseFileName,
      import_id: importRecordId,
      tenant_id: auth.tenant_id,
      status: 'pending',
    };
  }

  public async processImportRows(
    import_id: string,
    tenant_id: string,
    user_id: string,
    skipped: number,
    // Any row source works (arrays included); the import job passes a lazy
    // NDJSON iterator so the full payload is never materialized at once.
    rows: Iterable<Record<string, string>> | AsyncIterable<Record<string, string>>,
  ) {
    const results = { inserted: 0, errors: 0, skipped: 0 };
    const errorMessages: string[] = [];

    // Crash/continuation resume: each per-chunk counter write below also records, atomically
    // with the chunk's inserts, how many source rows have been durably consumed
    // (`processed_row_offset`). This importer's plain inserts are NOT idempotent, so a re-run
    // after a worker crash must skip exactly the committed rows: a re-entering run finds a
    // non-zero offset, its caller has already stream-skipped that many rows, and the totals
    // continue from what the database holds.
    const importState = await this.importsRepo.db
      .selectFrom('data_imports')
      .select(['processed_row_offset', 'inserted_count', 'error_count', 'skipped_count'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', import_id)
      .executeTakeFirst();
    const resumeOffset = Number(importState?.processed_row_offset ?? 0);
    const resuming = resumeOffset > 0;
    // On resume the pre-processing skips (wizard/count-pass) are already inside the stored
    // skipped_count, so the base contribution must not be added a second time.
    const skippedBase = resuming ? 0 : skipped;
    if (resuming) {
      results.inserted = Number(importState?.inserted_count ?? 0);
      results.errors = Number(importState?.error_count ?? 0);
      results.skipped = Number(importState?.skipped_count ?? 0);
    }
    // Rows consumed from the source so far — starts at the resume offset.
    let rowsSeen = resumeOffset;

    for await (const chunk of chunkRows(rows, IMPORT_CHUNK_SIZE)) {
      rowsSeen += chunk.length;
      // 1. Filter valid rows upfront
      const validRows: Record<string, string>[] = [];
      for (const raw of chunk) {
        if (!raw['name'] || !raw['name'].trim()) {
          results.skipped += 1;
        } else {
          validRows.push(raw);
        }
      }

      // Whether this chunk's transaction committed — committed chunks persist their counters
      // and resume offset inside the transaction; everything else is recorded after the fact.
      let chunkCommitted = false;
      if (validRows.length > 0) {
        try {
          // 2. Batch insert all valid company rows in one statement
          const companyRows = validRows.map((raw) => ({
            tenant_id,
            createdby_id: user_id,
            updatedby_id: user_id,
            name: (raw['name'] ?? '').trim(),
            description: raw['description'] ?? null,
            website: raw['website'] ?? null,
            email: raw['email'] ?? null,
            phone: raw['phone'] ?? null,
            industry: raw['industry'] ?? null,
            notes: raw['notes'] ?? null,
            file_id: import_id,
          }));
          await this.getRepo()
            .transaction()
            .execute(async (trx) => {
              await trx.insertInto('companies').values(companyRows).execute();
              // The chunk's counters and the resume offset, in the SAME transaction as its
              // rows, so a crash can never separate committed rows from the recorded offset.
              await this.importsRepo.update(
                {
                  tenant_id: tenant_id,
                  id: import_id,
                  row: {
                    inserted_count: results.inserted + validRows.length,
                    error_count: results.errors,
                    skipped_count: skippedBase + results.skipped,
                    processed_row_offset: rowsSeen,
                    updatedby_id: user_id,
                    updated_at: new Date(),
                  } as unknown as OperationDataType<'data_imports', 'update'>,
                },
                trx,
              );
            });
          results.inserted += validRows.length;
          chunkCommitted = true;
        } catch (err) {
          results.errors += validRows.length;
          errorMessages.push(err instanceof Error && err.message ? err.message : String(err));
        }
      }

      // Rolled-back and all-skipped chunks are recorded here, after the fact: a crash before
      // this write just re-runs the chunk on resume — nothing was committed.
      if (!chunkCommitted) {
        await this.importsRepo.update({
          tenant_id: tenant_id,
          id: import_id,
          row: {
            inserted_count: results.inserted,
            error_count: results.errors,
            skipped_count: skippedBase + results.skipped,
            processed_row_offset: rowsSeen,
            updatedby_id: user_id,
            updated_at: new Date(),
          } as unknown as OperationDataType<'data_imports', 'update'>,
        });
      }
    }

    // Bulk-inserted rows get their record slugs in one set-based pass (spec §1).
    try {
      await backfillMissingSlugs(this.getRepo().db, 'companies', tenant_id);
    } catch (err) {
      logger.error({ err }, 'Failed to backfill company slugs after import');
    }

    return {
      inserted: results.inserted,
      errors: results.errors,
      skipped: skippedBase + results.skipped,
      errorMessages,
    };
  }
}
