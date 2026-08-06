import type { Kysely, Transaction } from 'kysely';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { PublishedBoundaryEntry } from '../../../../../../libs/common/src/lib/boundaries/catalog';
import {
  findPublishedBoundary,
  publishedBoundaryStorageKey,
} from '../../../../../../libs/common/src/lib/boundaries/catalog';
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
import { StorageService } from '../storage.service';
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
 * Where a published boundary file is looked for.
 *
 * A `bundled` layer's polygons come from one GeoJSON file per catalog entry rather than from rows,
 * because a national map is millions of coordinates that nobody edits and that every workspace
 * adding the same map would otherwise store its own copy of.
 *
 * Resolution order, first hit wins:
 *  1. `GIS_BOUNDARY_DATA_DIR`, for an operator who mounts the data outside the image.
 *  2. `gis-boundaries/` next to the running bundle — where `apps/backend/project.json` copies it.
 *  3. `boundary-data/` next to this source file — where tests and `nx serve` from source find it.
 *  4. Blob storage, under the reserved `catalog/boundaries/` prefix, downloaded on demand.
 *
 * Step 4 is what lets the catalog cover every province and state without any of those files being
 * in the container image: a workspace that adds the Ontario map causes the Ontario file to be
 * fetched once per process, and a workspace that adds nothing causes no download at all. Steps 1–3
 * still come first so a developer can drop a file in and an operator can mount a directory.
 *
 * Whichever step supplies the bytes, they are checked against the SHA-256 the catalog records
 * before they are parsed. A file that does not match what the catalog describes is refused rather
 * than trusted, because the catalog is what told the workspace how many areas it was getting and
 * who published them.
 *
 * THE CATALOG IS EMPTY IN THIS RELEASE. The mechanism is complete and exercised the moment an entry
 * and its file exist; no coordinates have been invented in the meantime.
 */
const BOUNDARY_ASSET_ENV_VAR = 'GIS_BOUNDARY_DATA_DIR';
const HERE = path.dirname(fileURLToPath(import.meta.url));

function boundaryAssetCandidates(): string[] {
  const configured = process.env[BOUNDARY_ASSET_ENV_VAR];
  const candidates = [path.join(HERE, 'gis-boundaries'), path.join(HERE, 'boundary-data')];
  return configured ? [configured, ...candidates] : candidates;
}

/**
 * Built on first use, not at module load.
 *
 * A process that never touches a published map — which is every process until a workspace adds one
 * — should not construct a blob client or read storage configuration at import time. The worker and
 * the tRPC server both import this module unconditionally.
 */
/** All this module needs of blob storage: the bytes of one key. */
interface CatalogFileReader {
  download(key: string): Promise<Buffer>;
}

let storageService: CatalogFileReader | null = null;
function catalogStorage(): CatalogFileReader {
  storageService ??= new StorageService();
  return storageService;
}

/**
 * Replace the reader used to fetch published files from storage. Tests only.
 *
 * Without this a test covering a local file that fails its checksum falls through to a real blob
 * client and waits out its retry schedule, which turns a one-millisecond assertion into a timeout.
 * Pass null to restore the real client.
 */
export function setCatalogFileReaderForTests(reader: CatalogFileReader | null): void {
  storageService = reader;
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
interface CacheEntry<T> {
  version: string;
  value: T;
  estimatedBytes: number;
}

/**
 * A parsed coordinate graph occupies several times its serialized length in V8 heap (nested arrays
 * of positions). The serialized length times this factor approximates resident bytes — precision is
 * unimportant, only that a big layer costs proportionally more of the budget than a small one.
 */
const JSON_BYTES_TO_HEAP_FACTOR = 6;

function estimateHeapBytes(features: readonly LoadedBoundaryFeature[]): number {
  return JSON.stringify(features).length * JSON_BYTES_TO_HEAP_FACTOR;
}

/**
 * Least-recently-used cache with both an entry count and a byte budget.
 *
 * The byte budget matters more than the entry count: layers vary from a few hand-drawn wards
 * (kilobytes) to a 20 MB statewide file, so counting entries alone would let a handful of large
 * layers exhaust the heap while the count looked healthy.
 */
class BoundaryLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  public get(key: string, version: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.version !== version) return undefined;
    // Re-insert so Map iteration order tracks recency; the oldest key is evicted first below.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public put(key: string, version: string, value: T, estimatedBytes: number): void {
    this.delete(key);
    this.entries.set(key, { version, value, estimatedBytes });
    this.bytes += estimatedBytes;
    // Evicting oldest-first can drop the entry just inserted if it alone exceeds the byte budget;
    // that is fine — the caller holds its own reference, the layer just won't be cached.
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  public delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.estimatedBytes;
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/**
 * Editable layers, keyed by boundary set id. One entry per workspace per layer, because an uploaded
 * or drawn layer genuinely belongs to one workspace and no two are the same bytes.
 */
const BOUNDARY_CACHE_MAX_SETS = 64;
const BOUNDARY_CACHE_MAX_BYTES = 160 * 1024 * 1024;
const editableSetCache = new BoundaryLruCache<LoadedBoundarySet>(BOUNDARY_CACHE_MAX_SETS, BOUNDARY_CACHE_MAX_BYTES);

/**
 * Published layers, keyed by CATALOG SLUG rather than by boundary set id.
 *
 * This is the difference that makes the published catalog affordable. Every workspace that adds
 * "Canada — federal ridings" gets its own `boundary_sets` row with its own id, but all of those
 * rows name the same file with the same checksum. Keyed by set id, two hundred workspaces would
 * hold two hundred separately parsed copies of one national map — at the heap factor above, a 3 MB
 * file counts as roughly 18 MB, so about a dozen workspaces would exhaust the whole budget and
 * start evicting each other on every match pass. Keyed by slug there is exactly one parsed copy per
 * published layer per process, and the per-workspace `LoadedBoundarySet` wrapper around it costs a
 * handful of pointers.
 *
 * The version is the catalog entry's SHA-256. A published file is never rewritten in place — a new
 * edition is a new slug — so this entry needs no invalidation, and a file whose bytes stopped
 * matching their checksum is refused before it ever reaches the cache.
 *
 * The two budgets sum to the 256 MB this cache has always been allowed. Published layers get the
 * smaller share because a share goes much further when one entry serves every workspace.
 */
const PUBLISHED_CACHE_MAX_SETS = 32;
const PUBLISHED_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const publishedFeatureCache = new BoundaryLruCache<readonly LoadedBoundaryFeature[]>(
  PUBLISHED_CACHE_MAX_SETS,
  PUBLISHED_CACHE_MAX_BYTES,
);

/**
 * Drop a layer from this process's cache immediately.
 *
 * Not required for correctness — the version check above already catches every edit — but it keeps
 * a just-saved polygon from waiting on a round trip in the process that saved it.
 *
 * Only editable layers are addressed by set id. Published layers are keyed by catalog slug and are
 * immutable, so nothing can invalidate one; clearing everything clears them too, which is what a
 * test that swaps the storage client needs.
 */
export function invalidateBoundarySetCache(setId?: string): void {
  if (setId === undefined) {
    editableSetCache.clear();
    publishedFeatureCache.clear();
  } else {
    editableSetCache.delete(setId);
  }
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

/** Lowercase hex SHA-256, the same form the catalog records and the conversion script writes. */
function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The bytes of one published file, from the first source that supplies them intact.
 *
 * A local file whose checksum does not match is skipped rather than fatal: a stale copy in a
 * mounted directory should not stop the correct file being fetched from storage. A storage file
 * whose checksum does not match is fatal for that layer, because there is nowhere left to look and
 * matching households against unverified boundaries is worse than matching them against none.
 */
async function readPublishedFile(entry: PublishedBoundaryEntry): Promise<Buffer | null> {
  for (const dir of boundaryAssetCandidates()) {
    const filePath = path.join(dir, `${entry.slug}.geojson`);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch {
      continue; // Not in this directory — try the next candidate.
    }
    const digest = sha256Of(bytes);
    if (digest === entry.sha256) return bytes;
    logger.error(
      { slug: entry.slug, filePath, expected: entry.sha256, actual: digest },
      'Local boundary file does not match the checksum the catalog records for it, and was skipped',
    );
  }

  const key = publishedBoundaryStorageKey(entry.slug);
  let bytes: Buffer;
  try {
    bytes = await catalogStorage().download(key);
  } catch (err) {
    logger.error({ err, slug: entry.slug, key }, 'Failed to download the published boundary file from storage');
    return null;
  }

  const digest = sha256Of(bytes);
  if (digest !== entry.sha256) {
    logger.error(
      { slug: entry.slug, key, expected: entry.sha256, actual: digest },
      'Published boundary file in storage does not match the checksum the catalog records for it, and was refused',
    );
    return null;
  }
  return bytes;
}

/** Turn a published file's bytes into named areas. Returns an empty list on any unreadable input. */
function parsePublishedFeatures(entry: PublishedBoundaryEntry, bytes: Buffer): LoadedBoundaryFeature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    logger.error({ err, slug: entry.slug }, 'Published boundary file is not valid JSON');
    return [];
  }

  const collection = parsed as { features?: unknown };
  if (!Array.isArray(collection.features)) {
    logger.error({ slug: entry.slug }, 'Published boundary file is not a GeoJSON FeatureCollection');
    return [];
  }

  const nameKey = entry.nameProperty;
  const codeKey = entry.codeProperty ?? 'code';
  const features: LoadedBoundaryFeature[] = [];
  for (const [index, item] of collection.features.entries()) {
    if (typeof item !== 'object' || item === null) continue;
    const feature = item as { properties?: unknown; geometry?: unknown };
    const geometry = readGeometry(feature.geometry, `${entry.slug}[${index}]`);
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
 * Backend two: published reference data, read from a file rather than from rows.
 *
 * 343 Canadian ridings and 435 congressional districts are never edited and are versioned as a
 * whole, so they do not belong in a table a person browses. One GeoJSON FeatureCollection per
 * catalog entry, named after the entry's slug, is the whole format.
 *
 * The result is shared by every workspace holding this slug, so it is frozen: a caller that mutated
 * it would be mutating every other workspace's copy of the same national map.
 *
 * Returns null — not an empty list — when the file could not be read at all: the catalog does not
 * publish the slug, no copy was found locally or in storage, the download failed, or the bytes did
 * not match their checksum. The distinction is load-bearing. An empty list means "this map placed
 * this household in none of its areas", which is a real answer a re-match is allowed to store. Null
 * means "this map could not be consulted", and the caller must leave the household's existing area
 * for this map alone — a storage hiccup must not erase every household's riding.
 */
async function loadPublishedFeatures(slug: string): Promise<readonly LoadedBoundaryFeature[] | null> {
  const entry = findPublishedBoundary(slug);
  if (!entry) {
    // Deliberately loud. A row naming a slug the catalog no longer publishes would otherwise match
    // nothing at all, which reads exactly like "this address is in no district".
    logger.warn({ slug }, 'A boundary set names a published map that is not in this release’s catalog');
    return null;
  }

  const cached = publishedFeatureCache.get(slug, entry.sha256);
  if (cached) return cached;

  const bytes = await readPublishedFile(entry);
  if (bytes === null) return null;

  const features = parsePublishedFeatures(entry, bytes);
  features.sort(compareFeatures);
  const frozen: readonly LoadedBoundaryFeature[] = Object.freeze(features);
  publishedFeatureCache.put(slug, entry.sha256, frozen, estimateHeapBytes(frozen));
  return frozen;
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

    // A published layer's polygons are shared, so it does not use the per-set cache at all: the
    // features come from the slug-keyed cache and only the wrapper naming this workspace's set id
    // is built here. The wrapper is what the matcher writes into `household_districts.set_id`.
    //
    // A layer whose file could not be read is left out of the result entirely rather than returned
    // empty. Callers scope their replace to the layers this function actually returned, so omitting
    // it is what stops a missing file or a failed download erasing every household's area for that
    // map. It was not consulted, so it has no answer to overwrite the old one with.
    if (row.source === 'bundled') {
      const features = await loadPublishedFeatures(row.slug);
      if (features === null) continue;
      loaded.push({ id: setId, slug: row.slug, label: row.label, role: row.role, source: row.source, features });
      continue;
    }

    const version = versionOf(row);
    const cached = editableSetCache.get(setId, version);
    if (cached) {
      loaded.push(cached);
      continue;
    }

    const features = await loadFeaturesFromRows(db, tenantId, setId);
    features.sort(compareFeatures);
    const set: LoadedBoundarySet = {
      id: setId,
      slug: row.slug,
      label: row.label,
      role: row.role,
      source: row.source,
      features,
    };
    editableSetCache.put(setId, version, set, estimateHeapBytes(features));
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
