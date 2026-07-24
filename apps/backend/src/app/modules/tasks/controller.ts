import type {
  AddTaskType,
  ExportCsvInputType,
  ExportCsvResponseType,
  UpdateTaskType,
  getAllOptionsType,
} from '../../../../../../libs/common/src';

import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';
import { env } from '../../../env';
import { BaseController } from '../../lib/base.controller';

import { TasksRepo } from './repositories/tasks.repo';
import type { Selectable } from 'kysely';
import type {
  Models,
  OperationDataType,
  TypeId,
  TypeTenantId,
} from '../../../../../../libs/common/src/lib/kysely.models';
import type { QueryParams } from '../../lib/base.repo';
import { NotificationsRepo } from '../notifications/repositories/notifications.repo';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { notificationEnabled } from '../../lib/profile-preferences';
import { ImportsRepo } from '../imports/repositories/imports.repo';
import { StorageService } from '../../lib/storage.service';
import { TRPCError } from '@trpc/server';
import { logger } from '../../logger';
import { TASK_STATUSES, calculateWorkingTimeMs } from '../../../../../../libs/common/src';
import type { ReorderTasksType } from '../../../../../../libs/common/src';
import { NotFoundError } from '../../errors/app-errors';
import { SettingsRepo } from '../settings/repositories/settings.repo';

export class TasksController extends BaseController<'tasks', TasksRepo> {
  private mailService = new TransactionalEmailService();

  constructor() {
    super(new TasksRepo());
  }

  public async addTask(payload: AddTaskType, auth: IAuthKeyPayload) {
    const row = {
      name: payload.name,
      details: payload.details,
      due_at: payload.due_at ?? null,
      status: payload.status ?? 'todo',
      priority: payload.priority ?? null,
      completed_at: payload.completed_at ?? null,
      position: payload.position ?? 0,
      assigned_to: payload.assigned_to ?? null,
      team_id: payload.team_id ?? null,
      // '' is the unselected-<select> sentinel the schema admits — store a real NULL.
      person_id: payload.person_id || null,
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    } as OperationDataType<'tasks', 'insert'>;
    const task = await this.add(row);
    if (task && payload.assigned_to) {
      try {
        const assignedTo = payload.assigned_to;
        const assignee = await this.getRepo()
          .db.selectFrom('authusers')
          .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
          .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
          .where('authusers.id', '=', assignedTo)
          .executeTakeFirst();
        if (assignee) {
          if (notificationEnabled(assignee.profile_preferences, 'task_assigned_in_app')) {
            const notificationsRepo = new NotificationsRepo();
            await notificationsRepo.pushNotification({
              tenant_id: auth.tenant_id,
              user_id: assignedTo,
              title: 'Task Assigned',
              message: `You have been assigned the task: "${payload.name}"`,
              type: 'task',
              link: `/tasks/${task.id}`,
            });
          }
          if (assignee.email && notificationEnabled(assignee.profile_preferences, 'task_assigned')) {
            await this.mailService.sendMail({
              to: assignee.email,
              subject: `New task assigned: ${payload.name}`,
              notificationSettingsLink: true,
              text: `Hi ${assignee.first_name},\n\n${auth.name} assigned you the task "${payload.name}".\n\nDetails:\n${payload.details || 'None'}\n\nView the task: ${env.appUrl}/tasks/${task.id}`,
              html: `<h2>New task assigned</h2>
<p>Hi ${assignee.first_name},</p>
<p>${auth.name} assigned you the task <strong>"${payload.name}"</strong>.</p>
<div class="panel"><p><strong>Details:</strong><br>${payload.details || 'None'}</p></div>
<div class="btn-container">
  <a href="${env.appUrl}/tasks/${task.id}" class="btn">View task</a>
</div>`,
            });
          }
        }
      } catch (nErr) {
        logger.error({ err: nErr }, 'Failed to process task assignment alert/notification');
      }
    }
    return task;
  }

  public async getAllTasks(auth: IAuthKeyPayload, options?: getAllOptionsType) {
    return this.getRepo().getAllExcludingArchivedWithCount(auth.tenant_id, options as QueryParams<'tasks'>);
  }

  public async getArchivedTasks(auth: IAuthKeyPayload, options?: getAllOptionsType) {
    return this.getRepo().getAllArchivedWithCount(auth.tenant_id, options as QueryParams<'tasks'>);
  }

  /** Working-hours SLA config for this tenant, with the same fallbacks used tenant-wide. */
  private async loadSlaConfig(tenant_id: string): Promise<{
    taskSlaHours: number;
    workingDays: number[];
    workingHoursStart: string;
    workingHoursEnd: string;
  }> {
    const settingsRows = await new SettingsRepo().getAllForTenant(tenant_id);
    const settingsMap = settingsRows.reduce<Record<string, unknown>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const workingDaysStr = String(settingsMap['sla.working_days'] ?? '1,2,3,4,5');
    return {
      taskSlaHours: Number(settingsMap['sla.tasks_hours'] ?? 24),
      workingDays: workingDaysStr
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n)),
      workingHoursStart: String(settingsMap['sla.working_hours_start'] ?? '09:00'),
      workingHoursEnd: String(settingsMap['sla.working_hours_end'] ?? '17:00'),
    };
  }

  /** Live count of open tasks past the working-hours SLA target — the sidebar badge (spec §4). */
  public async countSlaBreaches(auth: IAuthKeyPayload): Promise<number> {
    const { taskSlaHours, workingDays, workingHoursStart, workingHoursEnd } = await this.loadSlaConfig(auth.tenant_id);
    const taskSlaMs = taskSlaHours * 60 * 60 * 1000;
    const now = new Date();

    const openTasks = await this.getRepo().getOpenForSla(auth.tenant_id);
    return openTasks.reduce((count, task) => {
      const workingMs = calculateWorkingTimeMs(
        new Date(task.created_at),
        now,
        workingDays,
        workingHoursStart,
        workingHoursEnd,
      );
      return workingMs > taskSlaMs ? count + 1 : count;
    }, 0);
  }

  /**
   * The count sentence's four numbers in one call (spec §4): "N open tasks · N breaching
   * SLA · N assigned to you" (list) plus "N waiting for an owner" (board adds this one).
   */
  public async getSummaryCounts(auth: IAuthKeyPayload): Promise<{
    assignedToMe: number;
    openTotal: number;
    slaBreaches: number;
    unassigned: number;
  }> {
    const repo = this.getRepo();
    const [openTotal, unassigned, assignedToMe, slaBreaches] = await Promise.all([
      repo.countOpen(auth.tenant_id),
      repo.countOpenUnassigned(auth.tenant_id),
      repo.countOpenAssignedTo(auth.tenant_id, auth.user_id),
      this.countSlaBreaches(auth),
    ]);
    return { openTotal, unassigned, assignedToMe, slaBreaches };
  }

  public async updateTask(id: string, row: UpdateTaskType, auth: IAuthKeyPayload) {
    const existingTask = (await this.getOneById({ tenant_id: auth.tenant_id, id })) as
      | Selectable<Models['tasks']>
      | undefined;
    const rowWithUpdatedBy = { ...row, updatedby_id: auth.user_id } as OperationDataType<'tasks', 'update'>;
    const updated = await this.update({ tenant_id: auth.tenant_id, id, row: rowWithUpdatedBy });

    if (updated && row.assigned_to && row.assigned_to !== existingTask?.assigned_to) {
      try {
        const assignedTo = row.assigned_to;
        const assignee = await this.getRepo()
          .db.selectFrom('authusers')
          .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
          .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
          .where('authusers.id', '=', assignedTo)
          .executeTakeFirst();
        if (assignee) {
          if (notificationEnabled(assignee.profile_preferences, 'task_assigned_in_app')) {
            const notificationsRepo = new NotificationsRepo();
            await notificationsRepo.pushNotification({
              tenant_id: auth.tenant_id,
              user_id: assignedTo,
              title: 'Task Assigned',
              message: `You have been assigned the task: "${updated.name}"`,
              type: 'task',
              link: `/tasks/${id}`,
            });
          }
          if (assignee.email && notificationEnabled(assignee.profile_preferences, 'task_assigned')) {
            await this.mailService.sendMail({
              to: assignee.email,
              subject: `New task assigned: ${updated.name}`,
              notificationSettingsLink: true,
              text: `Hi ${assignee.first_name},\n\n${auth.name} assigned you the task "${updated.name}".\n\nDetails:\n${updated.details || 'None'}\n\nView the task: ${env.appUrl}/tasks/${id}`,
              html: `<h2>New task assigned</h2>
<p>Hi ${assignee.first_name},</p>
<p>${auth.name} assigned you the task <strong>"${updated.name}"</strong>.</p>
<div class="panel"><p><strong>Details:</strong><br>${updated.details || 'None'}</p></div>
<div class="btn-container">
  <a href="${env.appUrl}/tasks/${id}" class="btn">View task</a>
</div>`,
            });
          }
        }
      } catch (nErr) {
        logger.error({ err: nErr }, 'Failed to process task assignment alert/notification');
      }
    }
    return updated;
  }

  /**
   * Board drag-and-drop persistence (spec §4). Re-seats one or two board columns
   * in a single transaction: every listed id gets `position = index`, and its
   * `status` is set to the column it now lives in. Ids are verified to belong to
   * the tenant first (a foreign or unknown id rejects the whole drop).
   *
   * `completed_at` note: the single-task update path (`updateTask` → BaseController)
   * has NO automatic completed_at behavior — it only writes completed_at when the
   * client explicitly sends it, and there is no DB trigger on tasks.status. So a
   * status change here (including to/from `done`) intentionally writes no
   * completed_at, matching the chevron/setStatus path exactly. The one real status
   * side effect the single-write path has is the activity-log entry, which we
   * replicate below for each card whose status actually changed.
   */
  public async reorderTasks(auth: IAuthKeyPayload, input: ReorderTasksType) {
    const allIds = input.columns.flatMap((c) => c.ids);
    const repo = this.getRepo();
    return repo.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('tasks')
        .select(['id', 'status', 'name'])
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', 'in', allIds)
        .execute();
      const byId = new Map(existing.map((r) => [String(r.id), r]));
      for (const id of allIds) {
        if (!byId.has(String(id))) throw new NotFoundError('One or more tasks were not found');
      }

      for (const col of input.columns) {
        let index = 0;
        for (const id of col.ids) {
          await trx
            .updateTable('tasks')
            .set({
              position: index,
              status: col.status,
              updatedby_id: auth.user_id,
            } as OperationDataType<'tasks', 'update'>)
            .where('tenant_id', '=', auth.tenant_id)
            .where('id', '=', id)
            .execute();

          const before = byId.get(String(id));
          if (before && before.status !== col.status) {
            await this.userActivity.log(
              {
                tenant_id: auth.tenant_id,
                user_id: auth.user_id,
                activity: 'update',
                entity: 'tasks',
                entity_id: String(id),
                quantity: 1,
                metadata: {
                  task_name: before.name,
                  changes: { status: { from: before.status ?? null, to: col.status } },
                },
              },
              trx,
            );
          }
          index += 1;
        }
      }

      return { ok: true as const, updated: allIds.length };
    });
  }

  public override async exportCsv(
    input: ExportCsvInputType & { tenant_id: string },
    auth?: IAuthKeyPayload,
  ): Promise<ExportCsvResponseType> {
    if (auth) {
      const includeArchived = Boolean(input?.options && input.options?.includeArchived);
      const result = includeArchived
        ? await this.getArchivedTasks(auth, input?.options)
        : await this.getAllTasks(auth, input?.options);
      const rows = (result?.rows ?? []).map((row) => ({ ...(row as Record<string, unknown>) }));
      const response = this.buildCsvResponse(rows, input) as {
        csv: string;
        fileName: string;
        columns: string[];
        rowCount: number;
      };
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'export',
        entity: includeArchived ? 'tasks_archived' : 'tasks',
        quantity: response.rowCount,
        metadata: {
          requested_columns: Array.isArray(input.columns) ? input.columns.slice(0, 12) : [],
          returned_columns: response.columns.slice(0, 12),
          file_name: response.fileName,
          include_archived: includeArchived,
        },
      });
      return response;
    }
    return super.exportCsv(input, auth);
  }

  private readonly importsRepo = new ImportsRepo();
  private readonly storageService = new StorageService();

  public async importRows(
    input: {
      rows: Array<{
        name: string;
        details?: string | null;
        status?: string | null;
        priority?: string | null;
        due_at?: string | null;
        assigned_to?: string | null;
      }>;
      skipped?: number;
      file_name?: string | null;
      source_csv?: string | null;
    },
    auth: IAuthKeyPayload,
  ) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const autoTag = `Imported-Tasks-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    const skippedFromClient = Math.max(0, Math.floor(input.skipped ?? 0));
    const requestedFileName = (input.file_name ?? '').trim();
    const baseFileName = requestedFileName || `${autoTag}.csv`;
    const totalRows = input.rows.length + skippedFromClient;

    const importRow = {
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      file_name: baseFileName,
      source: 'tasks',
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
    };

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
      const payloadBuffer = Buffer.from(JSON.stringify(input.rows), 'utf8');
      await this.storageService.upload(storageKey, payloadBuffer, 'application/json');
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
      },
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
          source: 'tasks',
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
    rows: Record<string, string>[],
  ) {
    const results = { inserted: 0, errors: 0, skipped: 0 };
    const errorMessages: string[] = [];

    // Parse status and priority to validate choices
    const normalize = (v?: string) =>
      (v || '')
        .toLowerCase()
        .trim()
        .replace(/[_\s-]+/g, '');
    const validStatuses: readonly string[] = TASK_STATUSES;
    const validPriorities = ['low', 'medium', 'high', 'urgent'];

    // Map names to users for assigned_to
    const users = await this.getRepo()
      .db.selectFrom('authusers')
      .select(['id', 'first_name', 'last_name', 'email'])
      .where('tenant_id', '=', tenant_id)
      .execute();

    const userMap = new Map<string, string>();
    for (const u of users) {
      const idStr = String(u.id);
      userMap.set(idStr, idStr);
      if (u.email) userMap.set(u.email.toLowerCase().trim(), idStr);
      if (u.first_name) {
        userMap.set(u.first_name.toLowerCase().trim(), idStr);
        if (u.last_name) {
          userMap.set(`${u.first_name.toLowerCase().trim()} ${u.last_name.toLowerCase().trim()}`, idStr);
        }
      }
    }

    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);

      // 1. Normalize and filter valid rows upfront
      const taskRows: any[] = [];
      for (const raw of chunk) {
        if (!raw['name'] || !raw['name'].trim()) {
          results.skipped += 1;
          continue;
        }

        let status: string = 'todo';
        if (raw['status']) {
          const normStatus = normalize(raw['status']);
          const matchedStatus = validStatuses.find((s) => normalize(s) === normStatus);
          if (matchedStatus) status = matchedStatus;
        }

        let priority: string | null = null;
        if (raw['priority']) {
          const normPriority = normalize(raw['priority']);
          const matchedPriority = validPriorities.find((p) => normalize(p) === normPriority);
          if (matchedPriority) priority = matchedPriority;
        }

        let assigned_to: string | null = null;
        if (raw['assigned_to']) {
          assigned_to = userMap.get(raw['assigned_to'].toLowerCase().trim()) ?? null;
        }

        let due_at: Date | null = null;
        if (raw['due_at']) {
          const parsedDate = new Date(raw['due_at']);
          if (!isNaN(parsedDate.getTime())) due_at = parsedDate;
        }

        taskRows.push({
          tenant_id,
          createdby_id: user_id,
          updatedby_id: user_id,
          name: raw['name'].trim(),
          details: raw['details'] ?? null,
          status,
          priority,
          assigned_to,
          due_at,
          file_id: import_id,
        });
      }

      if (taskRows.length > 0) {
        try {
          await this.getRepo()
            .transaction()
            .execute(async (trx) => {
              // Chunk inserts to a safe limit (e.g., 2000 rows * 10 cols = 20,000 params)
              const CHUNK_SIZE = 2000;
              for (let i = 0; i < taskRows.length; i += CHUNK_SIZE) {
                const chunk = taskRows.slice(i, i + CHUNK_SIZE);
                await trx
                  .insertInto('tasks')
                  .values(chunk)
                  .returningAll() // Adheres to repository rules
                  .execute();
              }
            });
          results.inserted += taskRows.length;
        } catch (err: unknown) {
          results.errors += taskRows.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
        }
      }

      await this.importsRepo.update({
        tenant_id: tenant_id,
        id: import_id,
        row: {
          inserted_count: results.inserted,
          error_count: results.errors,
          skipped_count: skipped + results.skipped,
          updatedby_id: user_id,
          updated_at: new Date(),
        },
      });
    }

    return {
      inserted: results.inserted,
      errors: results.errors,
      skipped: skipped + results.skipped,
      errorMessages,
    };
  }
}
