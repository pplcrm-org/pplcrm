import type { SelectQueryBuilder, Transaction } from 'kysely';

import { BaseRepository } from './base.repo';
import { resolvePageWindow } from './paging';
import type { Models, OperationDataType } from '../../../../../libs/common/src/lib/kysely.models';

/**
 * Rows an activity query returns when the caller sends no paging fields. Both in-app consumers
 * (the Activity page feed and the per-record activity list) always page explicitly; this is the
 * ceiling for anything that does not.
 */
const ACTIVITY_PAGE_SIZE = 100;

export class UserActivityRepo extends BaseRepository<'user_activity'> {
  constructor() {
    super('user_activity');
  }

  public async getStats(input: { tenant_id: string; user_id: string }) {
    const results = await (this.getSelect() as SelectQueryBuilder<Models, 'user_activity', any>)
      .select('activity')
      .select((eb) => [
        eb.fn.count('id').as('count'),
        eb.fn.sum('quantity').as('total_quantity'),
        eb.fn.max('created_at').as('last_activity_at'),
      ])
      .where('tenant_id', '=', input.tenant_id)
      .where('user_id', '=', input.user_id)
      .groupBy('activity')
      .execute();

    const mapped: Record<string, { count: number; total_quantity: number; last_activity_at: Date | null }> = {};
    for (const row of results) {
      const activity = String(row['activity'] ?? '');
      if (!activity) continue;
      const count = Number(row['count'] ?? 0);
      const totalQtyRaw = row['total_quantity'];
      const total_quantity = totalQtyRaw == null ? 0 : Number(totalQtyRaw);
      const lastAtValue = row['last_activity_at'] ?? null;
      const last_activity_at = lastAtValue ? new Date(lastAtValue) : null;
      mapped[activity] = { count, total_quantity, last_activity_at };
    }
    return mapped;
  }

  public async log(
    input: {
      tenant_id: string;
      user_id: string;
      activity: UserActivityType;
      entity: string;
      entity_id?: string | null;
      quantity?: number | null;
      metadata?: Record<string, unknown> | null;
      performed_by?: string | null;
    },
    trx?: Transaction<Models>,
  ) {
    const actor = input.performed_by ?? input.user_id;
    const row = {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      activity: input.activity,
      entity: input.entity,
      entity_id: input.entity_id ?? null,
      quantity: input.quantity ?? 0,
      metadata: input.metadata ?? null,
      createdby_id: actor,
      updatedby_id: actor,
    } as OperationDataType<'user_activity', 'insert'>;
    await this.add({ row }, trx);
  }

  public async getForEntity(
    tenant_id: string,
    entity: string,
    entity_id: string,
    options?: { startRow?: number; endRow?: number },
  ) {
    let entities = [entity];
    const ent = entity.toLowerCase();
    if (ent === 'person' || ent === 'persons' || ent === 'people') {
      entities = ['person', 'persons'];
    } else if (ent === 'household' || ent === 'households') {
      entities = ['household', 'households'];
    } else if (ent === 'company' || ent === 'companies') {
      entities = ['company', 'companies'];
    } else if (ent === 'task' || ent === 'tasks') {
      entities = ['task', 'tasks', 'tasks_archived'];
    } else if (ent === 'email' || ent === 'emails') {
      entities = ['email', 'emails'];
    } else if (ent === 'volunteer_event' || ent === 'volunteer_events') {
      entities = ['volunteer_event', 'volunteer_events'];
    } else if (ent === 'volunteer_shift' || ent === 'volunteer_shifts') {
      entities = ['volunteer_shift', 'volunteer_shifts'];
    }

    let query = (this.getSelect() as SelectQueryBuilder<Models, 'user_activity', any>)
      .innerJoin('authusers', 'authusers.id', 'user_activity.user_id')
      .select([
        'user_activity.id',
        'user_activity.activity',
        'user_activity.entity',
        'user_activity.entity_id',
        'user_activity.quantity',
        'user_activity.metadata',
        'user_activity.created_at',
        'authusers.first_name',
        'authusers.last_name',
      ])
      .where('user_activity.tenant_id', '=', tenant_id)
      .where('user_activity.entity', 'in', entities)
      .where('user_activity.entity_id', '=', entity_id)
      .orderBy('user_activity.created_at', 'desc');

    const countQuery = this.db
      .selectFrom('user_activity')
      .select(({ fn }) => [fn.count('user_activity.id').as('total')])
      .where('user_activity.tenant_id', '=', tenant_id)
      .where('user_activity.entity', 'in', entities)
      .where('user_activity.entity_id', '=', entity_id);

    // Always paged: this was conditional on both fields being present, so a caller that sent
    // neither read the record's entire activity history.
    const page = resolvePageWindow(options, ACTIVITY_PAGE_SIZE);
    query = query.offset(page.offset).limit(page.limit);

    const [rows, countResult] = await Promise.all([query.execute(), countQuery.executeTakeFirst()]);

    const count = Number(countResult?.total ?? 0);
    return { rows, count };
  }

  public async getAllWithUser(
    tenant_id: string,
    options: QueryParams<'user_activity'> & { userId?: string; entity?: string; activity?: string; searchStr?: string },
  ) {
    let query = this.getSelect()
      .innerJoin('authusers', 'authusers.id', 'user_activity.user_id')
      .select([
        'user_activity.id',
        'user_activity.activity',
        'user_activity.entity',
        'user_activity.entity_id',
        'user_activity.quantity',
        'user_activity.metadata',
        'user_activity.created_at',
        'authusers.first_name',
        'authusers.last_name',
        'authusers.email',
      ])
      .where('user_activity.tenant_id', '=', tenant_id);

    if (options.userId) {
      query = query.where('user_activity.user_id', '=', options.userId);
    }
    if (options.entity) {
      query = query.where('user_activity.entity', 'in', this.getEntityFilterValues(options.entity));
    }
    if (options.activity) {
      query = query.where('user_activity.activity', '=', options.activity);
    }
    if (options.searchStr) {
      const search = `%${options.searchStr.trim().toLowerCase()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('authusers.first_name', 'ilike', search),
          eb('authusers.last_name', 'ilike', search),
          eb('user_activity.entity', 'ilike', search),
          eb('user_activity.activity', 'ilike', search),
        ]),
      );
    }

    query = query.orderBy('user_activity.created_at', 'desc');
    // Always paged, for the same reason as getForEntity above.
    const page = resolvePageWindow(options, ACTIVITY_PAGE_SIZE);
    query = query.offset(page.offset).limit(page.limit);

    let countQuery = this.getSelect()
      .select(({ fn }) => [fn.count('user_activity.id').as('total')])
      .where('user_activity.tenant_id', '=', tenant_id);

    if (options.userId) {
      countQuery = countQuery.where('user_activity.user_id', '=', options.userId);
    }
    if (options.entity) {
      countQuery = countQuery.where('user_activity.entity', 'in', this.getEntityFilterValues(options.entity));
    }
    if (options.activity) {
      countQuery = countQuery.where('user_activity.activity', '=', options.activity);
    }
    if (options.searchStr) {
      const search = `%${options.searchStr.trim().toLowerCase()}%`;
      countQuery = countQuery
        .innerJoin('authusers', 'authusers.id', 'user_activity.user_id')
        .where((eb) =>
          eb.or([
            eb('authusers.first_name', 'ilike', search),
            eb('authusers.last_name', 'ilike', search),
            eb('user_activity.entity', 'ilike', search),
            eb('user_activity.activity', 'ilike', search),
          ]),
        );
    }

    const countResult = await countQuery.executeTakeFirst();
    const count = Number(countResult?.total ?? 0);

    const rows = await query.execute();
    return { rows, count };
  }

  private getEntityFilterValues(entityFilter: string): string[] {
    const ent = entityFilter.toLowerCase();
    if (ent === 'persons' || ent === 'person' || ent === 'people') {
      return ['person', 'persons'];
    }
    if (ent === 'households' || ent === 'household') {
      return ['household', 'households'];
    }
    if (ent === 'companies' || ent === 'company') {
      return ['company', 'companies'];
    }
    if (ent === 'tasks' || ent === 'task') {
      return ['task', 'tasks', 'tasks_archived'];
    }
    if (ent === 'emails' || ent === 'email') {
      return ['email', 'emails'];
    }
    if (ent === 'volunteer_events' || ent === 'volunteer_event') {
      return ['volunteer_event', 'volunteer_events'];
    }
    if (ent === 'volunteer_shifts' || ent === 'volunteer_shift') {
      return ['volunteer_shift', 'volunteer_shifts'];
    }
    if (ent === 'web_forms' || ent === 'web_form' || ent === 'forms' || ent === 'form') {
      return ['web_form', 'web_forms', 'form', 'forms'];
    }
    if (ent === 'tags' || ent === 'tag') {
      return ['tag', 'tags'];
    }
    return [ent];
  }
}

export type UserActivityType =
  | 'import'
  | 'export'
  | 'create'
  | 'update'
  | 'delete'
  | 'assign'
  | 'unassign'
  | 'merge'
  | 'close'
  | 'reopen'
  | 'send'
  // Human-authored interactions logged from a record page ("Log an interaction").
  // Keep in sync with INTERACTION_TYPES in libs/common activity.schema.ts.
  | 'call'
  | 'door_knock'
  | 'note'
  | 'meeting';
import type { QueryParams } from './base.repo';
