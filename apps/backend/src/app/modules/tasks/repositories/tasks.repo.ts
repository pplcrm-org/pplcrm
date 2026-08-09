import type { RawBuilder, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';
import { TASK_OPEN_STATUSES } from '../../../../../../../libs/common/src';
import type { GridFilterModel } from '../../../../../../../libs/common/src';

type TaskStatus = NonNullable<Models['tasks']['status']>;
type TaskPriority = NonNullable<Models['tasks']['priority']>;

/** A task open enough to count toward SLA-breach / count-sentence math (spec §4). */
export interface OpenTaskForSla {
  assigned_to: string | null;
  created_at: Date;
  id: string;
}

export class TasksRepo extends BaseRepository<'tasks'> {
  constructor() {
    super('tasks');
  }

  public async countArchived(tenant_id: string) {
    const res = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('tasks.tenant_id', '=', tenant_id)
      .where('tasks.status', '=', 'archived')
      .execute();
    const total = res?.[0]?.['total'] as unknown as number;
    return Number(total || 0);
  }

  public async countExcludingArchived(tenant_id: string) {
    const res = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('tenant_id', '=', tenant_id)
      .where('status', '!=', 'archived')
      .execute();
    const total = res?.[0]?.['total'] as unknown as number;
    return Number(total || 0);
  }

  /**
   * Open tasks (todo/in_progress/waiting) with just enough columns to compute SLA breach.
   *
   * `createdBefore` is the calendar-age pre-filter: a task can only be past its working-hours SLA
   * if it is at least that old in calendar time (working-hours age never exceeds calendar age), so
   * the caller passes `now - SLA` and the working-hours arithmetic runs only on the survivors
   * instead of every open task.
   */
  public async getOpenForSla(tenant_id: string, createdBefore: Date): Promise<OpenTaskForSla[]> {
    const rows = await this.getSelect()
      .select(['id', 'created_at', 'assigned_to'])
      .where('tenant_id', '=', tenant_id)
      .where('status', 'in', [...TASK_OPEN_STATUSES])
      .where('created_at', '<=', createdBefore)
      .execute();
    return rows.map((r) => ({
      id: String(r.id),
      created_at: r.created_at,
      assigned_to: r.assigned_to == null ? null : String(r.assigned_to),
    }));
  }

  public async countOpen(tenant_id: string): Promise<number> {
    const res = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('tenant_id', '=', tenant_id)
      .where('status', 'in', [...TASK_OPEN_STATUSES])
      .execute();
    return Number(res?.[0]?.['total'] ?? 0);
  }

  public async countOpenUnassigned(tenant_id: string): Promise<number> {
    const res = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('tenant_id', '=', tenant_id)
      .where('status', 'in', [...TASK_OPEN_STATUSES])
      .where('assigned_to', 'is', null)
      .execute();
    return Number(res?.[0]?.['total'] ?? 0);
  }

  public async countOpenAssignedTo(tenant_id: string, user_id: string): Promise<number> {
    const res = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('tenant_id', '=', tenant_id)
      .where('status', 'in', [...TASK_OPEN_STATUSES])
      .where('assigned_to', '=', user_id)
      .execute();
    return Number(res?.[0]?.['total'] ?? 0);
  }

  private buildTasksQueryBuilder(tenant_id: string, isArchived: boolean, options?: QueryParams<'tasks'>) {
    const text = this.normalizeSearch(options?.searchStr);
    const filterModel = (options?.filterModel ?? {}) as GridFilterModel;
    // Extract priority/assigned_to sort to apply custom ordering
    const pri = options?.sortModel?.find((s) => s.colId === 'priority');
    const ass = options?.sortModel?.find((s) => s.colId === 'assigned_to');

    const rest = {
      ...(options || {}),
      // team_name is a joined column (teams.name), not a real tasks column; select() below adds it.
      columns: options?.columns?.filter((c) => String(c) !== 'team_name'),
      sortModel: options?.sortModel?.filter((s) => s.colId !== 'priority' && s.colId !== 'assigned_to'),
    } as QueryParams<'tasks'>;

    const hasAssignedFilter = !!filterModel?.['assigned_to']?.value || typeof filterModel?.['assigned_to'] === 'string';
    const hasCreatedFilter =
      !!filterModel?.['createdby_id']?.value || typeof filterModel?.['createdby_id'] === 'string';
    const joinAssign = !!ass || !!text || hasAssignedFilter;
    const joinCreator = !!text || hasCreatedFilter;

    const applyGridFilters = <QB extends ReturnType<typeof this.getSelectWithColumns>>(qb: QB) =>
      qb
        .$if(!!filterModel?.['name']?.value, (q) => q.where('tasks.name', 'ilike', `%${filterModel['name']?.value}%`))
        .$if(!!filterModel?.['status']?.value, (q) => {
          const raw = filterModel['status']?.value;
          const vals = Array.isArray(raw) ? raw : [raw];
          const norm = vals.map((v) => String(v).trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
          return norm.length ? q.where('tasks.status', 'in', norm as TaskStatus[]) : q;
        })
        .$if(!!filterModel?.['priority']?.value, (q) => {
          const raw = filterModel['priority']?.value;
          const vals = Array.isArray(raw) ? raw : [raw];
          const norm = vals.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
          return norm.length ? q.where('tasks.priority', 'in', norm as TaskPriority[]) : q;
        })
        .$if(!!filterModel?.['due_at']?.value, (q) =>
          q.where(sql<boolean>`CAST(tasks.due_at AS TEXT) ILIKE ${'%' + String(filterModel['due_at']?.value) + '%'}`),
        )
        .$if(!!hasAssignedFilter, (q) => {
          const raw = filterModel['assigned_to']?.value ?? filterModel['assigned_to'];
          const arr = Array.isArray(raw) ? raw : [raw];
          const parts = arr
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .map((val): RawBuilder<boolean> | null => {
              const low = val.toLowerCase();
              if (low === 'not assigned' || low === 'unassigned') return sql<boolean>`tasks.assigned_to IS NULL`;
              const isNumeric = /^\d+$/.test(val);
              if (isNumeric)
                return sql<boolean>`(
                  COALESCE(au_assign.first_name || ' ' || au_assign.last_name, '') ILIKE ${'%' + val + '%'} OR
                  tasks.assigned_to = ${Number(val)}
                )`;
              return sql<boolean>`COALESCE(au_assign.first_name || ' ' || au_assign.last_name, '') ILIKE ${'%' + val + '%'}`;
            })
            .filter((p): p is RawBuilder<boolean> => p !== null);
          if (!parts.length) return q;
          const orExpr = parts.reduce((acc, cur) => sql<boolean>`${acc} OR ${cur}`);
          return q.where(sql<boolean>`(${orExpr})`);
        })
        .$if(!!hasCreatedFilter, (q) => {
          const raw = filterModel['createdby_id']?.value ?? filterModel['createdby_id'];
          const arr = Array.isArray(raw) ? raw : [raw];
          const parts = arr
            .map((v) => String(v || '').trim())
            .filter(Boolean)
            .map((val): RawBuilder<boolean> | null => {
              const isNumeric = /^\d+$/.test(val);
              if (isNumeric)
                return sql<boolean>`(
                  COALESCE(au_created.first_name || ' ' || au_created.last_name, '') ILIKE ${'%' + val + '%'} OR
                  tasks.createdby_id = ${Number(val)}
                )`;
              return sql<boolean>`COALESCE(au_created.first_name || ' ' || au_created.last_name, '') ILIKE ${'%' + val + '%'}`;
            })
            .filter((p): p is RawBuilder<boolean> => p !== null);
          if (!parts.length) return q;
          const orExpr = parts.reduce((acc, cur) => sql<boolean>`${acc} OR ${cur}`);
          return q.where(sql<boolean>`(${orExpr})`);
        })
        .$if(!!filterModel?.['team_id']?.value, (q) =>
          q.where('tasks.team_id', '=', filterModel['team_id']?.value as string),
        );

    return applyGridFilters(this.getSelectWithColumns(rest))
      .$if(joinAssign, (qb) => qb.leftJoin('authusers as au_assign', 'au_assign.id', 'tasks.assigned_to'))
      .$if(joinCreator, (qb) => qb.leftJoin('authusers as au_created', 'au_created.id', 'tasks.createdby_id'))
      .leftJoin('teams', 'teams.id', 'tasks.team_id')
      .select('teams.name as team_name')
      .where('tasks.tenant_id', '=', tenant_id)
      .where('tasks.status', isArchived ? '=' : '!=', 'archived')
      .$if(!!text, (qb) =>
        qb.where(
          sql<boolean>`(
            LOWER(tasks.name) LIKE ${text} OR
            LOWER(COALESCE(tasks.details, '')) LIKE ${text} OR
            LOWER(COALESCE(tasks.status, '')) LIKE ${text} OR
            LOWER(COALESCE(tasks.priority, '')) LIKE ${text} OR
            LOWER(COALESCE(teams.name, '')) LIKE ${text} OR
            LOWER(COALESCE(au_assign.first_name, '')) LIKE ${text} OR
            LOWER(COALESCE(au_assign.last_name, '')) LIKE ${text} OR
            LOWER(COALESCE(au_assign.first_name || ' ' || au_assign.last_name, '')) LIKE ${text} OR
            LOWER(COALESCE(au_created.first_name, '')) LIKE ${text} OR
            LOWER(COALESCE(au_created.last_name, '')) LIKE ${text} OR
            LOWER(COALESCE(au_created.first_name || ' ' || au_created.last_name, '')) LIKE ${text}
          )`,
        ),
      )
      .$if(!!pri, (qb) =>
        qb.orderBy(
          sql`CASE tasks.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END`,
          pri?.sort,
        ),
      )
      .$if(!!ass, (qb) => qb.orderBy(sql`COALESCE(au_assign.first_name || ' ' || au_assign.last_name, '')`, ass?.sort));
  }

  public async getAllArchived(tenant_id: string, options?: QueryParams<'tasks'>) {
    return this.buildTasksQueryBuilder(tenant_id, true, options).execute();
  }

  public async getAllArchivedWithCount(tenant_id: string, options?: QueryParams<'tasks'>) {
    const rows = (await this.buildTasksQueryBuilder(tenant_id, true, options)
      .select(() => [sql<number>`count(*) over()`.as('total')])
      .execute()) as Array<Record<string, unknown> & { total: number }>;
    const count = Number(rows[0]?.total ?? 0);
    return { rows: rows.map(({ total: _total, ...rest }) => rest), count };
  }

  public async getAllExcludingArchived(tenant_id: string, options?: QueryParams<'tasks'>) {
    return this.buildTasksQueryBuilder(tenant_id, false, options).execute();
  }

  public async getAllExcludingArchivedWithCount(tenant_id: string, options?: QueryParams<'tasks'>) {
    const rows = (await this.buildTasksQueryBuilder(tenant_id, false, options)
      .select(() => [sql<number>`count(*) over()`.as('total')])
      .execute()) as Array<Record<string, unknown> & { total: number }>;
    const count = Number(rows[0]?.total ?? 0);
    return { rows: rows.map(({ total: _total, ...rest }) => rest), count };
  }

  public async getIdsByFileId(
    input: { tenant_id: string; file_id: string },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    if (!input.file_id) return [];
    const rows = await this.getSelect(trx)
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('file_id', '=', input.file_id)
      .execute();
    return rows.map((row) => (row.id != null ? String(row.id) : '')).filter((id) => id.length > 0);
  }

  public async clearFileIdForImport(
    input: { tenant_id: string; import_id: string; user_id: string },
    trx?: Transaction<Models>,
  ) {
    await this.getUpdate(trx)
      .set({
        file_id: null,
        updated_at: new Date(),
        updatedby_id: input.user_id,
      } as OperationDataType<'tasks', 'update'>)
      .where('tenant_id', '=', input.tenant_id)
      .where('file_id', '=', input.import_id)
      .executeTakeFirst();
  }
}
