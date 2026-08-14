import { describe, expect, it } from 'vitest';

import {
  decimatePath,
  distanceIncrementM,
  formatCrewDistance,
  formatWalkDistance,
  haversineMeters,
  knockTape,
  nearestPoint,
  PATH_MAX_POINTS,
} from './live-geometry';

import type { DistancePoint } from './live-geometry';
import type { LatLng } from './haversine';

const BASE = { lat: 45.4215, lng: -75.6972 }; // Ottawa

/** A point `meters` north of BASE (1 degree of latitude ≈ 111,320 m). */
function north(meters: number): LatLng {
  return { lat: BASE.lat + meters / 111_320, lng: BASE.lng };
}

function dp(meters: number, secondsFromStart: number, accuracy: number | null = 10): DistancePoint {
  return { ...north(meters), accuracy_m: accuracy, at: new Date(1_700_000_000_000 + secondsFromStart * 1000) };
}

describe('decimatePath', () => {
  it('folds points closer than the minimum spacing and always keeps the newest point', () => {
    const path = decimatePath([north(0), north(5), north(10), north(30), north(33)]);
    // 5 and 10 fold into the start; 33 is within 15 m of 30 but is the newest point.
    expect(path).toHaveLength(3);
    expect(path[0]).toEqual(north(0));
    expect(path[1]).toEqual(north(30));
    expect(path[2]).toEqual(north(33));
  });

  it('caps the result at PATH_MAX_POINTS without dropping the endpoint', () => {
    const points = Array.from({ length: 1200 }, (_, i) => north(i * 20));
    const path = decimatePath(points);
    expect(path.length).toBeLessThanOrEqual(PATH_MAX_POINTS + 1);
    expect(path[path.length - 1]).toEqual(north(1199 * 20));
  });

  it('returns short inputs unchanged', () => {
    expect(decimatePath([])).toEqual([]);
    expect(decimatePath([north(0), north(1)])).toHaveLength(2);
  });
});

describe('distanceIncrementM', () => {
  it('counts an ordinary walking segment', () => {
    // 80 m in 60 s = 4.8 km/h.
    const meters = distanceIncrementM(dp(0, 0), dp(80, 60));
    expect(meters).toBeGreaterThan(75);
    expect(meters).toBeLessThan(85);
  });

  it('skips a segment when either end is less accurate than 50 m', () => {
    expect(distanceIncrementM(dp(0, 0, 80), dp(80, 60))).toBe(0);
    expect(distanceIncrementM(dp(0, 0), dp(80, 60, 51))).toBe(0);
  });

  it('accepts a missing accuracy reading', () => {
    expect(distanceIncrementM(dp(0, 0, null), dp(80, 60, null))).toBeGreaterThan(0);
  });

  it('skips a segment implying more than 12 km/h', () => {
    // 400 m in 60 s = 24 km/h.
    expect(distanceIncrementM(dp(0, 0), dp(400, 60))).toBe(0);
  });

  it('skips a segment with a non-positive time step', () => {
    expect(distanceIncrementM(dp(0, 60), dp(80, 60))).toBe(0);
    expect(distanceIncrementM(dp(0, 60), dp(80, 0))).toBe(0);
  });
});

describe('knockTape', () => {
  const start = new Date('2026-08-14T15:00:00Z');
  const end = new Date('2026-08-14T16:00:00Z');

  it('buckets knocks into 5-minute slots over the window', () => {
    const tape = knockTape(
      [new Date('2026-08-14T15:01:00Z'), new Date('2026-08-14T15:04:00Z'), new Date('2026-08-14T15:31:00Z')],
      start,
      end,
    );
    expect(tape).toHaveLength(12);
    expect(tape[0]).toBe(true); // both 15:01 and 15:04 land in slot 0
    expect(tape[6]).toBe(true); // 15:31
    expect(tape.filter(Boolean)).toHaveLength(2);
  });

  it('ignores knocks outside the window', () => {
    const tape = knockTape([new Date('2026-08-14T14:59:00Z'), new Date('2026-08-14T16:01:00Z')], start, end);
    expect(tape.some(Boolean)).toBe(false);
  });

  it('returns an empty tape for an empty or inverted window', () => {
    expect(knockTape([], end, start)).toEqual([]);
    expect(knockTape([], start, start)).toEqual([]);
  });

  it('puts a knock at the exact end into the last slot', () => {
    const tape = knockTape([end], start, end);
    expect(tape[tape.length - 1]).toBe(true);
  });
});

describe('nearestPoint', () => {
  it('returns the nearest candidate with its distance', () => {
    const found = nearestPoint(BASE, [north(500), north(120), north(3000)]);
    expect(found?.index).toBe(1);
    expect(found?.meters).toBeGreaterThan(110);
    expect(found?.meters).toBeLessThan(130);
  });

  it('returns null with no candidates', () => {
    expect(nearestPoint(BASE, [])).toBeNull();
  });
});

describe('formatting', () => {
  it('rounds walked distance to 10 m under 1 km, then 0.1 km', () => {
    expect(formatWalkDistance(312)).toBe('310 m');
    expect(formatWalkDistance(996)).toBe('1000 m');
    expect(formatWalkDistance(1437)).toBe('1.4 km');
    expect(formatWalkDistance(-5)).toBe('0 m');
  });

  it('rounds crew distance to 100 m under 1 km, then 0.1 km', () => {
    expect(formatCrewDistance(640)).toBe('600 m');
    expect(formatCrewDistance(1240)).toBe('1.2 km');
  });
});

describe('haversineMeters', () => {
  it('matches the synthetic north() offsets', () => {
    expect(haversineMeters(BASE, north(100))).toBeGreaterThan(99);
    expect(haversineMeters(BASE, north(100))).toBeLessThan(101);
  });
});
