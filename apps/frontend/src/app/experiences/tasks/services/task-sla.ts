import { calculateWorkingTimeMs } from '../../../../../../../libs/common/src/lib/sla';
import type { SlaPill, SlaTone } from '../../emails/services/email-sla';

const MS_PER_HOUR = 3_600_000;
/** Below this fraction of the target still remaining, the pill turns warning-tinted. */
const WARNING_REMAINING_FRACTION = 0.25;

export interface TaskSlaInputs {
  /** When the task was created — the working clock starts here (spec §4). */
  createdAt: Date | null | undefined;
  status: string | null | undefined;
  /** Workspace SLA target for resolving a task, in working hours (`sla.tasks_hours`). */
  tasksHours: number | null | undefined;
  /** '09:00' */
  workingHoursEnd: string | null | undefined;
  /** '17:00' */
  workingHoursStart: string | null | undefined;
  /** '1,2,3,4,5' — day numbers, 0=Sun … 6=Sat. */
  workingDays: string | null | undefined;
  /** Workspace IANA zone (`organization.timezone`); without it the pill would use the
   *  viewer's browser zone and disagree with the server-computed breach badge. */
  timeZone?: string | null | undefined;
}

function parseWorkingDays(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

/**
 * Honest per-task SLA pill (spec §4), the same shape and reasoning as the email SLA
 * pill (`../../emails/services/email-sla.ts`) — same underlying `calculateWorkingTimeMs`
 * from `libs/common`, just anchored on `created_at` instead of the email's received time.
 * A task that's already `done` or `archived` has nothing left to disclose, so it
 * reports no pill at all rather than a fabricated "resolved in Xh".
 */
export function computeTaskSla(inputs: TaskSlaInputs, now: Date = new Date()): SlaPill | null {
  const status = (inputs.status ?? 'todo').toLowerCase();
  if (status === 'done' || status === 'archived') return null;

  const target = inputs.tasksHours;
  const created = inputs.createdAt;
  const workingDays = parseWorkingDays(inputs.workingDays);

  if (created == null || target == null || !Number.isFinite(target) || target <= 0 || workingDays.length === 0) {
    return null;
  }

  const start = inputs.workingHoursStart || '09:00';
  const end = inputs.workingHoursEnd || '17:00';

  const elapsedHours =
    calculateWorkingTimeMs(created, now, workingDays, start, end, inputs.timeZone ?? undefined) / MS_PER_HOUR;
  const remaining = target - elapsedHours;
  const targetLabel = Math.round(target);

  if (remaining <= 0) {
    const overdueBy = Math.max(1, Math.ceil(-remaining));
    return { text: `Overdue by ${overdueBy}h · ${targetLabel}h SLA`, tone: 'error' };
  }

  const dueIn = Math.max(1, Math.ceil(remaining));
  const tone: SlaTone = remaining <= target * WARNING_REMAINING_FRACTION ? 'warning' : 'neutral';
  return { text: `Due in ${dueIn}h · ${targetLabel}h SLA`, tone };
}
