import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { writeDashboardSnapshot } from '../../../modules/dashboard/dashboard-stats.service';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

/**
 * Nightly sweep: one dashboard-statistics snapshot per tenant per day. Per-tenant failures are
 * logged and skipped — one workspace's bad data must not stop every other workspace's snapshot,
 * and the stale `computed_at` on the failing tenant's dashboard is itself the visible symptom.
 */
export async function handleRefreshDashboardStats(db: Kysely<Models>): Promise<void> {
  try {
    // Workspaces awaiting beta approval have no data, and ones scheduled for deletion are about
    // to lose theirs — neither earns two 90-day aggregate scans a night (REVIEW7 A12).
    const tenants = await db
      .selectFrom('tenants')
      .select('id')
      .where('approval_status', '=', 'approved')
      .where('deletion_scheduled_at', 'is', null)
      .execute();
    for (const tenant of tenants) {
      const tenantId = String(tenant.id);
      try {
        await writeDashboardSnapshot(db, tenantId);
      } catch (tenantErr) {
        logger.error({ err: tenantErr, tenantId }, 'Failed to refresh dashboard stats snapshot for tenant');
      }
    }
  } finally {
    // In a finally so a sweep that dies mid-loop still seeds its successor — otherwise the
    // nightly chain stops until the next process boot re-seeds it (REVIEW7 A3).
    await scheduleNextRun(db, 'refresh_dashboard_stats', msUntilNextSweepAnchor());
  }
}

/**
 * Delay to the next 02:30 UTC rather than a flat +24h from completion (REVIEW7 A11): the flat
 * interval drifts forward by each night's runtime, and since the snapshot is keyed by UTC
 * calendar date, enough accumulated drift crosses midnight and silently skips a date in the
 * history the week-over-week trends read.
 */
function msUntilNextSweepAnchor(): number {
  const ANCHOR_HOUR_UTC = 2;
  const ANCHOR_MINUTE_UTC = 30;
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ANCHOR_HOUR_UTC, ANCHOR_MINUTE_UTC, 0, 0),
  );
  // Half-hour guard: a sweep finishing just before the anchor must not schedule a second run
  // for the same night.
  if (next.getTime() - now.getTime() < 30 * 60 * 1000) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/** Manual refresh (or first-ever computation) for one tenant. */
export async function handleRefreshDashboardStatsTenant(
  payload: JobPayloadOf<'refresh_dashboard_stats_tenant'>,
  db: Kysely<Models>,
): Promise<void> {
  await writeDashboardSnapshot(db, payload.tenant_id);
}
