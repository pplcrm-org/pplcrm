import type { Kysely, Transaction } from 'kysely';

import type { IAuthKeyPayload } from '../../../../../../libs/common/src';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import type {
  AddBoundaryFeatureType,
  AddDrawnBoundarySetType,
  BoundaryFeatureRowType,
  BoundaryGeometryType,
  BoundaryHouseholdPinsType,
  BoundarySetRowType,
  BoundaryValidationType,
  UpdateBoundaryFeatureType,
  UploadBoundarySetType,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import {
  BOUNDARY_FEATURE_CODE_MAX,
  BOUNDARY_FEATURE_NAME_MAX,
  BOUNDARY_MAX_FEATURES_PER_SET,
  BOUNDARY_MAX_PINS,
  BOUNDARY_MAX_SETS_PER_TENANT,
  BOUNDARY_MAX_VERTICES_PER_FEATURE,
  BOUNDARY_UPLOAD_MAX_BYTES,
  BOUNDARY_UPLOAD_MAX_LABEL,
  boundaryBBoxOf,
  boundaryGeometrySchema,
  countBoundaryVertices,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { BadRequestError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { enqueueBoundaryMatch } from '../../lib/gis/boundary-jobs';
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

  private async listSetRows(tenantId: string): Promise<BoundarySetRowType[]> {
    const rows = await this.getRepo().listForTenant(tenantId);
    return rows.map((row) => ({
      ...row,
      // A layer is editable when its polygons live in rows. Bundled reference data is versioned as
      // a whole and imported names have no polygons at all, so neither can be edited area by area.
      editable: row.source === 'upload' || row.source === 'drawn',
      created_at: row.created_at == null ? null : new Date(row.created_at).toISOString(),
      updated_at: row.updated_at == null ? null : new Date(row.updated_at).toISOString(),
    }));
  }

  public async listFeatures(auth: IAuthKeyPayload, setId: string): Promise<BoundaryFeatureRowType[]> {
    await this.requireSet(auth.tenant_id, setId);
    const rows = await this.featuresRepo.listForSet(auth.tenant_id, setId);

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

  /**
   * The household pins the drawing map draws its areas around, plus how many located households
   * there really are.
   *
   * Both numbers are returned because only one of them is the sample. The pin list stops at
   * {@link BOUNDARY_MAX_PINS} and is ordered by id, so a workspace past the cap gets the SAME
   * households on every load instead of an arbitrary set that changes under the person tracing over
   * them. `total_geocoded` is the honest denominator for the caption; matching itself is unaffected,
   * because it runs server-side over every household rather than over these pins.
   *
   * Households without coordinates are left out because there is nowhere honest to put them.
   */
  public async listHouseholdPins(auth: IAuthKeyPayload): Promise<BoundaryHouseholdPinsType> {
    const db = this.getRepo().db;

    const totalRow = await db
      .selectFrom('households')
      .select(({ fn }) => [fn.countAll().as('cnt')])
      .where('tenant_id', '=', auth.tenant_id)
      .where('lat', 'is not', null)
      .where('lng', 'is not', null)
      .executeTakeFirst();

    const rows = await db
      .selectFrom('households')
      .select(['id', 'lat', 'lng', 'street_num', 'street1', 'city'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('lat', 'is not', null)
      .where('lng', 'is not', null)
      .orderBy('id', 'asc')
      .limit(BOUNDARY_MAX_PINS)
      .execute();

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

    return { pins, total_geocoded: Number(totalRow?.cnt ?? 0) };
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
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all');
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
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all');
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
      await enqueueBoundaryMatch(trx, auth.tenant_id, setId, 'all');
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
