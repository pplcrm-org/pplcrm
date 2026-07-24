import { Service } from '@angular/core';
import type { AddBugReportType } from '@common';
import { TRPCService } from './trpc-service';

@Service()
export class BugReportsService extends TRPCService<'bug_reports'> {
  public report(input: AddBugReportType): Promise<{ id: string }> {
    return this.api.bugReports.report.mutate(input);
  }
}
