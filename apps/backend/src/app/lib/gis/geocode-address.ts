import { env } from '../../../env';
import { logger } from '../../logger';

/** Deadline for the Google Maps geocode HTTP call — a hung connection must not stall a worker slot. */
const GEOCODE_TIMEOUT_MS = 10_000;

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  type: string;
}

/** True when there is no real Google key or we are running tests — use deterministic dev coords. */
export function isMockOrTestGeocode(): boolean {
  const apiKey = env.googleMapsApiKey;
  return !apiKey || apiKey.includes('mock') || process.env['NODE_ENV'] === 'test';
}

/**
 * Geocode a single free-text address string to coordinates. Shared by the household geocoding job
 * and the Deliveries route planner (spec §14) so there is one Google-Maps fetch path, one mock, and
 * one throttle. Returns null when the address is genuinely not found (ZERO_RESULTS); throws on a
 * transient API error so callers can decide to retry. In mock/test mode it returns deterministic
 * Chicago-area coordinates derived from the address hash and never touches the network.
 */
export async function geocodeAddress(addressStr: string): Promise<GeocodeResult | null> {
  if (isMockOrTestGeocode()) {
    let hash = 0;
    for (let i = 0; i < addressStr.length; i++) {
      hash = addressStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const val = Math.abs(hash % 1000) / 1000; // 0..1
    // Lat bounds 41.85–41.93, lng bounds -87.69–-87.61 (Chicago-ish), matching the household mock.
    return {
      lat: 41.85 + val * 0.08,
      lng: -87.69 + val * 0.08,
      formatted_address: addressStr,
      type: 'rooftop',
    };
  }

  // Throttle real API calls to protect rate limits (matches the household job's 200ms).
  await new Promise((resolve) => setTimeout(resolve, 200));

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressStr)}&key=${env.googleMapsApiKey}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Google Maps Geocoding API returned status ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!isGoogleGeocodeResponse(data)) {
    throw new Error('Unexpected Google Maps Geocoding response shape');
  }
  if (data.status === 'OK' && data.results.length > 0) {
    const result = data.results[0];
    if (!result) return null;
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address,
      type: result.geometry.location_type,
    };
  }
  if (data.status === 'ZERO_RESULTS') {
    logger.info(`Geocoding: address "${addressStr}" returned zero results.`);
    return null;
  }
  throw new Error(`Google Maps Geocoding API error status: ${data.status}`);
}

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number }; location_type: string };
  }>;
}

function isGoogleGeocodeResponse(value: unknown): value is GoogleGeocodeResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['status'] === 'string' && Array.isArray(v['results']);
}
