import { describe, expect, it } from 'vitest';

import { haversineKm, roadKm, type LatLng } from './geo';
import { type PlanParams, type PlanStopInput, orderStops, planRoutes } from './plan-routes';

const DEFAULT_PARAMS: PlanParams = {
  serviceMinutes: 5,
  avgSpeedKmh: 30,
  includeReturnLeg: false,
  drivers: null,
};

const START: LatLng = { lat: 41.85, lng: -87.65 };

function allRequestIds(result: ReturnType<typeof planRoutes>): string[] {
  const fromRoutes = result.routes.flatMap((r) => r.stops.map((s) => s.requestId));
  const fromUnroutable = result.unroutable.map((u) => u.requestId);
  return [...fromRoutes, ...fromUnroutable];
}

describe('haversineKm', () => {
  it('matches a known city pair within 1%', () => {
    // London → Paris is ~343.5 km.
    const london: LatLng = { lat: 51.5074, lng: -0.1278 };
    const paris: LatLng = { lat: 48.8566, lng: 2.3522 };
    const km = haversineKm(london, paris);
    expect(km).toBeGreaterThan(343.5 * 0.99);
    expect(km).toBeLessThan(343.5 * 1.01);
  });

  it('matches a second known pair within 1% (NYC → Boston ~306 km)', () => {
    const nyc: LatLng = { lat: 40.7128, lng: -74.006 };
    const boston: LatLng = { lat: 42.3601, lng: -71.0589 };
    const km = haversineKm(nyc, boston);
    expect(km).toBeGreaterThan(306 * 0.99);
    expect(km).toBeLessThan(306 * 1.01);
  });
});

describe('planRoutes', () => {
  it('returns empty for empty input without throwing', () => {
    expect(planRoutes(START, [], DEFAULT_PARAMS)).toEqual({ routes: [], unroutable: [] });
  });

  it('makes a single 1-stop route for one nearby stop', () => {
    const stops: PlanStopInput[] = [{ requestId: '1', lat: 41.851, lng: -87.651 }];
    const result = planRoutes(START, stops, DEFAULT_PARAMS);
    expect(result.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.stops).toHaveLength(1);
    expect(result.routes[0]?.stops[0]?.requestId).toBe('1');
    expect(result.routes[0]?.stops[0]?.seq).toBe(1);
  });

  it('splits a 4×4 grid into ≤60-minute routes covering every stop exactly once', () => {
    const stops: PlanStopInput[] = [];
    let id = 0;
    // ~500 m spacing near the start.
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        stops.push({ requestId: String(++id), lat: 41.85 + r * 0.0045, lng: -87.65 + c * 0.006 });
      }
    }
    const result = planRoutes(START, stops, DEFAULT_PARAMS);

    expect(result.unroutable).toEqual([]);
    for (const route of result.routes) {
      expect(route.totalMinutes).toBeLessThanOrEqual(60);
      expect(route.stops.length).toBeGreaterThan(0);
    }
    const ids = allRequestIds(result).sort();
    expect(new Set(ids).size).toBe(16); // no duplicates
    expect(ids).toEqual(stops.map((s) => s.requestId).sort());
  });

  it('flags a 50 km-away point as unroutable and never routes it', () => {
    const stops: PlanStopInput[] = [
      { requestId: '1', lat: 41.851, lng: -87.651 },
      { requestId: '2', lat: 41.852, lng: -87.652 },
      { requestId: 'far', lat: 42.3, lng: -87.1 }, // ~50+ km away
    ];
    const result = planRoutes(START, stops, DEFAULT_PARAMS);
    const routed = result.routes.flatMap((r) => r.stops.map((s) => s.requestId));
    expect(routed).not.toContain('far');
    expect(result.unroutable.map((u) => u.requestId)).toContain('far');
    const reason = result.unroutable.find((u) => u.requestId === 'far')?.reason;
    expect(['isolated', 'too_far_from_start']).toContain(reason);
  });

  it('is deterministic: identical input twice yields deep-equal output', () => {
    const stops: PlanStopInput[] = [];
    for (let i = 0; i < 12; i++) {
      stops.push({ requestId: String(i), lat: 41.85 + (i % 4) * 0.004, lng: -87.65 + Math.floor(i / 4) * 0.005 });
    }
    const a = planRoutes(START, stops, DEFAULT_PARAMS);
    const b = planRoutes(START, stops, DEFAULT_PARAMS);
    expect(a).toEqual(b);
  });

  it('2-opt yields the optimal open path for a crossed square', () => {
    // Four corners of a ~700 m square; feeding them in a crossing order must resolve to the
    // minimal-length open path from the start.
    const d = 0.006;
    const corners: PlanStopInput[] = [
      { requestId: 'A', lat: 41.85, lng: -87.65 },
      { requestId: 'B', lat: 41.85 + d, lng: -87.65 + d },
      { requestId: 'C', lat: 41.85, lng: -87.65 + d },
      { requestId: 'D', lat: 41.85 + d, lng: -87.65 },
    ];
    const result = planRoutes(START, corners, DEFAULT_PARAMS);
    expect(result.routes).toHaveLength(1);
    const order = result.routes[0]?.stops.map((s) => s.requestId) ?? [];

    // Brute-force the minimal open-path length from START over all 24 orderings.
    const byId = new Map(corners.map((c) => [c.requestId, c] as const));
    const pathLen = (ids: string[]): number => {
      let total = 0;
      let prev: LatLng = START;
      for (const id of ids) {
        const p = byId.get(id);
        if (!p) continue;
        total += roadKm(prev, p);
        prev = p;
      }
      return total;
    };
    const permute = (arr: string[]): string[][] =>
      arr.length <= 1
        ? [arr]
        : arr.flatMap((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
    const best = Math.min(...permute(['A', 'B', 'C', 'D']).map(pathLen));
    expect(pathLen(order)).toBeLessThanOrEqual(best + 1e-6);
  });

  it('balances stops across a fixed driver count', () => {
    const stops: PlanStopInput[] = [];
    for (let i = 0; i < 10; i++) {
      stops.push({ requestId: String(i), lat: 41.85 + (i % 5) * 0.003, lng: -87.65 + Math.floor(i / 5) * 0.004 });
    }
    const result = planRoutes(START, stops, { ...DEFAULT_PARAMS, drivers: 2 });
    // Each route capped at ceil(10/2)=5 stops.
    for (const route of result.routes) {
      expect(route.stops.length).toBeLessThanOrEqual(5);
    }
    expect(allRequestIds(result).sort()).toEqual(stops.map((s) => s.requestId).sort());
  });

  it('handles a 500-stop cloud in under 2 seconds', () => {
    const stops: PlanStopInput[] = [];
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 500; i++) {
      stops.push({ requestId: String(i), lat: 41.85 + rand() * 0.05, lng: -87.65 + rand() * 0.05 });
    }
    const t0 = Date.now();
    const result = planRoutes(START, stops, DEFAULT_PARAMS);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    expect(allRequestIds(result).sort((a, b) => Number(a) - Number(b))).toEqual(stops.map((s) => s.requestId));
  });
});

describe('orderStops', () => {
  const start: LatLng = { lat: 45.0, lng: -75.0 };

  it('chains every stop nearest-first from the start, keeping them all', () => {
    // Four stops on a line east of the start, given shuffled.
    const stops = [
      { id: 'c', lat: 45.0, lng: -74.97 },
      { id: 'a', lat: 45.0, lng: -74.99 },
      { id: 'd', lat: 45.0, lng: -74.96 },
      { id: 'b', lat: 45.0, lng: -74.98 },
    ];
    expect(orderStops(start, stops)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is deterministic: identical input yields the identical sequence, id breaking ties', () => {
    const twin = [
      { id: '2', lat: 45.0, lng: -74.99 },
      { id: '1', lat: 45.0, lng: -74.99 },
    ];
    expect(orderStops(start, twin)).toEqual(['1', '2']);
    expect(orderStops(start, twin)).toEqual(orderStops(start, twin.slice().reverse()));
  });

  it('handles the empty and single-stop cases', () => {
    expect(orderStops(start, [])).toEqual([]);
    expect(orderStops(start, [{ id: 'only', lat: 45.1, lng: -75.1 }])).toEqual(['only']);
  });

  it('never drops a stop, however far away — turf membership was decided at cut time', () => {
    const stops = [
      { id: 'near', lat: 45.0, lng: -74.99 },
      { id: 'far', lat: 47.0, lng: -70.0 },
    ];
    expect(orderStops(start, stops)).toEqual(['near', 'far']);
  });
});
