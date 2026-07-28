import { AVG_SPEED_KMH, ROAD_WINDING_FACTOR } from './route-constants';

// The distance primitive itself lives in libs/common: the Canvass Companion sorts turfs
// by distance in the browser, and two implementations would be two things to get wrong.
// Re-exported here so every existing routing caller keeps importing from one place.
export { haversineKm, type LatLng } from '../../../../../../libs/common/src';
import { haversineKm, type LatLng } from '../../../../../../libs/common/src';

const MINUTES_PER_HOUR = 60;

/** Estimated road distance in kilometres (straight-line × winding factor). */
export function roadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_WINDING_FACTOR;
}

/** Estimated travel time in minutes from a to b at the given average speed. */
export function legMinutes(a: LatLng, b: LatLng, avgSpeedKmh: number = AVG_SPEED_KMH): number {
  return (roadKm(a, b) / avgSpeedKmh) * MINUTES_PER_HOUR;
}
