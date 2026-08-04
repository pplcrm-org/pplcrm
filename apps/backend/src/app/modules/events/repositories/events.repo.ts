import type { Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';
import type { JoinedQueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { GridFilterModel } from '../../../../../../../libs/common/src';

export class EventsRepo extends BaseRepository<'events'> {
  constructor() {
    super('events');
  }

  public async getAllEventsWithCount(
    input: { tenant_id: string; options?: any },
    trx?: Transaction<Models>,
  ): Promise<{ rows: any[]; count: number }> {
    const options: JoinedQueryParams = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as GridFilterModel;
    const page = resolvePageWindow(options);

    const applyFilters = <QB extends AnyQB>(qb: QB) => {
      let q = qb.where('events.tenant_id', '=', tenantId).$if(!!searchStr, (qb2) => {
        const text = searchStr;
        return qb2.where(
          sql<boolean>`(
            LOWER(events.name) LIKE ${text} OR
            LOWER(events.description) LIKE ${text} OR
            LOWER(events.location_address) LIKE ${text}
          )`,
        );
      });

      const includeArchived = (options as { includeArchived?: boolean }).includeArchived === true;
      if (includeArchived) {
        q = q.where('events.end_time', '<', new Date());
      } else {
        q = q.where('events.end_time', '>=', new Date());
      }

      q = this.applyColumnFilter(q, 'events.name', filterModel['name']);
      q = this.applyColumnFilter(q, 'events.location_address', filterModel['location_address']);

      return q;
    };

    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count('events.id').as('total')])
      .execute();
    const count = Number(countResult[0]?.['total'] || 0);

    const rows = await applyFilters(this.getSelect(trx))
      .select([
        'events.id',
        'events.tenant_id',
        'events.name',
        'events.description',
        'events.location_address',
        'events.start_time',
        'events.end_time',
        'events.capacity',
        'events.slug',
        'events.is_published',
        'events.send_reminder',
        'events.send_registration_confirmation',
        'events.created_at',
        'events.updated_at',
      ])
      .select((eb) => [
        eb
          .selectFrom('event_registrations')
          .whereRef('event_registrations.event_id', '=', 'events.id')
          .where('event_registrations.status', '!=', 'cancelled')
          .select(({ fn }) => [fn.count<number>('event_registrations.id').as('registrations_count')])
          .as('registrations_count'),
      ])
      .$if(!!options.sortModel?.length, (qb) =>
        (options.sortModel ?? []).reduce(
          (acc: typeof qb, sort: { colId: string; sort: 'asc' | 'desc' }) => acc.orderBy(sort.colId, sort.sort),
          qb,
        ),
      )
      .$if(!options.sortModel?.length, (qb) => qb.orderBy('events.start_time', 'asc'))
      // Always paged. This was a `$if` on both paging fields being present, so a call with no
      // paging emitted no LIMIT clause and read every event in the workspace.
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    return { rows, count };
  }

  public async getTicketTypesForEvent(input: { tenant_id: string; event_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    return db
      .selectFrom('event_ticket_types')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('event_id', '=', input.event_id)
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  public async addTicketType(
    input: {
      tenant_id: string;
      event_id: string;
      name: string;
      description?: string | null;
      price_cents: number;
      capacity?: number | null;
      sort_order?: number;
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const db = trx || this.db;
    return db
      .insertInto('event_ticket_types')
      .values({
        tenant_id: input.tenant_id,
        event_id: input.event_id,
        name: input.name,
        description: input.description ?? null,
        price_cents: input.price_cents,
        capacity: input.capacity ?? null,
        sort_order: input.sort_order ?? 0,
        createdby_id: input.user_id,
        updatedby_id: input.user_id,
      })
      .returningAll()
      .executeTakeFirst();
  }

  public async updateTicketType(
    input: {
      tenant_id: string;
      id: string;
      row: {
        name?: string;
        description?: string | null;
        price_cents?: number;
        capacity?: number | null;
        sort_order?: number;
      };
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const db = trx || this.db;
    return db
      .updateTable('event_ticket_types')
      .set({ ...input.row, updatedby_id: input.user_id, updated_at: sql`now()` })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Persist a drag-to-reorder of an event's ticket types: write each id's `sort_order` to its index
   * in `ordered_ids`, atomically. Caller has already verified `ordered_ids` is exactly this event's
   * ticket types. There is no unique constraint on (event_id, sort_order), so a plain sequential
   * write is safe — no temp-offset dance needed.
   */
  public async reorderTicketTypes(input: {
    tenant_id: string;
    event_id: string;
    ordered_ids: string[];
    user_id: string;
  }): Promise<void> {
    await this.transaction().execute(async (trx) => {
      for (let i = 0; i < input.ordered_ids.length; i++) {
        await trx
          .updateTable('event_ticket_types')
          .set({ sort_order: i, updatedby_id: input.user_id, updated_at: sql`now()` })
          .where('tenant_id', '=', input.tenant_id)
          .where('event_id', '=', input.event_id)
          .where('id', '=', input.ordered_ids[i] ?? '')
          .execute();
      }
    });
  }

  public async deleteTicketType(input: { tenant_id: string; id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    const res = await db
      .deleteFrom('event_ticket_types')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return Number(res.numDeletedRows || 0) > 0;
  }

  public async getRegistrationsForEvent(input: { tenant_id: string; event_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    return db
      .selectFrom('event_registrations')
      .innerJoin('persons', 'persons.id', 'event_registrations.person_id')
      .leftJoin('event_ticket_types', 'event_ticket_types.id', 'event_registrations.ticket_type_id')
      .select([
        'event_registrations.id',
        'event_registrations.event_id',
        'event_registrations.person_id',
        'event_registrations.ticket_type_id',
        'event_registrations.status',
        'event_registrations.checked_in_at',
        'event_registrations.notes',
        'event_registrations.created_at',
        'event_registrations.updated_at',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'event_ticket_types.name as ticket_type_name',
        'event_ticket_types.price_cents as ticket_price_cents',
      ])
      .where('event_registrations.tenant_id', '=', input.tenant_id)
      .where('event_registrations.event_id', '=', input.event_id)
      .orderBy('persons.last_name', 'asc')
      .execute();
  }

  public async addRegistration(
    input: {
      tenant_id: string;
      event_id: string;
      person_id: string;
      ticket_type_id?: string | null;
      status?: 'registered' | 'attended' | 'no_show' | 'cancelled';
      notes?: string | null;
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const db = trx || this.db;
    return db
      .insertInto('event_registrations')
      .values({
        tenant_id: input.tenant_id,
        event_id: input.event_id,
        person_id: input.person_id,
        ticket_type_id: input.ticket_type_id ?? null,
        status: input.status ?? 'registered',
        notes: input.notes ?? null,
        createdby_id: input.user_id,
        updatedby_id: input.user_id,
      })
      .returningAll()
      .executeTakeFirst();
  }

  public async updateRegistration(
    input: {
      tenant_id: string;
      id: string;
      row: {
        ticket_type_id?: string | null;
        status?: 'registered' | 'attended' | 'no_show' | 'cancelled';
        checked_in_at?: Date | null;
        notes?: string | null;
      };
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const db = trx || this.db;
    return db
      .updateTable('event_registrations')
      .set({ ...input.row, updatedby_id: input.user_id, updated_at: sql`now()` })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
  }

  public async deleteRegistration(input: { tenant_id: string; id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    const res = await db
      .deleteFrom('event_registrations')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return Number(res.numDeletedRows || 0) > 0;
  }

  public async getHistoryForPerson(input: { tenant_id: string; person_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    return db
      .selectFrom('event_registrations')
      .innerJoin('events', 'events.id', 'event_registrations.event_id')
      .leftJoin('event_ticket_types', 'event_ticket_types.id', 'event_registrations.ticket_type_id')
      .select([
        'event_registrations.id',
        'event_registrations.event_id',
        'event_registrations.status',
        'event_registrations.checked_in_at',
        'event_registrations.notes',
        'event_registrations.created_at',
        'events.name as event_name',
        'events.start_time',
        'events.end_time',
        'events.location_address',
        'event_ticket_types.name as ticket_type_name',
      ])
      .where('event_registrations.tenant_id', '=', input.tenant_id)
      .where('event_registrations.person_id', '=', input.person_id)
      .orderBy('events.start_time', 'desc')
      .execute();
  }

  public async getEventStats(input: { tenant_id: string; person_id: string }, trx?: Transaction<Models>) {
    const db = trx || this.db;
    const result = await db
      .selectFrom('event_registrations')
      .select(({ fn }) => [fn.count<number>('id').as('events_count')])
      .where('tenant_id', '=', input.tenant_id)
      .where('person_id', '=', input.person_id)
      .where('status', '=', 'attended')
      .executeTakeFirst();
    return { events_count: Number(result?.events_count ?? 0) };
  }
}
