import type { Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

/**
 * Per-campaign email consent (§15). One row per (campaign, person); no row means
 * "never asked" (not sendable). Address health (bounces/spam) lives in
 * email_suppressions; the person-level DNC flag lives on persons — sendability
 * is the AND of all three, computed where recipients are selected.
 */
export class CampaignSubscriptionsRepo extends BaseRepository<'campaign_subscriptions'> {
  constructor() {
    super('campaign_subscriptions');
  }

  public async setStatus(
    input: {
      tenant_id: string;
      campaign_id: string;
      person_id: string;
      email: string;
      status: 'subscribed' | 'pending' | 'unsubscribed';
      consent_source: 'form' | 'import' | 'manual' | 'copied' | 'canvass';
      user_id: string;
    },
    trx?: Transaction<Models>,
  ) {
    const now = new Date();
    // `consent_at` and `consent_source` are the evidence that consent was given, so they are
    // written ONLY on the transition to 'subscribed'. Unsubscribing used to null `consent_at` and
    // overwrite `consent_source`, which destroyed the proof of the original opt-in at exactly the
    // moment it is most likely to be asked for; it now records only the new status and the time.
    // On a first-ever non-subscribed row there is nothing to preserve and the columns take their
    // defaults (consent_at NULL, consent_source 'manual' — which is what every caller that passes
    // a non-subscribed status passes anyway).
    const consentFields =
      input.status === 'subscribed' ? { consent_at: now, consent_source: input.consent_source } : {};
    const statusFields = {
      status: input.status,
      email: input.email,
      unsubscribed_at: input.status === 'unsubscribed' ? now : null,
      ...consentFields,
    };
    const row = {
      tenant_id: input.tenant_id,
      campaign_id: input.campaign_id,
      person_id: input.person_id,
      createdby_id: input.user_id,
      updatedby_id: input.user_id,
      ...statusFields,
    } as OperationDataType<'campaign_subscriptions', 'insert'>;

    return this.getInsert(trx)
      .values(row)
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'campaign_id', 'person_id']).doUpdateSet({
          ...statusFields,
          updatedby_id: input.user_id,
          updated_at: now,
        }),
      )
      .returningAll()
      .executeTakeFirst();
  }

  /** Confirm a double opt-in: every pending row for this person becomes subscribed. */
  public async confirmPending(input: { tenant_id: string; person_id: string }, trx?: Transaction<Models>) {
    const now = new Date();
    return this.getUpdate(trx)
      .set({ status: 'subscribed', consent_at: now, updated_at: now })
      .where('tenant_id', '=', input.tenant_id)
      .where('person_id', '=', input.person_id)
      .where('status', '=', 'pending')
      .execute();
  }

  /** SendGrid unsubscribe: scoped to the campaign whose newsletter carried the link. */
  public async unsubscribeByEmail(
    input: { tenant_id: string; campaign_id: string; email: string },
    trx?: Transaction<Models>,
  ) {
    const now = new Date();
    return this.getUpdate(trx)
      .set({ status: 'unsubscribed', unsubscribed_at: now, updated_at: now })
      .where('tenant_id', '=', input.tenant_id)
      .where('campaign_id', '=', input.campaign_id)
      .where('email', '=', input.email)
      .where('status', '!=', 'unsubscribed')
      .execute();
  }

  /** One person's consent rows across campaigns, with campaign labels (person page panel). */
  public async getForPerson(input: { tenant_id: string; person_id: string }, trx?: Transaction<Models>) {
    return this.getSelect(trx)
      .innerJoin('campaigns', 'campaigns.id', 'campaign_subscriptions.campaign_id')
      .where('campaign_subscriptions.tenant_id', '=', input.tenant_id)
      .where('campaign_subscriptions.person_id', '=', input.person_id)
      .select([
        'campaign_subscriptions.campaign_id',
        'campaign_subscriptions.email',
        'campaign_subscriptions.status',
        'campaign_subscriptions.consent_source',
        'campaign_subscriptions.consent_at',
        'campaign_subscriptions.unsubscribed_at',
        'campaigns.name as campaign_name',
        'campaigns.kind as campaign_kind',
        'campaigns.status as campaign_status',
      ])
      .orderBy('campaigns.created_at', 'desc')
      .execute();
  }

  /** Active suppressions for one email address (any reason). */
  public async getSuppressions(input: { tenant_id: string; email: string }, trx?: Transaction<Models>) {
    return (trx ?? this.db)
      .selectFrom('email_suppressions')
      .where('tenant_id', '=', input.tenant_id)
      .where('email', '=', input.email)
      .select(['reason', 'occurred_at'])
      .execute();
  }
}
