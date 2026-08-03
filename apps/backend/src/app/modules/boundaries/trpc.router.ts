import { z } from 'zod';

import { idSchema } from '../../../../../../libs/common/src';
import {
  AddBoundaryFeatureObj,
  AddDrawnBoundarySetObj,
  UpdateBoundaryFeatureObj,
  UploadBoundarySetObj,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { adminOrOwnerProcedure, authProcedure, router } from '../../../trpc';
import { BoundariesController } from './controller';

const controller = new BoundariesController();

/**
 * Boundary sets.
 *
 * Reads are open to any signed-in member, because seeing which map a workspace uses is part of
 * reading a household. Every mutation is admin-or-owner: a boundary set is workspace-wide
 * configuration, and one redrawn ward changes which turf every door falls in.
 *
 * There is deliberately no plan gate here. The gate that exists next door
 * (`planAllowsGeocoding`) controls spend on the Google Geocoding API; nothing in this router calls
 * a paid service, because matching re-reads coordinates already on file. Gating a free operation
 * would restrict a workspace without any cost behind the restriction. The abuse ceiling is instead
 * the caps in `boundaries.schema.ts`, which bound the CPU one workspace can ask for.
 */

function listSets() {
  return authProcedure.query(({ ctx }) => controller.listSets(ctx.auth));
}

function listFeatures() {
  return authProcedure
    .input(z.object({ setId: idSchema }))
    .query(({ ctx, input }) => controller.listFeatures(ctx.auth, input.setId));
}

function createDrawn() {
  return adminOrOwnerProcedure
    .input(AddDrawnBoundarySetObj)
    .mutation(({ ctx, input }) => controller.createDrawnSet(ctx.auth, input));
}

function upload() {
  return adminOrOwnerProcedure
    .input(UploadBoundarySetObj)
    .mutation(({ ctx, input }) => controller.uploadSet(ctx.auth, input));
}

function deleteSet() {
  return adminOrOwnerProcedure
    .input(z.object({ setId: idSchema }))
    .mutation(({ ctx, input }) => controller.deleteSet(ctx.auth, input.setId));
}

function addFeature() {
  return adminOrOwnerProcedure
    .input(AddBoundaryFeatureObj)
    .mutation(({ ctx, input }) => controller.addFeature(ctx.auth, input));
}

function updateFeature() {
  return adminOrOwnerProcedure
    .input(z.object({ id: idSchema, data: UpdateBoundaryFeatureObj }))
    .mutation(({ ctx, input }) => controller.updateFeature(ctx.auth, input.id, input.data));
}

function deleteFeature() {
  return adminOrOwnerProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ ctx, input }) => controller.deleteFeature(ctx.auth, input.id));
}

/** Re-run the match. Free to press: it calls no paid service and duplicates are coalesced. */
function rematch() {
  return adminOrOwnerProcedure
    .input(z.object({ setId: idSchema.nullable().optional() }))
    .mutation(({ ctx, input }) => controller.requestRematch(ctx.auth, input.setId ?? null));
}

/** How many households this map fails to place, and how many it places in two areas at once. */
function validate() {
  return authProcedure
    .input(z.object({ setId: idSchema }))
    .query(({ ctx, input }) => controller.validateSet(ctx.auth, input.setId));
}

export const BoundariesRouter = router({
  list: listSets(),
  features: listFeatures(),
  createDrawn: createDrawn(),
  upload: upload(),
  deleteSet: deleteSet(),
  addFeature: addFeature(),
  updateFeature: updateFeature(),
  deleteFeature: deleteFeature(),
  rematch: rematch(),
  validate: validate(),
});
