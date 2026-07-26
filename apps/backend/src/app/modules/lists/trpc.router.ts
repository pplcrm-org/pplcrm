import { AddListObj, UpdateListObj, getAllOptions, idSchema } from '../../../../../../libs/common/src';
import { z } from 'zod';

import { authProcedure as baseAuthProcedure, router } from '../../../trpc';
import { ListsController } from './controller';
import { createCrudRouter } from '../../lib/crud-router';
import { planFeatureGate } from '../billing/plan-gate';

const lists = new ListsController();

// FEATURE_MATRIX plan gate: lists (segments) are Grassroots-and-up; mutations below are blocked on Free.
const authProcedure = baseAuthProcedure.use(planFeatureGate('lists'));

const crud = createCrudRouter(lists, AddListObj, UpdateListObj, authProcedure);

export const ListsRouter = router({
  ...crud,

  // Both read paths go through getAllForContext so the built-in lists (§8) are
  // materialized for the context being read before the page renders.
  getAll: authProcedure.input(getAllOptions).query(({ input, ctx }) => lists.getAllForContext(ctx.auth, input)),

  getAllWithCounts: authProcedure
    .input(getAllOptions)
    .query(({ input, ctx }) => lists.getAllForContext(ctx.auth, input)),

  add: authProcedure.input(AddListObj).mutation(({ input, ctx }) => lists.addList(input, ctx.auth)),

  update: authProcedure
    .input(z.object({ id: idSchema, data: UpdateListObj }))
    .mutation(({ input, ctx }) => lists.updateList(input.id, input.data, ctx.auth)),

  getMembersHouseholds: authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => lists.getHouseholdsByListId(ctx.auth, input)),

  getMembersPersons: authProcedure.input(idSchema).query(({ input, ctx }) => lists.getPersonsByListId(ctx.auth, input)),

  refresh: authProcedure.input(idSchema).mutation(({ input, ctx }) => lists.refreshList(ctx.auth, input)),

  getListStats: authProcedure.input(idSchema).query(({ input, ctx }) => lists.getListStats(ctx.auth, input)),

  getMemberCount: authProcedure.input(idSchema).query(({ input, ctx }) => lists.getMemberCount(ctx.auth, input)),

  // Live membership (smart = re-run rules, static = saved snapshot). Reused by
  // turf cutting (§13), automations (§16) and CSV import (§17).
  getCurrentMembers: authProcedure.input(idSchema).query(({ input, ctx }) => lists.getCurrentMembers(ctx.auth, input)),

  // Consumers (newsletters/forms/turfs) — for LAST USED IN and delete confirms.
  getConsumers: authProcedure.input(idSchema).query(({ input, ctx }) => lists.getConsumers(ctx.auth, input)),
});
