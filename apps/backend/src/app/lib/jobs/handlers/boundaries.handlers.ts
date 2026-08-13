import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import type { BoundaryMatchScope } from '../../gis/boundary-jobs';
import {
  BOUNDARY_MATCH_BATCH_SIZE,
  BOUNDARY_MATCH_DEFER_MS,
  enqueueBoundaryMatch,
  enqueueBoundaryMatchContinuation,
} from '../../gis/boundary-jobs';
import type { HouseholdBoundaryMatches } from '../../gis/boundary-match';
import {
  applyHouseholdMatchesBatch,
  asCoordinate,
  loadBoundarySets,
  matchPointToLoadedSets,
  requiredSetIdsForTenant,
} from '../../gis/boundary-match';
import { CRON_JOBS } from '../cron-registry';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

/**
 * Background boundary matching.
 *
 * Matching is the free half of the geography pipeline: it re-reads coordinates already stored on
 * the household and runs a point-in-polygon test in this process. No Google request, no cost. That
 * is what lets an admin redraw a ward twenty times and re-match the whole workspace each time.
 *
 * The work is batched rather than done in one pass for one reason: a workspace can hold hundreds of
 * thousands of households, and holding a transaction open across that loop would keep a connection
 * and its locks for minutes. Each pass handles a fixed number of households, commits, and re-queues
 * itself with a keyset cursor.
 */

/** Widest jitter added to a deferred job's requeue delay, so ties re-arrive spread apart. */
const BOUNDARY_MATCH_DEFER_JITTER_MS = 15_000;

/** One page of households to match: id plus its stored coordinates. */
interface HouseholdPoint {
  id: string;
  lat: number;
  lng: number;
}

/**
 * One page of geocoded households, keyset-paginated by id.
 *
 * Only households whose `geocoding_status` is 'success' are eligible, in either scope. A failed
 * geocode clears the household's district rows but leaves its old coordinates in place, so
 * matching on "has coordinates" alone would resurrect districts for an address the product can no
 * longer place.
 *
 * `scope` 'unmatched' selects households never stamped by a match pass, or stamped before the
 * newest change (`newestSetChange`) among the target layers. That marker — not "holds no district
 * row" — is what lets the nightly sweep converge: a household outside every polygon gains no row,
 * but it does gain a stamp, so it is not re-examined until a map actually changes.
 */
async function fetchHouseholdPage(
  db: Kysely<Models>,
  tenantId: string,
  scope: BoundaryMatchScope,
  newestSetChange: Date | null,
  cursor: string | null,
): Promise<HouseholdPoint[]> {
  let query = db
    .selectFrom('households')
    .select(['id', 'lat', 'lng'])
    .where('tenant_id', '=', tenantId)
    .where('lat', 'is not', null)
    .where('lng', 'is not', null)
    .where('geocoding_status', '=', 'success')
    .orderBy('id', 'asc')
    .limit(BOUNDARY_MATCH_BATCH_SIZE);

  if (cursor !== null) query = query.where('id', '>', cursor);
  if (scope === 'unmatched') {
    query = query.where((eb) => {
      const neverChecked = eb('boundary_checked_at', 'is', null);
      return newestSetChange === null
        ? neverChecked
        : eb.or([neverChecked, eb('boundary_checked_at', '<', newestSetChange)]);
    });
  }

  const rows = await query.execute();
  const points: HouseholdPoint[] = [];
  for (const row of rows) {
    const lat = asCoordinate(row.lat);
    const lng = asCoordinate(row.lng);
    if (lat === null || lng === null) continue;
    points.push({ id: String(row.id), lat, lng });
  }
  return points;
}

/**
 * The newest `updated_at` among the target layers — the single reference instant a pass compares
 * every household's stamp against. Computed once per pass rather than correlated per row.
 */
async function newestSetChangeAt(db: Kysely<Models>, tenantId: string, setIds: string[]): Promise<Date | null> {
  const row = await db
    .selectFrom('boundary_sets')
    .select(({ fn }) => [fn.max('updated_at').as('newest')])
    .where('tenant_id', '=', tenantId)
    .where('id', 'in', setIds)
    .executeTakeFirst();
  const newest = row?.newest;
  if (newest instanceof Date) return newest;
  if (newest == null) return null;
  const parsed = new Date(newest);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function handleMatchBoundaries(
  payload: JobPayloadOf<'match_boundaries'>,
  db: Kysely<Models>,
  jobId?: string,
): Promise<void> {
  const correlationId = Math.random().toString(36).slice(2, 10).toUpperCase();
  const tenantId = payload.tenant_id;
  const scope: BoundaryMatchScope = payload.scope;
  const targetSetId = payload.set_id ?? null;
  const cursor = payload.cursor ?? null;

  // One match job per workspace at a time. The worker marks a job 'processing' before calling the
  // handler, so this job is one of the rows below; two or more means another job is working too.
  // The tie cannot be "everyone stands down": both jobs would requeue to the same run_at and
  // collide again, forever. So the lowest job id proceeds and every other job defers, with jitter
  // on the requeue so simultaneous deferrals do not re-arrive as another tie. A job that cannot
  // identify itself (no id passed) never claims the right of way.
  const running = await db
    .selectFrom('background_jobs')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'processing')
    .where(sql<string>`payload->>'type'`, '=', 'match_boundaries')
    .execute();
  if (running.length > 1) {
    const lowestId = running.map((row) => BigInt(row.id)).reduce((a, b) => (b < a ? b : a));
    if (jobId === undefined || jobId !== String(lowestId)) {
      const deferMs = BOUNDARY_MATCH_DEFER_MS + Math.floor(Math.random() * BOUNDARY_MATCH_DEFER_JITTER_MS);
      logger.info(
        { correlationId, tenantId, jobId, deferMs },
        'Boundary match deferred — another match job is already running',
      );
      await enqueueBoundaryMatchContinuation(db, tenantId, targetSetId, scope, cursor, deferMs);
      return;
    }
  }

  // Which layers this pass replaces. A named set is checked against the workspace first, so a stale
  // job for a deleted set does nothing rather than matching against somebody else's map.
  let setIds: string[];
  if (targetSetId) {
    const owned = await db
      .selectFrom('boundary_sets')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', targetSetId)
      .where('source', '<>', 'import')
      .executeTakeFirst();
    setIds = owned ? [String(owned.id)] : [];
  } else {
    setIds = await requiredSetIdsForTenant(db, tenantId);
  }

  if (setIds.length === 0) {
    logger.info(
      { correlationId, tenantId, targetSetId },
      'Boundary match finished — no boundary sets to match against',
    );
    return;
  }

  const sets = await loadBoundarySets(db, tenantId, setIds);
  const newestSetChange = await newestSetChangeAt(db, tenantId, setIds);
  const households = await fetchHouseholdPage(db, tenantId, scope, newestSetChange, cursor);

  if (households.length > 0) {
    const entries: HouseholdBoundaryMatches[] = households.map((household) => ({
      householdId: household.id,
      matches: matchPointToLoadedSets(household.lat, household.lng, sets),
    }));
    // Scoped to the layers that actually loaded, not to the ones this pass asked for. A published
    // layer whose file could not be read is missing from `sets`, so this pass leaves its existing
    // rows alone instead of clearing every household's area for a map it never managed to open.
    await applyHouseholdMatchesBatch(
      db,
      tenantId,
      entries,
      sets.map((set) => set.id),
    );

    // Stamp every household this pass examined, matched or not, in one batch. The stamp — not the
    // presence of a district row — is what the 'unmatched' scope reads, so a household outside
    // every polygon is checked once per map change instead of once per night forever.
    //
    // Only when every requested layer actually loaded. The stamp means "tested against the current
    // maps"; writing it while a layer's file was unreadable would make households never tested
    // against that map read as `outside` instead of `unknown` until the set next changes
    // (REVIEW6 T2-19). Skipping it leaves them in the 'unmatched' scope, so the next pass retries
    // them once the layer loads again.
    //
    // Rows already stamped at or after the newest set change are skipped: they were already
    // checked against the current maps (a prior overlapping pass got there first), and the stamp
    // is the only column this UPDATE touches, so rewriting the whole household row again would be
    // pure dead-tuple churn (REVIEW6 T2-5).
    if (sets.length === setIds.length) {
      let stampQuery = db
        .updateTable('households')
        .set({ boundary_checked_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where(
          'id',
          'in',
          households.map((household) => household.id),
        );
      if (newestSetChange !== null) {
        const cutoff = newestSetChange;
        stampQuery = stampQuery.where((eb) =>
          eb.or([eb('boundary_checked_at', 'is', null), eb('boundary_checked_at', '<', cutoff)]),
        );
      }
      await stampQuery.execute();
    } else {
      logger.warn(
        { correlationId, tenantId, requested: setIds.length, loaded: sets.length },
        'Boundary match: a requested layer failed to load — freshness stamp skipped so these households are retried',
      );
    }
  }

  const matchedRows = households.length;
  const lastId = households[households.length - 1]?.id ?? null;

  // A full page means there is very likely more; re-queue immediately, since this costs nothing.
  if (matchedRows === BOUNDARY_MATCH_BATCH_SIZE && lastId !== null) {
    await enqueueBoundaryMatchContinuation(db, tenantId, targetSetId, scope, lastId);
    logger.info(
      { correlationId, tenantId, targetSetId, scope, matchedRows, cursor: lastId },
      'Boundary match page complete — continuation queued',
    );
    return;
  }

  logger.info({ correlationId, tenantId, targetSetId, scope, matchedRows }, 'Boundary match complete');
}

/**
 * Nightly: re-match households no pass has examined since the workspace's maps last changed.
 *
 * Catches the households that fall between the event-driven paths — geocoded before any map
 * existed, imported with coordinates but no district columns, or missed because a match job failed
 * permanently. Eligibility is the `boundary_checked_at` stamp, so on a workspace whose maps are
 * unchanged the sweep selects nothing. It queues one job per workspace rather than doing the work
 * here, so no single cron run can be long, and the per-workspace concurrency cap still applies.
 */
export async function handleSweepUnmatchedBoundaries(db: Kysely<Models>): Promise<void> {
  const correlationId = Math.random().toString(36).slice(2, 10).toUpperCase();

  // NOTE: intentionally cross-tenant — this is a scheduled platform sweep with no caller, the same
  // shape as the other cron probes in lib/jobs/handlers. It returns only the DISTINCT tenant ids
  // that hold at least one boundary layer with polygons (no business data), and every job it
  // queues is scoped to the single tenant id it was queued for.
  // eslint-disable-next-line local/no-unscoped-db-query
  const tenants = await db
    .selectFrom('boundary_sets')
    .select('tenant_id')
    .where('source', '<>', 'import')
    .groupBy('tenant_id')
    .execute();

  let queued = 0;
  for (const row of tenants) {
    const tenantId = String(row.tenant_id);
    try {
      await enqueueBoundaryMatch(db, tenantId, null, 'unmatched');
      queued++;
    } catch (err) {
      logger.error({ err, correlationId, tenantId }, 'Failed to queue nightly boundary match for tenant');
    }
  }

  logger.info({ correlationId, tenants: tenants.length, queued }, 'Unmatched-boundary sweep queued');

  await scheduleNextRun(db, 'sweep_unmatched_boundaries', CRON_JOBS.sweep_unmatched_boundaries);
}
