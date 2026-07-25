import type { JobType } from './job-payloads';
import { DAY_MS, FIVE_MINUTES_MS, HOUR_MS, TEN_MINUTES_MS } from './reschedule';

/**
 * Single source of truth for every self-rescheduling (cron-style) background job.
 *
 * Consumed in three places so the set can never drift again:
 *  - worker.start() seeds one pending row per entry at boot;
 *  - each handler's end-of-run scheduleNextRun() pulls its interval from here;
 *  - the worker's permanent-failure path re-seeds the cron at the same interval,
 *    so a cron chain can never silently die between deploys.
 *
 * Adding a recurring job = add its entry here; the seed loop and the failure
 * reschedule pick it up automatically.
 */
export const CRON_JOBS = {
  ops_watchdog: FIVE_MINUTES_MS,
  process_scheduled_newsletters: FIVE_MINUTES_MS,
  process_drip_workflows: TEN_MINUTES_MS,
  schedule_sync_jobs: TEN_MINUTES_MS,
  detect_task_sla_breaches: HOUR_MS,
  check_all_usage_limits: DAY_MS,
  check_due_tasks: DAY_MS,
  cleanup_activities: DAY_MS,
  detect_lapsed_supporters: DAY_MS,
  perform_scheduled_deletions: DAY_MS,
  prune_newsletter_events: DAY_MS,
  prune_retention: DAY_MS,
  recompute_address_fingerprints: DAY_MS,
  recompute_all_duplicates: DAY_MS,
  refresh_companies_google: DAY_MS,
} as const satisfies Partial<Record<JobType, number>>;

export type CronJobType = keyof typeof CRON_JOBS;

export function isCronJobType(type: string): type is CronJobType {
  return Object.hasOwn(CRON_JOBS, type);
}

/**
 * Wall-clock caps for a single job execution. A handler that exceeds its cap is
 * treated as failed; because the timed-out promise cannot be cancelled and may
 * still be writing, the worker defers the retry long enough for the zombie to
 * finish or die before the retry could overlap it.
 */
export const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;
export const LONG_JOB_TIMEOUT_MS = 60 * 60 * 1000;

// Long-runners: bulk sends, whole-table exports, mailbox syncs, tenant wipes.
const JOB_TIMEOUT_OVERRIDES = {
  'send-newsletter': LONG_JOB_TIMEOUT_MS,
  export_csv: LONG_JOB_TIMEOUT_MS,
  google_sync: LONG_JOB_TIMEOUT_MS,
  ms_sync: LONG_JOB_TIMEOUT_MS,
  perform_scheduled_deletions: LONG_JOB_TIMEOUT_MS,
} as const satisfies Partial<Record<JobType, number>>;

export function jobTimeoutMs(type: string | undefined): number {
  // Legacy CSV imports carry no `type` on their payload; they process whole
  // uploaded files, so they get the long cap rather than the default.
  if (type == null) return LONG_JOB_TIMEOUT_MS;
  const overrides: Partial<Record<string, number>> = JOB_TIMEOUT_OVERRIDES;
  return overrides[type] ?? DEFAULT_JOB_TIMEOUT_MS;
}
