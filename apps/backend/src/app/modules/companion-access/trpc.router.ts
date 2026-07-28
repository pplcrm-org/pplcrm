import { z } from 'zod';

import { AddJoinCodeObj, UpdateJoinCodeObj, idSchema } from '../../../../../../libs/common/src';
import { adminOrOwnerProcedure as baseAdminOrOwnerProcedure, authProcedure, router } from '../../../trpc';
import { planFeatureGate } from '../billing/plan-gate';
import { CompanionAccessController } from './controller';

const controller = new CompanionAccessController();

// FEATURE_MATRIX plan gate: companion volunteer access is Movement-only — the surfaces that
// mint volunteer links (turf assignments, delivery routes) are Movement-gated, so approvals
// below Movement would be a dead end. Staff-side volunteer management (teams, volunteer
// events) stays on the Grassroots 'volunteers' gate.
const adminOrOwnerProcedure = baseAdminOrOwnerProcedure.use(planFeatureGate('companions'));

/** Staff surface for the companion access layer: the Volunteer access page. */
export const CompanionAccessRouter = router({
  getAll: authProcedure.query(({ ctx }) => controller.getAllVolunteers(ctx.auth.tenant_id)),
  pendingCount: authProcedure.query(({ ctx }) => controller.pendingCount(ctx.auth.tenant_id)),
  approve: adminOrOwnerProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => controller.approveVolunteer(ctx.auth, input.id)),
  revoke: adminOrOwnerProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => controller.revokeVolunteer(ctx.auth, input.id)),
  // Per-volunteer override for the workspace roam setting; null = follow the workspace.
  setRoam: adminOrOwnerProcedure
    .input(z.object({ id: idSchema, can_roam: z.boolean().nullable() }))
    .mutation(({ ctx, input }) => controller.setVolunteerRoam(ctx.auth, input.id, input.can_roam)),
});

/**
 * QR join codes — the front door for volunteers who are not in the database yet.
 *
 * Reads are `authProcedure` (any staff member can show the QR at a launch); anything that
 * mints, edits or kills a code is admin/owner and plan-gated, because a live code is a
 * standing invitation into the workspace.
 */
export const JoinCodesRouter = router({
  getForCampaign: authProcedure
    .input(z.object({ campaign_id: idSchema.nullable() }))
    .query(({ ctx, input }) => controller.getJoinCodes(ctx.auth, input.campaign_id)),
  qr: authProcedure
    .input(z.object({ id: idSchema }))
    .query(({ ctx, input }) => controller.joinCodeQr(ctx.auth, input.id)),
  create: adminOrOwnerProcedure
    .input(AddJoinCodeObj)
    .mutation(({ ctx, input }) => controller.createJoinCode(ctx.auth, input)),
  update: adminOrOwnerProcedure
    .input(z.object({ id: idSchema, data: UpdateJoinCodeObj }))
    .mutation(({ ctx, input }) => controller.updateJoinCode(ctx.auth, input.id, input.data)),
  // Texts the CALLER (never a typed number) the organizer page for this code — the QR to
  // hold up plus the people waiting. A mutation because it mints a credential and spends
  // an SMS, and admin/owner because that credential can approve volunteers.
  sendToMyPhone: adminOrOwnerProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => controller.sendJoinCodeToPhone(ctx.auth, input.id)),
  // Kills whatever is printed on the poster — the UI confirms before calling this.
  rotate: adminOrOwnerProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => controller.rotateJoinCode(ctx.auth, input.id)),
  revoke: adminOrOwnerProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => controller.revokeJoinCode(ctx.auth, input.id)),
});
