import { z } from 'zod';

import { idSchema } from '../../../../../../libs/common/src';
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
