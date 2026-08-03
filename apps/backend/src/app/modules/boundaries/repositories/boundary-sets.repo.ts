import type { Transaction } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';

/** One boundary layer as the boundaries page lists it, with its live area count. */
export interface BoundarySetListRow {
  id: string;
  slug: string;
  label: string;
  jurisdiction: string;
  role: string;
  chamber: string | null;
  region: string | null;
  vintage: string | null;
  source: string;
  file_id: string | null;
  name_property: string | null;
  code_property: string | null;
  feature_count: number;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

export class BoundarySetsRepo extends BaseRepository<'boundary_sets'> {
  constructor() {
    super('boundary_sets');
  }

  /**
   * Every layer this workspace holds, newest first, each with the number of areas actually stored.
   *
   * The count is computed rather than read from `boundary_sets.feature_count` so the page can never
   * show a number the polygons disagree with. The stored column is still maintained, because the
   * matcher's cache key depends on it — see `lib/gis/boundary-store.ts`.
   */
  public async listForTenant(tenantId: string, trx?: Transaction<Models>): Promise<BoundarySetListRow[]> {
    const rows = await this.getSelect(trx)
      .leftJoin('boundary_features', (join) =>
        join
          .onRef('boundary_features.set_id', '=', 'boundary_sets.id')
          .on('boundary_features.tenant_id', '=', tenantId),
      )
      .select(({ fn }) => [
        'boundary_sets.id',
        'boundary_sets.slug',
        'boundary_sets.label',
        'boundary_sets.jurisdiction',
        'boundary_sets.role',
        'boundary_sets.chamber',
        'boundary_sets.region',
        'boundary_sets.vintage',
        'boundary_sets.source',
        'boundary_sets.file_id',
        'boundary_sets.name_property',
        'boundary_sets.code_property',
        'boundary_sets.feature_count',
        'boundary_sets.created_at',
        'boundary_sets.updated_at',
        fn.count('boundary_features.id').as('stored_features'),
      ])
      .where('boundary_sets.tenant_id', '=', tenantId)
      .groupBy([
        'boundary_sets.id',
        'boundary_sets.slug',
        'boundary_sets.label',
        'boundary_sets.jurisdiction',
        'boundary_sets.role',
        'boundary_sets.chamber',
        'boundary_sets.region',
        'boundary_sets.vintage',
        'boundary_sets.source',
        'boundary_sets.file_id',
        'boundary_sets.name_property',
        'boundary_sets.code_property',
        'boundary_sets.feature_count',
        'boundary_sets.created_at',
        'boundary_sets.updated_at',
      ])
      .orderBy('boundary_sets.created_at', 'desc')
      .execute();

    return rows.map((row) => ({
      id: String(row.id),
      slug: row.slug,
      label: row.label,
      jurisdiction: row.jurisdiction,
      role: row.role,
      chamber: row.chamber,
      region: row.region,
      vintage: row.vintage,
      source: row.source,
      file_id: row.file_id == null ? null : String(row.file_id),
      name_property: row.name_property,
      code_property: row.code_property,
      // A bundled layer keeps its polygons in a build asset, so it has no rows to count and the
      // stored number is the only one there is.
      feature_count: row.source === 'bundled' ? (row.feature_count ?? 0) : Number(row.stored_features ?? 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  public async findById(tenantId: string, id: string, trx?: Transaction<Models>) {
    return this.getSelect(trx).selectAll().where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
  }

  public async countForTenant(tenantId: string, trx?: Transaction<Models>): Promise<number> {
    const row = await this.getSelect(trx)
      .select(({ fn }) => [fn.countAll().as('cnt')])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  /** Every slug already taken in this workspace, so a new one can be made unique in one round trip. */
  public async takenSlugs(tenantId: string, trx?: Transaction<Models>): Promise<Set<string>> {
    const rows = await this.getSelect(trx).select('slug').where('tenant_id', '=', tenantId).execute();
    return new Set(rows.map((row) => row.slug));
  }

  /**
   * Record a layer's new area count and bump its `updated_at`.
   *
   * Not bookkeeping. `updated_at` and `feature_count` together are the matcher's cache version
   * (`lib/gis/boundary-store.ts`), and the tRPC process and the worker process each hold their own
   * cache. Failing to bump this here would leave the worker matching against the polygons as they
   * were before the edit, with nothing to indicate anything was stale.
   */
  public async touch(tenantId: string, id: string, featureCount: number, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ feature_count: featureCount, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }
}
