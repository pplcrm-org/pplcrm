import {
  AddDeliveryRequestObj,
  AddDeliveryRequestsFromListObj,
  GetSignStatusObj,
  SetDeliveryRequestStatusObj,
  UpdateDeliveryRequestObj,
  getAllOptions,
  idSchema,
} from '../../../../../../libs/common/src';

import { z } from 'zod';

import { authProcedure as baseAuthProcedure, router } from '../../../trpc';
import { planFeatureGate } from '../billing/plan-gate';
import { DeliveriesController } from './controller';

const controller = new DeliveriesController();

// FEATURE_MATRIX plan gate: deliveries are Movement-only; mutations below are blocked on lower plans.
const authProcedure = baseAuthProcedure.use(planFeatureGate('deliveries'));

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
  addRequestsFromList: authProcedure
    .input(AddDeliveryRequestsFromListObj)
    .mutation(({ ctx, input }) => controller.addRequestsFromList(ctx.auth, input)),
  updateRequestNotes: authProcedure
    .input(z.object({ id: idSchema, data: UpdateDeliveryRequestObj }))
    .mutation(({ ctx, input }) => controller.updateRequestNotes(ctx.auth, input.id, input.data)),
  setRequestStatus: authProcedure
    .input(SetDeliveryRequestStatusObj)
    .mutation(({ ctx, input }) => controller.setRequestStatus(ctx.auth, input)),

  // The planning/routes half of this router retired with the turfs-absorb-deliveries
  // Phase 4: delivery work goes out as delivery-mode turfs on the canvassing router.
});
