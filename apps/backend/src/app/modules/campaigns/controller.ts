import { sql } from 'kysely';

import type {
  AddCampaignType,
  CarryOverCampaignType,
  IAuthKeyPayload,
  SetCampaignSubscriptionType,
  UpsertCampaignPersonFactType,
} from '../../../../../../libs/common/src';

import { BadRequestError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { logger } from '../../logger';
import { parseProfilePreferences } from '../../lib/profile-preferences';
import { DeliveriesController } from '../deliveries/controller';
import { WorkflowsController } from '../workflows/controller';
import { UserProfiles } from '../userprofiles/repositories/userprofiles.repo';
import { CampaignPersonFactsRepo } from './repositories/campaign-person-facts.repo';
import { CampaignSubscriptionsRepo } from './repositories/campaign-subscriptions.repo';
import { CampaignsRepo } from './repositories/campaigns.repo';
import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';

/**
 * Campaigns §15 — contexts. A tenant always has exactly one permanent 'office'
 * context (created at signup); election campaigns come and go around it. Campaigns
 * are never hard-deleted: their id is referenced as provenance and (in later phases)
 * by campaign-scoped facts, so retiring one is always `archive`.
 */
export class CampaignsController extends BaseController<'campaigns', CampaignsRepo> {
  private readonly profilesRepo = new UserProfiles();
  private readonly factsRepo = new CampaignPersonFactsRepo();
  private readonly subsRepo = new CampaignSubscriptionsRepo();
  private readonly workflows = new WorkflowsController();

  constructor() {
    super(new CampaignsRepo());
  }

  /**
   * One round-trip for the context payload.
   *
   * Admins/owners: every campaign plus the id of the context they are working
   * in. Their stored preference wins when it still points at an existing
   * campaign; otherwise fall back to the office context (which always exists).
   * Archived campaigns remain selectable — they are viewable read-only history.
   *
   * Editors/Viewers: exactly their admin-assigned campaign (§15 — they belong to
   * one campaign and cannot switch). Unassigned, archived, or dangling
   * assignments resolve to the office context.
   */
  public async getContext(auth: IAuthKeyPayload) {
    const campaigns = await this.getRepo().getSwitcherList({ tenant_id: auth.tenant_id });
    const isAdmin = auth.role === 'admin' || auth.role === 'owner';

    if (!isAdmin) {
      const me = await this.getRepo()
        .db.selectFrom('authusers')
        .select('campaign_id')
        .where('tenant_id', '=', auth.tenant_id)
        .where('id', '=', auth.user_id)
        .executeTakeFirst();
      const assignedId = me?.campaign_id != null ? String(me.campaign_id) : null;
      const assigned =
        (assignedId ? campaigns.find((c) => String(c.id) === assignedId && c.status === 'active') : undefined) ??
        campaigns.find((c) => c.kind === 'office') ??
        campaigns[0];
      return {
        campaigns: assigned ? [this.toContextItem(assigned)] : [],
        active_campaign_id: assigned ? String(assigned.id) : null,
      };
    }

    const profile = await this.profilesRepo.getOneByAuthId(auth.user_id);
    const preferred = parseProfilePreferences(profile?.preferences)?.active_campaign_id;
    const active =
      (preferred ? campaigns.find((c) => String(c.id) === preferred) : undefined) ??
      campaigns.find((c) => c.kind === 'office') ??
      campaigns[0];
    return {
      campaigns: campaigns.map((c) => this.toContextItem(c)),
      active_campaign_id: active ? String(active.id) : null,
    };
  }

  public async setActiveCampaign(id: string, auth: IAuthKeyPayload) {
    await this.getCampaignOrThrow(auth.tenant_id, id);
    const profile = await this.profilesRepo.getOneByAuthId(auth.user_id);
    if (profile) {
      const prefs = (parseProfilePreferences(profile.preferences) ?? {}) as Record<string, unknown>;
      prefs['active_campaign_id'] = String(id);
      await this.profilesRepo.update({
        tenant_id: auth.tenant_id,
        id: String(profile.id),
        row: {
          preferences: JSON.stringify(prefs),
          updatedby_id: auth.user_id,
        } as OperationDataType<'profiles', 'update'>,
      });
    }
    return { active_campaign_id: String(id) };
  }

  public async addCampaign(input: AddCampaignType, auth: IAuthKeyPayload) {
    if (input.kind === 'office') {
      const office = await this.findOffice(auth.tenant_id);
      if (office) throw new BadRequestError('There is already an office context for this organization.');
    }
    const row = {
      tenant_id: auth.tenant_id,
      admin_id: auth.user_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      name: input.name,
      description: input.description ?? null,
      notes: input.notes ?? null,
      kind: input.kind,
      status: 'active',
      startdate: input.startdate ?? null,
      enddate: input.enddate ?? null,
    } as OperationDataType<'campaigns', 'insert'>;
    return this.add(row);
  }

  public async archive(id: string, auth: IAuthKeyPayload) {
    const campaign = await this.getCampaignOrThrow(auth.tenant_id, id);
    if (campaign.kind === 'office') {
      throw new BadRequestError('The office context cannot be archived. It is the permanent workspace.');
    }
    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // Members assigned to this campaign fall back to the office context —
        // an archived campaign is read-only history nobody can work in (§15).
        await trx
          .updateTable('authusers')
          .set({ campaign_id: null, updated_at: new Date(), updatedby_id: auth.user_id })
          .where('tenant_id', '=', auth.tenant_id)
          .where('campaign_id', '=', id)
          .execute();
        // Open yard-sign requests would otherwise hold the one-open-request-per-household
        // slot forever (archived = read-only, so they can never reach a terminal status).
        await new DeliveriesController().closeCampaignDeliveries(trx, auth, id);
        return this.getRepo().update(
          {
            tenant_id: auth.tenant_id,
            id,
            row: { status: 'archived', updatedby_id: auth.user_id } as OperationDataType<'campaigns', 'update'>,
          },
          trx,
        );
      });
  }

  public async unarchive(id: string, auth: IAuthKeyPayload) {
    await this.getCampaignOrThrow(auth.tenant_id, id);
    return this.update({
      tenant_id: auth.tenant_id,
      id,
      row: { status: 'active', updatedby_id: auth.user_id } as OperationDataType<'campaigns', 'update'>,
    });
  }

  public async getSwitcherList(auth: IAuthKeyPayload) {
    return this.getRepo().getSwitcherList({ tenant_id: auth.tenant_id });
  }

  /**
   * Set/clear a person's support level and/or voting status in one campaign
   * (§15). Manual edits only — canvassing and forms write through their own
   * paths with their own `source`. The fact change is logged against the person
   * so it shows in that record's activity feed.
   */
  public async upsertPersonFact(input: UpsertCampaignPersonFactType, auth: IAuthKeyPayload) {
    await this.getRepo().assertWritable({ tenant_id: auth.tenant_id, campaign_id: input.campaign_id });
    const result = await this.factsRepo.upsertFact({
      tenant_id: auth.tenant_id,
      campaign_id: input.campaign_id,
      person_id: input.person_id,
      user_id: auth.user_id,
      support_level: input.support_level,
      voting_status: input.voting_status,
      source: 'manual',
    });
    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'persons',
        entity_id: input.person_id,
        quantity: 1,
        metadata: {
          campaign_id: input.campaign_id,
          ...(input.support_level !== undefined ? { support_level: input.support_level } : {}),
          ...(input.voting_status !== undefined ? { voting_status: input.voting_status } : {}),
        },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log person-fact activity');
    }
    return result;
  }

  /** One person's facts across every campaign — the cross-campaign history panel. */
  public async getPersonFacts(personId: string, auth: IAuthKeyPayload) {
    return this.factsRepo.getForPerson({ tenant_id: auth.tenant_id, person_id: personId });
  }

  /**
   * Staff subscribe/unsubscribe for one campaign (§15). Manual consent — forms
   * and SendGrid events write through their own paths. Fires the same
   * new_subscriber / new_unsubscriber automations the legacy tags used to.
   */
  public async setSubscription(input: SetCampaignSubscriptionType, auth: IAuthKeyPayload) {
    await this.getRepo().assertWritable({ tenant_id: auth.tenant_id, campaign_id: input.campaign_id });

    const person = await this.subsRepo.db
      .selectFrom('persons')
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', input.person_id)
      .select(['id', 'email'])
      .executeTakeFirst();
    if (!person) throw new NotFoundError('Person not found');
    if (!person.email) {
      throw new BadRequestError('This person has no email address, so there is nothing to subscribe.');
    }

    const result = await this.subsRepo.setStatus({
      tenant_id: auth.tenant_id,
      campaign_id: input.campaign_id,
      person_id: input.person_id,
      email: person.email,
      status: input.status,
      consent_source: 'manual',
      user_id: auth.user_id,
    });

    try {
      await this.workflows.triggerSubscriptionChanged(auth.tenant_id, input.person_id, input.status);
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'persons',
        entity_id: input.person_id,
        quantity: 1,
        metadata: { campaign_id: input.campaign_id, subscription: input.status },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to run subscription side-effects');
    }
    return result;
  }

  /**
   * The person page's consent panel: per-campaign subscription rows plus the
   * global layers (address suppressions + DNC) needed to derive sendability.
   */
  public async getPersonSubscriptions(personId: string, auth: IAuthKeyPayload) {
    const person = await this.subsRepo.db
      .selectFrom('persons')
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', personId)
      .select(['id', 'email', 'do_not_contact', 'do_not_contact_channels'])
      .executeTakeFirst();
    if (!person) throw new NotFoundError('Person not found');

    const subscriptions = await this.subsRepo.getForPerson({ tenant_id: auth.tenant_id, person_id: personId });
    const suppressions = person.email
      ? await this.subsRepo.getSuppressions({ tenant_id: auth.tenant_id, email: person.email })
      : [];
    return {
      email: person.email,
      do_not_contact: person.do_not_contact,
      do_not_contact_channels: person.do_not_contact_channels,
      subscriptions,
      suppressions,
    };
  }

  /**
   * Carry-over (§15): seed the target campaign from a prior one, atomically.
   *  - Support levels copy as a starting assumption (source='carryover');
   *    rows the target already has are never clobbered.
   *  - Voting status NEVER copies — it is election-specific by definition.
   *  - Subscriptions copy only behind the caller's explicit compliance
   *    confirmation (consent_source='copied', original consent_at preserved) —
   *    consent given to one entity is the caller's judgment to reuse.
   */
  public async carryOver(input: CarryOverCampaignType, auth: IAuthKeyPayload) {
    if (input.source_campaign_id === input.target_campaign_id) {
      throw new BadRequestError('Pick a different campaign to carry over from.');
    }
    await this.getRepo().assertWritable({ tenant_id: auth.tenant_id, campaign_id: input.target_campaign_id });
    await this.getCampaignOrThrow(auth.tenant_id, input.source_campaign_id);

    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        let supportCopied = 0;
        let subscriptionsCopied = 0;

        if (input.copy_support) {
          const inserted = await sql<{ id: string }>`
            INSERT INTO campaign_person_facts
              (tenant_id, campaign_id, person_id, createdby_id, updatedby_id,
               support_level, support_source, support_recorded_by, support_recorded_at)
            SELECT tenant_id, ${input.target_campaign_id}, person_id, ${auth.user_id}, ${auth.user_id},
                   support_level, 'carryover', ${auth.user_id}, now()
            FROM campaign_person_facts
            WHERE tenant_id = ${auth.tenant_id}
              AND campaign_id = ${input.source_campaign_id}
              AND support_level IS NOT NULL
            ON CONFLICT (tenant_id, campaign_id, person_id) DO NOTHING
            RETURNING id
          `.execute(trx);
          supportCopied = inserted.rows.length;
        }

        if (input.copy_subscriptions) {
          const inserted = await sql<{ id: string }>`
            INSERT INTO campaign_subscriptions
              (tenant_id, campaign_id, person_id, createdby_id, updatedby_id,
               email, status, consent_source, consent_at)
            SELECT tenant_id, ${input.target_campaign_id}, person_id, ${auth.user_id}, ${auth.user_id},
                   email, 'subscribed', 'copied', consent_at
            FROM campaign_subscriptions
            WHERE tenant_id = ${auth.tenant_id}
              AND campaign_id = ${input.source_campaign_id}
              AND status = 'subscribed'
            ON CONFLICT (tenant_id, campaign_id, person_id) DO NOTHING
            RETURNING id
          `.execute(trx);
          subscriptionsCopied = inserted.rows.length;
        }

        try {
          await this.userActivity.log(
            {
              tenant_id: auth.tenant_id,
              user_id: auth.user_id,
              activity: 'update',
              entity: 'campaigns',
              entity_id: input.target_campaign_id,
              quantity: 1,
              metadata: {
                carry_over_from: input.source_campaign_id,
                support_copied: supportCopied,
                subscriptions_copied: subscriptionsCopied,
              },
            },
            trx,
          );
        } catch (e) {
          logger.error({ err: e }, 'Failed to log carry-over activity');
        }

        return { support_copied: supportCopied, subscriptions_copied: subscriptionsCopied };
      });
  }

  public override async delete(): Promise<never> {
    throw new BadRequestError('Campaigns cannot be deleted. Archive them instead.');
  }

  public override async deleteMany(): Promise<never> {
    throw new BadRequestError('Campaigns cannot be deleted. Archive them instead.');
  }

  private toContextItem(c: Awaited<ReturnType<CampaignsRepo['getSwitcherList']>>[number]) {
    return {
      id: String(c.id),
      name: c.name,
      kind: c.kind,
      status: c.status,
      startdate: c.startdate,
      enddate: c.enddate,
    };
  }

  private async getCampaignOrThrow(tenant_id: string, id: string) {
    const rows = await this.getRepo().getSwitcherList({ tenant_id });
    const campaign = rows.find((c) => String(c.id) === String(id));
    if (!campaign) throw new NotFoundError('Campaign not found');
    return campaign;
  }

  private async findOffice(tenant_id: string) {
    const rows = await this.getRepo().getSwitcherList({ tenant_id });
    return rows.find((c) => c.kind === 'office');
  }
}
