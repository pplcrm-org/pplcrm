import { describe, expect, it } from 'vitest';

import { DEFAULT_TIMEZONE, calculateWorkingTimeMs, isValidTimeZone } from './sla';

const HOUR = 60 * 60 * 1000;

describe('calculateWorkingTimeMs', () => {
  const workingDays = [1, 2, 3, 4, 5]; // Mon - Fri
  const startHours = '09:00';
  const endHours = '17:00';
  const zone = 'America/Toronto';

  /**
   * Instants are written in UTC and the zone is passed explicitly, so these assertions do not
   * depend on the test runner's TZ. Toronto is UTC-4 (EDT) on every date used below except the
   * November one, which is UTC-5 (EST) — the local wall clock is given in each comment.
   */
  const hoursBetween = (startUtc: string, endUtc: string, tz: string = zone): number =>
    calculateWorkingTimeMs(new Date(startUtc), new Date(endUtc), workingDays, startHours, endHours, tz) / HOUR;

  it('should return 0 if start date is after end date', () => {
    // Mon 2026-06-01, 12:00 → 11:00 local.
    expect(hoursBetween('2026-06-01T16:00:00Z', '2026-06-01T15:00:00Z')).toBe(0);
  });

  it('should calculate time within a single working day', () => {
    // Mon 2026-06-01, 10:00 → 14:00 local.
    expect(hoursBetween('2026-06-01T14:00:00Z', '2026-06-01T18:00:00Z')).toBe(4);
  });

  it('should cap calculations to working hours', () => {
    // Mon 2026-06-01, 08:00 → 18:00 local: clamped to the 8-hour window.
    expect(hoursBetween('2026-06-01T12:00:00Z', '2026-06-01T22:00:00Z')).toBe(8);
  });

  it('should exclude weekends', () => {
    // Fri 2026-05-29 16:00 → Mon 2026-06-01 10:00 local: 1h Friday + 1h Monday.
    expect(hoursBetween('2026-05-29T20:00:00Z', '2026-06-01T14:00:00Z')).toBe(2);
  });

  it('should return 0 if checking completely over a weekend', () => {
    // Sat 2026-05-30 08:00 → Sun 2026-05-31 18:00 local.
    expect(hoursBetween('2026-05-30T12:00:00Z', '2026-05-31T22:00:00Z')).toBe(0);
  });

  it('should fallback to standard elapsed time if settings are malformed', () => {
    // A Saturday span, so a working-window result would be 0 — proving the fallback fired.
    const start = new Date('2026-05-30T12:00:00Z');
    const end = new Date('2026-05-30T14:00:00Z');
    expect(calculateWorkingTimeMs(start, end, [], startHours, endHours, zone)).toBe(2 * HOUR);
    expect(calculateWorkingTimeMs(start, end, workingDays, 'invalid', endHours, zone)).toBe(2 * HOUR);
  });

  it('reads the working window in the workspace zone, not the runtime zone', () => {
    // The same instants: Wed 08:00–15:00 in Toronto, but 21:00–04:00 in Tokyo.
    expect(hoursBetween('2026-03-11T12:00:00Z', '2026-03-11T19:00:00Z', 'America/Toronto')).toBe(6);
    expect(hoursBetween('2026-03-11T12:00:00Z', '2026-03-11T19:00:00Z', 'Asia/Tokyo')).toBe(0);
  });

  it('holds a full 8-hour day across the spring-forward DST boundary', () => {
    // DST starts Sun 2026-03-08 in Toronto; the Monday after is still a normal 8h day.
    expect(hoursBetween('2026-03-09T00:00:00Z', '2026-03-10T00:00:00Z')).toBe(8);
  });

  it('holds a full 8-hour day across the fall-back DST boundary', () => {
    // DST ends Sun 2026-11-01 in Toronto; the Monday after is still a normal 8h day.
    expect(hoursBetween('2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')).toBe(8);
  });

  it('falls back to the default zone, not the runtime zone, when the zone is missing or bad', () => {
    const start = new Date('2026-06-01T14:00:00Z');
    const end = new Date('2026-06-01T18:00:00Z');
    const expected = calculateWorkingTimeMs(start, end, workingDays, startHours, endHours, DEFAULT_TIMEZONE);

    expect(calculateWorkingTimeMs(start, end, workingDays, startHours, endHours, 'Not/AZone')).toBe(expected);
    expect(calculateWorkingTimeMs(start, end, workingDays, startHours, endHours)).toBe(expected);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects everything else', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});
