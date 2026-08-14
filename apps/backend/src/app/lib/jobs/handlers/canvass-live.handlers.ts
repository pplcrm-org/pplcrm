import { sql } from 'kysely';

import { logger } from '../../../logger';
import { CanvassShiftsRepo } from '../../../modules/canvassing/repositories/canvass-shifts.repo';
import { localMidnightUtc } from '../../local-time';
import { CRON_JOBS } from '../cron-registry';
import { scheduleNextRun } from '../reschedule';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { Kysely } from 'kysely';

/**
 * One tenant's share of the nightly location purge, in ITS local time:
 *  1. close shifts that went quiet (ended_at = their last activity — the honest time);
 *  2. close anything still open from before local midnight (ended at midnight at the latest);
 *  3. delete every ping received before that midnight.
 *
 * The aggregates that survive live on the shift row itself (started_at / ended_at /
 * distance_walked_m) and were maintained at write time, so nothing needs to be computed
 * from the pings before they are dropped. Door counts come from `turf_knocks`, which
 * this never touches.
 *
 * Exported so its spec can exercise it alone — calling `handlePurgeCanvassPings` in a
 * test would also enqueue the next cron run (same precedent as `pruneExpiredExports`).
 */
export async function purgeCanvassPingsForTenant(
  db: Kysely<Models>,
  tenant_id: string,
  now: Date = new Date(),
): Promise<number> {
  const zoneRow = await db
    .selectFrom('settings')
    .select(['value'])
    .where('tenant_id', '=', tenant_id)
    .where('key', '=', 'organization.timezone')
    .executeTakeFirst();
  // Values are stored JSON-encoded; localMidnightUtc falls back to the default zone for
  // anything unrecognizable.
  const zone = typeof zoneRow?.value === 'string' ? zoneRow.value.replace(/^"+|"+$/g, '') : null;
  const midnight = localMidnightUtc(now, zone);

  const shifts = new CanvassShiftsRepo();
  await shifts.closeStale(tenant_id);
  await shifts.closeOpenBefore({ tenant_id, midnight });
  return shifts.deletePingsBefore({ tenant_id, cutoff: midnight });
}

/**
 * Hourly enforcement of the Live tab's privacy contract: canvassing location pings are
 * TODAY-ONLY, in each workspace's own local time. Hourly rather than nightly because
 * "midnight" differs per workspace — each run purges only tenants already past theirs,
 * so coordinates live at most one hour beyond it.
 */
export async function handlePurgeCanvassPings(db: Kysely<Models>): Promise<void> {
  try {
    // Cross-tenant on purpose — scheduled platform maintenance with no caller, the same
    // as the other sweeps in this directory. Selects tenant ids and nothing else.
    const tenants = await sql<{ tenant_id: string }>`
      SELECT DISTINCT tenant_id FROM (
        SELECT tenant_id FROM canvass_location_pings
        UNION
        SELECT tenant_id FROM canvass_shifts WHERE ended_at IS NULL
      ) AS live
    `.execute(db);
    if (tenants.rows.length === 0) return;

    let purged = 0;
    for (const row of tenants.rows) {
      purged += await purgeCanvassPingsForTenant(db, String(row.tenant_id));
    }
    if (purged > 0) {
      logger.info({ tenants: tenants.rows.length, purged }, 'Canvass location pings purged');
    }
  } finally {
    // In a finally so a run that dies mid-loop still seeds its successor.
    await scheduleNextRun(db, 'purge_canvass_pings', CRON_JOBS.purge_canvass_pings);
  }
}
