import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

// Composed street address fallback when a household has no formatted_address yet.
const COMPOSED_ADDRESS_SQL = sql<string>`COALESCE(
  NULLIF(h.formatted_address, ''),
  NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ',
    NULLIF(CONCAT_WS(' ', h.street_num, h.street1, h.street2), ''),
    NULLIF(h.city, ''),
    NULLIF(h.state, ''),
    NULLIF(h.zip, '')
  )), ''),
  ''
)`;

export type DeliveryRequestGridRow = {
  id: string;
  status: string;
  source: string;
  notes: string | null;
  created_at: Date | string | null;
  person_id: string | null;
  person_name: string | null;
  household_id: string;
  address: string;
  geocoding_status: string | null;
  route_id: string | null;
  route_name: string | null;
};

export class DeliveryRequestsRepo extends BaseRepository<'delivery_requests'> {
  constructor() {
    super('delivery_requests');
  }

  public override async getAllWithCounts(
    input: { tenant_id: string; options?: QueryParams<'delivery_requests'> },
    trx?: Transaction<Models>,
  ): Promise<{ rows: DeliveryRequestGridRow[]; count: number }> {
    const options: JoinedQueryParams = (input.options as JoinedQueryParams) ?? {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as Record<string, { value?: string }>;
    const statusFilter = filterModel['status']?.value;

    const startRow = typeof options.startRow === 'number' ? Math.max(0, options.startRow) : 0;
    const endRow = typeof options.endRow === 'number' && options.endRow > startRow ? options.endRow : startRow + 100;
    const limit = endRow - startRow;

    const db = trx ?? this.db;
    const base = () =>
      db
        .selectFrom('delivery_requests as dr')
        .innerJoin('households as h', 'h.id', 'dr.household_id')
        .leftJoin('persons as p', 'p.id', 'dr.person_id')
        // The route link is derived from an active (pending) stop — not stored on the request.
        .leftJoin('delivery_route_stops as active_stop', (join) =>
          join
            .onRef('active_stop.request_id', '=', 'dr.id')
            .on('active_stop.tenant_id', '=', tenantId)
            .on('active_stop.status', '=', 'pending'),
        )
        .leftJoin('delivery_routes as rt', 'rt.id', 'active_stop.route_id')
        .where('dr.tenant_id', '=', tenantId)
        .$if(!!statusFilter && statusFilter !== 'open', (qb) =>
          qb.where('dr.status', '=', statusFilter as 'new' | 'approved' | 'declined' | 'delivered'),
        )
        .$if(statusFilter === 'open', (qb) => qb.where('dr.status', 'in', ['new', 'approved']))
        .$if(!!searchStr, (qb) =>
          qb.where(
            sql<boolean>`(
              LOWER(${COMPOSED_ADDRESS_SQL}) LIKE ${searchStr} OR
              LOWER(COALESCE(p.first_name || ' ' || p.last_name, '')) LIKE ${searchStr}
            )`,
          ),
        );

    const countRow = await base()
      .select(({ fn }) => fn.count<number>('dr.id').as('total'))
      .executeTakeFirst();
    const count = Number(countRow?.total ?? 0);

    const rows = await base()
      .select([
        'dr.id as id',
        'dr.status as status',
        'dr.source as source',
        'dr.notes as notes',
        'dr.created_at as created_at',
        'dr.person_id as person_id',
        'dr.household_id as household_id',
        'h.geocoding_status as geocoding_status',
        'active_stop.route_id as route_id',
        'rt.name as route_name',
        COMPOSED_ADDRESS_SQL.as('address'),
        sql<string>`NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')`.as('person_name'),
      ])
      .orderBy('dr.created_at', 'desc')
      .offset(startRow)
      .limit(limit)
      .execute();

    return {
      rows: rows.map((r) => ({
        id: String(r.id),
        status: String(r.status),
        source: String(r.source),
        notes: r.notes ?? null,
        created_at: r.created_at ?? null,
        person_id: r.person_id != null ? String(r.person_id) : null,
        person_name: r.person_name ?? null,
        household_id: String(r.household_id),
        address: r.address ?? '',
        geocoding_status: r.geocoding_status ?? null,
        route_id: r.route_id != null ? String(r.route_id) : null,
        route_name: r.route_name ?? null,
      })),
      count,
    };
  }

  /**
   * The yard-sign standing for one household in one campaign context: the most recently touched
   * request, with the requester's name and the derived active-route link (pending stop, never a
   * stored flag). Backs the "Yard sign" control on the household and person pages.
   */
  public async getSignStatus(
    tenantId: string,
    householdId: string,
    campaignId: string,
    trx?: Transaction<Models>,
  ): Promise<{
    id: string;
    status: string;
    source: string;
    notes: string | null;
    skip_reason: string | null;
    updated_at: Date | string | null;
    person_id: string | null;
    person_name: string | null;
    route_id: string | null;
    route_name: string | null;
  } | null> {
    const db = trx ?? this.db;
    const row = await db
      .selectFrom('delivery_requests as dr')
      .leftJoin('persons as p', 'p.id', 'dr.person_id')
      .leftJoin('delivery_route_stops as active_stop', (join) =>
        join
          .onRef('active_stop.request_id', '=', 'dr.id')
          .on('active_stop.tenant_id', '=', tenantId)
          .on('active_stop.status', '=', 'pending'),
      )
      .leftJoin('delivery_routes as rt', 'rt.id', 'active_stop.route_id')
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.household_id', '=', householdId)
      .where('dr.campaign_id', '=', campaignId)
      .select([
        'dr.id as id',
        'dr.status as status',
        'dr.source as source',
        'dr.notes as notes',
        'dr.skip_reason as skip_reason',
        'dr.updated_at as updated_at',
        'dr.person_id as person_id',
        sql<string>`NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')`.as('person_name'),
        'active_stop.route_id as route_id',
        'rt.name as route_name',
      ])
      .orderBy('dr.updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      status: String(row.status),
      source: String(row.source),
      notes: row.notes ?? null,
      skip_reason: row.skip_reason ?? null,
      updated_at: row.updated_at ?? null,
      person_id: row.person_id != null ? String(row.person_id) : null,
      person_name: row.person_name ?? null,
      route_id: row.route_id != null ? String(row.route_id) : null,
      route_name: row.route_name ?? null,
    };
  }

  /**
   * The household's open (new/approved) request with its campaign name, regardless of campaign —
   * the open-per-household unique index guarantees at most one tenant-wide. Backs the conflict
   * message when another campaign holds the open request, and the cross-campaign note in the
   * yard-sign standing control.
   */
  public async getOpenForHousehold(
    tenantId: string,
    householdId: string,
    trx?: Transaction<Models>,
  ): Promise<{ id: string; status: string; campaign_id: string; campaign_name: string } | null> {
    const db = trx ?? this.db;
    const row = await db
      .selectFrom('delivery_requests as dr')
      .innerJoin('campaigns as c', 'c.id', 'dr.campaign_id')
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.household_id', '=', householdId)
      .where('dr.status', 'in', ['new', 'approved'])
      .select(['dr.id as id', 'dr.status as status', 'dr.campaign_id as campaign_id', 'c.name as campaign_name'])
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      status: String(row.status),
      campaign_id: String(row.campaign_id),
      campaign_name: String(row.campaign_name),
    };
  }

  /** Tab counts for the requests grid (spec §4.1): Open = new + approved. */
  public async getStatusCounts(tenantId: string, trx?: Transaction<Models>): Promise<Record<string, number>> {
    const db = trx ?? this.db;
    const rows = await db
      .selectFrom('delivery_requests')
      .select(['status', ({ fn }) => fn.count<number>('id').as('n')])
      .where('tenant_id', '=', tenantId)
      .groupBy('status')
      .execute();
    const counts: Record<string, number> = { new: 0, approved: 0, declined: 0, delivered: 0, open: 0 };
    for (const r of rows) {
      const status = String(r.status);
      counts[status] = Number(r.n);
    }
    counts['open'] = (counts['new'] ?? 0) + (counts['approved'] ?? 0);
    return counts;
  }

  /**
   * Count of requests eligible to plan right now: approved, geocoded, and not already on an active
   * stop. Drives the sidebar badge and the always-enabled "Plan routes · N ready" button.
   */
  public async getReadyCount(tenantId: string, trx?: Transaction<Models>): Promise<number> {
    const db = trx ?? this.db;
    const row = await db
      .selectFrom('delivery_requests as dr')
      .innerJoin('households as h', 'h.id', 'dr.household_id')
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.status', '=', 'approved')
      .where('h.geocoding_status', '=', 'success')
      .where('h.lat', 'is not', null)
      .where('h.lng', 'is not', null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('delivery_route_stops as s')
              .select('s.id')
              .whereRef('s.request_id', '=', 'dr.id')
              .where('s.tenant_id', '=', tenantId)
              .where('s.status', '=', 'pending'),
          ),
        ),
      )
      .select(({ fn }) => fn.count<number>('dr.id').as('n'))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /** Eligible requests with coordinates + display info, for the planner. */
  public async getEligibleForPlanning(
    tenantId: string,
    limit: number,
    trx?: Transaction<Models>,
  ): Promise<Array<{ request_id: string; lat: number; lng: number; address: string; name: string | null }>> {
    const db = trx ?? this.db;
    const rows = await db
      .selectFrom('delivery_requests as dr')
      .innerJoin('households as h', 'h.id', 'dr.household_id')
      .leftJoin('persons as p', 'p.id', 'dr.person_id')
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.status', '=', 'approved')
      .where('h.geocoding_status', '=', 'success')
      .where('h.lat', 'is not', null)
      .where('h.lng', 'is not', null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('delivery_route_stops as s')
              .select('s.id')
              .whereRef('s.request_id', '=', 'dr.id')
              .where('s.tenant_id', '=', tenantId)
              .where('s.status', '=', 'pending'),
          ),
        ),
      )
      .select([
        'dr.id as request_id',
        'h.lat as lat',
        'h.lng as lng',
        COMPOSED_ADDRESS_SQL.as('address'),
        sql<string>`NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '')`.as('name'),
      ])
      .orderBy('dr.created_at', 'asc')
      .limit(limit)
      .execute();
    return rows
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({
        request_id: String(r.request_id),
        lat: Number(r.lat),
        lng: Number(r.lng),
        address: r.address ?? '',
        name: r.name ?? null,
      }));
  }

  /** Re-check eligibility for a specific set of request ids in a commit transaction (concurrent-planner guard). */
  public async getEligibleByIds(
    tenantId: string,
    ids: string[],
    trx?: Transaction<Models>,
  ): Promise<Array<{ request_id: string; lat: number; lng: number; address: string }>> {
    if (ids.length === 0) return [];
    const db = trx ?? this.db;
    const rows = await db
      .selectFrom('delivery_requests as dr')
      .innerJoin('households as h', 'h.id', 'dr.household_id')
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.id', 'in', ids)
      .where('dr.status', '=', 'approved')
      .where('h.geocoding_status', '=', 'success')
      .where('h.lat', 'is not', null)
      .where('h.lng', 'is not', null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('delivery_route_stops as s')
              .select('s.id')
              .whereRef('s.request_id', '=', 'dr.id')
              .where('s.tenant_id', '=', tenantId)
              .where('s.status', '=', 'pending'),
          ),
        ),
      )
      .select(['dr.id as request_id', 'h.lat as lat', 'h.lng as lng', COMPOSED_ADDRESS_SQL.as('address')])
      .execute();
    return rows.map((r) => ({
      request_id: String(r.request_id),
      lat: Number(r.lat),
      lng: Number(r.lng),
      address: r.address ?? '',
    }));
  }

  /** Buckets of requests that are NOT eligible, so the plan page can narrate why (guide, don't error). */
  public async getIneligibleBuckets(
    tenantId: string,
    trx?: Transaction<Models>,
  ): Promise<{ awaiting_geocode: number; geocode_failed: number; not_approved: number }> {
    const db = trx ?? this.db;
    const openRows = await db
      .selectFrom('delivery_requests as dr')
      .innerJoin('households as h', 'h.id', 'dr.household_id')
      .where('dr.tenant_id', '=', tenantId)
      .where('dr.status', 'in', ['new', 'approved'])
      .select(['dr.status as status', 'h.geocoding_status as geo'])
      .execute();
    let awaiting = 0;
    let failed = 0;
    let notApproved = 0;
    for (const r of openRows) {
      if (r.status === 'new') notApproved++;
      else if (r.geo === 'failed') failed++;
      else if (r.geo !== 'success') awaiting++;
    }
    return { awaiting_geocode: awaiting, geocode_failed: failed, not_approved: notApproved };
  }
}
