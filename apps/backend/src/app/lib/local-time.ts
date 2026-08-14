import { DEFAULT_TIMEZONE, isValidTimeZone } from '@common';

/**
 * Wall-clock arithmetic in a tenant's IANA zone (`organization.timezone` — the only
 * timezone the product stores). The server runs pinned to UTC, so "local midnight"
 * has to be computed, not read off the clock.
 *
 * Pure Intl math, no library. Offset is derived by formatting the instant in the target
 * zone and diffing against UTC; DST transitions are therefore handled by Intl itself.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function safeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? String(timeZone) : DEFAULT_TIMEZONE;
}

/** The UTC instant of `hour`:00 today (local calendar date of `now`) in `timeZone`. */
export function localHourTodayUtc(now: Date, timeZone: string | null | undefined, hour: number): Date {
  const zone = safeZone(timeZone);
  const wall = wallClockIn(now, zone);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsetMs = asIfUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, hour) - offsetMs);
}

/** The UTC instant of the most recent local midnight in `timeZone`. */
export function localMidnightUtc(now: Date, timeZone: string | null | undefined): Date {
  return localHourTodayUtc(now, timeZone, 0);
}
