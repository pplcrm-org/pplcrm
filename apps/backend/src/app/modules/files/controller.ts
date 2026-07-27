import { BaseController } from '../../lib/base.controller';
import { FilesRepo } from './repositories/files.repo';
import { StorageService } from '../../lib/storage.service';
import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import type { getAllOptionsType } from '../../../../../../libs/common/src';
import { logger } from '../../logger';
import { ForbiddenError } from '../../errors/app-errors';
import { getPlanLimits } from '../billing/usage-limits';
import { verifyUploadHandle } from '../../lib/signed-download';
import { sanitizeFilename } from '../../lib/storage-key';

const LARGEST_FILES_LIMIT = 5;

export class FilesController extends BaseController<'files', FilesRepo> {
  private storageService = new StorageService();

  constructor() {
    super(new FilesRepo());
  }

  public async getAllFiles(
    auth: IAuthKeyPayload,
    options?: NonNullable<getAllOptionsType> & { entityType?: string; entityId?: string },
  ) {
    return this.getAllWithCounts(auth.tenant_id, options);
  }

  public async getUsageSummary(auth: IAuthKeyPayload) {
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select(['subscription_plan', 'subscription_quantity'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    const planLimits = getPlanLimits(
      tenant?.subscription_plan as string | null | undefined,
      tenant?.subscription_quantity ?? 1,
    );
    const [usedBytes, largestFiles] = await Promise.all([
      this.getRepo().getTotalBytes(auth.tenant_id),
      this.getRepo().getLargestFiles(auth.tenant_id, LARGEST_FILES_LIMIT),
    ]);

    return {
      usedBytes,
      quotaBytes: planLimits.storageBytes,
      planLabel: (tenant?.subscription_plan as string | null | undefined) || 'Free trial',
      largestFiles,
    };
  }

  public async registerFile(
    input: {
      filename: string;
      mimeType?: string | null;
      uploadHandle: string;
      sha256Hex?: string | null;
      entityType?: string | null;
      entityId?: string | null;
    },
    auth: IAuthKeyPayload,
  ) {
    // The storage key is re-derived from the signed handle minted by getUploadUrl, never
    // taken from the client. A client-chosen key would let any tenant register a row
    // pointing at another tenant's blob and then download or delete it — the row lookup
    // downstream is tenant-scoped, but the blob it dereferences would not be.
    const storageKey = verifyUploadHandle(input.uploadHandle, auth.tenant_id);

    if (input.sha256Hex) {
      const existing = await this.getRepo()
        .db.selectFrom('files')
        .selectAll()
        .where('tenant_id', '=', auth.tenant_id)
        .where('sha256_hex', '=', input.sha256Hex)
        .executeTakeFirst();
      if (existing) {
        // Clean up the newly uploaded duplicate file from storage since we won't be using it
        try {
          await this.storageService.delete(storageKey);
        } catch (err) {
          logger.error({ err }, `Failed to clean up duplicate file ${storageKey}`);
        }
        return existing;
      }
    }

    // Size is read back from storage, never declared by the client: the browser PUTs
    // straight to Azure via the write SAS, so a self-reported byte count is unverifiable
    // and declaring 0 would skip the quota check entirely.
    const sizeBytes = (await this.storageService.getSizeBytes(storageKey)) ?? 0;

    // Storage quota: enforce the plan's storage cap before recording the file, otherwise the limit
    // is only ever measured after the fact by the async usage job (and by then the bytes are
    // already stored). Dedup hits above add no bytes, so they're exempt. The blob has already been
    // uploaded to storage by the client SAS flow, so a rejected upload is cleaned up here.
    if (sizeBytes > 0) {
      const tenant = await this.getRepo()
        .db.selectFrom('tenants')
        .select(['subscription_plan', 'subscription_quantity'])
        .where('id', '=', auth.tenant_id)
        .executeTakeFirst();
      const quotaBytes = getPlanLimits(
        tenant?.subscription_plan ?? null,
        tenant?.subscription_quantity ?? 1,
      ).storageBytes;
      if (Number.isFinite(quotaBytes)) {
        const usedBytes = await this.getRepo().getTotalBytes(auth.tenant_id);
        if (usedBytes + sizeBytes > quotaBytes) {
          try {
            await this.storageService.delete(storageKey);
          } catch (err) {
            logger.error({ err }, `Failed to clean up over-quota upload ${storageKey}`);
          }
          throw new ForbiddenError(
            "This upload would exceed your plan's storage quota. Free up space or upgrade your plan to add more files.",
          );
        }
      }
    }

    return this.add({
      tenant_id: auth.tenant_id,
      filename: sanitizeFilename(input.filename),
      mime_type: input.mimeType || null,
      size_bytes: sizeBytes || null,
      storage_key: storageKey,
      sha256_hex: input.sha256Hex || null,
      uploaded_by: auth.user_id,
      entity_type: input.entityType || null,
      entity_id: input.entityId || null,
    });
  }

  public async generateUploadSasUrl(key: string, expiryMinutes = 15): Promise<string> {
    return this.storageService.generateWriteSasUrl(key, expiryMinutes);
  }

  public override async delete(tenant_id: string, id: string, userId?: string): Promise<boolean> {
    const file = (await this.getOneById({ tenant_id, id })) as any;
    if (!file) return false;

    // Delete from DB
    const deleted = await super.delete(tenant_id, id, userId);

    // Delete from Azure Storage
    if (deleted && file.storage_key) {
      try {
        await this.storageService.delete(file.storage_key);
      } catch (err) {
        logger.error({ err }, `Failed to delete blob for storage key ${file.storage_key}`);
      }
    }
    return deleted;
  }

  public override async deleteMany(tenant_id: string, ids: string[], userId?: string): Promise<boolean> {
    let anyDeleted = false;
    for (const id of ids) {
      const ok = await this.delete(tenant_id, id, userId);
      if (ok) anyDeleted = true;
    }
    return anyDeleted;
  }
}
