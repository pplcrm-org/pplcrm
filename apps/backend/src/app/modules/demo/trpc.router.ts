import { adminOrOwnerProcedure, router } from '../../../trpc';
import { DemoController } from './controller';

const demo = new DemoController();

export const DemoRouter = router({
  /** Real counts of what exiting would delete, read from the seed manifest. */
  summary: adminOrOwnerProcedure.query(({ ctx }) => demo.getDemoSummary(ctx.auth)),

  /** Deletes all seeded demo data (keeps the starter forms) and clears the tenant's demo flag. */
  exit: adminOrOwnerProcedure.mutation(({ ctx }) => demo.exitDemoMode(ctx.auth)),
});
