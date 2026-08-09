import { z } from 'zod';

/**
 * The dashboard's retrospective statistics — the numbers that tolerate staleness.
 *
 * These are NOT computed on page view. A background job (`refresh_dashboard_stats`) writes one
 * snapshot row per tenant per day into `dashboard_stats_snapshots`, and the dashboard reads the
 * newest row with a primary-key lookup. The split exists because the old implementation read the
 * whole `emails`, `tasks`, and `email_recipients` tables into memory on every dashboard load and
 * got slower for the life of the tenant (REVIEW6 T1-3). Live, actionable numbers (open counts,
 * oldest unassigned, SLA breach lists) stay real-time queries and are deliberately absent here.
 *
 * All four windows are computed in one SQL pass, so serving 7/30/60/90 costs the same as serving
 * one. Window semantics, chosen to keep every window inside the 90-day activity-log retention that
 * "who closed it" attribution depends on:
 *  - first-response stats window on the email's ARRIVAL date;
 *  - closed counts and time-to-close window on the CLOSE date (proxied by `updated_at`, which for
 *    a closed email is the close write — the same proxy the previous implementation used).
 */
export const DASHBOARD_STATS_WINDOW_DAYS = [7, 30, 60, 90] as const;
export type DashboardStatsWindowDays = (typeof DASHBOARD_STATS_WINDOW_DAYS)[number];
export const DASHBOARD_STATS_WINDOW_KEYS = ['d7', 'd30', 'd60', 'd90'] as const;
export type DashboardStatsWindowKey = (typeof DASHBOARD_STATS_WINDOW_KEYS)[number];

/**
 * Per-user slice of one window. Names are resolved from `authusers` at read time (people get
 * renamed); only the id is stored. Averages are null — not 0 — when the window holds no samples,
 * so the UI can say "—" instead of claiming a zero-hour response time.
 */
export const DashboardWindowUserStatsObj = z.object({
  user_id: z.string(),
  closedCount: z.number().int().nonnegative(),
  responseCount: z.number().int().nonnegative(),
  avgFirstResponseHours: z.number().nonnegative().nullable(),
  timeToCloseCount: z.number().int().nonnegative(),
  avgTimeToCloseHours: z.number().nonnegative().nullable(),
});
export type DashboardWindowUserStatsType = z.infer<typeof DashboardWindowUserStatsObj>;

export const DashboardWindowStatsObj = z.object({
  closedCount: z.number().int().nonnegative(),
  responseCount: z.number().int().nonnegative(),
  avgFirstResponseHours: z.number().nonnegative().nullable(),
  timeToCloseCount: z.number().int().nonnegative(),
  avgTimeToCloseHours: z.number().nonnegative().nullable(),
  perUser: z.array(DashboardWindowUserStatsObj),
});
export type DashboardWindowStatsType = z.infer<typeof DashboardWindowStatsObj>;

/**
 * The `payload` column of `dashboard_stats_snapshots`, versioned so a future shape change can
 * detect and recompute old rows instead of misreading them. The reader (`getStats`) parses with
 * this schema and treats a parse failure the same as "no snapshot yet" — recompute, never guess.
 */
export const DashboardStatsSnapshotObj = z.object({
  version: z.literal(1),
  windows: z.object({
    d7: DashboardWindowStatsObj,
    d30: DashboardWindowStatsObj,
    d60: DashboardWindowStatsObj,
    d90: DashboardWindowStatsObj,
  }),
});
export type DashboardStatsSnapshotType = z.infer<typeof DashboardStatsSnapshotObj>;
