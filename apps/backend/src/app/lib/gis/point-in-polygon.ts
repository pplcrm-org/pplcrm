/**
 * Point-in-polygon tests — the whole of pplCRM's geometry engine.
 *
 * No PostGIS extension is installed (the schema creates only `pg_trgm` and `pgcrypto`), and none is
 * needed: these three functions are a correct even-odd ray cast, including interior rings, and they
 * run as pure CPU with no external call. That is why re-matching every household against a redrawn
 * map is free, and why the product can promise that drawing a boundary never costs anything.
 *
 * They were moved here from `geocoding.ts` unchanged, so that the boundary matcher can use them
 * without importing the geocoding module (which imports the matcher back, and would close a cycle).
 * `geocoding.ts` re-exports them, so existing imports of `isPointInPolygon` from there still work.
 *
 * Argument order is longitude first, matching GeoJSON (RFC 7946 §3.1.1) and NOT matching
 * `households.lat` / `households.lng` or any mapping UI. Every caller converts.
 *
 * If matching ever proves too slow in JavaScript, adding PostGIS is the upgrade path — Azure
 * Database for PostgreSQL Flexible Server supports it. Do not add it pre-emptively.
 */

function isPointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] ?? [];
    const [xj, yj] = ring[j] ?? [];
    if (xi === undefined || yi === undefined || xj === undefined || yj === undefined) continue;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInPolygon(lng: number, lat: number, polygon: number[][][]): boolean {
  const outerRing = polygon[0];
  if (!outerRing || !isPointInRing(lng, lat, outerRing)) {
    return false;
  }
  // If it's inside any inner rings (holes), it is NOT in the polygon
  for (const innerRing of polygon.slice(1)) {
    if (isPointInRing(lng, lat, innerRing)) {
      return false;
    }
  }
  return true;
}

export function isPointInMultiPolygon(lng: number, lat: number, multipolygon: number[][][][]): boolean {
  for (const polygon of multipolygon) {
    if (isPointInPolygon(lng, lat, polygon)) {
      return true;
    }
  }
  return false;
}
