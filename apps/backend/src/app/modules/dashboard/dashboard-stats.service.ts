import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type {
  DashboardStatsSnapshotType,
  DashboardWindowStatsType,
  DashboardWindowUserStatsType,
} from '../../../../../../libs/common/src';
import { DashboardStatsSnapshotObj } from '../../../../../../libs/common/src';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';

/**
 * Computes and stores the dashboard's retrospective statistics — the snapshot half of the
 * live/snapshot split (REVIEW6 T1-3).
 *
 * Everything here runs in the background job worker (`refresh_dashboard_stats` nightly sweep,
 * `refresh_dashboard_stats_tenant` manual refresh), never on a page view. The dashboard reads the
 * newest `dashboard_stats_snapshots` row by primary key.
 *
 * Semantics preserved from the old on-request computation, except for the windowing itself:
 *  - "who closed it": the LAST 'close' activity-log entry for the email, falling back to the
 *    assignee (the old code built its map in ascending order and let later entries overwrite).
 *  - "first response": the earliest of (first internal comment on the email, first Sent-folder
 *    email addressed to the sender after the inbound arrived), counted only when it is strictly
 *    after the arrival.
 *  - time-to-close: `updated_at - created_at` of a closed email, counted only when positive
 *    (`updated_at` is the close write for a closed email — the same proxy as before).
 *
 * Window semantics (see dashboard.schema.ts): first-response windows on ARRIVAL date; closed
 * counts and time-to-close window on CLOSE date. All windows are ≤ 90 days, which keeps the
 * close-attribution inside `user_activity`'s 90-day retention.
 *
 * The window lengths are hard-coded in the two SQL statements below as FILTER clauses; they must
 * match DASHBOARD_STATS_WINDOW_DAYS (7/30/60/90). A spec pins the correspondence.
 */

interface ClosedStatsRow {
  stat_user_id: string | null;
  closed_d7: string | number;
  closed_d30: string | number;
  closed_d60: string | number;
  closed_d90: string | number;
  close_secs_d7: string | number | null;
  close_secs_d30: string | number | null;
  close_secs_d60: string | number | null;
  close_secs_d90: string | number | null;
  close_n_d7: string | number;
  close_n_d30: string | number;
  close_n_d60: string | number;
  close_n_d90: string | number;
}

interface ResponseStatsRow {
  stat_user_id: string | null;
  resp_secs_d7: string | number | null;
  resp_secs_d30: string | number | null;
  resp_secs_d60: string | number | null;
  resp_secs_d90: string | number | null;
  resp_n_d7: string | number;
  resp_n_d30: string | number;
  resp_n_d60: string | number;
  resp_n_d90: string | number;
}

const WINDOW_KEYS = ['d7', 'd30', 'd60', 'd90'] as const;
type WindowKey = (typeof WINDOW_KEYS)[number];

/** Inbox folder id — same constant the emails module uses ('11' = Inbox, '3' = Sent). */
const INBOX_FOLDER_ID = '11';
const SENT_FOLDER_ID = '3';

function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Closed-email counts and time-to-close sums per closer, one aggregate pass over the last 90 days
 * of closed inbox mail. Grouped by "who gets credit": the last close activity's user, else the
 * assignee, else NULL (feeds the global average only — same as the old loop).
 */
async function readClosedStats(db: Kysely<Models>, tenantId: string): Promise<ClosedStatsRow[]> {
  const res = await sql<ClosedStatsRow>`
    SELECT
      coalesce(closer.user_id::text, e.assigned_to::text) AS stat_user_id,
      count(*) FILTER (WHERE e.updated_at >= now() - interval '7 days')  AS closed_d7,
      count(*) FILTER (WHERE e.updated_at >= now() - interval '30 days') AS closed_d30,
      count(*) FILTER (WHERE e.updated_at >= now() - interval '60 days') AS closed_d60,
      count(*)                                                          AS closed_d90,
      sum(extract(epoch FROM (e.updated_at - e.created_at)))
        FILTER (WHERE e.updated_at > e.created_at AND e.updated_at >= now() - interval '7 days')  AS close_secs_d7,
      sum(extract(epoch FROM (e.updated_at - e.created_at)))
        FILTER (WHERE e.updated_at > e.created_at AND e.updated_at >= now() - interval '30 days') AS close_secs_d30,
      sum(extract(epoch FROM (e.updated_at - e.created_at)))
        FILTER (WHERE e.updated_at > e.created_at AND e.updated_at >= now() - interval '60 days') AS close_secs_d60,
      sum(extract(epoch FROM (e.updated_at - e.created_at)))
        FILTER (WHERE e.updated_at > e.created_at)                                               AS close_secs_d90,
      count(*) FILTER (WHERE e.updated_at > e.created_at AND e.updated_at >= now() - interval '7 days')  AS close_n_d7,
      count(*) FILTER (WHERE e.updated_at > e.created_at AND e.updated_at >= now() - interval '30 days') AS close_n_d30,
      count(*) FILTER (WHERE e.updated_at > e.created_at AND e.updated_at >= now() - interval '60 days') AS close_n_d60,
      count(*) FILTER (WHERE e.updated_at > e.created_at)                                                AS close_n_d90
    FROM emails e
    LEFT JOIN LATERAL (
      SELECT ua.user_id
      FROM user_activity ua
      WHERE ua.tenant_id = ${tenantId}
        AND ua.activity = 'close'
        AND ua.entity IN ('email', 'emails')
        AND ua.entity_id = e.id::text
      ORDER BY ua.created_at DESC
      LIMIT 1
    ) closer ON true
    WHERE e.tenant_id = ${tenantId}
      AND e.folder_id = ${INBOX_FOLDER_ID}
      AND e.status = 'closed'
      -- Detached mail is invisible in the inbox, so it must not count here either (REVIEW7 A10).
      AND e.detached_at IS NULL
      AND e.updated_at >= now() - interval '90 days'
    GROUP BY 1
  `.execute(db);
  return res.rows;
}

/**
 * First-response sums per assignee over inbox emails that ARRIVED in the last 90 days.
 * `resp.secs` is NULL when the email has had no response yet, so `count(resp.secs)` is exactly
 * "emails with a measured first response".
 */
async function readResponseStats(db: Kysely<Models>, tenantId: string): Promise<ResponseStatsRow[]> {
  const res = await sql<ResponseStatsRow>`
    SELECT
      e.assigned_to::text AS stat_user_id,
      sum(resp.secs)   FILTER (WHERE e.created_at >= now() - interval '7 days')  AS resp_secs_d7,
      sum(resp.secs)   FILTER (WHERE e.created_at >= now() - interval '30 days') AS resp_secs_d30,
      sum(resp.secs)   FILTER (WHERE e.created_at >= now() - interval '60 days') AS resp_secs_d60,
      sum(resp.secs)                                                             AS resp_secs_d90,
      count(resp.secs) FILTER (WHERE e.created_at >= now() - interval '7 days')  AS resp_n_d7,
      count(resp.secs) FILTER (WHERE e.created_at >= now() - interval '30 days') AS resp_n_d30,
      count(resp.secs) FILTER (WHERE e.created_at >= now() - interval '60 days') AS resp_n_d60,
      count(resp.secs)                                                           AS resp_n_d90
    FROM emails e
    LEFT JOIN LATERAL (
      SELECT min(c.created_at) AS first_comment_at
      FROM email_comments c
      WHERE c.tenant_id = ${tenantId} AND c.email_id = e.id
    ) cm ON true
    LEFT JOIN LATERAL (
      SELECT min(e2.created_at) AS first_outbound_at
      FROM email_recipients r
      JOIN emails e2 ON e2.id = r.email_id AND e2.tenant_id = ${tenantId}
      WHERE r.tenant_id = ${tenantId}
        AND r.kind = 'to'
        AND lower(r.email) = lower(btrim(e.from_email))
        AND e2.folder_id = ${SENT_FOLDER_ID}
        AND e2.created_at > e.created_at
    ) snt ON true
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN least(cm.first_comment_at, snt.first_outbound_at) > e.created_at
        THEN extract(epoch FROM (least(cm.first_comment_at, snt.first_outbound_at) - e.created_at))
      END AS secs
    ) resp
    WHERE e.tenant_id = ${tenantId}
      AND e.folder_id = ${INBOX_FOLDER_ID}
      -- Same detached rule as the closed-stats pass (REVIEW7 A10).
      AND e.detached_at IS NULL
      AND e.created_at >= now() - interval '90 days'
    GROUP BY 1
  `.execute(db);
  return res.rows;
}

/** Merge the two aggregate passes into the versioned snapshot payload. */
export async function computeDashboardSnapshot(
  db: Kysely<Models>,
  tenantId: string,
): Promise<DashboardStatsSnapshotType> {
  const [closedRows, responseRows] = [await readClosedStats(db, tenantId), await readResponseStats(db, tenantId)];

  const windows = {} as Record<WindowKey, DashboardWindowStatsType>;
  for (const key of WINDOW_KEYS) {
    const perUserMap = new Map<string, DashboardWindowUserStatsType>();
    const userEntry = (userId: string): DashboardWindowUserStatsType => {
      let entry = perUserMap.get(userId);
      if (!entry) {
        entry = {
          user_id: userId,
          closedCount: 0,
          responseCount: 0,
          avgFirstResponseHours: null,
          timeToCloseCount: 0,
          avgTimeToCloseHours: null,
        };
        perUserMap.set(userId, entry);
      }
      return entry;
    };

    let closedTotal = 0;
    let closeSecsTotal = 0;
    let closeNTotal = 0;
    for (const row of closedRows) {
      const closed = num(row[`closed_${key}`]);
      const secs = num(row[`close_secs_${key}`]);
      const n = num(row[`close_n_${key}`]);
      closedTotal += closed;
      closeSecsTotal += secs;
      closeNTotal += n;
      if (row.stat_user_id != null && closed > 0) {
        const entry = userEntry(row.stat_user_id);
        entry.closedCount += closed;
        entry.timeToCloseCount += n;
        entry.avgTimeToCloseHours = n > 0 ? secs / n / 3600 : null;
      }
    }

    let respSecsTotal = 0;
    let respNTotal = 0;
    for (const row of responseRows) {
      const secs = num(row[`resp_secs_${key}`]);
      const n = num(row[`resp_n_${key}`]);
      respSecsTotal += secs;
      respNTotal += n;
      if (row.stat_user_id != null && n > 0) {
        const entry = userEntry(row.stat_user_id);
        entry.responseCount += n;
        entry.avgFirstResponseHours = secs / n / 3600;
      }
    }

    windows[key] = {
      closedCount: closedTotal,
      responseCount: respNTotal,
      avgFirstResponseHours: respNTotal > 0 ? respSecsTotal / respNTotal / 3600 : null,
      timeToCloseCount: closeNTotal,
      avgTimeToCloseHours: closeNTotal > 0 ? closeSecsTotal / closeNTotal / 3600 : null,
      perUser: [...perUserMap.values()].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    };
  }

  // Parse before returning so a writer bug is caught at compute time, not at read time.
  return DashboardStatsSnapshotObj.parse({ version: 1, windows });
}

/**
 * Compute and upsert today's snapshot row. "Today" is the server's UTC date (TZ is pinned to UTC
 * in production); a manual refresh later the same day overwrites the same row, which is what makes
 * `computed_at` the honest "as of" timestamp while `snapshot_date` stays one-row-per-day history.
 */
export async function writeDashboardSnapshot(db: Kysely<Models>, tenantId: string): Promise<void> {
  const payload = await computeDashboardSnapshot(db, tenantId);
  const snapshotDate = new Date().toISOString().slice(0, 10);
  await db
    .insertInto('dashboard_stats_snapshots')
    .values({
      tenant_id: tenantId,
      snapshot_date: snapshotDate,
      computed_at: new Date(),
      payload: JSON.stringify(payload),
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'snapshot_date']).doUpdateSet({
        computed_at: new Date(),
        payload: JSON.stringify(payload),
      }),
    )
    .execute();
}

/**
 * Is a refresh for this tenant already queued or running? Read by getStats (drives the UI's
 * "refreshing…" state) and by the enqueue below (coalescing: a second job would recompute the
 * identical numbers seconds later, so it is refused rather than stacked).
 */
export async function dashboardRefreshPending(db: Kysely<Models>, tenantId: string): Promise<boolean> {
  const existing = await db
    .selectFrom('background_jobs')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('status', 'in', ['pending', 'processing'])
    .where(sql`payload->>'type'`, '=', 'refresh_dashboard_stats_tenant')
    .executeTakeFirst();
  return existing != null;
}

/**
 * Queue a one-tenant snapshot refresh unless one is already in flight. Two concurrent callers can
 * in principle both pass the check and insert two jobs; the write is an idempotent upsert and the
 * mutation is rate-limited per tenant, so no advisory lock is spent on it.
 */
export async function enqueueDashboardStatsRefresh(
  db: Kysely<Models>,
  tenantId: string,
): Promise<'queued' | 'already_pending'> {
  if (await dashboardRefreshPending(db, tenantId)) return 'already_pending';
  await db
    .insertInto('background_jobs')
    .values({
      tenant_id: tenantId,
      queue: 'default',
      status: 'pending',
      payload: JSON.stringify({ type: 'refresh_dashboard_stats_tenant', tenant_id: tenantId }),
      run_at: new Date(),
      max_attempts: 3,
    })
    .execute();
  return 'queued';
}

/**
 * The newest snapshot for a tenant, parsed — or null when none exists yet or the stored payload
 * predates the current schema version (the reader must treat both as "not computed yet").
 */
export async function readLatestDashboardSnapshot(
  db: Kysely<Models>,
  tenantId: string,
): Promise<{ computedAt: Date; stats: DashboardStatsSnapshotType } | null> {
  const row = await db
    .selectFrom('dashboard_stats_snapshots')
    .select(['computed_at', 'payload'])
    .where('tenant_id', '=', tenantId)
    .orderBy('snapshot_date', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  const parsed = DashboardStatsSnapshotObj.safeParse(row.payload);
  if (!parsed.success) return null;
  return { computedAt: new Date(row.computed_at), stats: parsed.data };
}
