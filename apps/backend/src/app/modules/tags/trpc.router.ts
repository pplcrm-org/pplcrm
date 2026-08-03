import { AddTagObj, UpdateTagObj, idSchema, nameSchema } from '../../../../../../libs/common/src';
import { z } from 'zod';

import { authProcedure, router } from '../../../trpc';
import { TagsController } from './controller';
import { createCrudRouter } from '../../lib/crud-router';

const tags = new TagsController();

const crud = createCrudRouter(tags, AddTagObj, UpdateTagObj);

export const TagsRouter = router({
  ...crud,

  add: authProcedure.input(AddTagObj).mutation(({ input, ctx }) => tags.addTag(input, ctx.auth)),

  findByName: authProcedure
    .input(
      z.object({
        name: z.string().trim().max(100, 'Search term too long'),
        type: z.enum(['tag', 'issue']).default('tag').optional(),
      }),
    )
    .query(({ input, ctx }) => tags.findByName(input, ctx.auth)),

  // §9.1 Tags admin / §9.2 Issues admin. `campaignId` scopes the top-area ranking to that
  // campaign's seat set so the number under a campaign-worded heading ("Top ward") is computed
  // on the same map the word comes from.
  getAdminList: authProcedure
    .input(z.object({ type: z.enum(['tag', 'issue']), campaignId: z.string().optional() }))
    .query(({ input, ctx }) => tags.getAdminList(input.type, ctx.auth, input.campaignId)),

  countDistinctPeople: authProcedure
    .input(z.object({ type: z.enum(['tag', 'issue']) }))
    .query(({ input, ctx }) => tags.countDistinctPeople(input.type, ctx.auth)),

  rename: authProcedure
    .input(z.object({ id: idSchema, newName: nameSchema('Tag name', 50) }))
    .mutation(({ input, ctx }) => tags.renameTag(input.id, input.newName, ctx.auth)),

  merge: authProcedure
    .input(z.object({ sourceId: idSchema, targetId: idSchema }))
    .mutation(({ input, ctx }) => tags.mergeTags(input.sourceId, input.targetId, ctx.auth)),
});
