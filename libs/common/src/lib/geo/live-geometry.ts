/**
 * Pure geometry for the canvassing Live tab — path decimation, walked-distance rules and
 * the knock tape. Server-side only in practice (the client is sent finished values and
 * does no geometry), but pure and dependency-free so it is testable like walk-order.ts.
 */

import { haversineKm } from './haversine';

import type { LatLng } from './haversine';

/** Consecutive path points closer than this are folded into one. */
export const PATH_MIN_SPACING_M = 15;
/** Hard cap on points returned per path — a payload bound, not a quality knob. */
export const PATH_MAX_POINTS = 400;
/** A ping less accurate than this never contributes to walked distance. */
export const DISTANCE_MAX_ACCURACY_M = 50;
/** A segment implying more than this speed is a GPS jump or a car, not walking. */
export const DISTANCE_MAX_SPEED_KMH = 12;
/** A ping less accurate than this is unusable as a display position. */
export const POSITION_MAX_ACCURACY_M = 100;
/** Knock-tape bucket width. */
export const KNOCK_TAPE_SLOT_MS = 5 * 60 * 1000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

/**
 * Thin an ordered ping trail to a drawable path: keep a point only once it is
 * PATH_MIN_SPACING_M from the last kept one, always keep the newest point (the current
 * position), and stride-sample if the result still exceeds PATH_MAX_POINTS.
 */
export function decimatePath(points: LatLng[]): LatLng[] {
  const first = points[0];
  const newest = points[points.length - 1];
  if (points.length <= 2 || first == null || newest == null) return points.slice();
  const kept: LatLng[] = [first];
  let anchor = first;
  for (let i = 1; i < points.length - 1; i++) {
    const candidate = points[i];
    if (candidate == null) continue;
    if (haversineMeters(anchor, candidate) >= PATH_MIN_SPACING_M) {
      kept.push(candidate);
      anchor = candidate;
    }
  }
  kept.push(newest);
  if (kept.length <= PATH_MAX_POINTS) return kept;
  const stride = Math.ceil(kept.length / PATH_MAX_POINTS);
  const sampled: LatLng[] = [];
  for (let i = 0; i < kept.length; i += stride) {
    const p = kept[i];
    if (p != null) sampled.push(p);
  }
  if (sampled[sampled.length - 1] !== newest) sampled.push(newest);
  return sampled;
}

export interface DistancePoint extends LatLng {
  /** null = the device did not report accuracy; accepted rather than discarded. */
  accuracy_m: number | null;
  at: Date;
}

/**
 * Metres this segment adds to distance_walked_m, or 0 when the segment is skipped:
 * either end worse than DISTANCE_MAX_ACCURACY_M, a non-positive time step, or an implied
 * speed over DISTANCE_MAX_SPEED_KMH (a GPS jump, or a drive between streets).
 */
export function distanceIncrementM(prev: DistancePoint, next: DistancePoint): number {
  if (prev.accuracy_m != null && prev.accuracy_m > DISTANCE_MAX_ACCURACY_M) return 0;
  if (next.accuracy_m != null && next.accuracy_m > DISTANCE_MAX_ACCURACY_M) return 0;
  const dtMs = next.at.getTime() - prev.at.getTime();
  if (dtMs <= 0) return 0;
  const meters = haversineMeters(prev, next);
  const speedKmh = meters / 1000 / (dtMs / 3_600_000);
  if (speedKmh > DISTANCE_MAX_SPEED_KMH) return 0;
  return meters;
}

/**
 * Bucket knock timestamps into KNOCK_TAPE_SLOT_MS slots across [windowStart, windowEnd].
 * The client draws runs and gaps from these booleans and never positions individual ticks.
 * Knocks outside the window are ignored; the last partial slot is included.
 */
export function knockTape(knockTimes: readonly Date[], windowStart: Date, windowEnd: Date): boolean[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  if (endMs <= startMs) return [];
  const slotCount = Math.ceil((endMs - startMs) / KNOCK_TAPE_SLOT_MS);
  const slots = new Array<boolean>(slotCount).fill(false);
  for (const knock of knockTimes) {
    const offset = knock.getTime() - startMs;
    if (offset < 0 || knock.getTime() > endMs) continue;
    const index = Math.min(slotCount - 1, Math.floor(offset / KNOCK_TAPE_SLOT_MS));
    slots[index] = true;
  }
  return slots;
}

/** Index and distance of the candidate nearest to `target`; null when there are none. */
export function nearestPoint(target: LatLng, candidates: readonly LatLng[]): { index: number; meters: number } | null {
  let best: { index: number; meters: number } | null = null;
  for (const [i, candidate] of candidates.entries()) {
    const meters = haversineMeters(target, candidate);
    if (!best || meters < best.meters) best = { index: i, meters };
  }
  return best;
}

/** "310 m" under 1 km (nearest 10 m), then "1.4 km" (nearest 0.1 km). */
export function formatWalkDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

/** Crew distance: nearest 100 m under 1 km, then 0.1 km. */
export function formatCrewDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters / 100) * 100} m`;
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}
