import { z } from 'zod';

import {
  AddTurfObj,
  AssignTurfObj,
  CutTurfsObj,
  FieldReportRangeObj,
  RemoveCanvasserObj,
  UpdateCompanionSettingsObj,
  UpdateTurfObj,
  idSchema,
} from '../../../../../../libs/common/src';

import {
  adminOrOwnerProcedure as baseAdminOrOwnerProcedure,
  authProcedure as baseAuthProcedure,
  router,
} from '../../../trpc';
import { planFeatureGate } from '../billing/plan-gate';
import { CanvassingController } from './controller';

const controller = new CanvassingController();

// FEATURE_MATRIX plan gate: canvassing is Movement-only; mutations below are blocked on lower plans.
const authProcedure = baseAuthProcedure.use(planFeatureGate('canvassing'));
const adminOrOwnerProcedure = baseAdminOrOwnerProcedure.use(planFeatureGate('canvassing'));

export const CanvassingRouter = router({
  // Turfs & assignments page.
  getTurfs: authProcedure.query(({ ctx }) => controller.getTurfs(ctx.auth)),
  getFieldSummary: authProcedure.query(({ ctx }) => controller.getFieldSummary(ctx.auth)),
  getInFieldToday: authProcedure.query(({ ctx }) => controller.getInFieldToday(ctx.auth)),

  // One turf, opened: its doors, what happened at each, and who is walking it.
  getTurfDetail: authProcedure.input(idSchema).query(({ ctx, input }) => controller.getTurfDetail(ctx.auth, input)),

  // Cut new turfs.
  previewCut: authProcedure.input(CutTurfsObj).query(({ ctx, input }) => controller.previewCut(ctx.auth, input)),
  cutTurfs: authProcedure.input(CutTurfsObj).mutation(({ ctx, input }) => controller.cutTurfs(ctx.auth, input)),
  refreshFromList: authProcedure
    .input(idSchema)
    .mutation(({ ctx, input }) => controller.refreshFromList(ctx.auth, input)),

  // Turf CRUD + lifecycle.
  addTurf: authProcedure.input(AddTurfObj).mutation(({ ctx, input }) => controller.addTurf(ctx.auth, input)),
  updateTurf: authProcedure
    .input(z.object({ id: idSchema, data: UpdateTurfObj }))
    .mutation(({ ctx, input }) => controller.updateTurf(ctx.auth, input.id, input.data)),
  assign: authProcedure.input(AssignTurfObj).mutation(({ ctx, input }) => controller.assignTurf(ctx.auth, input)),
  retire: authProcedure.input(idSchema).mutation(({ ctx, input }) => controller.retireTurf(ctx.auth, input)),

  // Turf roster: several volunteers can walk one turf, so membership is add/remove
  // rather than a single swap.
  getCanvassers: authProcedure.input(idSchema).query(({ ctx, input }) => controller.getTurfCanvassers(ctx.auth, input)),
  removeCanvasser: authProcedure
    .input(RemoveCanvasserObj)
    .mutation(({ ctx, input }) => controller.removeVolunteerFromTurf(ctx.auth, input)),

  // Companion survey vocabulary (issues chips + door script), campaign-scoped.
  getCompanionSettings: authProcedure
    .input(z.object({ campaign_id: idSchema.optional() }).optional())
    .query(({ ctx, input }) => controller.getCompanionSettings(ctx.auth, input?.campaign_id)),
  updateCompanionSettings: adminOrOwnerProcedure
    .input(UpdateCompanionSettingsObj)
    .mutation(({ ctx, input }) => controller.updateCompanionSettings(ctx.auth, input)),

  // Field report.
  getFieldReport: authProcedure
    .input(FieldReportRangeObj)
    .query(({ ctx, input }) => controller.getFieldReport(ctx.auth, input)),
  exportFieldReport: authProcedure
    .input(FieldReportRangeObj)
    .query(({ ctx, input }) => controller.exportFieldReportCsv(ctx.auth, input)),
  getCoverage: authProcedure
    .input(FieldReportRangeObj)
    .query(({ ctx, input }) => controller.getCoverage(ctx.auth, input)),
});
