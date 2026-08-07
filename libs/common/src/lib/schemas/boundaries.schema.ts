import { z } from 'zod';

import type { BoundaryRole, BoundarySource } from '../jurisdictions/jurisdiction.types';
import { JURISDICTION_IDS } from '../jurisdictions/jurisdiction.types';
import { descriptionSchema, idSchema, nameSchema } from './core.schema';

/**
 * Boundary sets and their polygons — the shapes every tRPC procedure under
 * `apps/backend/src/app/modules/boundaries/` validates its input against.
 *
 * A boundary set is one named, versioned map layer: "Ottawa wards 2022", "Congressional districts
 * (119th Congress)", or "the three neighbourhoods we are targeting". A boundary feature is one
 * named area inside such a layer.
 *
 * What a layer MEANS lives in `role`, never in what its areas are called. A Toronto ward elects a
 * councillor and is a `seat_area`; a Boston ward elects nobody and is a `subdivision` sitting
 * alongside a second `subdivision` layer for its precincts. Both are called "ward". Nothing in the
 * product may decide which kind it is from the word.
 */

/**
 * What the areas of a layer mean. Mirrors `BoundaryRole` in ../jurisdictions/jurisdiction.types,
 * as a runtime array so Zod and the pickers can both read it; `satisfies` keeps the two in step.
 */
export const BOUNDARY_ROLES = ['seat_area', 'subdivision', 'locality'] as const satisfies readonly BoundaryRole[];

/** Where a layer's polygons came from. Mirrors `BoundarySource` in ../jurisdictions. */
export const BOUNDARY_SOURCES = ['bundled', 'upload', 'import', 'drawn'] as const satisfies readonly BoundarySource[];

export const BOUNDARY_ROLE_LABELS: Record<BoundaryRole, string> = {
  seat_area: 'Seat areas — each one elects a representative',
  subdivision: 'Voting subdivisions — the area served by one polling place',
  locality: 'Localities — the outline of a municipality or county',
};

export const BOUNDARY_SOURCE_LABELS: Record<BoundarySource, string> = {
  bundled: 'Shipped with pplCRM',
  upload: 'Uploaded GeoJSON',
  import: 'Assigned by a CSV import',
  drawn: 'Drawn in the app',
};

// ── Caps ────────────────────────────────────────────────────────────────────────────────────────
//
// Boundary work never calls a paid service, so none of these caps exist to control spend. They
// exist because polygons are the one place a workspace can hand the server an unbounded amount of
// work in a single request: a national shapefile converted to GeoJSON is routinely hundreds of
// megabytes, and one carelessly-exported coastline feature can carry millions of vertices, every
// one of which the point-in-polygon ray cast has to walk for every household on every re-match.
// Each cap is stated in the error message it produces, so a rejected upload says what to do next.

/** Largest GeoJSON file accepted for one set. Read from blob storage, never through a tRPC body. */
export const BOUNDARY_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Most areas one layer may contain. A city has 5–45 wards; a US state has ~10,000 precincts. */
export const BOUNDARY_MAX_FEATURES_PER_SET = 5_000;

/** Most points one area's outline may contain, counting every ring of every part. */
export const BOUNDARY_MAX_VERTICES_PER_FEATURE = 50_000;

/** Most layers one workspace may hold at once, across every source. */
export const BOUNDARY_MAX_SETS_PER_TENANT = 50;

/**
 * Most serialized geometry one `features` response carries.
 *
 * A layer may legitimately be far larger than a browser should be handed at once: an uploaded file
 * is allowed up to {@link BOUNDARY_UPLOAD_MAX_BYTES}, and a published national map is the largest
 * thing a workspace can hold without ever having uploaded anything. Past this budget the response
 * stops adding areas and says how many the layer really has, exactly as the pin read does — a map
 * that quietly drew two thirds of a country's ridings and reported nothing would read as complete.
 *
 * Chosen well under the upload cap because this is the parsed, re-serialized payload crossing the
 * wire to a browser tab, not a file being written to storage once.
 */
export const BOUNDARY_FEATURES_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Most household pins one request returns for the drawing map.
 *
 * A workspace can hold far more located households than a map can usefully draw or a browser can
 * hold, so the pin read is capped. The cap is why the same response also carries the true number of
 * located households: a capped sample that does not say how much it left out reads as a total.
 */
export const BOUNDARY_MAX_PINS = 5_000;

/** Human-readable form of {@link BOUNDARY_UPLOAD_MAX_BYTES}, for messages the user reads. */
export const BOUNDARY_UPLOAD_MAX_LABEL = '20 MB';

/**
 * Longest area name and code, shared by the Zod schemas (drawn/renamed areas) and the upload
 * ingestion in the boundaries controller (file-supplied areas), so the two paths cannot drift.
 */
export const BOUNDARY_FEATURE_NAME_MAX = 120;
export const BOUNDARY_FEATURE_CODE_MAX = 60;

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────

/**
 * One GeoJSON position: [longitude, latitude], in that order.
 *
 * The order is the trap. GeoJSON is longitude-first (RFC 7946 §3.1.1) while every mapping UI, the
 * Google Geocoding API and `households.lat` / `households.lng` are latitude-first. The matcher's
 * `isPointInPolygon(lng, lat, …)` signature follows GeoJSON; every caller has to convert.
 *
 * Trailing numbers past the first two are accepted and ignored: RFC 7946 allows an optional third
 * elevation element, and QGIS/KML exports routinely write `[lng, lat, 0]`. Everything downstream —
 * the ray cast, the bbox, the vertex count — reads only indices 0 and 1.
 */
export const boundaryPositionSchema = z.tuple(
  [
    z.number().gte(-180, 'Longitude must be between -180 and 180').lte(180, 'Longitude must be between -180 and 180'),
    z.number().gte(-90, 'Latitude must be between -90 and 90').lte(90, 'Latitude must be between -90 and 90'),
  ],
  z.number(),
);

export type BoundaryPositionType = z.infer<typeof boundaryPositionSchema>;

/**
 * One closed ring. Four positions is the RFC 7946 minimum for a closed triangle (the first point is
 * repeated as the last), and it is also the smallest thing a person can draw that encloses any area.
 */
export const boundaryRingSchema = z.array(boundaryPositionSchema).min(4, 'An area needs at least three corners');

/** A GeoJSON Polygon's coordinates: an outer ring, then a ring per hole. */
export const boundaryPolygonCoordinatesSchema = z
  .array(boundaryRingSchema)
  .min(1, 'A polygon needs at least an outer ring');

/** A GeoJSON MultiPolygon's coordinates: one entry per disconnected part. */
export const boundaryMultiPolygonCoordinatesSchema = z
  .array(boundaryPolygonCoordinatesSchema)
  .min(1, 'A multi-part area needs at least one part');

/**
 * The geometry stored in `boundary_features.geometry`.
 *
 * The whole geometry object is stored, not just its coordinates, because Polygon and MultiPolygon
 * nest their arrays to different depths and there is no way to tell them apart from the numbers
 * alone. MultiPolygon is not an exotic case: an island ward, or a ward split by a river with a
 * carve-out, is a MultiPolygon, and dropping the type would silently mis-read it as a Polygon with
 * holes.
 */
export const boundaryGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: boundaryPolygonCoordinatesSchema }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: boundaryMultiPolygonCoordinatesSchema }),
]);

export type BoundaryGeometryType = z.infer<typeof boundaryGeometrySchema>;

/** [minLng, minLat, maxLng, maxLat] — the pre-filter tested before the full ray cast. */
export type BoundaryBBoxType = [number, number, number, number];

/** How many points an outline carries, counting every ring of every part. */
export function countBoundaryVertices(geometry: BoundaryGeometryType): number {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
  }
  return geometry.coordinates.reduce(
    (sum, polygon) => sum + polygon.reduce((inner, ring) => inner + ring.length, 0),
    0,
  );
}

/** The smallest axis-aligned box containing an outline. Cheap to test, and rejects most points. */
export function boundaryBBoxOf(geometry: BoundaryGeometryType): BoundaryBBoxType {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  // Positions may carry a third elevation element; only indices 0 and 1 are read.
  const visitRing = (ring: readonly BoundaryPositionType[]): void => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) visitRing(ring);
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) visitRing(ring);
    }
  }

  return [minLng, minLat, maxLng, maxLat];
}

/** Rejects an outline whose point count is past {@link BOUNDARY_MAX_VERTICES_PER_FEATURE}. */
const withVertexCap = <T extends z.ZodType<BoundaryGeometryType>>(schema: T) =>
  schema.refine(
    (geometry) => countBoundaryVertices(geometry) <= BOUNDARY_MAX_VERTICES_PER_FEATURE,
    `One area may not have more than ${BOUNDARY_MAX_VERTICES_PER_FEATURE.toLocaleString()} points. Simplify the outline and try again.`,
  );

// ── Sets ────────────────────────────────────────────────────────────────────────────────────────

const boundarySetSlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(80, 'Slug is too long')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug may only contain lowercase letters, numbers and single hyphens');

const boundarySetCoreShape = {
  label: nameSchema('Name', 120),
  jurisdiction: z.enum(JURISDICTION_IDS),
  role: z.enum(BOUNDARY_ROLES),
  /** Only US state legislative layers carry one; the two chambers are two different maps. */
  chamber: z.enum(['upper', 'lower']).nullable().optional(),
  /** Province, territory or state this layer covers. Null when it covers a whole country. */
  region: z.string().trim().max(10, 'Region code is too long').nullable().optional(),
  /** Which edition these boundaries are: '2023 representation order', 'City of Ottawa 2022'. */
  vintage: z.string().trim().max(120, 'Vintage is too long').nullable().optional(),
  /** Optional stable id. Generated from the label when the caller does not supply one. */
  slug: boundarySetSlugSchema.optional(),
};

/**
 * Create an empty layer for an admin to draw into.
 *
 * Creating it empty is deliberate: drawing is iterative, the map has to exist before the first
 * polygon can be attached to it, and an admin who draws one ward and stops still has a usable
 * layer.
 */
export const AddDrawnBoundarySetObj = z.object({
  ...boundarySetCoreShape,
  description: descriptionSchema(500),
});
export type AddDrawnBoundarySetType = z.infer<typeof AddDrawnBoundarySetObj>;

/**
 * Turn an already-uploaded GeoJSON file into a layer.
 *
 * `file_id` points at a row the files module already created, which means the bytes went to blob
 * storage through the existing signed-upload flow and never through a tRPC request body — the
 * server-wide body limit is 1 MiB and this accepts files up to 20 MB. `geojson` is the alternative
 * for a small file the caller already has in memory; exactly one of the two is required.
 *
 * `name_property` and `code_property` say which GeoJSON feature property holds each area's name and
 * code, because no two publishers agree: Elections Canada writes ED_NAMEE, the Census Bureau writes
 * NAMELSAD, and a city open-data portal writes whatever it likes.
 */
export const UploadBoundarySetObj = z
  .object({
    ...boundarySetCoreShape,
    file_id: idSchema.nullable().optional(),
    geojson: z.unknown().optional(),
    name_property: z.string().trim().min(1).max(80, 'Property name is too long'),
    code_property: z.string().trim().max(80, 'Property name is too long').nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasFile = value.file_id != null;
    const hasInline = value.geojson !== undefined;
    if (hasFile === hasInline) {
      ctx.addIssue({
        code: 'custom',
        path: ['file_id'],
        message: 'Provide either an uploaded file or the GeoJSON itself, but not both.',
      });
    }
  });
export type UploadBoundarySetType = z.infer<typeof UploadBoundarySetObj>;

/**
 * Add a map from the published catalog.
 *
 * The whole input is one catalog slug, because everything else that would describe the layer — its
 * label, jurisdiction, region, chamber, role, vintage, which properties hold the name and code, and
 * how many areas it holds — is already recorded in the catalog entry and is copied from there. A
 * client that could send those fields could also send a label that contradicts the file, which is
 * how "Ontario ridings" ends up being a map of Alberta.
 *
 * The slug is validated for shape here and for existence in the controller, so an unknown slug
 * produces "that map is not in the catalog" rather than a shape error.
 */
export const AddPublishedBoundarySetObj = z.object({
  catalog_slug: boundarySetSlugSchema,
});
export type AddPublishedBoundarySetType = z.infer<typeof AddPublishedBoundarySetObj>;

// ── Features ────────────────────────────────────────────────────────────────────────────────────

export const AddBoundaryFeatureObj = z.object({
  set_id: idSchema,
  name: nameSchema('Area name', BOUNDARY_FEATURE_NAME_MAX),
  code: z.string().trim().max(BOUNDARY_FEATURE_CODE_MAX, 'Code is too long').nullable().optional(),
  geometry: withVertexCap(boundaryGeometrySchema),
});
export type AddBoundaryFeatureType = z.infer<typeof AddBoundaryFeatureObj>;

/**
 * Rename or reshape one area. Both fields are optional so a rename does not have to resend the
 * whole outline, which for a traced municipal ward is the bulk of the payload.
 */
export const UpdateBoundaryFeatureObj = z
  .object({
    name: nameSchema('Area name', BOUNDARY_FEATURE_NAME_MAX).optional(),
    code: z.string().trim().max(BOUNDARY_FEATURE_CODE_MAX, 'Code is too long').nullable().optional(),
    geometry: withVertexCap(boundaryGeometrySchema).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.code !== undefined || value.geometry !== undefined,
    'Nothing to change.',
  );
export type UpdateBoundaryFeatureType = z.infer<typeof UpdateBoundaryFeatureObj>;

// ── Read shapes ─────────────────────────────────────────────────────────────────────────────────

export const BoundarySetObj = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  jurisdiction: z.string(),
  role: z.string(),
  chamber: z.string().nullable(),
  region: z.string().nullable(),
  vintage: z.string().nullable(),
  source: z.string(),
  file_id: z.string().nullable(),
  name_property: z.string().nullable(),
  code_property: z.string().nullable(),
  feature_count: z.number(),
  /** True when the layer's polygons live in rows a person can rename, reshape or delete. */
  editable: z.boolean(),
  /**
   * True when the layer HAS polygons, whoever owns them — so there is a shape to draw on a map.
   *
   * Deliberately separate from `editable`, which answers a different question. A published map has
   * shapes and cannot be edited; treating one flag as the other hid the map view behind the edit
   * permission and told the user there was "no shape to open" for a map that has 124 of them.
   * Only an imported layer, which carries names and no geometry, is genuinely unopenable.
   */
  viewable: z.boolean(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type BoundarySetRowType = z.infer<typeof BoundarySetObj>;

export const BoundaryFeatureObj = z.object({
  id: z.string(),
  set_id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  geometry: boundaryGeometrySchema,
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type BoundaryFeatureRowType = z.infer<typeof BoundaryFeatureObj>;

/**
 * The areas of one layer, plus how many the layer really has.
 *
 * Both numbers are here for the same reason the pin read carries two: only one of them is the
 * sample. `features` stops once the serialized geometry reaches
 * {@link BOUNDARY_FEATURES_MAX_RESPONSE_BYTES}, which a hand-drawn ward map will never reach and a
 * published national map can. `total` counts every area in the layer, so a caption drawn from
 * `features.length` cannot silently report a truncated map as the whole thing.
 *
 * Matching is unaffected by the cap. It runs server-side against every area of the layer; this
 * bounds only what one browser tab is handed.
 */
export const BoundaryFeatureListObj = z.object({
  set_id: z.string(),
  features: z.array(BoundaryFeatureObj),
  /** Areas in the layer, whether or not their outlines were returned. */
  total: z.number(),
  /** True when the byte budget stopped the list short of `total`. */
  truncated: z.boolean(),
});
export type BoundaryFeatureListType = z.infer<typeof BoundaryFeatureListObj>;

/**
 * One household with coordinates, thinned to what a map pin needs: where to put it and enough of
 * the address to label it. The address parts are sent separately rather than pre-joined so the page
 * decides how to write them.
 */
export const BoundaryHouseholdPinObj = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  street_num: z.string().nullable(),
  street1: z.string().nullable(),
  city: z.string().nullable(),
});
export type BoundaryHouseholdPinType = z.infer<typeof BoundaryHouseholdPinObj>;

/**
 * The pins for the drawing map, plus the number of located households they were drawn from.
 *
 * Both numbers are here because only one of them is the sample. `pins` stops at
 * {@link BOUNDARY_MAX_PINS} and is ordered by id so the same households come back on every load;
 * `total_geocoded` counts every located household in the workspace. Matching is unaffected by the
 * cap — it runs server-side over all of them — but a caption that reported `pins.length` as the
 * workspace total would be false for any workspace past the cap.
 */
export const BoundaryHouseholdPinsObj = z.object({
  pins: z.array(BoundaryHouseholdPinObj),
  /** Households with coordinates in the workspace, whether or not a pin was returned for them. */
  total_geocoded: z.number(),
});
export type BoundaryHouseholdPinsType = z.infer<typeof BoundaryHouseholdPinsObj>;

/**
 * The two honest quality numbers for a hand-drawn or uploaded map, reported after every save.
 *
 * Hand-drawn polygons have gaps and overlaps unless traced carefully, and this product does not
 * promise shared-edge topology editing. Rather than hide that, every save reports how many
 * households fell outside every area (a gap) and how many fell inside more than one (an overlap).
 * Running the matcher costs nothing, so this is free to compute.
 *
 * `examined` and `capped` exist so the numbers are never quietly wrong: the check walks households
 * in memory and stops at a fixed ceiling, and a truncated answer must say it was truncated.
 */
export const BoundaryValidationObj = z.object({
  set_id: z.string(),
  /** Households with coordinates that were tested. */
  examined: z.number(),
  /** Households with coordinates in the workspace, whether or not they were tested. */
  total_geocoded: z.number(),
  /** Households whose coordinates fall inside no area of this layer. */
  unmatched: z.number(),
  /** Households whose coordinates fall inside two or more areas of this layer. */
  multiply_matched: z.number(),
  /** True when `examined` is short of `total_geocoded` because the ceiling was reached. */
  capped: z.boolean(),
});
export type BoundaryValidationType = z.infer<typeof BoundaryValidationObj>;
