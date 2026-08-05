import type { IAuthKeyPayload } from '../../../../../../libs/common/src';
import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';

import { MAX_IMPORT_FILE_BYTES } from '../../../../../../libs/common/src';
import { BadRequestError, InternalError } from '../../errors/app-errors';
import { verifyUploadHandle } from '../../lib/signed-download';
import type { StorageService } from '../../lib/storage.service';
import type { ImportsRepo } from './repositories/imports.repo';

/** `data_imports.source` vocabulary — which entity's importer owns the rows. */
export type ImportSource = 'persons' | 'households' | 'companies' | 'tasks';

/** The upload-based intake shape shared by all four `<entity>.import` mutations. */
export interface UploadImportInput {
  /** Signed handle from `imports.getUploadUrl` — the server, not the client, names the blob. */
  upload_handle: string;
  /** Stringified 0-based CSV column index → import field key (see import-rows.schema.ts). */
  mapping: Record<string, string>;
  file_name?: string | null;
}

interface CreateUploadImportArgs {
  auth: IAuthKeyPayload;
  importsRepo: ImportsRepo;
  storageService: StorageService;
  source: ImportSource;
  input: UploadImportInput;
  /** Used when the client sent no file name, e.g. `Imported-20260804-1210.csv`. */
  fallbackFileName: string;
  /** The persons importer's auto-applied batch tag; null for the other sources. */
  tagName?: string | null;
  /** Source-specific facts the background job needs beyond the file itself. */
  jobExtras?: {
    campaign_id?: string | null;
    tags?: string[] | null;
    duplicate_decision?: 'merge' | 'skip' | 'import_new' | null;
    list_name?: string | null;
  };
}

/**
 * The upload-based half of a CSV import, shared by the four import mutations: verify the signed
 * upload handle, confirm the blob's real size against the import cap, then — in ONE transaction
 * (transactional outbox) — record the import and enqueue the `import_csv` background job that
 * will stream-parse the file. A rollback discards both writes, so there is never a job pointing
 * at a missing import nor an import no job will run. (The legacy rows-in-body path cannot do
 * this because a blob upload sits between its two writes; here the source blob already exists.)
 *
 * `row_count` is left 0: only the job, which parses the file, knows it. The blob key becomes
 * `source_file_key`, which is what the 90-day retention sweep, the delete-import cleanup, and
 * the History re-download all key on — no separate row-payload blob is written on this path.
 */
export async function createUploadImport(
  args: CreateUploadImportArgs,
): Promise<{ import_id: string; file_name: string }> {
  const { auth, input } = args;

  if (Object.keys(input.mapping).length === 0) {
    throw new BadRequestError('Map at least one column before importing.');
  }

  const storageKey = verifyUploadHandle(input.upload_handle, auth.tenant_id);
  // Handles minted by `files.getUploadUrl` share the signing scope but name a different
  // namespace. An import must only ever read the retained-source namespace — retention and the
  // delete-import cascade are keyed on it — so refuse any other key outright.
  if (!storageKey.startsWith(`imports/source/${auth.tenant_id}/`)) {
    throw new BadRequestError('That upload cannot be imported. Upload the CSV again and retry.');
  }

  // Never trust a client-declared size: the browser PUT the file straight to storage, so the
  // only honest byte count is the one the storage account reports.
  const sizeBytes = await args.storageService.getSizeBytes(storageKey);
  if (sizeBytes == null || sizeBytes === 0) {
    throw new BadRequestError('The uploaded file could not be found. Upload it again before importing.');
  }
  if (sizeBytes > MAX_IMPORT_FILE_BYTES) {
    const maxMb = Math.floor(MAX_IMPORT_FILE_BYTES / (1024 * 1024));
    throw new BadRequestError(`That file is too large to import. Import files can be at most ${maxMb} MB.`);
  }

  const requestedFileName = (input.file_name ?? '').trim();
  const fileName = requestedFileName || args.fallbackFileName;

  const importId = await args.importsRepo.transaction().execute(async (trx) => {
    const importRow = {
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      file_name: fileName,
      source: args.source,
      tag_name: args.tagName ?? null,
      tag_id: null,
      row_count: 0,
      inserted_count: 0,
      error_count: 0,
      skipped_count: 0,
      households_created: 0,
      status: 'pending',
      metadata: null,
      source_file_key: storageKey,
      source_file_size: sizeBytes,
      processed_at: new Date(),
    } as OperationDataType<'data_imports', 'insert'>;

    const saved = await args.importsRepo.add({ row: importRow }, trx);
    if (!saved || !saved.id) {
      throw new InternalError('Failed to create data import record');
    }
    const id = String(saved.id);

    await trx
      .insertInto('background_jobs')
      .values({
        tenant_id: auth.tenant_id,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'import_csv',
          import_id: id,
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          source: args.source,
          storage_key: storageKey,
          mapping: input.mapping,
          campaign_id: args.jobExtras?.campaign_id ?? null,
          tags: args.jobExtras?.tags ?? [],
          file_name: fileName,
          duplicate_decision: args.jobExtras?.duplicate_decision ?? null,
          list_name: args.jobExtras?.list_name ?? null,
        }),
        run_at: new Date(),
      })
      .execute();

    return id;
  });

  return { import_id: importId, file_name: fileName };
}
