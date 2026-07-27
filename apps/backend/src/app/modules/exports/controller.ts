import { TRPCError } from '@trpc/server';
import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import type { LogInstantExportInputType, QueueExportInputType } from '../../../../../../libs/common/src';
import { ExportsRepo } from './repositories/exports.repo';
import { StorageService } from '../../lib/storage.service';
import { logger } from '../../logger';
import { EXPORT_ENTITY_TABLE } from './export-tables';
import { checkDurableRateLimit } from '../../lib/durable-rate-limiter';

/** Exports a tenant may have waiting at once. Matches the worker's per-tenant in-flight
 *  cap (job-claim.ts), so a deeper queue would only ever wait anyway. */
const MAX_PENDING_EXPORTS = 3;
/** Exports a tenant may queue per hour, however fast they drain. */
const EXPORTS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export class ExportsController {
  private readonly repo = new ExportsRepo();

  /** Refuse a new export when the tenant already has a queue waiting, or has queued too
   *  many this hour. */
  private async assertExportCapacity(tenantId: string): Promise<void> {
    const pending = await this.repo.db
      .selectFrom('data_exports')
      .select((eb) => eb.fn.countAll().as('cnt'))
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirst();

    if (Number(pending?.cnt ?? 0) >= MAX_PENDING_EXPORTS) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `You already have ${MAX_PENDING_EXPORTS} exports in progress. Wait for one to finish before starting another.`,
      });
    }

    await checkDurableRateLimit(
      `queueExport:${tenantId}`,
      EXPORTS_PER_HOUR,
      HOUR_MS,
      'You have queued a lot of exports in the last hour. Try again shortly.',
    );
  }

  public async queueExport(input: QueueExportInputType, auth: IAuthKeyPayload) {
    const entityKey = input.entity?.trim();
    if (!entityKey) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'entity is required' });
    }

    // SECURITY (H6): each export streams a full table to blob storage and then sends an
    // email, and nothing capped how many could be queued. Looping this mutation gave
    // unbounded queue depth, unbounded storage (export blobs are not counted against the
    // files quota), and an email fan-out. Bound the queue and the rate.
    await this.assertExportCapacity(auth.tenant_id);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const fileName = input.fileName?.trim() || `${entityKey}-export-${ts}.csv`;
    const columns = Array.isArray(input.columns) && input.columns.length ? input.columns : null;

    const exportRecord = await this.repo.create({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entity: entityKey,
      file_name: fileName,
      columns,
    });

    const exportId = String(exportRecord.id);

    await this.repo.db
      .insertInto('background_jobs')
      .values({
        tenant_id: auth.tenant_id,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'export_csv',
          export_id: exportId,
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          entity: entityKey,
          table: EXPORT_ENTITY_TABLE[entityKey] ?? entityKey,
          options: input.options ?? {},
          columns,
          file_name: fileName,
        }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();

    return {
      id: exportId,
      entity: entityKey,
      file_name: fileName,
      status: 'pending' as const,
      row_count: null,
      error: null,
      created_at: exportRecord.created_at?.toISOString?.() ?? new Date().toISOString(),
      updated_at: exportRecord.updated_at?.toISOString?.() ?? new Date().toISOString(),
      downloadable: false,
      createdBy: {
        id: auth.user_id,
        name: auth.name || null,
        email: null,
      },
    };
  }

  /** Records an export that already downloaded straight to the browser (small/displayed-rows
   * path in the grid toolbar) so it still appears in Exports history — see pplcrm-datagrid.
   * No file is stored server-side, so the record can't be re-downloaded. */
  public async logInstantExport(input: LogInstantExportInputType, auth: IAuthKeyPayload) {
    const exportRecord = await this.repo.createCompleted({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entity: input.entity,
      file_name: input.fileName,
      row_count: input.rowCount,
    });

    return {
      id: String(exportRecord.id),
      entity: input.entity,
      file_name: input.fileName,
      status: 'completed' as const,
      row_count: input.rowCount,
      error: null,
      created_at: exportRecord.created_at?.toISOString?.() ?? new Date().toISOString(),
      updated_at: exportRecord.updated_at?.toISOString?.() ?? new Date().toISOString(),
      downloadable: false,
      createdBy: {
        id: auth.user_id,
        name: auth.name || null,
        email: null,
      },
    };
  }

  public async list(auth: IAuthKeyPayload) {
    const rows = await this.repo.list(auth.tenant_id);
    return rows.map((r) => {
      const name = [r.creator_first_name, r.creator_last_name].filter(Boolean).join(' ').trim();
      return {
        id: String(r.id),
        entity: String(r.entity),
        file_name: String(r.file_name),
        status: r.status as 'pending' | 'processing' | 'completed' | 'failed',
        row_count: r.row_count != null ? Number(r.row_count) : null,
        error: r.error ?? null,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
        downloadable: r.storage_key != null,
        createdBy: r.user_id
          ? {
              id: r.user_id,
              name: name || null,
              email: r.creator_email || null,
            }
          : null,
      };
    });
  }

  public async getById(id: string, auth: IAuthKeyPayload) {
    const row = await this.repo.getById(id, auth.tenant_id);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Export not found' });
    return row;
  }

  public async deleteExport(id: string, auth: IAuthKeyPayload) {
    const row = await this.repo.getById(id, auth.tenant_id);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Export not found' });
    }

    await this.repo.delete(id, auth.tenant_id);

    if (row.storage_key) {
      try {
        const storageService = new StorageService();
        await storageService.delete(row.storage_key);
      } catch (err) {
        logger.error({ err }, `Failed to delete storage file ${row.storage_key}`);
      }
    }

    return { success: true };
  }

  public getRepo() {
    return this.repo;
  }
}
