import type { Kysely, Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { DoorPoint } from '../lib/cutting-engine';

export interface TurfRow {
  id: string;
  name: string;
  status: string;
  list_id: string | null;
  list_name: string | null;
  ward: string | null;
  target_doors: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  updated_at: Date | null;
  door_count: number;
  team_id: string | null;
  team_name: string | null;
  /** Whether an active companion link exists. The raw token is never stored (M5). */
  has_link: boolean;
}

export class TurfsRepo extends BaseRepository<'turfs'> {
  constructor() {
    super('turfs');
  }

  /**
   * All turfs with universe-list name and current (single active) assignment.
   * Door counts are merged from a separate grouped query to keep this row-per-turf.
   */
  public async getTurfs(tenant_id: string, trx?: Transaction<Models>): Promise<TurfRow[]> {
    const rows = await this.getSelect(trx)
      .leftJoin('lists', 'lists.id', 'turfs.list_id')
      .leftJoin('turf_assignments as ta', (join) =>
        join.onRef('ta.turf_id', '=', 'turfs.id').on('ta.tenant_id', '=', tenant_id).on('ta.status', '=', 'active'),
      )
      .leftJoin('teams', 'teams.id', 'ta.team_id')
      .where('turfs.tenant_id', '=', tenant_id)
      .orderBy('turfs.id')
      .select([
        'turfs.id as id',
        'turfs.name as name',
        'turfs.status as status',
        'turfs.list_id as list_id',
        'lists.name as list_name',
        'turfs.ward as ward',
        'turfs.target_doors as target_doors',
        'turfs.centroid_lat as centroid_lat',
        'turfs.centroid_lng as centroid_lng',
        'turfs.updated_at as updated_at',
        'ta.team_id as team_id',
        'teams.name as team_name',
        'ta.token_hash as token_hash',
      ])
      .execute();

    const counts = await this.doorCounts(tenant_id, trx);

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      status: String(r.status),
      list_id: r.list_id == null ? null : String(r.list_id),
      list_name: r.list_name ? String(r.list_name) : null,
      ward: r.ward ? String(r.ward) : null,
      target_doors: r.target_doors == null ? null : Number(r.target_doors),
      centroid_lat: r.centroid_lat == null ? null : Number(r.centroid_lat),
      centroid_lng: r.centroid_lng == null ? null : Number(r.centroid_lng),
      updated_at: r.updated_at ? new Date(String(r.updated_at)) : null,
      door_count: counts.get(String(r.id)) ?? 0,
      team_id: r.team_id == null ? null : String(r.team_id),
      team_name: r.team_name ? String(r.team_name) : null,
      // The raw token is no longer stored (M5), so the list reports only WHETHER a link
      // exists — enough to label the action, without handing the credential to every
      // client that can read the turf list.
      has_link: r.token_hash != null,
    }));
  }

  /** Typed single-turf lookup (getOneById returns a loosely-typed row). */
  public async getTurfCore(
    input: { tenant_id: string; id: string },
    trx?: Transaction<Models>,
  ): Promise<{
    id: string;
    name: string;
    status: string;
    list_id: string | null;
    ward: string | null;
    campaign_id: string | null;
  } | null> {
    const row = await this.getSelect(trx)
      .select(['id', 'name', 'status', 'list_id', 'ward', 'campaign_id'])
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      list_id: row.list_id == null ? null : String(row.list_id),
      ward: row.ward == null ? null : String(row.ward),
      campaign_id: row.campaign_id == null ? null : String(row.campaign_id),
    };
  }

  private conn(trx?: Transaction<Models>): Kysely<Models> | Transaction<Models> {
    return trx ?? this.db;
  }

  private async doorCounts(tenant_id: string, trx?: Transaction<Models>): Promise<Map<string, number>> {
    const rows = await this.conn(trx)
      .selectFrom('turf_households')
      .where('tenant_id', '=', tenant_id)
      .groupBy('turf_id')
      .select(({ fn }) => ['turf_id', fn.count('household_id').as('doors')])
      .execute();
    const map = new Map<string, number>();
    for (const r of rows) map.set(String(r.turf_id), Number(r.doors ?? 0));
    return map;
  }

  /** Geocoded doors for a set of households, feeding the cutting engine. */
  public async getHouseholdsGeo(
    input: { tenant_id: string; household_ids: string[] },
    trx?: Transaction<Models>,
  ): Promise<DoorPoint[]> {
    if (input.household_ids.length === 0) return [];
    const rows = await this.conn(trx)
      .selectFrom('households')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', 'in', input.household_ids)
      .select(['id', 'lat', 'lng', 'ward'])
      .execute();
    return rows.map((r) => ({
      household_id: String(r.id),
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      ward: r.ward ?? null,
    }));
  }

  /** Distinct households for a set of persons (universe = a people smart list). */
  public async getHouseholdIdsForPersons(
    input: { tenant_id: string; person_ids: string[] },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    if (input.person_ids.length === 0) return [];
    const rows = await this.conn(trx)
      .selectFrom('persons')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', 'in', input.person_ids)
      .where('household_id', 'is not', null)
      .select('household_id')
      .distinct()
      .execute();
    return rows.map((r) => String(r.household_id));
  }
}
