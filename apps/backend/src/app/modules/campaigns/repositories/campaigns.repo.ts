import { sql } from 'kysely';

import type { Transaction } from 'kysely';

import { BadRequestError, NotFoundError } from '../../../errors/app-errors';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

export class CampaignsRepo extends BaseRepository<'campaigns'> {
  constructor() {
    super('campaigns');
  }

  /**
   * Lightweight list for the header context switcher — office first, newest elections after.
   *
   * Carries the office columns as well as the name, because the frontend resolves every geography
   * word it prints (riding, ward, congressional district, constituency) from the active campaign's
   * jurisdiction, region and override. Without them the context payload cannot label anything, and
   * the alternative is a second round trip on every page that shows a district.
   */
  public async getSwitcherList(input: { tenant_id: string }, trx?: Transaction<Models>) {
    return this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .select([
        'id',
        'name',
        'kind',
        'status',
        'startdate',
        'enddate',
        'jurisdiction',
        'office_region',
        'office_locality',
        'chamber',
        'seat_type',
        'seat_name',
        'seat_position',
        'seat_label_override',
        'office_title',
      ])
      .orderBy(sql`CASE WHEN kind = 'office' THEN 0 ELSE 1 END`)
      .orderBy('created_at', 'desc')
      .execute();
  }

  /**
   * Resolve the campaign a new campaign-scoped row belongs to (§15): an explicit
   * id is validated (exists, tenant-owned, active); otherwise fall back to the
   * tenant's office context, which always exists.
   */
  public async resolveForWrite(
    input: { tenant_id: string; campaign_id?: string | null },
    trx?: Transaction<Models>,
  ): Promise<string> {
    if (input.campaign_id) {
      await this.assertWritable({ tenant_id: input.tenant_id, campaign_id: String(input.campaign_id) }, trx);
      return String(input.campaign_id);
    }
    const office = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('kind', '=', 'office')
      .select(['id'])
      .executeTakeFirst();
    if (!office) throw new NotFoundError('No campaign context exists for this organization.');
    return String(office.id);
  }

  /**
   * Guard for campaign-scoped mutations (Campaigns §15): the target campaign must exist,
   * belong to the tenant, and be active — archived campaigns are read-only history.
   */
  public async assertWritable(input: { tenant_id: string; campaign_id: string }, trx?: Transaction<Models>) {
    const row = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.campaign_id)
      .select(['id', 'status'])
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Campaign not found');
    if (row.status === 'archived') {
      throw new BadRequestError('This campaign is archived and read-only. Unarchive it to make changes.');
    }
  }
}
