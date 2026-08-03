import {
  BOUNDARY_MAX_FEATURES_PER_SET,
  BOUNDARY_MAX_VERTICES_PER_FEATURE,
  BOUNDARY_UPLOAD_MAX_BYTES,
  BOUNDARY_UPLOAD_MAX_LABEL,
  type BoundaryGeometryType,
} from '@common';
import type { PcLatLng } from '@uxcommon/components/map/map-types';

/**
 * Pure helpers for the Boundaries settings page: reading an uploaded GeoJSON file well enough to
 * ask the user which property holds each area's name, and converting between the map component's
 * `PcLatLng[]` vertex rings and stored GeoJSON geometry.
 *
 * Everything here is deliberately free of Angular, the tRPC client and the Google Maps SDK, so the
 * rules can be tested on their own.
 *
 * The file is inspected in the browser before a byte is sent, for one reason: an upload that is
 * going to be refused should be refused while the user is still looking at the file picker, with a
 * message naming the limit it broke. The server repeats every one of these checks — this is a
 * courtesy, never the enforcement.
 */

/** How many features are sampled when listing the properties the file offers. */
const PROPERTY_SAMPLE_FEATURES = 200;

/** How many example values are shown beside each property name. */
const PROPERTY_SAMPLE_VALUES = 3;

/** One candidate GeoJSON property, with a few of its values so the user can recognise it. */
export interface BoundaryPropertyOption {
  key: string;
  /** Distinct example values, in file order, so "NAME → Ward 1, Ward 2, Ward 3" reads at a glance. */
  samples: string[];
}

/** What the browser could work out about an uploaded GeoJSON file. */
export interface GeoJsonInspection {
  /** Entries in the file's `features` list, whatever their geometry. */
  featureCount: number;
  /** Entries that are a Polygon or MultiPolygon, and so become an area. */
  areaCount: number;
  /** Entries skipped because they are points, lines, or have no geometry at all. */
  skippedCount: number;
  /** Every property name seen on a sampled feature, with example values. */
  properties: BoundaryPropertyOption[];
  /** The largest point count on any one area, for the "how detailed is this file" line. */
  maxVertices: number;
}

export type GeoJsonInspectionResult = { ok: true; inspection: GeoJsonInspection } | { ok: false; message: string };

/**
 * Reject an over-sized file before it is read into memory.
 *
 * Returns the message to show, or null when the size is fine.
 */
export function checkBoundaryFileSize(bytes: number): string | null {
  if (bytes <= BOUNDARY_UPLOAD_MAX_BYTES) return null;
  const megabytes = (bytes / (1024 * 1024)).toFixed(1);
  return `That file is ${megabytes} MB. The limit for one map is ${BOUNDARY_UPLOAD_MAX_LABEL}. Most publishers offer a simplified version of the same map, which is usually far smaller.`;
}

/** Count the points in a raw geometry, or null when it is not an area. */
export function countRawGeometryVertices(geometry: unknown): number | null {
  if (typeof geometry !== 'object' || geometry === null) return null;
  const shape = geometry as { type?: unknown; coordinates?: unknown };
  if (shape.type === 'Polygon') return countRings(shape.coordinates);
  if (shape.type !== 'MultiPolygon') return null;
  if (!Array.isArray(shape.coordinates)) return null;
  let total = 0;
  for (const part of shape.coordinates) {
    const count = countRings(part);
    if (count === null) return null;
    total += count;
  }
  return total;
}

function countRings(rings: unknown): number | null {
  if (!Array.isArray(rings)) return null;
  let total = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring)) return null;
    total += ring.length;
  }
  return total;
}

/**
 * Read a GeoJSON FeatureCollection well enough to offer the property pickers.
 *
 * Geometry is checked structurally rather than with the shared Zod schema. A 20 MB file holds
 * millions of coordinate numbers, and validating every one of them in the browser would freeze the
 * tab for seconds to reach an answer the server is going to work out again anyway.
 */
export function inspectBoundaryGeoJson(text: string): GeoJsonInspectionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: 'That file is not valid JSON, so it cannot be a GeoJSON map. Check you downloaded the GeoJSON version.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, message: 'That file is not a GeoJSON FeatureCollection.' };
  }
  const collection = parsed as { features?: unknown };
  if (!Array.isArray(collection.features)) {
    return { ok: false, message: 'That file has no "features" list, so it is not a GeoJSON FeatureCollection.' };
  }
  if (collection.features.length === 0) {
    return { ok: false, message: 'That file contains no areas.' };
  }
  if (collection.features.length > BOUNDARY_MAX_FEATURES_PER_SET) {
    return {
      ok: false,
      message: `One map may hold at most ${BOUNDARY_MAX_FEATURES_PER_SET.toLocaleString()} areas, and this file has ${collection.features.length.toLocaleString()}. Split it into more than one map, for example one file per region.`,
    };
  }

  const samples = new Map<string, string[]>();
  let areaCount = 0;
  let skippedCount = 0;
  let maxVertices = 0;

  for (const [index, entry] of collection.features.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      skippedCount++;
      continue;
    }
    const feature = entry as { geometry?: unknown; properties?: unknown };
    const vertices = countRawGeometryVertices(feature.geometry);
    if (vertices === null) {
      skippedCount++;
      continue;
    }
    if (vertices > BOUNDARY_MAX_VERTICES_PER_FEATURE) {
      return {
        ok: false,
        message: `One area in that file has ${vertices.toLocaleString()} points, past the limit of ${BOUNDARY_MAX_VERTICES_PER_FEATURE.toLocaleString()} for a single area. Upload the simplified version of the map instead.`,
      };
    }
    areaCount++;
    if (vertices > maxVertices) maxVertices = vertices;

    if (index < PROPERTY_SAMPLE_FEATURES) collectProperties(feature.properties, samples);
  }

  if (areaCount === 0) {
    return {
      ok: false,
      message: 'None of the shapes in that file are areas. A boundary map needs Polygon or MultiPolygon features.',
    };
  }

  return {
    ok: true,
    inspection: {
      featureCount: collection.features.length,
      areaCount,
      skippedCount,
      maxVertices,
      properties: [...samples.entries()]
        .map(([key, values]) => ({ key, samples: values }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    },
  };
}

function collectProperties(properties: unknown, into: Map<string, string[]>): void {
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return;
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    const existing = into.get(key) ?? [];
    if (existing.length >= PROPERTY_SAMPLE_VALUES) continue;
    const text = valueAsSample(value);
    if (text === null || existing.includes(text)) {
      into.set(key, existing);
      continue;
    }
    existing.push(text);
    into.set(key, existing);
  }
}

function valueAsSample(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value.trim() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Guess which property holds the area name.
 *
 * Publishers disagree about everything except that the word "name" usually appears somewhere:
 * Elections Canada writes `ED_NAMEE`, the US Census Bureau writes `NAMELSAD`, a city portal writes
 * `WARD_NAME`. A guess the user can see and change beats an empty picker.
 */
export function guessNameProperty(properties: readonly BoundaryPropertyOption[]): string {
  const named = properties.find((property) => /name/i.test(property.key));
  return named?.key ?? properties[0]?.key ?? '';
}

/** The same guess for the optional code property: a short identifier, never the name itself. */
export function guessCodeProperty(properties: readonly BoundaryPropertyOption[], nameProperty: string): string {
  const coded = properties.find(
    (property) => property.key !== nameProperty && /(^|_)(code|id|num|no|fips|geoid)($|_)/i.test(property.key),
  );
  return coded?.key ?? '';
}

// ── Map vertex rings <-> stored geometry ────────────────────────────────────────────────────────

/** The fewest corners that enclose an area. */
const MIN_RING_CORNERS = 3;

/**
 * Turn a traced vertex ring into a stored GeoJSON Polygon.
 *
 * Two conversions happen here and both are easy to get wrong. The map speaks `{lat, lng}` while
 * GeoJSON positions are `[longitude, latitude]` in that order (RFC 7946 §3.1.1), and a GeoJSON ring
 * must repeat its first position as its last, which a traced ring does not.
 *
 * Returns null when the ring is still a line rather than an area.
 */
export function ringToPolygonGeometry(path: readonly PcLatLng[]): BoundaryGeometryType | null {
  const ring = closedRing(path);
  return ring === null ? null : { type: 'Polygon', coordinates: [ring] };
}

/** The vertex ring as GeoJSON positions, first position repeated at the end. Null when it is a line. */
function closedRing(path: readonly PcLatLng[]): [number, number][] | null {
  if (path.length < MIN_RING_CORNERS) return null;
  const ring: [number, number][] = path.map((point) => [point.lng, point.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

/**
 * The outer ring of each part of a stored geometry, as vertex rings the map can draw.
 *
 * A stored GeoJSON ring repeats its first position as its last (RFC 7946 §3.1.6); an editable path
 * must not, so the repeat is stripped here. Kept, it becomes a real vertex on the map: two stacked
 * handles at the origin, and dragging one leaves the other behind, growing the ring by one position
 * on every edit. {@link ringToPolygonGeometry} / `closedRing` put the repeat back on save.
 *
 * Holes are not returned. The map component draws one filled shape per path and has no notion of an
 * interior ring, so a hole would be drawn as a second solid area sitting inside the first, which
 * would say the opposite of what it means. Holes are preserved in storage and honoured by matching;
 * they simply are not shown or edited here.
 */
export function geometryOuterRings(geometry: BoundaryGeometryType): PcLatLng[][] {
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings: PcLatLng[][] = [];
  for (const part of parts) {
    const outer = part[0];
    if (!outer) continue;
    const ring = outer.map(([lng, lat]) => ({ lat, lng }));
    const first = ring[0];
    const last = ring.length > 1 ? ring[ring.length - 1] : undefined;
    if (first && last && first.lat === last.lat && first.lng === last.lng) ring.pop();
    rings.push(ring);
  }
  return rings;
}

/**
 * Put a reshaped ring back into a stored geometry, keeping every other part and every hole.
 *
 * Returns null when the part index is not in the geometry, so a stale edit is dropped rather than
 * silently rewriting the wrong part.
 */
export function replaceOuterRing(
  geometry: BoundaryGeometryType,
  partIndex: number,
  path: readonly PcLatLng[],
): BoundaryGeometryType | null {
  const ring = closedRing(path);
  if (ring === null) return null;

  if (geometry.type === 'Polygon') {
    if (partIndex !== 0) return null;
    return { type: 'Polygon', coordinates: [ring, ...geometry.coordinates.slice(1)] };
  }

  const part = geometry.coordinates[partIndex];
  if (!part) return null;
  const parts = geometry.coordinates.map((existing, index) =>
    index === partIndex ? [ring, ...existing.slice(1)] : existing,
  );
  return { type: 'MultiPolygon', coordinates: parts };
}

// ── Guards for features too detailed to reshape on the map ──────────────────────────────────────

/**
 * Above this many points a feature is shown view-only in edit mode. Two ceilings meet here:
 *
 * - The server refuses any request body over 1 MiB (`apps/backend/src/fastify.server.ts`), and
 *   saving a reshape sends the whole geometry. One position serialises to roughly 40–50 bytes
 *   (`[-75.123456789012345,45.123456789012345],`), so 1 MiB holds about 21,000 positions and a
 *   safe ceiling must sit well under 20,000.
 * - Edit mode renders one draggable handle per vertex plus a midpoint handle per edge, and tens of
 *   thousands of handles freeze the tab long before the wire limit is reached.
 *
 * 10,000 keeps the largest editable save near half the body limit and the handle count bearable.
 * An uploaded feature may legitimately hold up to `BOUNDARY_MAX_VERTICES_PER_FEATURE` (50,000)
 * points; such a feature still renders, still matches households, and can still be renamed or
 * deleted. Only on-map reshaping is withheld, with the upload path as the stated way to change it.
 */
export const MAX_RESHAPE_VERTICES = 10_000;

/** The server-wide request body limit, mirrored from `apps/backend/src/fastify.server.ts`. */
const SERVER_BODY_LIMIT_BYTES = 1024 * 1024;

/** Room for everything around the geometry in the save request: ids, field names, the tRPC envelope. */
const SHAPE_SAVE_ENVELOPE_BYTES = 16 * 1024;

/** True when this feature has too many points to reshape on the map. See {@link MAX_RESHAPE_VERTICES}. */
export function isTooDetailedToReshape(geometry: BoundaryGeometryType): boolean {
  return (countRawGeometryVertices(geometry) ?? 0) > MAX_RESHAPE_VERTICES;
}

/**
 * True when saving this geometry would exceed the server's request body limit and come back as a
 * bare HTTP 413 with the edit lost. Checked before sending so the refusal is a sentence naming the
 * fix instead. Belt and braces behind {@link MAX_RESHAPE_VERTICES}: features past the threshold
 * never grow edit handles in the first place, so this only fires if the two limits ever drift.
 */
export function geometryTooLargeToSave(geometry: BoundaryGeometryType): boolean {
  const bytes = new TextEncoder().encode(JSON.stringify(geometry)).length;
  return bytes > SERVER_BODY_LIMIT_BYTES - SHAPE_SAVE_ENVELOPE_BYTES;
}

/**
 * The id given to one drawn part on the map.
 *
 * A feature can have several parts (an island ward, a ward split by a river) and the map draws one
 * shape per part, so a part needs its own id to be clicked and dragged. The feature id is recovered
 * from it when the click has to be turned back into "which area did they mean".
 */
export function partPolygonId(featureId: string, partIndex: number): string {
  return `${featureId}#${partIndex}`;
}

/** Split a part id back into the feature it belongs to and which part it is. */
export function readPartPolygonId(partId: string): { featureId: string; partIndex: number } | null {
  const separator = partId.lastIndexOf('#');
  if (separator <= 0) return null;
  const featureId = partId.slice(0, separator);
  const partIndex = Number(partId.slice(separator + 1));
  if (!Number.isInteger(partIndex) || partIndex < 0) return null;
  return { featureId, partIndex };
}
