import type { Selectable } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';

export class DonationPledgesRepo extends BaseRepository<'donation_pledges'> {
  constructor() {
    super('donation_pledges');
  }

  public async getAllForTenant(tenantId: string) {
    // Campaigns §15 — the caller's campaign pin, null for admins/owners (who see the whole tenant)
    // and for background callers. A pinned Editor or Viewer used to read every campaign's pledges.
    // Office-fund pledges carry the office campaign's id, so callers pinned to the office see
    // them and callers pinned to a real campaign do not.
    const campaignId = this.campaignPin();
    return this.db
      .selectFrom('donation_pledges')
      .leftJoin('persons', 'persons.id', 'donation_pledges.person_id')
      .select([
        'donation_pledges.id',
        'donation_pledges.tenant_id',
        'donation_pledges.person_id',
        'donation_pledges.stripe_subscription_id',
        'donation_pledges.stripe_customer_id',
        'donation_pledges.monthly_amount',
        'donation_pledges.status',
        'donation_pledges.started_at',
        'donation_pledges.cancelled_at',
        'donation_pledges.next_billing_date',
        'donation_pledges.state',
        'donation_pledges.country',
        'donation_pledges.created_at',
        this.db.fn.coalesce('persons.first_name', 'donation_pledges.first_name').as('person_first_name'),
        this.db.fn.coalesce('persons.last_name', 'donation_pledges.last_name').as('person_last_name'),
        this.db.fn.coalesce('persons.email', 'donation_pledges.email').as('person_email'),
      ])
      .where('donation_pledges.tenant_id', '=', tenantId)
      .$if(campaignId != null, (b) => b.where('donation_pledges.campaign_id', '=', String(campaignId)))
      .orderBy('donation_pledges.created_at', 'desc')
      .execute();
  }

  public async getForPerson(tenantId: string, personId: string): Promise<Selectable<Models['donation_pledges']>[]> {
    return this.db
      .selectFrom('donation_pledges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  /**
   * Sum of monthly_amount for all active pledges for a person.
   * Used for conservative limit enforcement: counts committed future payments.
   */
  public async getActivePledgeMonthlyTotal(tenantId: string, personId: string): Promise<number> {
    const result = await this.db
      .selectFrom('donation_pledges')
      .select(({ fn }) => [fn.sum<string | number>('monthly_amount').as('total')])
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    return Number(result?.total || 0);
  }
}
