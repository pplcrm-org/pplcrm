/**
 * Great-circle distance, shared by the backend routing engine and the companion apps.
 *
 * Lives in libs/common rather than the backend because the Canvass Companion sorts turfs
 * by how far away they are, and a second implementation on the client would be a second
 * thing to get wrong.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres between two coordinates. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // Clamped: floating-point can push `h` a hair above 1 for antipodal points, and
  // asin(>1) is NaN — which would silently poison every distance downstream.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
