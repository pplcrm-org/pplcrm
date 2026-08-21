import { describe, expect, it } from 'vitest';

import { CRON_JOBS, DEFAULT_JOB_TIMEOUT_MS, isCronJobType, jobTimeoutMs, LONG_JOB_TIMEOUT_MS } from './cron-registry';

// Hardcoded on purpose: this list is the tripwire. If a recurring job is dropped from the registry
// (or added without thought), the seed loop in worker.start() and the permanent-failure reschedule
// silently stop covering it — so the drift has to fail a test, not a code review.
const EXPECTED_CRON_TYPES = [
  'ops_watchdog',
  'process_scheduled_newsletters',
  'process_drip_workflows',
  'schedule_sync_jobs',
  'detect_task_sla_breaches',
  'check_all_usage_limits',
  'check_due_tasks',
  'cleanup_activities',
  'detect_date_arrivals',
  'detect_lapsed_supporters',
  'perform_scheduled_deletions',
  'prune_newsletter_events',
  'prune_retention',
  'purge_canvass_pings',
  'purge_downgraded_inboxes',
  'recompute_address_fingerprints',
  'recompute_all_duplicates',
  'refresh_companies_google',
  'refresh_dashboard_stats',
  'sweep_unmatched_boundaries',
] as const;

describe('CRON_JOBS registry', () => {
  it('contains exactly the expected recurring job types', () => {
    expect(Object.keys(CRON_JOBS).sort()).toEqual([...EXPECTED_CRON_TYPES].sort());
  });

  it('gives every recurring job a positive finite interval', () => {
    for (const [type, intervalMs] of Object.entries(CRON_JOBS)) {
      expect(Number.isFinite(intervalMs), `${type} interval must be finite`).toBe(true);
      expect(intervalMs, `${type} interval must be positive`).toBeGreaterThan(0);
    }
  });
});

describe('isCronJobType', () => {
  it('accepts registered recurring types', () => {
    expect(isCronJobType('ops_watchdog')).toBe(true);
    expect(isCronJobType('prune_retention')).toBe(true);
  });

  it('rejects one-shot job types and unknown strings', () => {
    expect(isCronJobType('send-newsletter')).toBe(false);
    expect(isCronJobType('send-sms')).toBe(false);
    expect(isCronJobType('')).toBe(false);
    expect(isCronJobType('not_a_job')).toBe(false);
  });
});

describe('jobTimeoutMs', () => {
  it('gives the long cap to legacy typeless payloads (CSV imports)', () => {
    expect(jobTimeoutMs(undefined)).toBe(LONG_JOB_TIMEOUT_MS);
  });

  it('gives the long cap to known long-runners', () => {
    expect(jobTimeoutMs('send-newsletter')).toBe(LONG_JOB_TIMEOUT_MS);
  });

  it('gives the default cap to an ordinary one-shot job', () => {
    expect(jobTimeoutMs('send-sms')).toBe(DEFAULT_JOB_TIMEOUT_MS);
  });

  it('gives the default cap to an unknown type rather than no cap', () => {
    expect(jobTimeoutMs('not_a_job')).toBe(DEFAULT_JOB_TIMEOUT_MS);
  });

  it('keeps the long cap longer than the default', () => {
    expect(LONG_JOB_TIMEOUT_MS).toBeGreaterThan(DEFAULT_JOB_TIMEOUT_MS);
  });
});
