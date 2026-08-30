import type { Kysely, Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import { chunk } from '../../../lib/chunk';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { DoorPoint } from '../lib/cutting-engine';

export interface TurfRow {
  id: string;
  name: string;
  status: string;
  list_id: string | null;
  list_name: string | null;
  /** The named area this turf covers, or null when its doors sit inside no area — see turf-boundary.ts. */
  boundary_name: string | null;
  /**
   * The boundary map the turf was cut against. The two columns are independent:
   * set + name = inside that named area; set without name = cut against that map but outside
   * every area of it; both null = cut with no map at all; name without set = the map was
   * deleted (FK is ON DELETE SET NULL) or the turf predates boundary maps.
   */
  boundary_set_id: string | null;
  target_doors: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  updated_at: Date | null;
  door_count: number;
  /** Scopes what a roaming volunteer may claim — they never leave their own campaign. */
  campaign_id: string | null;
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
    // NOTE: deliberately does NOT join turf_assignments. A turf can hold several
    // active assignments (a group walking it together), and joining them here fans
    // each turf out into one row per volunteer, silently multiplying door counts.
    // The roster is fetched separately by TurfAssignmentsRepo.canvassersByTurf.
    const rows = await this.getSelect(trx)
      .leftJoin('lists', 'lists.id', 'turfs.list_id')
      .where('turfs.tenant_id', '=', tenant_id)
      .orderBy('turfs.id')
      .select([
        'turfs.id as id',
        'turfs.name as name',
        'turfs.status as status',
        'turfs.list_id as list_id',
        'lists.name as list_name',
        'turfs.boundary_name as boundary_name',
        'turfs.boundary_set_id as boundary_set_id',
        'turfs.target_doors as target_doors',
        'turfs.centroid_lat as centroid_lat',
        'turfs.centroid_lng as centroid_lng',
        'turfs.updated_at as updated_at',
        'turfs.campaign_id as campaign_id',
      ])
      .execute();

    const counts = await this.doorCounts(tenant_id, trx);

    return rows.map((r) => this.toTurfRow(r, counts.get(String(r.id)) ?? 0));
  }

  /**
   * One turf as the same row shape the list page renders — the detail page's
   * header source, so both surfaces derive status and progress identically.
   */
  public async getTurfRow(
    input: { tenant_id: string; id: string },
    trx?: Transaction<Models>,
  ): Promise<TurfRow | null> {
    const row = await this.getSelect(trx)
      .leftJoin('lists', 'lists.id', 'turfs.list_id')
      .where('turfs.tenant_id', '=', input.tenant_id)
      .where('turfs.id', '=', input.id)
      .select([
        'turfs.id as id',
        'turfs.name as name',
        'turfs.status as status',
        'turfs.list_id as list_id',
        'lists.name as list_name',
        'turfs.boundary_name as boundary_name',
        'turfs.boundary_set_id as boundary_set_id',
        'turfs.target_doors as target_doors',
        'turfs.centroid_lat as centroid_lat',
        'turfs.centroid_lng as centroid_lng',
        'turfs.updated_at as updated_at',
        'turfs.campaign_id as campaign_id',
      ])
      .executeTakeFirst();
    if (!row) return null;

    const counts = await this.doorCounts(input.tenant_id, trx, input.id);
    return this.toTurfRow(row, counts.get(String(row.id)) ?? 0);
  }

  private toTurfRow(
    r: {
      id: unknown;
      name: unknown;
      status: unknown;
      list_id: unknown;
      list_name: unknown;
      boundary_name: unknown;
      boundary_set_id: unknown;
      target_doors: unknown;
      centroid_lat: unknown;
      centroid_lng: unknown;
      updated_at: unknown;
      campaign_id: unknown;
    },
    door_count: number,
  ): TurfRow {
    return {
      id: String(r.id),
      name: String(r.name),
      status: String(r.status),
      list_id: r.list_id == null ? null : String(r.list_id),
      list_name: r.list_name ? String(r.list_name) : null,
      boundary_name: r.boundary_name ? String(r.boundary_name) : null,
      boundary_set_id: r.boundary_set_id == null ? null : String(r.boundary_set_id),
      target_doors: r.target_doors == null ? null : Number(r.target_doors),
      centroid_lat: r.centroid_lat == null ? null : Number(r.centroid_lat),
      centroid_lng: r.centroid_lng == null ? null : Number(r.centroid_lng),
      updated_at: r.updated_at ? new Date(String(r.updated_at)) : null,
      door_count,
      campaign_id: r.campaign_id == null ? null : String(r.campaign_id),
    };
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
    boundary_name: string | null;
    boundary_set_id: string | null;
    campaign_id: string | null;
    /** Staff account that cut the turf — the responsible actor for volunteer-driven
     *  activity, which has no CRM user of its own (§22.7: never a fabricated user). */
    createdby_id: string;
  } | null> {
    const row = await this.getSelect(trx)
      .select(['id', 'name', 'status', 'list_id', 'boundary_name', 'boundary_set_id', 'campaign_id', 'createdby_id'])
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      list_id: row.list_id == null ? null : String(row.list_id),
      boundary_name: row.boundary_name == null ? null : String(row.boundary_name),
      boundary_set_id: row.boundary_set_id == null ? null : String(row.boundary_set_id),
      campaign_id: row.campaign_id == null ? null : String(row.campaign_id),
      createdby_id: String(row.createdby_id),
    };
  }

  private conn(trx?: Transaction<Models>): Kysely<Models> | Transaction<Models> {
    return trx ?? this.db;
  }

  private async doorCounts(
    tenant_id: string,
    trx?: Transaction<Models>,
    turf_id?: string,
  ): Promise<Map<string, number>> {
    let qb = this.conn(trx).selectFrom('turf_households').where('tenant_id', '=', tenant_id);
    if (turf_id) qb = qb.where('turf_id', '=', turf_id);
    const rows = await qb
      .groupBy('turf_id')
      .select(({ fn }) => ['turf_id', fn.count('household_id').as('doors')])
      .execute();
    const map = new Map<string, number>();
    for (const r of rows) map.set(String(r.turf_id), Number(r.doors ?? 0));
    return map;
  }

  /**
   * Geocoded doors for a set of households, feeding the cutting engine.
   *
   * `boundary_set_id` names the map the doors are placed against. A household's area comes from
   * `household_districts`, which holds one row per household per map — so a household in a
   * congressional district AND a state house district AND a precinct returns whichever of those
   * this cut is bounded by, and the other two are untouched.
   *
   * The join is a LEFT join on purpose: a household that matched no area of the map still returns
   * a door, with a null boundary. Dropping it would silently shrink the universe the organizer
   * chose, and the engine already has a defined behaviour for unmatched doors (they cluster
   * together on geography alone). A null `boundary_set_id` means no map applies at all, and every
   * door comes back unbounded.
   */
  public async getHouseholdsGeo(
    input: { tenant_id: string; household_ids: string[]; boundary_set_id: string | null },
    trx?: Transaction<Models>,
  ): Promise<DoorPoint[]> {
    // The id list is a whole universe (a smart list's membership), so it is read in chunks —
    // one IN-list holding 100k ids would blow the statement's bind-parameter cap. See chunk.ts.
    const setId = input.boundary_set_id;
    const out: DoorPoint[] = [];
    for (const ids of chunk(input.household_ids)) {
      if (setId == null) {
        const rows = await this.conn(trx)
          .selectFrom('households')
          .where('tenant_id', '=', input.tenant_id)
          .where('id', 'in', ids)
          .select(['id', 'lat', 'lng'])
          .execute();
        for (const r of rows) {
          out.push({ household_id: String(r.id), lat: r.lat ?? null, lng: r.lng ?? null, boundaryName: null });
        }
        continue;
      }

      const rows = await this.conn(trx)
        .selectFrom('households')
        .leftJoin('household_districts as hd', (join) =>
          join
            .onRef('hd.household_id', '=', 'households.id')
            .on('hd.tenant_id', '=', input.tenant_id)
            .on('hd.set_id', '=', setId),
        )
        .where('households.tenant_id', '=', input.tenant_id)
        .where('households.id', 'in', ids)
        .select(['households.id as id', 'households.lat as lat', 'households.lng as lng', 'hd.name as boundary_name'])
        .execute();
      for (const r of rows) {
        out.push({
          household_id: String(r.id),
          lat: r.lat ?? null,
          lng: r.lng ?? null,
          boundaryName: r.boundary_name == null ? null : String(r.boundary_name),
        });
      }
    }
    return out;
  }

  /** Distinct households for a set of persons (universe = a people smart list). */
  public async getHouseholdIdsForPersons(
    input: { tenant_id: string; person_ids: string[] },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    // Chunked (a people smart list can hold 100k+ ids), deduped across chunks: two persons in
    // different chunks can share a household, and DISTINCT only dedupes within one statement.
    const households = new Set<string>();
    for (const ids of chunk(input.person_ids)) {
      const rows = await this.conn(trx)
        .selectFrom('persons')
        .where('tenant_id', '=', input.tenant_id)
        .where('id', 'in', ids)
        .where('household_id', 'is not', null)
        .select('household_id')
        .distinct()
        .execute();
      for (const r of rows) households.add(String(r.household_id));
    }
    return [...households];
  }
}
