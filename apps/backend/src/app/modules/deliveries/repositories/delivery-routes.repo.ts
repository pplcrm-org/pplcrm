import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import type { DeliveryRoutes } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

export type DeliveryRouteGridRow = {
  id: string;
  name: string;
  status: string;
  est_minutes: number;
  est_km: number;
  scheduled_for: Date | string | null;
  created_at: Date | string | null;
  volunteer_person_id: string | null;
  volunteer_name: string | null;
  stops_total: number;
  stops_delivered: number;
};

export class DeliveryRoutesRepo extends BaseRepository<'delivery_routes'> {
  constructor() {
    super('delivery_routes');
  }

  public override async getAllWithCounts(
    input: { tenant_id: string; options?: QueryParams<'delivery_routes'> },
    trx?: Transaction<Models>,
  ): Promise<{ rows: DeliveryRouteGridRow[]; count: number }> {
    const tenantId = input.tenant_id;
    const db = trx ?? this.db;

    const rows = await db
      .selectFrom('delivery_routes as rt')
      .leftJoin('persons as v', 'v.id', 'rt.volunteer_person_id')
      .leftJoin('delivery_route_stops as s', (join) =>
        join.onRef('s.route_id', '=', 'rt.id').on('s.tenant_id', '=', tenantId),
      )
      .where('rt.tenant_id', '=', tenantId)
      .groupBy(['rt.id', 'v.first_name', 'v.last_name'])
      .select([
        'rt.id as id',
        'rt.name as name',
        'rt.status as status',
        'rt.est_minutes as est_minutes',
        'rt.est_km as est_km',
        'rt.scheduled_for as scheduled_for',
        'rt.created_at as created_at',
        'rt.volunteer_person_id as volunteer_person_id',
        sql<string>`NULLIF(TRIM(COALESCE(v.first_name, '') || ' ' || COALESCE(v.last_name, '')), '')`.as(
          'volunteer_name',
        ),
        ({ fn }) => fn.count<number>('s.id').as('stops_total'),
        sql<number>`COUNT(CASE WHEN s.status = 'delivered' THEN 1 END)`.as('stops_delivered'),
      ])
      .orderBy('rt.created_at', 'desc')
      .execute();

    const countRow = await db
      .selectFrom('delivery_routes')
      .select(({ fn }) => fn.count<number>('id').as('total'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return {
      rows: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        status: String(r.status),
        est_minutes: Number(r.est_minutes ?? 0),
        est_km: Number(r.est_km ?? 0),
        scheduled_for: r.scheduled_for ?? null,
        created_at: r.created_at ?? null,
        volunteer_person_id: r.volunteer_person_id != null ? String(r.volunteer_person_id) : null,
        volunteer_name: r.volunteer_name ?? null,
        stops_total: Number(r.stops_total ?? 0),
        stops_delivered: Number(r.stops_delivered ?? 0),
      })),
      count: Number(countRow?.total ?? 0),
    };
  }

  /**
   * Route counts by status, for the Requests/Routes tab badge. Every status key is present (zeroed)
   * so the caller never has to distinguish "no routes in that state" from "status unknown".
   */
  public async getStatusCounts(tenantId: string, trx?: Transaction<Models>): Promise<Record<string, number>> {
    const db = trx ?? this.db;
    const rows = await db
      .selectFrom('delivery_routes')
      .select(['status', ({ fn }) => fn.count<number>('id').as('n')])
      .where('tenant_id', '=', tenantId)
      .groupBy('status')
      .execute();
    const counts: Record<string, number> = { draft: 0, assigned: 0, in_progress: 0, completed: 0, canceled: 0 };
    for (const r of rows) counts[String(r.status)] = Number(r.n);
    return counts;
  }

  /** Typed single-route fetch (getOneById erases the row type to `{}`). */
  public async getRouteRow(
    tenantId: string,
    id: string,
    trx?: Transaction<Models>,
  ): Promise<Selectable<DeliveryRoutes> | undefined> {
    const db = trx ?? this.db;
    const row = await db
      .selectFrom('delivery_routes')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row as Selectable<DeliveryRoutes> | undefined;
  }

  /**
   * Resolve a route by the sha256 hash of its capability token. Cross-tenant by design — the token
   * IS the credential and decides which tenant owns the route. Every follow-up query in the public
   * handler is scoped by the resolved tenant_id.
   */
  public async findByTokenHash(tokenHash: string): Promise<Selectable<DeliveryRoutes> | undefined> {
    // eslint-disable-next-line local/no-unscoped-db-query
    const row = await BaseRepository.dbInstance
      .selectFrom('delivery_routes')
      .selectAll()
      .where('share_token_hash', '=', tokenHash)
      .executeTakeFirst();
    return row as Selectable<DeliveryRoutes> | undefined;
  }
}
