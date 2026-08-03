import type { Kysely, Transaction } from 'kysely';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type {
  BoundaryBBoxType,
  BoundaryGeometryType,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import {
  boundaryBBoxOf,
  boundaryGeometrySchema,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { logger } from '../../logger';
import { isPointInMultiPolygon, isPointInPolygon } from './point-in-polygon';

type Db = Kysely<Models> | Transaction<Models>;

/** One named area of one layer, ready to be tested against a point. */
export interface LoadedBoundaryFeature {
  name: string;
  code: string | null;
  /** [minLng, minLat, maxLng, maxLat]. Tested before the ray cast; rejects almost every point. */
  bbox: BoundaryBBoxType;
  geometry: BoundaryGeometryType;
}

/** One boundary layer with its polygons in memory, areas sorted into a fixed order. */
export interface LoadedBoundarySet {
  id: string;
  slug: string;
  label: string;
  role: string;
  source: string;
  features: readonly LoadedBoundaryFeature[];
}

/**
 * Where bundled boundary files live once the build has copied them.
 *
 * NO BUNDLED FILES SHIP TODAY. This is the mechanism, not the data. Elections Canada riding files
 * and US Census TIGER/Line district files are large binary shapefiles that need converting, and
 * nothing has been converted yet, so the directory is empty and every boundary a workspace holds
 * arrives by import, upload or drawing. The code path is complete and exercised the moment a file
 * is dropped in; it is not stubbed, and it invents no coordinates in the meantime.
 *
 * Resolution order, first hit wins:
 *  1. `GIS_BOUNDARY_DATA_DIR`, for an operator who mounts the data outside the image.
 *  2. `gis-boundaries/` next to the running bundle — where `apps/backend/project.json` copies it.
 *  3. `boundary-data/` next to this source file — where tests and `nx serve` from source find it.
 */
const BOUNDARY_ASSET_ENV_VAR = 'GIS_BOUNDARY_DATA_DIR';
const HERE = path.dirname(fileURLToPath(import.meta.url));

function boundaryAssetCandidates(): string[] {
  const configured = process.env[BOUNDARY_ASSET_ENV_VAR];
  const candidates = [path.join(HERE, 'gis-boundaries'), path.join(HERE, 'boundary-data')];
  return configured ? [configured, ...candidates] : candidates;
}

/**
 * Cached layers, keyed by boundary set id.
 *
 * This replaces the single module-global GeoJSON cache the old matcher used, which could only ever
 * hold one map. Many layers are live at once now — a US state campaign needs congressional
 * districts, upper-chamber districts, lower-chamber districts and precincts simultaneously.
 *
 * The stored `version` is what makes the cache safe across processes. The tRPC process serves the
 * edit and the worker process runs the match, so an in-process invalidation on one would leave the
 * other holding a stale map. The version is built from the set row's `updated_at` and feature
 * count, both of which every write path bumps, and it is re-read from Postgres on every load — so a
 * layer edited anywhere is reloaded everywhere, without a shared cache or a guessed expiry.
 */
interface CacheEntry {
  version: string;
  set: LoadedBoundarySet;
}
const boundarySetCache = new Map<string, CacheEntry>();

/**
 * How many layers stay in memory. Past this the least-recently-loaded entry is dropped, so one
 * workspace uploading its 50 allowed layers cannot pin every other workspace's out of memory.
 */
const BOUNDARY_CACHE_MAX_SETS = 64;

function cacheGet(setId: string, version: string): LoadedBoundarySet | undefined {
  const entry = boundarySetCache.get(setId);
  if (!entry || entry.version !== version) return undefined;
  // Re-insert so Map iteration order tracks recency; the oldest key is evicted first below.
  boundarySetCache.delete(setId);
  boundarySetCache.set(setId, entry);
  return entry.set;
}

function cachePut(setId: string, version: string, set: LoadedBoundarySet): void {
  boundarySetCache.delete(setId);
  boundarySetCache.set(setId, { version, set });
  while (boundarySetCache.size > BOUNDARY_CACHE_MAX_SETS) {
    const oldest = boundarySetCache.keys().next();
    if (oldest.done) break;
    boundarySetCache.delete(oldest.value);
  }
}

/**
 * Drop a layer from this process's cache immediately.
 *
 * Not required for correctness — the version check above already catches every edit — but it keeps
 * a just-saved polygon from waiting on a round trip in the process that saved it.
 */
export function invalidateBoundarySetCache(setId?: string): void {
  if (setId === undefined) boundarySetCache.clear();
  else boundarySetCache.delete(setId);
}

/**
 * A fixed order for the areas of a layer.
 *
 * Hand-drawn polygons overlap, and the matcher takes the first area that contains the point. With
 * no defined order, "first" is whatever Postgres returned or whatever order the file happened to
 * list, which can change between runs — so the same household could land in one ward today and the
 * neighbouring one tomorrow, with nothing in the data changed. Sorting by name and then by code
 * makes the answer the same every time. Overlaps are then surfaced honestly through the validation
 * counts rather than resolved silently.
 *
 * The comparison is on code points rather than `localeCompare`, because a locale collation can
 * differ between Node builds and ICU versions, which would reintroduce exactly the instability this
 * exists to remove.
 */
function compareFeatures(a: LoadedBoundaryFeature, b: LoadedBoundaryFeature): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  const aCode = a.code ?? '';
  const bCode = b.code ?? '';
  if (aCode !== bCode) return aCode < bCode ? -1 : 1;
  return 0;
}

/** Narrow a jsonb column to a geometry, or return null and say which feature was unreadable. */
function readGeometry(value: unknown, describe: string): BoundaryGeometryType | null {
  const parsed = boundaryGeometrySchema.safeParse(value);
  if (!parsed.success) {
    logger.warn({ describe }, 'Boundary feature has unreadable geometry and was skipped');
    return null;
  }
  return parsed.data;
}

function readBBox(value: unknown, geometry: BoundaryGeometryType): BoundaryBBoxType {
  if (Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number')) {
    const [minLng, minLat, maxLng, maxLat] = value;
    if (minLng !== undefined && minLat !== undefined && maxLng !== undefined && maxLat !== undefined) {
      return [minLng, minLat, maxLng, maxLat];
    }
  }
  // A stored bbox that is missing or malformed is recomputed rather than treated as an error: it is
  // only a pre-filter, and getting it wrong would silently exclude households from a real area.
  return boundaryBBoxOf(geometry);
}

/** The set row's identity for cache purposes — any write to a layer changes one of these. */
function versionOf(row: { updated_at: Date | string | null; feature_count: number | null }): string {
  const updated = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(String(row.updated_at ?? ''));
  return `${Number.isNaN(updated) ? 0 : updated}:${row.feature_count ?? -1}`;
}

/** Backend one: the polygons of an editable layer, stored as rows a person can rename and reshape. */
async function loadFeaturesFromRows(db: Db, tenantId: string, setId: string): Promise<LoadedBoundaryFeature[]> {
  const rows = await db
    .selectFrom('boundary_features')
    .select(['id', 'name', 'code', 'geometry', 'bbox'])
    .where('tenant_id', '=', tenantId)
    .where('set_id', '=', setId)
    .execute();

  const features: LoadedBoundaryFeature[] = [];
  for (const row of rows) {
    const geometry = readGeometry(row.geometry, `boundary_features.id=${row.id}`);
    if (!geometry) continue;
    features.push({ name: row.name, code: row.code, bbox: readBBox(row.bbox, geometry), geometry });
  }
  return features;
}

/** Read the first candidate directory that holds `<slug>.geojson`, or null when none does. */
async function readBundledFile(slug: string): Promise<string | null> {
  for (const dir of boundaryAssetCandidates()) {
    const filePath = path.join(dir, `${slug}.geojson`);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      // Not in this directory — try the next candidate.
    }
  }
  return null;
}

/**
 * Backend two: bulk reference data, read from a build asset rather than from rows.
 *
 * 435 congressional districts and tens of thousands of precincts are never edited and are versioned
 * as a whole, so they do not belong in a table a person browses. One GeoJSON FeatureCollection per
 * layer, named after the layer's slug, is the whole format.
 */
async function loadFeaturesFromAsset(
  slug: string,
  nameProperty: string | null,
  codeProperty: string | null,
): Promise<LoadedBoundaryFeature[]> {
  const raw = await readBundledFile(slug);
  if (raw === null) {
    // Deliberately loud. A workspace pointing at a bundled layer with no file present would
    // otherwise silently match nothing, which reads exactly like "this address is in no district".
    logger.warn(
      { slug, searched: boundaryAssetCandidates() },
      'No bundled boundary file found for this set. No bundled boundary data ships with pplCRM yet.',
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error({ err, slug }, 'Bundled boundary file is not valid JSON');
    return [];
  }

  const collection = parsed as { features?: unknown };
  if (!Array.isArray(collection.features)) {
    logger.error({ slug }, 'Bundled boundary file is not a GeoJSON FeatureCollection');
    return [];
  }

  const nameKey = nameProperty ?? 'name';
  const codeKey = codeProperty ?? 'code';
  const features: LoadedBoundaryFeature[] = [];
  for (const [index, entry] of collection.features.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const feature = entry as { properties?: unknown; geometry?: unknown };
    const geometry = readGeometry(feature.geometry, `${slug}[${index}]`);
    if (!geometry) continue;
    const properties = (
      typeof feature.properties === 'object' && feature.properties !== null ? feature.properties : {}
    ) as Record<string, unknown>;
    const name = properties[nameKey];
    const code = properties[codeKey];
    features.push({
      name: typeof name === 'string' && name.trim() ? name.trim() : `Area ${index + 1}`,
      code: typeof code === 'string' && code.trim() ? code.trim() : null,
      bbox: boundaryBBoxOf(geometry),
      geometry,
    });
  }
  return features;
}

/**
 * Load several layers at once, from cache where possible.
 *
 * Batched on purpose. The per-point entry point below re-loads on every call, which is fine for one
 * household but is one query per household per pass when a job re-matches thousands of them; the
 * job calls this once and then matches every point in memory.
 *
 * Layers whose source is `import` are skipped: an imported layer has no polygons at all — its area
 * names arrived already assigned per household in a CSV — so there is nothing to match against.
 */
export async function loadBoundarySets(db: Db, tenantId: string, setIds: string[]): Promise<LoadedBoundarySet[]> {
  const ids = [...new Set(setIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  const rows = await db
    .selectFrom('boundary_sets')
    .select(['id', 'slug', 'label', 'role', 'source', 'name_property', 'code_property', 'feature_count', 'updated_at'])
    .where('tenant_id', '=', tenantId)
    .where('id', 'in', ids)
    .execute();

  const loaded: LoadedBoundarySet[] = [];
  for (const row of rows) {
    if (row.source === 'import') continue;

    const setId = String(row.id);
    const version = versionOf(row);
    const cached = cacheGet(setId, version);
    if (cached) {
      loaded.push(cached);
      continue;
    }

    const features =
      row.source === 'bundled'
        ? await loadFeaturesFromAsset(row.slug, row.name_property, row.code_property)
        : await loadFeaturesFromRows(db, tenantId, setId);

    features.sort(compareFeatures);
    const set: LoadedBoundarySet = {
      id: setId,
      slug: row.slug,
      label: row.label,
      role: row.role,
      source: row.source,
      features,
    };
    cachePut(setId, version, set);
    loaded.push(set);
  }

  return loaded;
}

/** True when the point is outside the area's bounding box — four comparisons instead of a ray cast. */
function outsideBBox(lng: number, lat: number, bbox: BoundaryBBoxType): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lng < minLng || lng > maxLng || lat < minLat || lat > maxLat;
}

/**
 * True when the point is inside this area.
 *
 * The bounding box is tested first, and that is the whole performance story. The previous matcher
 * ran a full ray cast over every ring of every feature with no pre-filter, which was fine for the
 * three placeholder rectangles it shipped with and is not fine for 435 congressional districts or
 * tens of thousands of precincts. Four comparisons reject almost every candidate.
 *
 * The GeoJSON position tuples pass straight into the ray-cast helpers: a `[number, number]` is a
 * `number[]`, so no conversion or cast is involved.
 */
export function featureContainsPoint(lat: number, lng: number, feature: LoadedBoundaryFeature): boolean {
  if (outsideBBox(lng, lat, feature.bbox)) return false;
  const { geometry } = feature;
  return geometry.type === 'Polygon'
    ? isPointInPolygon(lng, lat, geometry.coordinates)
    : isPointInMultiPolygon(lng, lat, geometry.coordinates);
}
