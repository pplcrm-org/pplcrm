import { Service } from '@angular/core';
import { TRPCService } from '../../../services/api/trpc-service';
import { RouterOutputs } from '../../../services/api/trpc-types';

/** The full `dashboard.getStats` response: live fields plus the background-job snapshot. */
export type DashboardStats = RouterOutputs['dashboard']['getStats'];
/** One row of the always-live per-user open counts + SLA breach counts. */
export type DashboardUserLiveRow = DashboardStats['userLive'][number];

@Service()
export class DashboardService extends TRPCService<any> {
  public getStats() {
    return this.api.dashboard.getStats.query();
  }

  /**
   * Queue a snapshot refresh (REVIEW6 T1-3). Coalesced and rate-limited server-side; the caller
   * shows its own error message (including the TOO_MANY_REQUESTS copy), so the generic handler is
   * skipped here.
   */
  public refreshStats() {
    return this.api.dashboard.refreshStats.mutate(undefined, { context: { skipErrorHandler: true } });
  }

  public getBreachedEmails(page: number, limit: number) {
    return this.api.dashboard.getBreachedEmails.query({ page, limit });
  }

  public getBreachedTasks(page: number, limit: number) {
    return this.api.dashboard.getBreachedTasks.query({ page, limit });
  }
}
