/**
 * The IANA zone used when a workspace has not set `organization.timezone`.
 *
 * Deliberately a real zone rather than the runtime default: the backend runs in UTC and the
 * browser runs in whatever the user's laptop says, so "runtime default" meant the SLA badge
 * and the SLA pill for the same task could disagree by hours.
 */
export const DEFAULT_TIMEZONE = 'America/Toronto';

/** Fields of a wall clock, read in a specific zone. */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
}

const ZONED_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let dtf = ZONED_FORMATTERS.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    ZONED_FORMATTERS.set(timeZone, dtf);
  }
  return dtf;
}

/** True when the runtime recognises the zone; guards against a bad stored setting. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at a given instant, in ms (positive = ahead of UTC). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Reading the zone's wall clock back as though it were UTC yields the offset directly.
  // `% 24` because some ICU builds render midnight as hour 24.
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return asIfUtc - instantMs;
}

/**
 * The zone's UTC offset at an instant as `+HHMM` / `-HHMM`.
 *
 * Angular's `formatDate` takes an offset string rather than an IANA name, so this is how the
 * workspace zone reaches the `pcDate` pipe and the datagrid.
 */
export function timeZoneOffsetString(instantMs: number, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const totalMinutes = Math.round(zoneOffsetMs(instantMs, zone) / 60000);
  const sign = totalMinutes < 0 ? '-' : '+';
  const abs = Math.abs(totalMinutes);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

/** The calendar date showing on `timeZone`'s wall clock at a given instant. */
function zonedDate(instantMs: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** The instant at which `timeZone`'s wall clock reads the given local date and time. */
function instantFromZonedTime(date: ZonedParts, hour: number, minute: number, timeZone: string): number {
  const asIfUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  // Two passes: the first uses the offset at the wrong instant, the second corrects it.
  // That settles DST transitions, where the offset before and after the boundary differ.
  const firstPass = asIfUtc - zoneOffsetMs(asIfUtc, timeZone);
  return asIfUtc - zoneOffsetMs(firstPass, timeZone);
}

/**
 * Working (business-hours) milliseconds elapsed between two instants.
 *
 * `timeZone` decides which wall clock "09:00–17:00, Mon–Fri" refers to. Pass the workspace's
 * `organization.timezone` so the answer is the same whether it is computed on the server or
 * in a browser; omitting it falls back to DEFAULT_TIMEZONE rather than to the runtime zone.
 */
export function calculateWorkingTimeMs(
  startDate: Date,
  endDate: Date,
  workingDays: number[],
  workingHoursStart: string,
  workingHoursEnd: string,
  timeZone?: string,
): number {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return 0;
  }

  const [startHour = NaN, startMin = NaN] = workingHoursStart.split(':').map(Number);
  const [endHour = NaN, endMin = NaN] = workingHoursEnd.split(':').map(Number);

  if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin) || workingDays.length === 0) {
    // Malformed settings: fall back to plain elapsed time rather than reporting zero, so a
    // misconfigured workspace still sees its work age instead of looking permanently fresh.
    return endMs - startMs;
  }

  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;

  // Walk calendar days in the workspace's zone. The cursor is a pure calendar counter held as
  // a UTC midnight, so stepping it never drifts across a DST boundary.
  const firstDay = zonedDate(startMs, zone);
  const lastDay = zonedDate(endMs, zone);
  let cursor = Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day);
  const lastCursor = Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day);

  let totalMs = 0;

  while (cursor <= lastCursor) {
    const day = new Date(cursor);
    if (workingDays.includes(day.getUTCDay())) {
      const calendarDay: ZonedParts = {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
      };
      const workStart = instantFromZonedTime(calendarDay, startHour, startMin, zone);
      const workEnd = instantFromZonedTime(calendarDay, endHour, endMin, zone);

      const overlap = Math.min(endMs, workEnd) - Math.max(startMs, workStart);
      if (overlap > 0) totalMs += overlap;
    }

    cursor += 24 * 60 * 60 * 1000;
  }

  return totalMs;
}
