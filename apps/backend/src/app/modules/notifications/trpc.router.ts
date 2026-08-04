import { z } from 'zod';
import { idSchema, rowCountSchema, rowOffsetSchema } from '../../../../../../libs/common/src';
import { authProcedure, router } from '../../../trpc';
import { NotificationsController } from './controller';

const notifications = new NotificationsController();

export const NotificationsRouter = router({
  getLatest: authProcedure
    .input(
      // Bare `z.number()` reached NotificationsRepo.getLatestForUser, which puts these straight
      // into .limit()/.offset() — a negative or fractional value errored out in Postgres, and an
      // arbitrarily large one read the user's whole notification history.
      z
        .object({
          limit: rowCountSchema.optional(),
          offset: rowOffsetSchema.optional(),
        })
        .optional(),
    )
    .query(({ input, ctx }) => notifications.getLatest(ctx.auth, input?.limit, input?.offset)),

  getUnreadCount: authProcedure.query(({ ctx }) => notifications.getUnreadCount(ctx.auth)),

  markAllRead: authProcedure.mutation(({ ctx }) => notifications.markAllAsRead(ctx.auth)),

  markRead: authProcedure.input(idSchema).mutation(({ input, ctx }) => notifications.markRead(input, ctx.auth)),
});
