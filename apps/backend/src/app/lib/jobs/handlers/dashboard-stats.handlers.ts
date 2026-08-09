import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { writeDashboardSnapshot } from '../../../modules/dashboard/dashboard-stats.service';
import { CRON_JOBS } from '../cron-registry';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

/**
 * Nightly sweep: one dashboard-statistics snapshot per tenant per day. Per-tenant failures are
 * logged and skipped — one workspace's bad data must not stop every other workspace's snapshot,
 * and the stale `computed_at` on the failing tenant's dashboard is itself the visible symptom.
 */
export async function handleRefreshDashboardStats(db: Kysely<Models>): Promise<void> {
  const tenants = await db.selectFrom('tenants').select('id').execute();
  for (const tenant of tenants) {
    const tenantId = String(tenant.id);
    try {
      await writeDashboardSnapshot(db, tenantId);
    } catch (tenantErr) {
      logger.error({ err: tenantErr, tenantId }, 'Failed to refresh dashboard stats snapshot for tenant');
    }
  }
  await scheduleNextRun(db, 'refresh_dashboard_stats', CRON_JOBS.refresh_dashboard_stats);
}

/** Manual refresh (or first-ever computation) for one tenant. */
export async function handleRefreshDashboardStatsTenant(
  payload: JobPayloadOf<'refresh_dashboard_stats_tenant'>,
  db: Kysely<Models>,
): Promise<void> {
  await writeDashboardSnapshot(db, payload.tenant_id);
}
