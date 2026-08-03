import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';

export class BoundaryFeaturesRepo extends BaseRepository<'boundary_features'> {
  constructor() {
    super('boundary_features');
  }

  /**
   * Every area of one layer, in the same fixed name order the matcher uses.
   *
   * The order matters beyond tidiness: when hand-drawn areas overlap, the matcher takes the first
   * one in this order, so the list a person sees and the list the matcher walks have to agree or
   * the reported match will look arbitrary.
   */
  public async listForSet(tenantId: string, setId: string, trx?: Transaction<Models>) {
    // COLLATE "C" (byte-wise) with nulls coalesced to '' matches `compareFeatures` in
    // lib/gis/boundary-store.ts; a locale collation would order some names differently than the
    // matcher's precedence, making an overlap's reported winner look arbitrary.
    return this.getSelect(trx)
      .select(['id', 'set_id', 'name', 'code', 'geometry', 'bbox'])
      .where('tenant_id', '=', tenantId)
      .where('set_id', '=', setId)
      .orderBy(sql`name COLLATE "C"`, 'asc')
      .orderBy(sql`coalesce(code, '') COLLATE "C"`, 'asc')
      .execute();
  }

  public async findById(tenantId: string, id: string, trx?: Transaction<Models>) {
    return this.getSelect(trx).selectAll().where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
  }

  public async countForSet(tenantId: string, setId: string, trx?: Transaction<Models>): Promise<number> {
    const row = await this.getSelect(trx)
      .select(({ fn }) => [fn.countAll().as('cnt')])
      .where('tenant_id', '=', tenantId)
      .where('set_id', '=', setId)
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  /** Insert a parsed upload's areas. Chunked, because one file may carry thousands of them. */
  public async insertForSet(
    rows: OperationDataType<'boundary_features', 'insert'>[],
    trx?: Transaction<Models>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.addManyChunked({ rows }, trx);
  }

  public async deleteById(tenantId: string, id: string, trx?: Transaction<Models>): Promise<boolean> {
    const result = await this.getDelete(trx).where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }
}
