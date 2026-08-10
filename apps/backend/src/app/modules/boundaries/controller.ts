import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';

import type { IAuthKeyPayload } from '../../../../../../libs/common/src';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { findPublishedBoundary } from '../../../../../../libs/common/src/lib/boundaries/catalog';
import type {
  AddBoundaryFeatureType,
  AddDrawnBoundarySetType,
  AddPublishedBoundarySetType,
  BoundaryFeatureListType,
  BoundaryFeatureRowType,
  BoundaryGeometryType,
  BoundaryAreaColumnType,
  BoundaryHouseholdPinsType,
  BoundarySetRowType,
  BoundaryValidationType,
  BoundaryViewportType,
  UpdateBoundaryFeatureType,
  UploadBoundarySetType,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import {
  BOUNDARY_FEATURES_MAX_RESPONSE_BYTES,
  BOUNDARY_FEATURE_CODE_MAX,
  BOUNDARY_FEATURE_NAME_MAX,
  BOUNDARY_MAX_FEATURES_PER_SET,
  BOUNDARY_MAX_PINS,
  BOUNDARY_MAX_SETS_PER_TENANT,
  BOUNDARY_MAX_VERTICES_PER_FEATURE,
  BOUNDARY_PIN_GRID_COLUMNS,
  BOUNDARY_UPLOAD_MAX_BYTES,
  BOUNDARY_UPLOAD_MAX_LABEL,
  boundaryBBoxOf,
  boundaryGeometrySchema,
  countBoundaryVertices,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { BadRequestError, NotFoundError } from '../../errors/app-errors';
import { listAreaSetColumns } from '../households/electoral-areas';
import { BaseController } from '../../lib/base.controller';
import { BOUNDARY_FEATURE_EDIT_SETTLE_MS, enqueueBoundaryMatch } from '../../lib/gis/boundary-jobs';
import { asCoordinate, countContainingFeatures, loadBoundarySets } from '../../lib/gis/boundary-match';
import { invalidateBoundarySetCache } from '../../lib/gis/boundary-store';
import { logger } from '../../logger';
import { StorageService } from '../../lib/storage.service';
import { BoundaryFeaturesRepo } from './repositories/boundary-features.repo';
import { BoundarySetsRepo } from './repositories/boundary-sets.repo';

/**
 * Boundary sets — the maps a workspace uses to say which areas cover which addresses.
 *
 * THE COST RULE, stated here because it drives every decision below: **nothing in this file calls a
 * paid service.** Creating, drawing, uploading, editing or deleting a map re-reads coordinates that
 * are already stored on the household and runs a point-in-polygon test in this process. Geocoding —
 * turning an address into coordinates — is the part that costs money, it happens elsewhere
 * (`lib/gis/geocode-queue.ts`), and it is plan-gated and metered. So this module is deliberately
 * NOT plan-gated: refusing a free operation on a cheap plan would be a restriction with no cost
 * behind it. Every mutation is admin-or-owner, which is the appropriate control for a workspace-wide
 * setting.
 *
 * The caps in `boundaries.schema.ts` are the other side of that: matching is free per household but
 * not free per vertex, and one carelessly-exported coastline can carry millions of them.
 */

/** Households examined by one validation pass before it reports a truncated answer honestly. */
const VALIDATION_HOUSEHOLD_CEILING = 50_000;

/** Households read per query while validating. */
const VALIDATION_PAGE_SIZE = 1_000;

/** Areas read per query while walking a large uploaded layer. */
const UPLOAD_INSERT_CHUNK = 500;

/**
 * Smallest density-grid square, in degrees — roughly eleven metres.
 *
 * A rectangle with no width or no height (a map framed on one household, or a browser that reported
 * a zero-size viewport while its container was still laying out) would otherwise divide by zero and
 * put every household in one square at NaN.
 */
const MIN_GRID_CELL_DEGREES = 0.0001;

/**
 * The extent of every located household, read off the same aggregate row that counted them, or null
 * when the workspace has none. This is what frames "fit the map to everything".
 */
function boundsFromExtent(
  row: {
    min_lat: unknown;
    max_lat: unknown;
    min_lng: unknown;
    max_lng: unknown;
  } | null,
): BoundaryViewportType | null {
  if (!row) return null;
  const south = asCoordinate(row.min_lat);
  const north = asCoordinate(row.max_lat);
  const west = asCoordinate(row.min_lng);
  const east = asCoordinate(row.max_lng);
  if (south === null || north === null || west === null || east === null) return null;
  return { north, south, east, west };
}

export class BoundariesController extends BaseController<'boundary_sets', BoundarySetsRepo> {
  private readonly featuresRepo = new BoundaryFeaturesRepo();
  private readonly storage = new StorageService();

  constructor() {
    super(new BoundarySetsRepo());
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────

  public async listSets(auth: IAuthKeyPayload): Promise<BoundarySetRowType[]> {
    return this.listSetRows(auth.tenant_id);
  }

  /**
   * The workspace's boundary maps described as grid columns — what the people and household grids
   * build their per-map area columns from.
   *
   * Separate from `listSets` because it answers a different question and carries the one thing the
   * settings list has no reason to know: which of these maps the given campaign's own seat is drawn
   * on, so the grid does not show that area name twice.
   */
  public listAreaColumns(auth: IAuthKeyPayload, campaignId: string | null): Promise<BoundaryAreaColumnType[]> {
    return listAreaSetColumns(this.getRepo().db, auth.tenant_id, campaignId);
  }

  private async listSetRows(tenantId: string): Promise<BoundarySetRowType[]> {
    const rows = await this.getRepo().listForTenant(tenantId);
    return rows.map((row) => ({
      ...row,
      // A layer is editable when its polygons live in rows. Bundled reference data is versioned as
      // a whole and imported names have no polygons at all, so neither can be edited area by area.
      editable: row.source === 'upload' || row.source === 'drawn',
      // Viewable is the wider question: are there polygons at all. Everything except an imported
      // list of names has them, including a published map that cannot be edited.
      viewable: row.source !== 'import',
      created_at: row.created_at == null ? null : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at == null ? null : new Date(row.updated_at).toISOString(),
    }));
  }

  /**
   * The areas of one layer, from wherever that layer keeps them.
   *
   * Two backends, one shape. An uploaded or drawn layer's areas are rows a person can rename and
   * reshape, so they carry their real row ids. A published layer's areas come from the shared
   * GeoJSON file the catalog describes and have no rows at all, so their ids are synthesised from
   * the set id and the area's position in the layer's fixed sort order. Nothing may be edited by
   * such an id — `requireEditableSet` refuses a published layer before any write reaches it — and
   * the ids are stable across loads because the sort order is.
   *
   * The response stops adding areas once the serialized geometry reaches the byte budget and
   * reports the layer's true size either way. A hand-drawn ward map never approaches it; a
   * published national map can, and a map that quietly drew two thirds of a country and said
   * nothing would read as complete.
   */
  public async listFeatures(auth: IAuthKeyPayload, setId: string): Promise<BoundaryFeatureListType> {
    const set = await this.requireSet(auth.tenant_id, setId);

    const all =
      set.source === 'bundled'
        ? await this.publishedFeatures(auth.tenant_id, setId)
        : await this.storedFeatures(auth.tenant_id, setId);

    const features: BoundaryFeatureRowType[] = [];
    let bytes = 0;
    for (const feature of all) {
      bytes += JSON.stringify(feature.geometry).length;
      if (bytes > BOUNDARY_FEATURES_MAX_RESPONSE_BYTES && features.length > 0) break;
      features.push(feature);
    }

    return {
      set_id: setId,
      features,
      total: all.length,
      truncated: features.length < all.length,
    };
  }

  /** Areas of an editable layer, read from the rows that hold them. */
  private async storedFeatures(tenantId: string, setId: string): Promise<BoundaryFeatureRowType[]> {
    const rows = await this.featuresRepo.listForSet(tenantId, setId);

    const features: BoundaryFeatureRowType[] = [];
    for (const row of rows) {
      const geometry = boundaryGeometrySchema.safeParse(row.geometry);
      if (!geometry.success) {
        logger.warn({ featureId: String(row.id) }, 'Boundary feature has unreadable geometry and was not listed');
        continue;
      }
      features.push({
        id: String(row.id),
        set_id: String(row.set_id),
        name: row.name,
        code: row.code,
        geometry: geometry.data,
        bbox: boundaryBBoxOf(geometry.data),
      });
    }
    return features;
  }

  /** Areas of a published layer, read through the same loader the matcher uses. */
  private async publishedFeatures(tenantId: string, setId: string): Promise<BoundaryFeatureRowType[]> {
    const loaded = await loadBoundarySets(this.getRepo().db, tenantId, [setId]);
    const layer = loaded[0];
    if (!layer) return [];
    return layer.features.map((feature, index) => ({
      id: `${setId}:${index}`,
      set_id: setId,
      name: feature.name,
      code: feature.code,
      geometry: feature.geometry,
      bbox: feature.bbox,
    }));
  }

  /**
   * What the drawing map should draw for the rectangle it is currently showing, and the numbers
   * that say what that is.
   *
   * The size problem this solves is real and ordinary: an Ontario provincial candidate works a
   * hundred thousand voters across thirty-five thousand or more households. Thirty-five thousand
   * map pins is thirty-five thousand DOM nodes; the tab stops responding and nobody could read the
   * result anyway. So the answer is scoped to the rectangle on screen and takes one of two shapes:
   *
   * - At most {@link BOUNDARY_MAX_PINS} located households in that rectangle → every one of them,
   *   as its own pin.
   * - More than that → a {@link BOUNDARY_PIN_GRID_COLUMNS}-square grid over the same rectangle with
   *   a count and an average position per square. At most a few hundred bubbles, whatever the zoom.
   *
   * Zooming in shrinks the rectangle until individual doors come back, which is the whole
   * interaction: density where you are looking wide, doors where you are looking close.
   *
   * `total_geocoded` (the workspace) and `in_view` (the rectangle) are both returned so a caption
   * can never report one as the other, and `bounds` is the extent of every located household — what
   * "fit the map to everything" frames, rather than the extent of whatever sample was drawn.
   *
   * Matching is unaffected by any of this. It runs server-side over every household in the
   * workspace, not over what a browser happens to be showing.
   *
   * Households without coordinates are left out because there is nowhere honest to put them.
   */
  public async listHouseholdPins(
    auth: IAuthKeyPayload,
    viewport: BoundaryViewportType | null,
  ): Promise<BoundaryHouseholdPinsType> {
    const db = this.getRepo().db;
    // A rectangle whose east edge is west of its west edge straddles the 180th meridian. Nothing
    // this product covers does, so rather than return an empty map for a nonsense rectangle, treat
    // it as no rectangle at all and answer for the whole workspace.
    const view = viewport && viewport.east >= viewport.west && viewport.north >= viewport.south ? viewport : null;

    const totals = await db
      .selectFrom('households')
      .select(({ fn }) => [
        fn.countAll().as('cnt'),
        fn.min('lat').as('min_lat'),
        fn.max('lat').as('max_lat'),
        fn.min('lng').as('min_lng'),
        fn.max('lng').as('max_lng'),
      ])
      .where('tenant_id', '=', auth.tenant_id)
      .where('lat', 'is not', null)
      .where('lng', 'is not', null)
      .executeTakeFirst();

    const totalGeocoded = Number(totals?.cnt ?? 0);
    const bounds = boundsFromExtent(totals ?? null);

    const inView = view === null ? totalGeocoded : await this.countLocatedIn(auth.tenant_id, view);
    const empty = { pins: [], clusters: [], total_geocoded: totalGeocoded, in_view: inView, bounds };
    if (inView === 0) return empty;

    // Too many to draw one by one: answer with density over the rectangle that was asked for, or
    // over the workspace's own extent when the browser has not framed itself yet.
    if (inView > BOUNDARY_MAX_PINS) {
      const grid = view ?? bounds;
      if (grid === null) return empty;
      return { ...empty, clusters: await this.householdClusters(auth.tenant_id, grid) };
    }

    return { ...empty, pins: await this.householdPinRows(auth.tenant_id, view) };
  }

  /** How many located households fall inside one rectangle. */
  private async countLocatedIn(tenantId: string, view: BoundaryViewportType): Promise<number> {
    const row = await this.getRepo()
      .db.selectFrom('households')
      .select(({ fn }) => [fn.countAll().as('cnt')])
      .where('tenant_id', '=', tenantId)
      .where('lat', '>=', view.south)
      .where('lat', '<=', view.north)
      .where('lng', '>=', view.west)
      .where('lng', '<=', view.east)
      .executeTakeFirst();
    return Number(row?.cnt ?? 0);
  }

  /** Every located household in the rectangle, as pins. Only called when there are few enough. */
  private async householdPinRows(
    tenantId: string,
    view: BoundaryViewportType | null,
  ): Promise<BoundaryHouseholdPinsType['pins']> {
    const base = this.getRepo()
      .db.selectFrom('households')
      .select(['id', 'lat', 'lng', 'street_num', 'street1', 'city'])
      .where('tenant_id', '=', tenantId)
      .where('lat', 'is not', null)
      .where('lng', 'is not', null);
    const query = view
      ? base
          .where('lat', '>=', view.south)
          .where('lat', '<=', view.north)
          .where('lng', '>=', view.west)
          .where('lng', '<=', view.east)
      : base;

    const rows = await query.orderBy('id', 'asc').limit(BOUNDARY_MAX_PINS).execute();

    const pins: BoundaryHouseholdPinsType['pins'] = [];
    for (const row of rows) {
      const lat = asCoordinate(row.lat);
      const lng = asCoordinate(row.lng);
      if (lat === null || lng === null) continue;
      pins.push({
        id: String(row.id),
        lat,
        lng,
        street_num: row.street_num ?? null,
        street1: row.street1 ?? null,
        city: row.city ?? null,
      });
    }
    return pins;
  }

  /**
   * The density grid over one rectangle: households counted into squares, each square reported at
   * the average position of the households in it so the bubble sits on the doors rather than on the
   * square's centre.
   *
   * The grid is a fixed number of squares across whatever the rectangle's size, so the work and the
   * response are bounded at every zoom. A rectangle with no width or no height (one household, or a
   * map framed on a single point) would divide by zero, so it gets a floor.
   */
  private async householdClusters(
    tenantId: string,
    view: BoundaryViewportType,
  ): Promise<BoundaryHouseholdPinsType['clusters']> {
    const latCell = Math.max((view.north - view.south) / BOUNDARY_PIN_GRID_COLUMNS, MIN_GRID_CELL_DEGREES);
    const lngCell = Math.max((view.east - view.west) / BOUNDARY_PIN_GRID_COLUMNS, MIN_GRID_CELL_DEGREES);

    const rows = await this.getRepo()
      .db.selectFrom('households')
      .where('tenant_id', '=', tenantId)
      .where('lat', '>=', view.south)
      .where('lat', '<=', view.north)
      .where('lng', '>=', view.west)
      .where('lng', '<=', view.east)
      .select(({ fn }) => [fn.countAll().as('cnt'), fn.avg('lat').as('avg_lat'), fn.avg('lng').as('avg_lng')])
      // Grouped by the square each household falls in, but the square itself is never selected: the
      // browser draws the bubble at the average position below, and the square number would only be
      // bytes on the wire nothing reads.
      .groupBy([sql`floor(${sql.ref('lat')} / ${latCell})`, sql`floor(${sql.ref('lng')} / ${lngCell})`])
      .execute();

    const clusters: BoundaryHouseholdPinsType['clusters'] = [];
    for (const row of rows) {
      const lat = asCoordinate(row.avg_lat);
      const lng = asCoordinate(row.avg_lng);
      if (lat === null || lng === null) continue;
      clusters.push({ lat, lng, count: Number(row.cnt) });
    }
    return clusters;
  }

  // ── Creating layers ───────────────────────────────────────────────────────────────────────────

  /**
   * Create an empty layer to draw into.
   *
   * Empty is the point: drawing is iterative, the layer has to exist before the first polygon can
   * be attached to it, and an admin who draws one ward and stops still has something usable.
   */
  public async createDrawnSet(auth: IAuthKeyPayload, input: AddDrawnBoundarySetType): Promise<BoundarySetRowType> {
    const repo = this.getRepo();
    await this.assertSetBudget(auth.tenant_id);

    const created = await repo.transaction().execute(async (trx) => {
      const slug = await this.uniqueSlug(auth.tenant_id, input.slug ?? input.label, trx);
      const row = {
        tenant_id: auth.tenant_id,
        slug,
        label: input.label,
        jurisdiction: input.jurisdiction,
        role: input.role,
        chamber: input.chamber ?? null,
        region: input.region ?? null,
        vintage: input.vintage ?? null,
        source: 'drawn',
        file_id: null,
        name_property: null,
        code_property: null,
        feature_count: 0,
        createdby_id: auth.user_id,
      } as OperationDataType<'boundary_sets', 'insert'>;

      const inserted = await repo.add({ row }, trx);
      if (!inserted) throw new NotFoundError('Failed to create the boundary set');
      return inserted;
    });

    return this.setRowOf(auth.tenant_id, String(created.id));
  }

  /**
   * Add a map from the published catalog.
   *
   * The polygons are not copied anywhere. One row is written naming the catalog slug, and the file
   * behind that slug is loaded on demand and shared by every workspace that added the same map —
   * which is the whole reason a national riding map can be offered at all. That also makes this the
   * cheapest way to get a map: no upload, no parse, no per-workspace copy of five thousand areas,
   * and still no paid service, because matching re-reads coordinates already on the household.
   *
   * Everything descriptive is copied from the catalog entry rather than taken from the caller, so a
   * row cannot end up claiming to be Ontario's ridings while naming Alberta's file.
   */
  public async addPublishedSet(auth: IAuthKeyPayload, input: AddPublishedBoundarySetType): Promise<BoundarySetRowType> {
    const entry = findPublishedBoundary(input.catalog_slug);
    if (!entry) {
      throw new NotFoundError(
        'That map is not in this version of the published catalog. Upload a GeoJSON file or draw the areas instead.',
      );
    }

    const repo = this.getRepo();
    await this.assertSetBudget(auth.tenant_id);

    // `(tenant_id, slug)` is unique, and a published set always uses the catalog slug verbatim so
    // that two workspaces holding the same map are recognisably holding the same map. A second add
    // is therefore a duplicate rather than a second copy, and is refused by name.
    const taken = await repo.takenSlugs(auth.tenant_id);
    if (taken.has(entry.slug)) {
      throw new BadRequestError(`This workspace already has "${entry.label}".`);
    }

    const created = await repo.transaction().execute(async (trx) => {
      const row = {
        tenant_id: auth.tenant_id,
        slug: entry.slug,
        label: entry.label,
        jurisdiction: entry.jurisdiction,
        role: entry.role,
        chamber: entry.chamber,
        region: entry.region,
        vintage: entry.vintage,
        source: 'bundled',
        file_id: null,
        name_property: entry.nameProperty,
        code_property: entry.codeProperty,
        feature_count: entry.featureCount,
        createdby_id: auth.user_id,
      } as OperationDataType<'boundary_sets', 'insert'>;

      const inserted = await repo.add({ row }, trx);
      if (!inserted) throw new NotFoundError('Failed to add the published map');

      // Transactional outbox, exactly as the upload path does it: the match job is queued inside
      // the transaction that created the row, so a rolled-back add leaves no job pointing at a set
      // that never existed.
      await enqueueBoundaryMatch(trx, auth.tenant_id, String(inserted.id), 'all');
      return inserted;
    });

    return this.setRowOf(auth.tenant_id, String(created.id));
  }

  /**
   * Turn an uploaded GeoJSON file into a layer.
   *
   * The bytes arrive through the existing signed-upload flow into blob storage, not through this
   * request: the server-wide body limit is 1 MiB and this accepts files up to 20 MB. A small file
   * the caller already holds may be passed inline instead.
   *
   * Every area is parsed, capped and stored as its own row, so an uploaded boundary that turns out
   * to be wrong can be fixed in place rather than re-exported from whatever published it. The
   * original file stays in `files`, so a bad parse can be re-run against the source.
   */
  public async uploadSet(auth: IAuthKeyPayload, input: UploadBoundarySetType): Promise<BoundarySetRowType> {
    const repo = this.getRepo();
    await this.assertSetBudget(auth.tenant_id);

    const raw = input.file_id != null ? await this.readUploadedFile(auth.tenant_id, input.file_id) : input.geojson;
    const parsed = this.parseFeatureCollection(raw, input.name_property, input.code_property ?? null);

    const created = await repo.transaction().execute(async (trx) => {
      const slug = await this.uniqueSlug(auth.tenant_id, input.slug ?? input.label, trx);
      const row = {
        tenant_id: auth.tenant_id,
        slug,
        label: input.label,
        jurisdiction: input.jurisdiction,
        role: input.role,
        chamber: input.chamber ?? null,
        region: input.region ?? null,
        vintage: input.vintage ?? null,
        source: 'upload',
        file_id: input.file_id ?? null,
        name_property: input.name_property,
        code_property: input.code_property ?? null,
        feature_count: parsed.length,
        createdby_id: auth.user_id,
      } as OperationDataType<'boundary_sets', 'insert'>;

      const inserted = await repo.add({ row }, trx);
      if (!inserted) throw new NotFoundError('Failed to create the boundary set');
      const setId = String(inserted.id);

      const featureRows = parsed.map(
        (feature) =>
          ({
            tenant_id: auth.tenant_id,
            set_id: setId,
            name: feature.name,
            code: feature.code,
            geometry: JSON.stringify(feature.geometry),
            bbox: JSON.stringify(boundaryBBoxOf(feature.geometry)),
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          }) as OperationDataType<'boundary_features', 'insert'>,
      );
      for (let i = 0; i < featureRows.length; i += UPLOAD_INSERT_CHUNK) {
        await this.featuresRepo.insertForSet(featureRows.slice(i, i + UPLOAD_INSERT_CHUNK), trx);
      }

      // Transactional outbox: the match job is queued inside the same transaction that stored the
      // polygons, so a rolled-back upload leaves no job matching against areas that never existed.
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all');
      return inserted;
    });

    const setId = String(created.id);
    invalidateBoundarySetCache(setId);
    return this.setRowOf(auth.tenant_id, setId);
  }

  public async deleteSet(auth: IAuthKeyPayload, setId: string): Promise<boolean> {
    const set = await this.requireSet(auth.tenant_id, setId);

    // `boundary_features` and `household_districts` both cascade from `boundary_sets`, so one
    // statement removes the layer, its polygons, and every household's membership in it. The other
    // layers' answers are untouched, so no re-match is queued: deleting a map triggers nothing.
    await this.getRepo().delete({ tenant_id: auth.tenant_id, id: String(set.id) });

    invalidateBoundarySetCache(String(set.id));
    return true;
  }

  // ── Editing areas ─────────────────────────────────────────────────────────────────────────────

  public async addFeature(auth: IAuthKeyPayload, input: AddBoundaryFeatureType): Promise<BoundaryFeatureRowType> {
    const set = await this.requireEditableSet(auth.tenant_id, input.set_id);
    const setId = String(set.id);

    const repo = this.getRepo();
    const created = await repo.transaction().execute(async (trx) => {
      const existing = await this.featuresRepo.countForSet(auth.tenant_id, setId, trx);
      if (existing >= BOUNDARY_MAX_FEATURES_PER_SET) {
        throw new BadRequestError(
          `A boundary set may hold at most ${BOUNDARY_MAX_FEATURES_PER_SET.toLocaleString()} areas. Split this map across more than one set.`,
        );
      }

      const row = {
        tenant_id: auth.tenant_id,
        set_id: setId,
        name: input.name,
        code: input.code ?? null,
        geometry: JSON.stringify(input.geometry),
        bbox: JSON.stringify(boundaryBBoxOf(input.geometry)),
        createdby_id: auth.user_id,
        updatedby_id: auth.user_id,
      } as OperationDataType<'boundary_features', 'insert'>;

      const inserted = await this.featuresRepo.add({ row }, trx);
      if (!inserted) throw new NotFoundError('Failed to save the area');

      await this.getRepo().touch(auth.tenant_id, setId, existing + 1, trx);
      // Settle delay: area saves arrive in bursts while a map is being drawn; see the constant.
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all', BOUNDARY_FEATURE_EDIT_SETTLE_MS);
      return inserted;
    });

    invalidateBoundarySetCache(setId);
    return {
      id: String(created.id),
      set_id: setId,
      name: input.name,
      code: input.code ?? null,
      geometry: input.geometry,
      bbox: boundaryBBoxOf(input.geometry),
    };
  }

  public async updateFeature(
    auth: IAuthKeyPayload,
    featureId: string,
    input: UpdateBoundaryFeatureType,
  ): Promise<BoundaryFeatureRowType> {
    const existing = await this.featuresRepo.findById(auth.tenant_id, featureId);
    if (!existing) throw new NotFoundError('Area not found');
    const setId = String(existing.set_id);
    await this.requireEditableSet(auth.tenant_id, setId);

    const geometry = input.geometry ?? this.readStoredGeometry(existing.geometry, featureId);
    const name = input.name ?? existing.name;
    const code = input.code === undefined ? existing.code : (input.code ?? null);

    const repo = this.getRepo();
    await repo.transaction().execute(async (trx) => {
      await this.featuresRepo.update(
        {
          tenant_id: auth.tenant_id,
          id: featureId,
          row: {
            name,
            code,
            geometry: JSON.stringify(geometry),
            bbox: JSON.stringify(boundaryBBoxOf(geometry)),
            updatedby_id: auth.user_id,
            updated_at: new Date(),
          },
        },
        trx,
      );

      // A turf remembers which area it was cut from by NAME: `turfs.boundary_name` is text, and the
      // canvassing door refresh compares it to the area name exactly. Renaming an area without
      // moving its turfs would leave them naming an area this map no longer has, so the refresh
      // would find no doors — or, after a renumbering that reuses names, the wrong ones. Scoped to
      // this layer as well as this tenant, because two layers may both have a "Ward 3".
      if (name !== existing.name) {
        await trx
          .updateTable('turfs')
          .set({ boundary_name: name })
          .where('tenant_id', '=', auth.tenant_id)
          .where('boundary_set_id', '=', setId)
          .where('boundary_name', '=', existing.name)
          .execute();
      }

      const count = await this.featuresRepo.countForSet(auth.tenant_id, setId, trx);
      await repo.touch(auth.tenant_id, setId, count, trx);
      // Settle delay: area saves arrive in bursts while a map is being drawn; see the constant.
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all', BOUNDARY_FEATURE_EDIT_SETTLE_MS);
    });

    invalidateBoundarySetCache(setId);
    return { id: featureId, set_id: setId, name, code, geometry, bbox: boundaryBBoxOf(geometry) };
  }

  public async deleteFeature(auth: IAuthKeyPayload, featureId: string): Promise<boolean> {
    const existing = await this.featuresRepo.findById(auth.tenant_id, featureId);
    if (!existing) throw new NotFoundError('Area not found');
    const setId = String(existing.set_id);
    await this.requireEditableSet(auth.tenant_id, setId);

    const repo = this.getRepo();
    await repo.transaction().execute(async (trx) => {
      await this.featuresRepo.deleteById(auth.tenant_id, featureId, trx);
      const count = await this.featuresRepo.countForSet(auth.tenant_id, setId, trx);
      await repo.touch(auth.tenant_id, setId, count, trx);
      // Households that were inside the deleted area now belong to no area of this layer, so the
      // whole layer is re-matched rather than left reporting an area that no longer exists.
      // Settle delay: deletes arrive in bursts during a redraw session too; see the constant.
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all', BOUNDARY_FEATURE_EDIT_SETTLE_MS);
    });

    invalidateBoundarySetCache(setId);
    return true;
  }

  // ── Matching and quality ──────────────────────────────────────────────────────────────────────

  /**
   * Queue a re-match, for one layer or for every layer the workspace requires.
   *
   * Safe to press repeatedly: an equivalent pending job suppresses a duplicate, and the work itself
   * calls no paid service.
   */
  public async requestRematch(auth: IAuthKeyPayload, setId: string | null): Promise<{ queued: true }> {
    if (setId !== null) await this.requireSet(auth.tenant_id, setId);
    await enqueueBoundaryMatch(this.getRepo().db, auth.tenant_id, setId, 'all');
    return { queued: true };
  }

  /**
   * Count the households a layer fails to place, and the ones it places twice.
   *
   * These are the two honest quality numbers for a hand-drawn or uploaded map. Adjacent polygons
   * have gaps and overlaps unless traced carefully, and this product does not promise shared-edge
   * topology editing, so rather than hide that the matcher is simply run and the result reported.
   * It costs nothing: no external call is involved.
   *
   * The pass stops at a fixed ceiling and says so through `capped`, because a truncated answer that
   * does not admit it is worse than no answer.
   */
  public async validateSet(auth: IAuthKeyPayload, setId: string): Promise<BoundaryValidationType> {
    const set = await this.requireSet(auth.tenant_id, setId);
    const loaded = await loadBoundarySets(this.getRepo().db, auth.tenant_id, [String(set.id)]);
    const layer = loaded[0];

    const db = this.getRepo().db;
    const totalRow = await db
      .selectFrom('households')
      .select(({ fn }) => [fn.countAll().as('cnt')])
      .where('tenant_id', '=', auth.tenant_id)
      .where('lat', 'is not', null)
      .where('lng', 'is not', null)
      .executeTakeFirst();
    const totalGeocoded = Number(totalRow?.cnt ?? 0);

    // A layer with no loadable polygons — an import-source set, an empty drawn set, a bundled set
    // whose asset is absent — examines nothing, and that is "not applicable", not "truncated".
    // Reporting `capped` from `examined < total` here would claim a ceiling was hit on a check
    // that never ran.
    if (!layer || layer.features.length === 0) {
      return {
        set_id: String(set.id),
        examined: 0,
        total_geocoded: totalGeocoded,
        unmatched: 0,
        multiply_matched: 0,
        capped: false,
      };
    }

    let examined = 0;
    let unmatched = 0;
    let multiplyMatched = 0;
    let cursor: string | null = null;

    while (examined < VALIDATION_HOUSEHOLD_CEILING) {
      const page = await this.geocodedHouseholdPage(db, auth.tenant_id, cursor);
      if (page.length === 0) break;

      for (const household of page) {
        if (examined >= VALIDATION_HOUSEHOLD_CEILING) break;
        examined++;
        const hits = countContainingFeatures(household.lat, household.lng, layer);
        if (hits === 0) unmatched++;
        else if (hits > 1) multiplyMatched++;
      }

      const lastRow = page[page.length - 1];
      if (!lastRow) break;
      cursor = lastRow.id;
      if (page.length < VALIDATION_PAGE_SIZE) break;
    }

    return {
      set_id: String(set.id),
      examined,
      total_geocoded: totalGeocoded,
      unmatched,
      multiply_matched: multiplyMatched,
      capped: examined < totalGeocoded,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────────────────────────

  private async geocodedHouseholdPage(
    db: Kysely<Models>,
    tenantId: string,
    cursor: string | null,
  ): Promise<{ id: string; lat: number; lng: number }[]> {
    let query = db
      .selectFrom('households')
      .select(['id', 'lat', 'lng'])
      .where('tenant_id', '=', tenantId)
      .where('lat', 'is not', null)
      .where('lng', 'is not', null)
      .orderBy('id', 'asc')
      .limit(VALIDATION_PAGE_SIZE);
    if (cursor !== null) query = query.where('id', '>', cursor);

    const rows = await query.execute();
    const points: { id: string; lat: number; lng: number }[] = [];
    for (const row of rows) {
      const lat = asCoordinate(row.lat);
      const lng = asCoordinate(row.lng);
      if (lat === null || lng === null) continue;
      points.push({ id: String(row.id), lat, lng });
    }
    return points;
  }

  private async requireSet(tenantId: string, setId: string) {
    const set = await this.getRepo().findById(tenantId, setId);
    if (!set) throw new NotFoundError('Boundary set not found');
    return set;
  }

  private async requireEditableSet(tenantId: string, setId: string) {
    const set = await this.requireSet(tenantId, setId);
    if (set.source !== 'upload' && set.source !== 'drawn') {
      throw new BadRequestError(
        'This map cannot be edited area by area. Bundled maps are versioned as a whole, and imported districts have no polygons — they arrive already assigned on each row of the import.',
      );
    }
    return set;
  }

  private async assertSetBudget(tenantId: string): Promise<void> {
    const held = await this.getRepo().countForTenant(tenantId);
    if (held >= BOUNDARY_MAX_SETS_PER_TENANT) {
      throw new BadRequestError(
        `A workspace may hold at most ${BOUNDARY_MAX_SETS_PER_TENANT} boundary sets. Delete one you no longer use before adding another.`,
      );
    }
  }

  private async setRowOf(tenantId: string, setId: string): Promise<BoundarySetRowType> {
    const rows = await this.listSetRows(tenantId);
    const found = rows.find((row) => row.id === setId);
    if (!found) throw new NotFoundError('Boundary set not found');
    return found;
  }

  /** Build a slug that is unique in this workspace, since `(tenant_id, slug)` is a unique key. */
  private async uniqueSlug(tenantId: string, seed: string, trx?: Transaction<Models>): Promise<string> {
    const base =
      seed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'boundary-set';

    const taken = await this.getRepo().takenSlugs(tenantId, trx);
    if (!taken.has(base)) return base;
    for (let suffix = 2; suffix <= BOUNDARY_MAX_SETS_PER_TENANT + 1; suffix++) {
      const candidate = `${base}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new BadRequestError('A boundary set with this name already exists. Give the new one a different name.');
  }

  private readStoredGeometry(value: unknown, featureId: string): BoundaryGeometryType {
    const parsed = boundaryGeometrySchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestError(
        `The stored outline for area ${featureId} could not be read, so it cannot be renamed without also redrawing it.`,
      );
    }
    return parsed.data;
  }

  /**
   * Fetch an already-uploaded GeoJSON file's bytes, refusing anything past the size cap.
   *
   * The recorded size is checked before the download, so an oversized file is refused without ever
   * being pulled into memory. `files.size_bytes` is read back from storage at registration time and
   * never declared by the client, so it is trustworthy; when it is absent the download happens and
   * the byte length is checked instead.
   */
  private async readUploadedFile(tenantId: string, fileId: string): Promise<unknown> {
    const file = await this.getRepo()
      .db.selectFrom('files')
      .select(['id', 'storage_key', 'size_bytes', 'filename'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .executeTakeFirst();
    if (!file) throw new NotFoundError('Uploaded file not found');

    if (file.size_bytes != null && file.size_bytes > BOUNDARY_UPLOAD_MAX_BYTES) {
      throw new BadRequestError(
        `A boundary file may be at most ${BOUNDARY_UPLOAD_MAX_LABEL}. This one is ${(file.size_bytes / (1024 * 1024)).toFixed(1)} MB. Simplify the geometry or split the file.`,
      );
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.download(file.storage_key);
    } catch (err) {
      logger.error({ err, fileId }, 'Failed to download boundary upload from storage');
      throw new BadRequestError('The uploaded file could not be read. Upload it again.');
    }

    if (buffer.byteLength > BOUNDARY_UPLOAD_MAX_BYTES) {
      throw new BadRequestError(
        `A boundary file may be at most ${BOUNDARY_UPLOAD_MAX_LABEL}. Simplify the geometry or split the file.`,
      );
    }

    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new BadRequestError(`"${file.filename}" is not valid JSON, so it cannot be read as GeoJSON.`);
    }
  }

  /**
   * Read a GeoJSON FeatureCollection into named areas, enforcing every cap on the way.
   *
   * Publishers disagree on which property holds the name — Elections Canada writes ED_NAMEE, the
   * Census Bureau writes NAMELSAD, a city portal writes whatever it likes — so the caller says
   * which property to read rather than the code guessing.
   */
  private parseFeatureCollection(
    raw: unknown,
    nameProperty: string,
    codeProperty: string | null,
  ): { name: string; code: string | null; geometry: BoundaryGeometryType }[] {
    if (typeof raw !== 'object' || raw === null) {
      throw new BadRequestError('That file is not a GeoJSON FeatureCollection.');
    }
    const collection = raw as { type?: unknown; features?: unknown };
    if (!Array.isArray(collection.features)) {
      throw new BadRequestError('That file has no "features" list, so it is not a GeoJSON FeatureCollection.');
    }
    if (collection.features.length === 0) {
      throw new BadRequestError('That file contains no areas.');
    }
    if (collection.features.length > BOUNDARY_MAX_FEATURES_PER_SET) {
      throw new BadRequestError(
        `A boundary set may hold at most ${BOUNDARY_MAX_FEATURES_PER_SET.toLocaleString()} areas; this file has ${collection.features.length.toLocaleString()}. Split it across more than one set — for example one file per region.`,
      );
    }

    const parsed: { name: string; code: string | null; geometry: BoundaryGeometryType }[] = [];
    const skipped: number[] = [];

    for (const [index, entry] of collection.features.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        skipped.push(index);
        continue;
      }
      const feature = entry as { properties?: unknown; geometry?: unknown };
      const geometry = boundaryGeometrySchema.safeParse(feature.geometry);
      if (!geometry.success) {
        // Points, lines and null geometries are legal GeoJSON and simply have no area, so they are
        // skipped rather than treated as a broken file.
        skipped.push(index);
        continue;
      }

      const vertices = countBoundaryVertices(geometry.data);
      if (vertices > BOUNDARY_MAX_VERTICES_PER_FEATURE) {
        throw new BadRequestError(
          `One area in that file has ${vertices.toLocaleString()} points, past the limit of ${BOUNDARY_MAX_VERTICES_PER_FEATURE.toLocaleString()} per area. Simplify the outlines before uploading — most published files offer a simplified version.`,
        );
      }

      const properties = (
        typeof feature.properties === 'object' && feature.properties !== null ? feature.properties : {}
      ) as Record<string, unknown>;
      const nameValue = properties[nameProperty];
      const codeValue = codeProperty ? properties[codeProperty] : undefined;

      // Truncated to the same caps Zod enforces on drawn areas, rather than refused: the file is
      // otherwise valid, the property was probably never meant as a display name, and rejecting a
      // 5,000-area upload over one long label would make the admin edit the file by hand.
      const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : null;
      const code = typeof codeValue === 'string' && codeValue.trim() ? codeValue.trim() : null;

      parsed.push({
        name: name === null ? `Area ${index + 1}` : name.slice(0, BOUNDARY_FEATURE_NAME_MAX).trimEnd(),
        code: code === null ? null : code.slice(0, BOUNDARY_FEATURE_CODE_MAX).trimEnd(),
        geometry: geometry.data,
      });
    }

    if (parsed.length === 0) {
      throw new BadRequestError(
        'None of the shapes in that file are areas. A boundary file must contain Polygon or MultiPolygon features.',
      );
    }
    if (skipped.length > 0) {
      logger.info({ skipped: skipped.length }, 'Boundary upload skipped features with no area');
    }
    return parsed;
  }
}
