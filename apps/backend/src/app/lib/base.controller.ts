import { TRPCError } from '@trpc/server';

import type {
  ExportCsvInputType,
  ExportCsvResponseType,
  IAuthKeyPayload,
  getAllOptionsType,
} from '../../../../../libs/common/src';
import { env } from '../../env';
import { logger } from '../logger';

import type { ReferenceExpression, Transaction } from 'kysely';

import type { Models, OperationDataType, TypeTenantId } from '../../../../../libs/common/src/lib/kysely.models';
import type { BaseRepository, QueryParams } from './base.repo';
import { rowsToCsv } from './csv';
import { notificationEnabled } from './profile-preferences';
import type { UserActivityType } from './user-activity.repo';
import { UserActivityRepo } from './user-activity.repo';
import { TransactionalEmailService } from './mail/transactional-mail.service';

// The inline exportCsv path buffers the whole result set plus the built CSV string in memory and
// returns it in a single tRPC response, so it must be bounded — a large tenant would otherwise spike
// backend memory or stall the event loop (SECURITY-REVIEW.md 3.2). Anything past this cap has to go
// through the queued/streamed background export (ExportsController.queueExport), which writes to
// storage instead of buffering. Kept generous so ordinary exports are unaffected.
const MAX_INLINE_EXPORT_ROWS = 50_000;

/** Refuse an oversized inline export with an actionable message pointing at the background export. */
function assertInlineExportWithinCap(rowCount: number): void {
  if (rowCount > MAX_INLINE_EXPORT_ROWS) {
    throw new TRPCError({
      code: 'PAYLOAD_TOO_LARGE',
      message: `This export is too large for a direct download (over ${MAX_INLINE_EXPORT_ROWS.toLocaleString()} rows). Use the background export to have it prepared as a downloadable file.`,
    });
  }
}

export class BaseController<T extends keyof Models, R extends BaseRepository<T>> {
  protected readonly userActivity = new UserActivityRepo();

  constructor(private repo: R) {}

  private getEntityLabel(tableName: string, rowObj: any): string {
    if (!rowObj) return '';
    if (tableName === 'tasks') {
      return String(rowObj['name'] || '');
    }
    if (tableName === 'persons') {
      return `${rowObj['first_name'] || ''} ${rowObj['last_name'] || ''}`.trim();
    }
    if (tableName === 'households') {
      const streetParts = [
        rowObj['apt'] ? `Apt ${rowObj['apt']}` : null,
        rowObj['street_num'],
        rowObj['street1'],
        rowObj['street2'],
      ].filter(Boolean);
      const locationParts = [rowObj['city'], rowObj['state'], rowObj['zip']].filter(Boolean);
      return [streetParts.join(' '), locationParts.join(', ')].filter(Boolean).join(', ').trim() || 'Household';
    }
    if (tableName === 'emails') {
      return String(rowObj['subject'] || '');
    }
    return String(rowObj['name'] || rowObj['subject'] || rowObj['title'] || '');
  }

  public async add(row: OperationDataType<T, 'insert'>, trx?: Transaction<Models>) {
    const result = await this.repo.add({ row }, trx);
    try {
      const rowObj = row as Record<string, unknown>;
      const actor = rowObj['createdby_id'];
      const tenant = rowObj['tenant_id'];
      if (actor != null && tenant != null) {
        const resultObj = result as Record<string, unknown> | undefined;
        const resultId = resultObj && 'id' in resultObj ? String(resultObj['id']) : null;
        const metadata: Record<string, unknown> = resultId ? { id: resultId } : {};
        if (resultObj) {
          const tableName = String(this.repo.getTableName());
          metadata['entity_label'] = this.getEntityLabel(tableName, resultObj);
        }
        if (String(this.repo.getTableName()) === 'tasks' && resultObj && resultObj['name']) {
          metadata['task_name'] = String(resultObj['name']);
        }
        await this.userActivity.log(
          {
            tenant_id: String(tenant),
            user_id: String(actor),
            activity: 'create',
            entity: String(this.repo.getTableName()),
            entity_id: resultId,
            quantity: 1,
            metadata,
          },
          trx,
        );
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log create activity');
    }
    return result;
  }

  public async addMany(rows: OperationDataType<T, 'insert'>[], trx?: Transaction<Models>) {
    const result = await this.repo.addMany({ rows }, trx);
    try {
      const firstRow = rows[0];
      if (firstRow) {
        const rowObj = firstRow as Record<string, unknown>;
        const actor = rowObj['createdby_id'];
        const tenant = rowObj['tenant_id'];
        if (actor != null && tenant != null) {
          await this.userActivity.log(
            {
              tenant_id: String(tenant),
              user_id: String(actor),
              activity: 'create',
              entity: String(this.repo.getTableName()),
              quantity: rows.length,
              metadata: { count: rows.length },
            },
            trx,
          );
        }
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log addMany activity');
    }
    return result;
  }

  public async delete(tenant_id: TypeTenantId<T>, idToDelete: string, userId?: string) {
    const result = await this.repo.delete({
      tenant_id,
      id: idToDelete,
    });
    try {
      if (userId != null) {
        await this.userActivity.log({
          tenant_id: String(tenant_id),
          user_id: String(userId),
          activity: 'delete',
          entity: String(this.repo.getTableName()),
          entity_id: idToDelete ? String(idToDelete) : null,
          quantity: 1,
          metadata: { id: idToDelete },
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log delete activity');
    }
    return result;
  }

  public deleteMany(tenant_id: TypeTenantId<T>, idsToDelete: string[]) {
    return this.repo.deleteMany({
      ids: idsToDelete,
      tenant_id,
    });
  }

  public find(input: { tenant_id: string; key: string; column: ReferenceExpression<Models, T> }) {
    return this.repo.find({
      tenant_id: input.tenant_id,
      key: input.key,
      column: input.column,
    });
  }

  public getAll(tenant: string, options?: getAllOptionsType) {
    return this.repo.getAll({
      tenant_id: tenant,
      options: options as QueryParams<T>,
    });
  }

  public getAllWithCounts(tenant: string, options?: getAllOptionsType) {
    return this.getRepo().getAllWithCounts({
      tenant_id: tenant,
      options: options as QueryParams<any>,
    });
  }

  public getCount(tenant_id: string) {
    return this.repo.count(tenant_id);
  }

  public getOneById(input: { tenant_id: string; id: string }) {
    return this.repo.getOneById({ id: input.id, tenant_id: input.tenant_id });
  }

  public async update(input: { tenant_id: string; id: string; row: OperationDataType<T, 'update'> }) {
    let original: Record<string, unknown> | undefined;
    try {
      original = (await this.repo.getOneById({ id: input.id, tenant_id: input.tenant_id })) as
        | Record<string, unknown>
        | undefined;
    } catch (err) {
      logger.error({ err }, 'Failed to fetch original record for activity log');
    }
    const result = await this.repo.update({ id: input.id, tenant_id: input.tenant_id, row: input.row });
    try {
      const rowObj = input.row as Record<string, unknown>;
      const actor = rowObj['updatedby_id'];
      if (actor != null) {
        const metadata: Record<string, unknown> = { id: input.id };
        const resultObj = result as Record<string, unknown> | undefined;
        if (original && resultObj) {
          const skipKeys = [
            'id',
            'tenant_id',
            'createdby_id',
            'updatedby_id',
            'created_at',
            'updated_at',
            'address_fp_street',
            'address_fp_full',
            'password',
            'password_reset_code',
            'password_reset_code_created_at',
          ];
          const changes: Record<string, unknown> = {};
          for (const key of Object.keys(rowObj)) {
            if (skipKeys.includes(key)) continue;
            const oldVal = original[key];
            const newVal = resultObj[key];
            if (oldVal !== newVal) {
              changes[key] = { from: oldVal ?? null, to: newVal ?? null };
            }
          }
          metadata['changes'] = changes;
          metadata['entity_label'] = this.getEntityLabel(String(this.repo.getTableName()), resultObj);
        }
        if (String(this.repo.getTableName()) === 'tasks' && resultObj && resultObj['name']) {
          metadata['task_name'] = String(resultObj['name']);
        }
        let activity: UserActivityType = 'update';
        if (String(this.repo.getTableName()) === 'tasks' && 'due_at' in rowObj) {
          metadata['action'] = 'change_due_date';
          metadata['due_at'] = rowObj['due_at'];
        }
        if (String(this.repo.getTableName()) === 'tasks' && 'assigned_to' in rowObj) {
          const assigneeId = rowObj['assigned_to'];
          if (assigneeId == null || assigneeId === '') {
            activity = 'unassign';
          } else {
            activity = 'assign';
            try {
              const assignee = await this.repo.db
                .selectFrom('authusers')
                .select(['first_name', 'last_name'])
                .where('id', '=', String(assigneeId))
                .executeTakeFirst();
              if (assignee) {
                metadata['assigned_to_name'] = `${assignee.first_name} ${assignee.last_name || ''}`.trim();
              }
            } catch (err) {
              logger.error({ err }, 'Failed to look up assignee name');
            }
          }
        }
        await this.userActivity.log({
          tenant_id: String(input.tenant_id),
          user_id: String(actor),
          activity: activity,
          entity: String(this.repo.getTableName()),
          entity_id: input.id ? String(input.id) : null,
          quantity: 1,
          metadata,
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log update activity');
    }
    return result;
  }

  protected getRepo() {
    return this.repo;
  }

  public async exportCsv(
    input: ExportCsvInputType & { tenant_id: string },
    auth?: IAuthKeyPayload,
  ): Promise<ExportCsvResponseType> {
    const options = (input?.options ?? {}) as QueryParams<T>;
    // Fetch one past the cap so an oversized export is detected and refused (below) instead of
    // pulling an unbounded table into memory. An explicit limit wins over any derived paging.
    const cappedOptions = { ...options, limit: MAX_INLINE_EXPORT_ROWS + 1 } as QueryParams<T>;
    const rows = await this.repo.getAll({ tenant_id: input.tenant_id, options: cappedOptions });
    assertInlineExportWithinCap(rows.length);
    const records = rows.map((row) => ({ ...(row as Record<string, unknown>) }));
    const response = this.buildCsvResponse(records, input) as {
      csv: string;
      fileName: string;
      columns: string[];
      rowCount: number;
    };

    if (auth) {
      try {
        await this.userActivity.log({
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'export',
          entity: String(this.repo.getTableName()),
          quantity: response.rowCount,
          metadata: {
            requested_columns: Array.isArray(input.columns) ? input.columns.slice(0, 12) : [],
            returned_columns: response.columns.slice(0, 12),
            file_name: response.fileName,
          },
        });

        const user = await this.repo.db
          .selectFrom('authusers')
          .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
          .select(['authusers.email', 'profiles.preferences as profile_preferences'])
          .where('authusers.id', '=', auth.user_id)
          .executeTakeFirst();
        if (user && user.email) {
          if (notificationEnabled(user.profile_preferences, 'export_ready')) {
            const mailService = new TransactionalEmailService();
            await mailService.sendMail({
              to: user.email,
              subject: `Your export is ready: ${response.fileName}`,
              notificationSettingsLink: true,
              text: `Hi ${auth.name},\n\nYour export of ${response.rowCount} records from the ${String(this.repo.getTableName())} table is ready.\n\nFile name: ${response.fileName}\nDownload it here: ${env.appUrl}/downloads/${response.fileName}`,
              html: `<h2>Your export is ready</h2>
<p>Hi ${auth.name},</p>
<p>Your export of <strong>${response.rowCount}</strong> records from the <strong>${String(this.repo.getTableName())}</strong> table is ready.</p>
<div class="panel"><p><strong>File name:</strong> ${response.fileName}</p></div>
<div class="btn-container">
  <a href="${env.appUrl}/downloads/${response.fileName}" class="btn">Download CSV</a>
</div>`,
            });
          }
        }
      } catch (err) {
        // Logging failures should never break export flow; swallow silently
        logger.error({ err }, 'Failed to log export activity or send email alert');
      }
    }

    return response;
  }

  protected buildCsvResponse(
    rows: Array<Record<string, unknown>>,
    input: ExportCsvInputType & { tenant_id: string },
  ): ExportCsvResponseType {
    const requestedColumns = Array.isArray(input?.columns)
      ? (input.columns.filter((c): c is string => Boolean(c)) ?? [])
      : [];
    const columns = requestedColumns.length
      ? requestedColumns
      : rows.length > 0
        ? Object.keys(rows[0] as Record<string, unknown>)
        : [];
    const fileName = input?.fileName?.trim() || `${String(this.repo.getTableName())}-export.csv`;
    // Shared safety net for override paths (persons/households/etc.) that fetch rows themselves:
    // never build an oversized CSV string inline — steer them to the background export too.
    assertInlineExportWithinCap(rows.length);
    const csv = columns.length ? rowsToCsv(rows as Array<Record<string, unknown>>, columns) : '';
    return {
      csv,
      columns,
      fileName,
      rowCount: rows.length,
    };
  }

  protected async resolveCreatorAndUpdater(tenantId: string, record: any, trx?: Transaction<Models>) {
    if (!record) return record;
    const db = trx ?? this.repo.db;
    const userIds: string[] = [record.createdby_id, record.updatedby_id].filter(Boolean);
    if (userIds.length === 0) return record;

    const users = await db
      .selectFrom('authusers')
      .select(['id', 'first_name', 'last_name'])
      .where('id', 'in', userIds)
      .where('tenant_id', '=', tenantId)
      .execute();

    const userMap: Record<string, string> = {};
    for (const u of users) {
      userMap[String(u.id)] = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Unknown User';
    }

    return {
      ...record,
      created_by_name: record.createdby_id ? (userMap[String(record.createdby_id)] ?? 'Unknown User') : null,
      updated_by_name: record.updatedby_id ? (userMap[String(record.updatedby_id)] ?? 'Unknown User') : null,
    };
  }
}
