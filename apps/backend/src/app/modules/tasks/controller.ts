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
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import type { QueryParams } from '../../lib/base.repo';
import { NotificationsRepo } from '../notifications/repositories/notifications.repo';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { notificationEnabled } from '../../lib/profile-preferences';
import { assertAssigneeInTenant, findAssigneeForNotification } from '../../lib/tenant-members';
import { ImportsRepo } from '../imports/repositories/imports.repo';
import { createUploadImport } from '../imports/upload-intake';
import { chunkRows, IMPORT_CHUNK_SIZE } from '../../lib/import-rows';
import { StorageService } from '../../lib/storage.service';
import { logger } from '../../logger';
import { TASK_STATUSES, calculateWorkingTimeMs } from '../../../../../../libs/common/src';
import type { ReorderTasksType } from '../../../../../../libs/common/src';
import { NotFoundError } from '../../errors/app-errors';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import { type SlaPolicy, settingsMapFrom, slaPolicyFrom } from '../../lib/sla-policy';

/**
 * The formats an imported due-date column may be written in, in plain words — quoted by the
 * wizard's field hint and by the skip reason a value that matches none of them produces.
 */
export const IMPORT_DUE_DATE_FORMATS = 'YYYY-MM-DD or DD/MM/YYYY';

/** Noon, so a date-only value is the same calendar day in every timezone the app displays it in. */
const DATE_ONLY_HOUR = 12;
const MONTHS_IN_YEAR = 12;

/**
 * Read one imported due-date cell.
 *
 * Handing the raw text to `new Date()` was wrong in three separate ways, all silent: a
 * day-first cell like `05/06/2026` (June 5th on a Canadian file, the product's main market) was
 * read as May 6th; an impossible-in-US cell like `13/05/2026` became no due date at all with no
 * reason recorded; and a date-only ISO cell was read as UTC midnight, which displays as the
 * previous day west of Greenwich. So the formats are now explicit:
 *
 *  - `YYYY-MM-DD` (and `YYYY/MM/DD`) — year first, unambiguous.
 *  - `D/M/YYYY`, `D-M-YYYY`, `D.M.YYYY` — day first. When the second number is above 12 the cell
 *    can only be month-first (`05/13/2026`), so it is read that way; when both numbers are 12 or
 *    below the cell is genuinely ambiguous and day-first wins, which is what the wizard's field
 *    hint tells the person mapping the column.
 *  - Anything else (`13 May 2026`, a full ISO timestamp with a `T`) falls through to the
 *    JavaScript parser, which handles month names and offsets correctly.
 *
 * Date-only values are built at local noon so no timezone can shift the calendar day.
 * Returns null when the cell cannot be read as a date at all — the caller records that.
 */
export function parseImportedDueDate(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;

  const build = (year: number, month: number, day: number): Date | null => {
    if (month < 1 || month > MONTHS_IN_YEAR || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day, DATE_ONLY_HOUR, 0, 0, 0);
    // Rejects a real-calendar impossibility such as 31/02: the Date constructor rolls it over.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  };

  const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (yearFirst) {
    return build(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  }

  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (dayFirst) {
    const first = Number(dayFirst[1]);
    const second = Number(dayFirst[2]);
    const year = Number(dayFirst[3]);
    // Only a month-first file can put something above 12 in the middle position.
    return second > MONTHS_IN_YEAR ? build(year, first, second) : build(year, second, first);
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export class TasksController extends BaseController<'tasks', TasksRepo> {
  private mailService = new TransactionalEmailService({ defaultAudience: 'staff' });

  constructor() {
    super(new TasksRepo());
  }

  public async addTask(payload: AddTaskType, auth: IAuthKeyPayload) {
    // The FK on tasks.assigned_to is not composite with tenant_id, so nothing else stops a
    // cross-tenant assignee being stored (see lib/tenant-members).
    await assertAssigneeInTenant(this.getRepo().db, auth.tenant_id, payload.assigned_to);

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
        const assignee = await findAssigneeForNotification(this.getRepo().db, auth.tenant_id, assignedTo);
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
  private async loadSlaConfig(tenant_id: string): Promise<SlaPolicy> {
    const settingsRows = await new SettingsRepo().getAllForTenant(tenant_id);
    return slaPolicyFrom(settingsMapFrom(settingsRows));
  }

  /** Live count of open tasks past the working-hours SLA target — the sidebar badge (spec §4). */
  public async countSlaBreaches(auth: IAuthKeyPayload): Promise<number> {
    const { taskSlaHours, workingDays, workingHoursStart, workingHoursEnd, timeZone } = await this.loadSlaConfig(
      auth.tenant_id,
    );
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
        timeZone,
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
    await assertAssigneeInTenant(this.getRepo().db, auth.tenant_id, row.assigned_to);

    const existingTask = (await this.getOneById({ tenant_id: auth.tenant_id, id })) as
      | Selectable<Models['tasks']>
      | undefined;
    const rowWithUpdatedBy = { ...row, updatedby_id: auth.user_id } as OperationDataType<'tasks', 'update'>;
    const updated = await this.update({ tenant_id: auth.tenant_id, id, row: rowWithUpdatedBy });

    if (updated && row.assigned_to && row.assigned_to !== existingTask?.assigned_to) {
      try {
        const assignedTo = row.assigned_to;
        const assignee = await findAssigneeForNotification(this.getRepo().db, auth.tenant_id, assignedTo);
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

  /**
   * Upload-based intake is the ONLY request shape since 2026-08-05 — the legacy rows-in-body
   * variant was removed once the wizard stopped sending it.
   */
  public async importRows(
    input: {
      /** Upload-based intake: the CSV is already in blob storage (imports.getUploadUrl). */
      upload_handle: string;
      /** Stringified 0-based CSV column index → import field key (TasksImportMappingObj). */
      mapping: Record<string, string>;
      file_name?: string | null;
    },
    auth: IAuthKeyPayload,
  ) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const autoTag = `Imported-Tasks-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    const created = await createUploadImport({
      auth,
      importsRepo: this.importsRepo,
      storageService: this.storageService,
      source: 'tasks',
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

  public async processImportRows(
    import_id: string,
    tenant_id: string,
    user_id: string,
    skipped: number,
    // Any row source works (arrays included); the import job passes a lazy
    // iterator so the full file is never materialized at once.
    rows: Iterable<Record<string, string>> | AsyncIterable<Record<string, string>>,
  ) {
    const results = { inserted: 0, errors: 0, skipped: 0 };
    const errorMessages: string[] = [];
    // Rows kept downloadable with the reason each was lost or partly dropped, same as the people
    // and households importers. Until now this importer wrote none, so a rolled-back batch left
    // an error count with nothing behind it and an import that still read as a clean success.
    const SKIP_REASONS_CAP = 500;
    const ERROR_MESSAGE_MAX = 1000;

    // Crash/continuation resume: each per-chunk counter write below also records, atomically
    // with the chunk's inserts, how many source rows have been durably consumed
    // (`processed_row_offset`). This importer's plain inserts are NOT idempotent, so a re-run
    // after a worker crash must skip exactly the committed rows: a re-entering run finds a
    // non-zero offset, its caller has already stream-skipped that many rows, and the totals
    // continue from what the database holds.
    const importState = await this.importsRepo.db
      .selectFrom('data_imports')
      .select(['processed_row_offset', 'inserted_count', 'error_count', 'skipped_count', 'skip_reasons'])
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
    // Seeded from what is already on file — the CSV job records the counting pass's validation
    // skips there before processing starts, and a resumed run must keep every reason an earlier
    // run persisted (the writes below replace the whole array).
    const storedReasons: unknown = importState?.skip_reasons;
    const skipReasons: Array<{ row: number; reason: string }> = Array.isArray(storedReasons)
      ? storedReasons.filter(
          (value): value is { row: number; reason: string } =>
            typeof value === 'object' &&
            value !== null &&
            'row' in value &&
            'reason' in value &&
            typeof value.row === 'number' &&
            typeof value.reason === 'string',
        )
      : [];
    // Rows consumed from the source so far — starts at the resume offset.
    let rowsSeen = resumeOffset;

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

    for await (const chunk of chunkRows(rows, IMPORT_CHUNK_SIZE)) {
      // 1-based position of this chunk's first row in the file, so a lost row can be named.
      const chunkStartRow = rowsSeen;
      rowsSeen += chunk.length;
      // 1. Normalize and filter valid rows upfront
      const taskRows: any[] = [];
      // Index-aligned with taskRows: the file position each pending insert came from.
      const taskRowNumbers: number[] = [];
      for (const [chunkIdx, raw] of chunk.entries()) {
        const rowNumber = chunkStartRow + chunkIdx + 1;
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
        if (raw['due_at'] && raw['due_at'].trim()) {
          due_at = parseImportedDueDate(raw['due_at']);
          if (due_at === null && skipReasons.length < SKIP_REASONS_CAP) {
            // The task is still imported — it just has no due date. Recording why keeps the
            // dropped value on the History page's skipped-rows download instead of losing it.
            skipReasons.push({
              row: rowNumber,
              reason: `Row ${rowNumber}: the due date "${raw['due_at'].trim()}" could not be read (expected ${IMPORT_DUE_DATE_FORMATS}); the task was imported without a due date`,
            });
          }
        }

        taskRowNumbers.push(rowNumber);
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

      // Whether this chunk's transaction committed — committed chunks persist their counters
      // and resume offset inside the transaction; everything else is recorded after the fact.
      let chunkCommitted = false;
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
              // The chunk's counters and the resume offset, in the SAME transaction as its
              // rows, so a crash can never separate committed rows from the recorded offset.
              await this.importsRepo.update(
                {
                  tenant_id: tenant_id,
                  id: import_id,
                  row: {
                    inserted_count: results.inserted + taskRows.length,
                    error_count: results.errors,
                    skipped_count: skippedBase + results.skipped,
                    // Carried in the same transaction as the rows, so the unreadable due dates
                    // this chunk recorded survive a crash exactly as its inserts do.
                    skip_reasons: JSON.stringify(skipReasons),
                    processed_row_offset: rowsSeen,
                    updatedby_id: user_id,
                    updated_at: new Date(),
                  } as unknown as OperationDataType<'data_imports', 'update'>,
                },
                trx,
              );
            });
          results.inserted += taskRows.length;
          chunkCommitted = true;
        } catch (err: unknown) {
          results.errors += taskRows.length;
          const message = err instanceof Error && err.message ? err.message : String(err);
          errorMessages.push(message);
          logger.error({ err, message, importId: import_id }, 'Task import chunk failed');
          // Name the rows that were lost, so History can list them instead of showing an
          // error count with nothing behind it.
          for (const rowNumber of taskRowNumbers) {
            if (skipReasons.length >= SKIP_REASONS_CAP) break;
            skipReasons.push({
              row: rowNumber,
              reason: `Row ${rowNumber} was not imported: its batch failed and was rolled back (${message})`,
            });
          }
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
            skip_reasons: JSON.stringify(skipReasons),
            processed_row_offset: rowsSeen,
            updatedby_id: user_id,
            updated_at: new Date(),
          } as unknown as OperationDataType<'data_imports', 'update'>,
        });
      }
    }

    // What was lost and why. The job handler discards the returned errorMessages and marks the
    // import completed regardless, so an import that dropped a batch used to read as a clean
    // success on the History page with no reasons to download.
    try {
      await this.importsRepo.update({
        tenant_id: tenant_id,
        id: import_id,
        row: {
          skip_reasons: JSON.stringify(skipReasons),
          error_message:
            errorMessages.length > 0 ? [...new Set(errorMessages)].join('; ').substring(0, ERROR_MESSAGE_MAX) : null,
          updatedby_id: user_id,
          updated_at: new Date(),
        } as unknown as OperationDataType<'data_imports', 'update'>,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to persist final task import stats');
    }

    return {
      inserted: results.inserted,
      errors: results.errors,
      skipped: skippedBase + results.skipped,
      errorMessages,
    };
  }
}
