import { AddBugReportObj } from '../../../../../../libs/common/src';

import { authProcedure, router } from '../../../trpc';
import { BugReportsController } from './controller';

const bugReports = new BugReportsController();

export const BugReportsRouter = router({
  report: authProcedure.input(AddBugReportObj).mutation(({ ctx, input }) => bugReports.report(ctx.auth, input)),
});
