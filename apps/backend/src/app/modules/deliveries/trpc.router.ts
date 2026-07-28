import {
  AddDeliveryRequestObj,
  AssignVolunteerObj,
  CommitDeliveriesObj,
  GetSignStatusObj,
  MintShareLinkObj,
  PlanDeliveriesObj,
  ReorderStopObj,
  ReorderStopsObj,
  RouteIdObj,
  SetDeliveryRequestStatusObj,
  SetRouteDefaultsObj,
  SetDeliveryRouteStatusObj,
  StopActionObj,
  UpdateDeliveryRequestObj,
  UpdateDeliveryRouteObj,
  getAllOptions,
  idSchema,
} from '../../../../../../libs/common/src';

import { z } from 'zod';

import { adminOrOwnerProcedure as baseAdminProcedure, authProcedure as baseAuthProcedure, router } from '../../../trpc';
import { planFeatureGate } from '../billing/plan-gate';
import { DeliveriesController } from './controller';

const controller = new DeliveriesController();

// FEATURE_MATRIX plan gate: deliveries are Movement-only; mutations below are blocked on lower plans.
const authProcedure = baseAuthProcedure.use(planFeatureGate('deliveries'));
// Workspace-level planning defaults are admin config, not something an organizer flips per plan.
const adminProcedure = baseAdminProcedure.use(planFeatureGate('deliveries'));

export const DeliveriesRouter = router({
  // Requests
  getAllRequests: authProcedure
    .input(getAllOptions.optional())
    .query(({ ctx, input }) => controller.getAllRequests(ctx.auth.tenant_id, input)),
  getRequestCounts: authProcedure.query(({ ctx }) => controller.getRequestCounts(ctx.auth.tenant_id)),
  getReadyCount: authProcedure.query(({ ctx }) => controller.getReadyCount(ctx.auth.tenant_id)),
  getSignStatus: authProcedure
    .input(GetSignStatusObj)
    .query(({ ctx, input }) => controller.getSignStatus(ctx.auth, input)),
  addRequest: authProcedure
    .input(AddDeliveryRequestObj)
    .mutation(({ ctx, input }) => controller.addRequest(ctx.auth, input)),
  updateRequestNotes: authProcedure
    .input(z.object({ id: idSchema, data: UpdateDeliveryRequestObj }))
    .mutation(({ ctx, input }) => controller.updateRequestNotes(ctx.auth, input.id, input.data)),
  setRequestStatus: authProcedure
    .input(SetDeliveryRequestStatusObj)
    .mutation(({ ctx, input }) => controller.setRequestStatus(ctx.auth, input)),

  // Planning
  getRouteDefaults: authProcedure.query(({ ctx }) => controller.getRouteDefaults(ctx.auth.tenant_id)),
  setRouteDefaults: adminProcedure
    .input(SetRouteDefaultsObj)
    .mutation(({ ctx, input }) => controller.setRouteDefaults(ctx.auth, input)),
  previewPlan: authProcedure
    .input(PlanDeliveriesObj)
    .mutation(({ ctx, input }) => controller.previewPlan(ctx.auth, input)),
  commitPlan: authProcedure
    .input(CommitDeliveriesObj)
    .mutation(({ ctx, input }) => controller.commitPlan(ctx.auth, input)),

  // Routes
  getAllRoutes: authProcedure
    .input(getAllOptions.optional())
    .query(({ ctx, input }) => controller.getAllRoutes(ctx.auth.tenant_id, input)),
  getRouteById: authProcedure.input(idSchema).query(({ ctx, input }) => controller.getRouteById(ctx.auth, input)),
  updateRoute: authProcedure
    .input(z.object({ id: idSchema, data: UpdateDeliveryRouteObj }))
    .mutation(({ ctx, input }) => controller.updateRoute(ctx.auth, input.id, input.data)),
  assignVolunteer: authProcedure
    .input(AssignVolunteerObj)
    .mutation(({ ctx, input }) => controller.assignVolunteer(ctx.auth, input)),
  resendVolunteerLink: authProcedure
    .input(RouteIdObj)
    .mutation(({ ctx, input }) => controller.resendVolunteerLink(ctx.auth, input.route_id)),
  setRouteStatus: authProcedure
    .input(SetDeliveryRouteStatusObj)
    .mutation(({ ctx, input }) => controller.setRouteStatus(ctx.auth, input)),
  deleteRoute: authProcedure.input(idSchema).mutation(({ ctx, input }) => controller.deleteRoute(ctx.auth, input)),
  stopAction: authProcedure.input(StopActionObj).mutation(({ ctx, input }) => controller.stopAction(ctx.auth, input)),
  reorderStop: authProcedure
    .input(ReorderStopObj)
    .mutation(({ ctx, input }) => controller.reorderStop(ctx.auth, input)),
  reorderStops: authProcedure
    .input(ReorderStopsObj)
    .mutation(({ ctx, input }) => controller.reorderStops(ctx.auth, input)),
  mintShareLink: authProcedure
    .input(MintShareLinkObj)
    .mutation(({ ctx, input }) => controller.mintShareLink(ctx.auth, input)),
  revokeShareLink: authProcedure
    .input(RouteIdObj)
    .mutation(({ ctx, input }) => controller.revokeShareLink(ctx.auth, input.route_id)),
});
