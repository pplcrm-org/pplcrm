import { DEFAULT_TIMEZONE, isValidTimeZone } from '@common';

/**
 * The workspace's service-level policy, resolved from tenant settings.
 *
 * This exists because the same six defaults (24h, Mon–Fri, 09:00, 17:00, warn 1, critical 4)
 * were re-hardcoded at four independent call sites — the tasks badge, two dashboard queries,
 * and the workflow handler. They drifted in exactly the way you would expect: adding a
 * timezone to one of them would have left the other three on server time.
 */
export interface SlaPolicy {
  taskSlaHours: number;
  emailSlaHours: number;
  /** Day numbers as returned by Date#getDay — 0 = Sunday. */
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  /** IANA zone the working window is read in. Never the server's zone. */
  timeZone: string;
  emailWarningThreshold: number;
  emailCriticalThreshold: number;
  taskWarningThreshold: number;
  taskCriticalThreshold: number;
}

/** Settings keys a caller must load for `slaPolicyFrom` to see a complete policy. */
export const SLA_SETTING_KEYS = [
  'sla.tasks_hours',
  'sla.emails_hours',
  'sla.working_days',
  'sla.working_hours_start',
  'sla.working_hours_end',
  'sla.email_warning_threshold',
  'sla.email_critical_threshold',
  'sla.task_warning_threshold',
  'sla.task_critical_threshold',
  'organization.timezone',
] as const;

const DEFAULTS = {
  slaHours: 24,
  workingDays: '1,2,3,4,5',
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  warningThreshold: 1,
  criticalThreshold: 4,
} as const;

/** Reads a positive number, falling back when the stored value is absent or unusable. */
function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function str(value: unknown, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

/**
 * Build the policy from a tenant's settings rows, keyed by settings key.
 *
 * Pure so every caller resolves defaults identically regardless of how it loaded the rows
 * (SettingsRepo for the controllers, a direct select inside the job transaction).
 */
export function slaPolicyFrom(settingsMap: Record<string, unknown>): SlaPolicy {
  const workingDays = str(settingsMap['sla.working_days'], DEFAULTS.workingDays)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  const timeZone = settingsMap['organization.timezone'];

  return {
    taskSlaHours: num(settingsMap['sla.tasks_hours'], DEFAULTS.slaHours),
    emailSlaHours: num(settingsMap['sla.emails_hours'], DEFAULTS.slaHours),
    // An empty list would make calculateWorkingTimeMs fall back to raw elapsed time, which
    // silently turns every SLA into a wall-clock one. Restore the default instead.
    workingDays: workingDays.length > 0 ? workingDays : [1, 2, 3, 4, 5],
    workingHoursStart: str(settingsMap['sla.working_hours_start'], DEFAULTS.workingHoursStart),
    workingHoursEnd: str(settingsMap['sla.working_hours_end'], DEFAULTS.workingHoursEnd),
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE,
    emailWarningThreshold: num(settingsMap['sla.email_warning_threshold'], DEFAULTS.warningThreshold),
    emailCriticalThreshold: num(settingsMap['sla.email_critical_threshold'], DEFAULTS.criticalThreshold),
    taskWarningThreshold: num(settingsMap['sla.task_warning_threshold'], DEFAULTS.warningThreshold),
    taskCriticalThreshold: num(settingsMap['sla.task_critical_threshold'], DEFAULTS.criticalThreshold),
  };
}

/** Collapse settings rows into the key/value map `slaPolicyFrom` expects. */
export function settingsMapFrom(rows: readonly { key: string; value: unknown }[]): Record<string, unknown> {
  return rows.reduce<Record<string, unknown>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}
