import { z } from 'zod';
import { MAX_PAGE_SIZE } from '../../../../../../libs/common/src';
import { authProcedure, router } from '../../../trpc';
import { DashboardController } from './controller';

const dashboard = new DashboardController();

/**
 * Page size for the two paginated dashboard panels. `limit` had a minimum but no maximum, which
 * is the same missing-ceiling defect as the list paging fields. (The panels build their candidate
 * list in memory before slicing it, so this bounds the response, not the underlying reads — those
 * are a separate, larger piece of work.)
 */
const dashboardPageInput = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
});

export const DashboardRouter = router({
  getStats: authProcedure.query(({ ctx }) => dashboard.getStats(ctx.auth)),

  getBreachedEmails: authProcedure
    .input(dashboardPageInput)
    .query(({ input, ctx }) => dashboard.getBreachedEmails(ctx.auth, input)),

  getBreachedTasks: authProcedure
    .input(dashboardPageInput)
    .query(({ input, ctx }) => dashboard.getBreachedTasks(ctx.auth, input)),
});
