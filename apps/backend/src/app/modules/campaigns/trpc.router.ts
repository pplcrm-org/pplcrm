import { z } from 'zod';

import {
  AddCampaignObj,
  CarryOverCampaignObj,
  SeatAreaSuggestionsObj,
  SetCampaignSubscriptionObj,
  UpdateCampaignObj,
  UpsertCampaignPersonFactObj,
  idSchema,
} from '../../../../../../libs/common/src';

import { adminOrOwnerProcedure, authProcedure, router } from '../../../trpc';
import { CampaignsController } from './controller';
import { createCrudRouter } from '../../lib/crud-router';

const campaigns = new CampaignsController();

// Campaign management (create/edit/archive/browse) is admin/owner-only; ordinary
// users are assigned to a campaign by an admin and cannot change contexts.
const crud = createCrudRouter(campaigns, AddCampaignObj, UpdateCampaignObj, adminOrOwnerProcedure);

export const CampaignsRouter = router({
  ...crud,

  add: adminOrOwnerProcedure.input(AddCampaignObj).mutation(({ input, ctx }) => campaigns.addCampaign(input, ctx.auth)),

  /** The CRUD router's alias for `add`; pointed at the same handler so it cannot skip its checks. */
  create: adminOrOwnerProcedure
    .input(AddCampaignObj)
    .mutation(({ input, ctx }) => campaigns.addCampaign(input, ctx.auth)),

  /**
   * Replaces the generic CRUD update so an edit that changes the office is checked against the
   * whole office block, not only the fields the form happened to send.
   */
  update: adminOrOwnerProcedure
    .input(z.object({ id: idSchema, data: UpdateCampaignObj }))
    .mutation(({ input, ctx }) => campaigns.updateCampaign(input.id, input.data, ctx.auth)),

  /** Lightweight list for campaign management and assignment pickers (admin/owner). */
  getSwitcherList: adminOrOwnerProcedure.query(({ ctx }) => campaigns.getSwitcherList(ctx.auth)),

  /**
   * Context payload. Admins/owners get every campaign + their active context id;
   * Editors/Viewers get exactly their assigned campaign (or the office).
   */
  getContext: authProcedure.query(({ ctx }) => campaigns.getContext(ctx.auth)),

  /** Only admins/owners switch contexts — everyone else is pinned to their assigned campaign. */
  setActiveCampaign: adminOrOwnerProcedure
    .input(idSchema)
    .mutation(({ input, ctx }) => campaigns.setActiveCampaign(input, ctx.auth)),

  archive: adminOrOwnerProcedure.input(idSchema).mutation(({ input, ctx }) => campaigns.archive(input, ctx.auth)),

  /** The areas a campaign represents — one riding, or the several wards that elect one councillor. */
  getAreas: adminOrOwnerProcedure
    .input(idSchema)
    .query(({ input, ctx }) => campaigns.getCampaignAreas(ctx.auth, input)),

  /**
   * Area names to offer in the campaign form, from whichever map covers this office.
   *
   * Read rather than guessed, and NOT limited to published maps: municipal wards are the case with
   * no publisher, so a workspace's own drawn or uploaded ward map is the only source there.
   */
  areaSuggestions: adminOrOwnerProcedure
    .input(SeatAreaSuggestionsObj)
    .query(({ input, ctx }) => campaigns.getAreaSuggestions(ctx.auth, input)),

  /** Set/clear a person's support level / voting status in one campaign (§15). */
  upsertPersonFact: authProcedure
    .input(UpsertCampaignPersonFactObj)
    .mutation(({ input, ctx }) => campaigns.upsertPersonFact(input, ctx.auth)),

  /** One person's facts across all campaigns (history panel). */
  getPersonFacts: authProcedure.input(idSchema).query(({ input, ctx }) => campaigns.getPersonFacts(input, ctx.auth)),

  /** Staff subscribe/unsubscribe in one campaign (§15). */
  setSubscription: authProcedure
    .input(SetCampaignSubscriptionObj)
    .mutation(({ input, ctx }) => campaigns.setSubscription(input, ctx.auth)),

  /** Consent panel payload: per-campaign rows + global suppressions + DNC. */
  getPersonSubscriptions: authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => campaigns.getPersonSubscriptions(input, ctx.auth)),

  unarchive: adminOrOwnerProcedure.input(idSchema).mutation(({ input, ctx }) => campaigns.unarchive(input, ctx.auth)),

  /** Seed a campaign from a prior one (§15) — support as assumption, consent only with confirmation. */
  carryOver: adminOrOwnerProcedure
    .input(CarryOverCampaignObj)
    .mutation(({ input, ctx }) => campaigns.carryOver(input, ctx.auth)),
});
