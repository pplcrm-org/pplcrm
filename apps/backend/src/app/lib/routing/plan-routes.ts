import { haversineKm, legMinutes, roadKm, type LatLng } from './geo';
import { OUTLIER_NEAREST_KM, ROUTE_FILL_TARGET_MIN, TWO_OPT_MAX_ITERATIONS } from './route-constants';

export interface PlanStopInput extends LatLng {
  requestId: string;
}

export interface PlanParams {
  serviceMinutes: number;
  avgSpeedKmh: number;
  includeReturnLeg: boolean;
  /** Optional number of volunteers to balance stops across; null = as many routes as needed. */
  drivers?: number | null;
}

export interface PlannedStop {
  requestId: string;
  seq: number;
  /** Estimated travel minutes from the previous point (the start for seq 1). */
  legMinutes: number;
}

export interface PlannedRoute {
  stops: PlannedStop[];
  totalMinutes: number;
  totalKm: number;
}

export type UnroutableReason = 'too_far_from_start' | 'isolated';

export interface UnroutableStop {
  requestId: string;
  reason: UnroutableReason;
  /** For 'isolated', km to the nearest OTHER stop; for 'too_far_from_start', road km from the start. */
  nearestKm: number;
}

export interface PlanResult {
  routes: PlannedRoute[];
  unroutable: UnroutableStop[];
}

function stopMinutes(a: LatLng, b: LatLng, params: PlanParams): number {
  return legMinutes(a, b, params.avgSpeedKmh);
}

/** Total estimated minutes for an ordered chain of stops leaving `start`. */
function routeMinutes(start: LatLng, stops: PlanStopInput[], params: PlanParams): number {
  if (stops.length === 0) return 0;
  let minutes = 0;
  let cursor: LatLng = start;
  for (const s of stops) {
    minutes += stopMinutes(cursor, s, params) + params.serviceMinutes;
    cursor = s;
  }
  if (params.includeReturnLeg) minutes += stopMinutes(cursor, start, params);
  return minutes;
}

/** Deterministic nearest-remaining stop to a cursor, breaking ties by requestId. */
function nearest(cursor: LatLng, pool: PlanStopInput[]): number {
  let bestIdx = -1;
  let bestKm = Infinity;
  let bestId = '';
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (!s) continue;
    const km = haversineKm(cursor, s);
    if (km < bestKm || (km === bestKm && (bestIdx === -1 || s.requestId < bestId))) {
      bestKm = km;
      bestIdx = i;
      bestId = s.requestId;
    }
  }
  return bestIdx;
}

/** 2-opt improvement (deterministic, capped). Minimises the leaving-start road distance. */
function twoOptImprove(start: LatLng, order: PlanStopInput[], params: PlanParams): PlanStopInput[] {
  if (order.length < 4) return order;
  const dist = (a: LatLng, b: LatLng): number => roadKm(a, b);
  const points: LatLng[] = [start, ...order];
  let best = order.slice();
  let improved = true;
  let iterations = 0;
  const tourLength = (seq: PlanStopInput[]): number => {
    let total = 0;
    let prev: LatLng = start;
    for (const s of seq) {
      total += dist(prev, s);
      prev = s;
    }
    if (params.includeReturnLeg) total += dist(prev, start);
    return total;
  };
  let bestLen = tourLength(best);
  while (improved && iterations < TWO_OPT_MAX_ITERATIONS) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const len = tourLength(candidate);
        if (len + 1e-9 < bestLen) {
          best = candidate;
          bestLen = len;
          improved = true;
        }
        iterations++;
        if (iterations >= TWO_OPT_MAX_ITERATIONS) break;
      }
      if (iterations >= TWO_OPT_MAX_ITERATIONS) break;
    }
  }
  void points;
  return best;
}

function materialize(start: LatLng, order: PlanStopInput[], params: PlanParams): PlannedRoute {
  const stops: PlannedStop[] = [];
  let cursor: LatLng = start;
  let totalKm = 0;
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    if (!s) continue;
    const legMin = stopMinutes(cursor, s, params);
    totalKm += roadKm(cursor, s);
    stops.push({ requestId: s.requestId, seq: i + 1, legMinutes: round1(legMin) });
    cursor = s;
  }
  if (params.includeReturnLeg && order.length > 0) totalKm += roadKm(cursor, start);
  return {
    stops,
    totalMinutes: round1(routeMinutes(start, order, params)),
    totalKm: round1(totalKm),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface OrderableStop extends LatLng {
  id: string;
}

/**
 * Order ONE set of stops into a single drive sequence — the whole-turf sibling of
 * `planRoutes`. No time budget and no partitioning: which doors are in the turf was
 * decided at cut time, so every stop stays in and only the visit order is chosen here.
 * Greedy nearest-neighbour from the start, refined by the same bounded 2-opt pass, and
 * deterministic (id breaks every tie). Used to write `turf_households.walk_order` for
 * travel='drive' turfs, where the boustrophedon street sweep would order doors for a
 * walker, not a driver.
 */
export function orderStops(start: LatLng, stops: OrderableStop[]): string[] {
  const pool: PlanStopInput[] = stops.map((s) => ({ requestId: s.id, lat: s.lat, lng: s.lng }));
  // Only `includeReturnLeg` matters to the passes used here; the time fields feed the
  // budget logic this function deliberately has none of.
  const params: PlanParams = { serviceMinutes: 0, avgSpeedKmh: 30, includeReturnLeg: false };
  const chain: PlanStopInput[] = [];
  const remaining = pool.slice();
  let cursor: LatLng = start;
  while (remaining.length > 0) {
    const idx = nearest(cursor, remaining);
    if (idx < 0) break;
    const next = remaining[idx];
    if (!next) break;
    chain.push(next);
    remaining.splice(idx, 1);
    cursor = next;
  }
  return twoOptImprove(start, chain, params).map((s) => s.requestId);
}

/**
 * Group geocoded stops into ~1-hour routes (spec §14). Pure — no DB, no I/O. Greedy
 * nearest-neighbour fill under the time budget, refined with a bounded 2-opt pass. Deterministic:
 * identical input always yields deep-equal output (requestId breaks every tie).
 */
export function planRoutes(start: LatLng, inputStops: PlanStopInput[], params: PlanParams): PlanResult {
  const unroutable: UnroutableStop[] = [];
  if (inputStops.length === 0) return { routes: [], unroutable };

  // 1. Partition out stops that can't join any route.
  const routable: PlanStopInput[] = [];
  for (const s of inputStops) {
    const startRoadKm = roadKm(start, s);
    const startMinutes = legMinutes(start, s, params.avgSpeedKmh) + params.serviceMinutes;
    let nearestOtherKm = Infinity;
    for (const other of inputStops) {
      if (other === s || other.requestId === s.requestId) continue;
      nearestOtherKm = Math.min(nearestOtherKm, haversineKm(s, other));
    }
    if (startMinutes > ROUTE_FILL_TARGET_MIN) {
      // Far from the start point. If it's also far from every other stop, it's genuinely isolated;
      // otherwise it's simply too far to reach within the hour from this start.
      if (nearestOtherKm > OUTLIER_NEAREST_KM) {
        unroutable.push({ requestId: s.requestId, reason: 'isolated', nearestKm: round1(nearestOtherKm) });
      } else {
        unroutable.push({ requestId: s.requestId, reason: 'too_far_from_start', nearestKm: round1(startRoadKm) });
      }
      continue;
    }
    routable.push(s);
  }

  // 2. Deterministic seed order: nearest-to-start first, requestId tiebreak.
  routable.sort((a, b) => {
    const da = haversineKm(start, a);
    const db = haversineKm(start, b);
    if (da !== db) return da - db;
    return a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0;
  });

  const maxStopsPerRoute =
    params.drivers && params.drivers > 0 ? Math.ceil(routable.length / params.drivers) : Number.POSITIVE_INFINITY;

  // 3. Greedy fill.
  const remaining = routable.slice();
  const routes: PlannedRoute[] = [];
  while (remaining.length > 0) {
    const chain: PlanStopInput[] = [];
    let cursor: LatLng = start;
    while (remaining.length > 0) {
      const idx = nearest(cursor, remaining);
      if (idx < 0) break;
      const candidate = remaining[idx];
      if (!candidate) break;
      const projected = routeMinutes(start, [...chain, candidate], params);
      if (chain.length > 0 && (projected > ROUTE_FILL_TARGET_MIN || chain.length >= maxStopsPerRoute)) {
        break;
      }
      chain.push(candidate);
      remaining.splice(idx, 1);
      cursor = candidate;
    }
    const improved = twoOptImprove(start, chain, params);
    routes.push(materialize(start, improved, params));
  }

  return { routes, unroutable };
}
