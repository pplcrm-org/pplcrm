import type { Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';
import { ConflictError } from '../../../errors/app-errors';
import type { JoinedQueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { QueryParams } from '../../../lib/base.repo';

export class VolunteerEventsRepo extends BaseRepository<'volunteer_events'> {
  constructor() {
    super('volunteer_events');
  }

  public async getAllEventsWithCount(
    input: {
      tenant_id: string;
      options?: QueryParams<'volunteer_events'> & { includeArchived?: boolean };
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as Record<string, { value: unknown } | undefined>;
    const page = resolvePageWindow(options);

    const applyFilters = <QB extends AnyQB>(qb: QB) => {
      let q = qb.where('volunteer_events.tenant_id', '=', tenantId).$if(!!searchStr, (qb2) => {
        const text = searchStr;
        return qb2.where(
          sql<boolean>`(
              LOWER(volunteer_events.name) LIKE ${text} OR
              LOWER(volunteer_events.description) LIKE ${text} OR
              LOWER(volunteer_events.location_address) LIKE ${text}
            )`,
        );
      });

      // Archive filter based on event time
      const includeArchived = (options as { includeArchived?: boolean }).includeArchived === true;
      if (includeArchived) {
        q = q.where('volunteer_events.end_time', '<', new Date());
      } else {
        q = q.where('volunteer_events.end_time', '>=', new Date());
      }

      // Apply basic column filters
      q = this.applyColumnFilter(q, 'volunteer_events.name', filterModel['name'] ?? {});
      q = this.applyColumnFilter(q, 'volunteer_events.location_address', filterModel['location_address'] ?? {});

      return q;
    };

    // Count query
    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count('volunteer_events.id').as('total')])
      .execute();
    const count = Number(countResult[0]?.['total'] || 0);

    // Data query
    const rows = await applyFilters(this.getSelect(trx))
      .select([
        'volunteer_events.id',
        'volunteer_events.tenant_id',
        'volunteer_events.name',
        'volunteer_events.description',
        'volunteer_events.location_address',
        'volunteer_events.start_time',
        'volunteer_events.end_time',
        'volunteer_events.capacity',
        'volunteer_events.created_at',
        'volunteer_events.updated_at',
      ])
      .select((eb) => [
        eb
          .selectFrom('volunteer_shifts')
          .whereRef('volunteer_shifts.event_id', '=', 'volunteer_events.id')
          .select(({ fn }) => [fn.count<number>('volunteer_shifts.id').as('volunteers_count')])
          .as('volunteers_count'),
      ])
      .groupBy([
        'volunteer_events.id',
        'volunteer_events.tenant_id',
        'volunteer_events.name',
        'volunteer_events.description',
        'volunteer_events.location_address',
        'volunteer_events.start_time',
        'volunteer_events.end_time',
        'volunteer_events.capacity',
        'volunteer_events.created_at',
        'volunteer_events.updated_at',
      ])
      .$if(!!options.sortModel?.length, (qb) =>
        (options.sortModel ?? []).reduce((acc, sort) => acc.orderBy(sort.colId, sort.sort), qb),
      )
      .$if(!options.sortModel?.length, (qb) => qb.orderBy('volunteer_events.start_time', 'desc'))
      // Always paged. This was a `$if` on both paging fields being present, so a call with no
      // paging emitted no LIMIT clause and read every volunteer event in the workspace.
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    return {
      rows,
      count,
    };
  }

  public async getShiftsForEvent(input: { tenant_id: string; event_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    return db
      .selectFrom('volunteer_shifts')
      .innerJoin('persons', 'persons.id', 'volunteer_shifts.person_id')
      .select([
        'volunteer_shifts.id',
        'volunteer_shifts.event_id',
        'volunteer_shifts.person_id',
        'volunteer_shifts.status',
        'volunteer_shifts.hours_worked',
        'volunteer_shifts.notes',
        'volunteer_shifts.created_at',
        'volunteer_shifts.updated_at',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
      ])
      .where('volunteer_shifts.tenant_id', '=', input.tenant_id)
      .where('volunteer_shifts.event_id', '=', input.event_id)
      .orderBy('persons.last_name', 'asc')
      .execute();
  }

  public async signupVolunteer(
    input: {
      tenant_id: string;
      event_id: string;
      person_id: string;
      status?: 'signed_up' | 'attended' | 'no_show' | 'cancelled';
      hours_worked?: number | null;
      notes?: string | null;
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const db = trx || this.db;

    // Check if shift already exists
    const existing = await db
      .selectFrom('volunteer_shifts')
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('event_id', '=', input.event_id)
      .where('person_id', '=', input.person_id)
      .executeTakeFirst();

    if (existing) {
      // A plain Error is redacted to "Something went wrong, please try again" in production.
      // ConflictError is a recognised app error, so the real sentence reaches the organizer.
      throw new ConflictError('This person is already signed up for this event.');
    }

    const row = {
      tenant_id: input.tenant_id,
      event_id: input.event_id,
      person_id: input.person_id,
      status: input.status ?? 'signed_up',
      hours_worked: input.hours_worked ?? null,
      notes: input.notes ?? null,
      createdby_id: input.user_id,
      updatedby_id: input.user_id,
    };

    return db.insertInto('volunteer_shifts').values(row).returningAll().executeTakeFirst();
  }

  public async updateShift(
    input: {
      tenant_id: string;
      id: string;
      row: {
        status?: 'signed_up' | 'attended' | 'no_show' | 'cancelled';
        hours_worked?: number | null;
        notes?: string | null;
      };
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const db = trx || this.db;
    return db
      .updateTable('volunteer_shifts')
      .set({
        ...input.row,
        updatedby_id: input.user_id,
        updated_at: sql`now()`,
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
  }

  public async deleteShift(input: { tenant_id: string; id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    const res = await db
      .deleteFrom('volunteer_shifts')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return Number(res.numDeletedRows || 0) > 0;
  }

  public async getHistoryForPerson(input: { tenant_id: string; person_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    return db
      .selectFrom('volunteer_shifts')
      .innerJoin('volunteer_events', 'volunteer_events.id', 'volunteer_shifts.event_id')
      .select([
        'volunteer_shifts.id',
        'volunteer_shifts.event_id',
        'volunteer_shifts.status',
        'volunteer_shifts.hours_worked',
        'volunteer_shifts.notes',
        'volunteer_shifts.created_at',
        'volunteer_events.name as event_name',
        'volunteer_events.start_time',
        'volunteer_events.end_time',
      ])
      .where('volunteer_shifts.tenant_id', '=', input.tenant_id)
      .where('volunteer_shifts.person_id', '=', input.person_id)
      .orderBy('volunteer_events.start_time', 'desc')
      .execute();
  }

  public async getVolunteerStats(input: { tenant_id: string; person_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;

    const result = await db
      .selectFrom('volunteer_shifts')
      .select(({ fn }) => [fn.count<number>('id').as('shifts_count'), fn.sum<number>('hours_worked').as('total_hours')])
      .where('tenant_id', '=', input.tenant_id)
      .where('person_id', '=', input.person_id)
      .where('status', '=', 'attended')
      .executeTakeFirst();

    return {
      shifts_count: Number(result?.shifts_count ?? 0),
      total_hours: parseFloat(String(result?.total_hours ?? '0.0')),
    };
  }
}
