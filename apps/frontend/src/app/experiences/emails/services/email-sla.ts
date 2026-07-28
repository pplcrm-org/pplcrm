import { calculateWorkingTimeMs } from '../../../../../../../libs/common/src/lib/sla';

const MS_PER_HOUR = 3_600_000;
/** Below this fraction of the target still remaining, the pill turns warning-tinted. */
const WARNING_REMAINING_FRACTION = 0.25;

export type SlaTone = 'neutral' | 'warning' | 'error';

export interface SlaPill {
  text: string;
  tone: SlaTone;
}

export interface SlaInputs {
  /** Workspace SLA target for an email reply, in working hours. */
  emailsHours: number | null | undefined;
  /** When the inbound email was received. */
  receivedAt: Date | null | undefined;
  status: string | null | undefined;
  /** '09:00' */
  workingHoursEnd: string | null | undefined;
  /** '17:00' */
  workingHoursStart: string | null | undefined;
  /** '1,2,3,4,5' — day numbers, 0=Sun … 6=Sat. */
  workingDays: string | null | undefined;
  /** Workspace IANA zone (`organization.timezone`); without it the pill would use the
   *  viewer's browser zone and disagree with the server-computed dashboard breach counts. */
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
 * Honest per-thread SLA pill (§5) computed only from data we already have:
 * the received timestamp + the workspace SLA config. We do NOT know the actual
 * first-response time, so a closed thread reports only "Closed" — never a
 * fabricated "sent in 1.2h". Returns null when there's nothing truthful to show.
 */
export function computeEmailSla(inputs: SlaInputs, now: Date = new Date()): SlaPill | null {
  const status = (inputs.status ?? 'open').toLowerCase();

  if (status === 'closed') {
    return { text: 'Closed', tone: 'neutral' };
  }

  const target = inputs.emailsHours;
  const received = inputs.receivedAt;
  const workingDays = parseWorkingDays(inputs.workingDays);

  // Nothing truthful to compute without a received time, a target and a schedule.
  if (received == null || target == null || !Number.isFinite(target) || target <= 0 || workingDays.length === 0) {
    return null;
  }

  const start = inputs.workingHoursStart || '09:00';
  const end = inputs.workingHoursEnd || '17:00';

  const elapsedHours =
    calculateWorkingTimeMs(received, now, workingDays, start, end, inputs.timeZone ?? undefined) / MS_PER_HOUR;
  const remaining = target - elapsedHours;
  const targetLabel = Math.round(target);

  if (remaining <= 0) {
    const overdueBy = Math.max(1, Math.ceil(-remaining));
    return { text: `First response overdue by ${overdueBy}h · ${targetLabel}h SLA`, tone: 'error' };
  }

  const dueIn = Math.max(1, Math.ceil(remaining));
  const tone: SlaTone = remaining <= target * WARNING_REMAINING_FRACTION ? 'warning' : 'neutral';
  return { text: `First response due in ${dueIn}h · ${targetLabel}h SLA`, tone };
}
