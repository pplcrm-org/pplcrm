import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IAuthKeyPayload } from '@common';
import type { BoundaryGeometryType } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import {
  BOUNDARY_FEATURE_CODE_MAX,
  BOUNDARY_FEATURE_NAME_MAX,
  BOUNDARY_MAX_PINS,
  BOUNDARY_MAX_SETS_PER_TENANT,
  BOUNDARY_PIN_GRID_COLUMNS,
  boundaryBBoxOf,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import type { PublishedBoundaryEntry } from '../../../../../../libs/common/src/lib/boundaries/catalog';
import { PUBLISHED_BOUNDARY_ENTRIES } from '../../../../../../libs/common/src/lib/boundaries/catalog';
import { BaseRepository } from '../../lib/base.repo';
import { invalidateBoundarySetCache } from '../../lib/gis/boundary-store';
import { BoundariesController } from './controller';

const db = BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/** An axis-aligned box, as a GeoJSON Polygon. */
function box(minLng: number, minLat: number, maxLng: number, maxLat: number): BoundaryGeometryType {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

describe('BoundariesController', () => {
  const controller = new BoundariesController();
  let tenantId: string;
  let userId: string;
  let auth: IAuthKeyPayload;

  async function makeSet(slug: string, source: string): Promise<string> {
    const row = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug,
        label: slug,
        jurisdiction: 'other',
        role: 'subdivision',
        source,
        feature_count: 0,
        createdby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  async function addFeature(setId: string, name: string, geometry: BoundaryGeometryType): Promise<void> {
    await db
      .insertInto('boundary_features')
      .values({
        tenant_id: tenantId,
        set_id: setId,
        name,
        geometry: JSON.stringify(geometry),
        bbox: JSON.stringify(boundaryBBoxOf(geometry)),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    invalidateBoundarySetCache(setId);
  }

  async function makeGeocodedHousehold(lat: number, lng: number): Promise<string> {
    const id = rand();
    await db
      .insertInto('households')
      .values({
        id,
        tenant_id: tenantId,
        street_num: '1',
        street1: 'Test St',
        city: 'Testville',
        lat,
        lng,
        geocoding_status: 'success',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    return id;
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    auth = { tenant_id: tenantId, user_id: userId, name: 'Test User', session_id: 'sess' };
    await db.insertInto('tenants').values({ id: tenantId, name: 'Boundary Controller Test' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `bc-${userId}@example.com`,
        password: 'password',
        first_name: 'Test',
        last_name: 'User',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    invalidateBoundarySetCache();
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_features').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  describe('validateSet', () => {
    it('reports a real pass over a layer with polygons', async () => {
      const setId = await makeSet('wards', 'drawn');
      await addFeature(setId, 'Ward 1', box(-76, 45, -75, 46));
      await makeGeocodedHousehold(45.5, -75.5);

      const result = await controller.validateSet(auth, setId);

      expect(result.examined).toBe(1);
      expect(result.unmatched).toBe(0);
      expect(result.capped).toBe(false);
    });

    it('never claims a truncated check for an import-source layer, which has no polygons to run', async () => {
      // An import layer's area names arrived per household in a CSV; there is nothing to validate.
      // `examined` 0 with geocoded households present used to compute `capped` true — a claim that
      // a ceiling was hit on a check that never ran.
      const setId = await makeSet('voter-file', 'import');
      await makeGeocodedHousehold(45.5, -75.5);

      const result = await controller.validateSet(auth, setId);

      expect(result.examined).toBe(0);
      expect(result.total_geocoded).toBe(1);
      expect(result.unmatched).toBe(0);
      expect(result.multiply_matched).toBe(0);
      expect(result.capped).toBe(false);
    });

    it('never claims a truncated check for a layer with no areas yet', async () => {
      const setId = await makeSet('empty-drawn', 'drawn');
      await makeGeocodedHousehold(45.5, -75.5);

      const result = await controller.validateSet(auth, setId);

      expect(result.examined).toBe(0);
      expect(result.capped).toBe(false);
    });
  });

  describe('uploadSet', () => {
    it('truncates file-supplied area names and codes to the same caps drawn areas get', async () => {
      // Uploaded properties are not Zod-validated the way drawn areas are; a publisher can put
      // anything in them. The file is otherwise valid, so over-long values are truncated rather
      // than the whole upload refused.
      const longName = 'N'.repeat(BOUNDARY_FEATURE_NAME_MAX + 80);
      const longCode = 'C'.repeat(BOUNDARY_FEATURE_CODE_MAX + 40);

      const created = await controller.uploadSet(auth, {
        label: 'Uploaded wards',
        jurisdiction: 'other',
        role: 'subdivision',
        name_property: 'NAME',
        code_property: 'CODE',
        geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { NAME: longName, CODE: longCode },
              geometry: box(-76, 45, -75, 46),
            },
          ],
        },
      });

      const stored = await db
        .selectFrom('boundary_features')
        .select(['name', 'code'])
        .where('tenant_id', '=', tenantId)
        .where('set_id', '=', created.id)
        .execute();

      expect(stored).toHaveLength(1);
      expect(stored[0]?.name).toBe('N'.repeat(BOUNDARY_FEATURE_NAME_MAX));
      expect(stored[0]?.code).toBe('C'.repeat(BOUNDARY_FEATURE_CODE_MAX));
    });
  });

  describe('adding a map from the published catalog', () => {
    it('refuses a slug the catalog does not publish, and names the two paths that do work', async () => {
      // A slug can go unknown two ways: a typo, or a map retired from the catalog between the page
      // loading and the click. The error has to point somewhere useful rather than reading as a bug.
      await expect(
        controller.addPublishedSet(auth, { catalog_slug: 'not-a-real-published-map' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    // These need a populated catalog. They are skipped rather than silently passing while it is
    // empty, so the runner reports honestly that they did not exercise anything.
    describe.skipIf(PUBLISHED_BOUNDARY_ENTRIES.length === 0)('once the catalog holds an entry', () => {
      /** Never throws inside this block — it is skipped entirely when the catalog is empty. */
      const anEntry = (): PublishedBoundaryEntry => {
        const entry = PUBLISHED_BOUNDARY_ENTRIES[0];
        if (!entry) throw new Error('This block is skipped when the catalog is empty.');
        return entry;
      };

      it('refuses even a real catalog slug when the workspace is at its map limit', async () => {
        const entry = anEntry();
        // Budget is checked first, so a full workspace gets the limit message rather than a
        // confusing "not in the catalog" for a map that does exist.
        for (let i = 0; i < BOUNDARY_MAX_SETS_PER_TENANT; i++) await makeSet(`budget-${rand()}-${i}`, 'drawn');
        await expect(controller.addPublishedSet(auth, { catalog_slug: entry.slug })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      });

      it('copies the catalog entry onto the row and queues a match in the same transaction', async () => {
        const entry = anEntry();
        const created = await controller.addPublishedSet(auth, { catalog_slug: entry.slug });

        // Nothing descriptive comes from the caller: a row that could disagree with the file it
        // names is how "Ontario ridings" ends up being a map of Alberta.
        expect(created.slug).toBe(entry.slug);
        expect(created.label).toBe(entry.label);
        expect(created.source).toBe('bundled');
        expect(created.feature_count).toBe(entry.featureCount);
        expect(created.editable).toBe(false);

        const jobs = await db
          .selectFrom('background_jobs')
          .select(['payload'])
          .where('tenant_id', '=', tenantId)
          .execute();
        expect(jobs.some((job) => JSON.stringify(job.payload).includes('match_boundaries'))).toBe(true);
      });

      it('refuses a second copy of a map the workspace already has', async () => {
        const entry = anEntry();
        await controller.addPublishedSet(auth, { catalog_slug: entry.slug });
        await expect(controller.addPublishedSet(auth, { catalog_slug: entry.slug })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      });
    });
  });

  describe('listing the areas of a map', () => {
    it('reports the layer size alongside the areas, so a caption cannot quote the sample', async () => {
      const setId = await makeSet(`areas-${rand()}`, 'drawn');
      await addFeature(setId, 'Ward 1', box(-76, 45, -75, 46));
      await addFeature(setId, 'Ward 2', box(-75, 45, -74, 46));

      const listed = await controller.listFeatures(auth, setId);
      expect(listed.set_id).toBe(setId);
      expect(listed.features).toHaveLength(2);
      expect(listed.total).toBe(2);
      expect(listed.truncated).toBe(false);
    });

    it('returns no areas for a published map whose file is not present, rather than failing', async () => {
      // A `bundled` row naming a slug with no readable file behind it logs loudly and matches
      // nothing. The page must still render — an empty layer is a state, not an error.
      const setId = await makeSet(`published-${rand()}`, 'bundled');
      const listed = await controller.listFeatures(auth, setId);
      expect(listed.features).toEqual([]);
      expect(listed.total).toBe(0);
      expect(listed.truncated).toBe(false);
    });

    it('refuses to edit an area of a published map', async () => {
      const setId = await makeSet(`published-edit-${rand()}`, 'bundled');
      await expect(
        controller.addFeature(auth, { set_id: setId, name: 'Invented ward', geometry: box(-76, 45, -75, 46) }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('what the drawing map is given to draw', () => {
    it('returns every located household as its own pin when there are few of them', async () => {
      await makeGeocodedHousehold(45.42, -75.69);
      await makeGeocodedHousehold(45.43, -75.68);

      const drawn = await controller.listHouseholdPins(auth, null);

      expect(drawn.pins).toHaveLength(2);
      expect(drawn.clusters).toEqual([]);
      expect(drawn.total_geocoded).toBe(2);
      expect(drawn.in_view).toBe(2);
    });

    it('leaves out households that have no coordinates, having nowhere honest to put them', async () => {
      await makeGeocodedHousehold(45.42, -75.69);
      await db
        .insertInto('households')
        .values({
          id: rand(),
          tenant_id: tenantId,
          street1: 'Unlocated Rd',
          geocoding_status: 'pending',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      const drawn = await controller.listHouseholdPins(auth, null);

      expect(drawn.pins).toHaveLength(1);
      expect(drawn.total_geocoded).toBe(1);
    });

    it('answers only for the rectangle asked for, not the whole workspace', async () => {
      await makeGeocodedHousehold(45.42, -75.69); // Ottawa
      await makeGeocodedHousehold(43.65, -79.38); // Toronto, far outside the rectangle below

      const drawn = await controller.listHouseholdPins(auth, {
        north: 45.5,
        south: 45.3,
        east: -75.6,
        west: -75.8,
      });

      expect(drawn.pins).toHaveLength(1);
      expect(drawn.in_view).toBe(1);
      // The workspace count and the extent stay workspace-wide, so a caption cannot report the
      // rectangle as the total and "fit to everything" still reaches the household it cannot see.
      expect(drawn.total_geocoded).toBe(2);
      expect(drawn.bounds).toEqual({ north: 45.42, south: 43.65, east: -75.69, west: -79.38 });
    });

    it('treats a rectangle straddling the 180th meridian as no rectangle rather than an empty map', async () => {
      await makeGeocodedHousehold(45.42, -75.69);

      const drawn = await controller.listHouseholdPins(auth, {
        north: 45.5,
        south: 45.3,
        east: -179,
        west: 179,
      });

      expect(drawn.pins).toHaveLength(1);
      expect(drawn.in_view).toBe(1);
    });

    it('groups the households by area once there are more in view than a browser can draw', async () => {
      // One more than the pin cap, spread over a grid of streets: this is the shape of the problem
      // a real riding has, at the smallest size that triggers it.
      const count = BOUNDARY_MAX_PINS + 1;
      const base = Number(rand()) * 1000;
      await db
        .insertInto('households')
        .values(
          Array.from({ length: count }, (_unused, index) => ({
            id: String(base + index),
            tenant_id: tenantId,
            street_num: String(index),
            street1: 'Crowded Ave',
            city: 'Testville',
            // Spread across roughly a tenth of a degree in each direction, so the grid has work to do.
            lat: 45.3 + (index % 50) * 0.002,
            lng: -75.8 + Math.floor(index / 50) * 0.002,
            geocoding_status: 'success',
            createdby_id: userId,
            updatedby_id: userId,
          })),
        )
        .execute();

      const drawn = await controller.listHouseholdPins(auth, null);

      expect(drawn.pins).toEqual([]);
      expect(drawn.clusters.length).toBeGreaterThan(1);
      // Bounded by the grid, not by the number of households: this is the whole point. One more
      // than the divisions in each direction, because a household on the top or right edge of the
      // rectangle falls into the next square along.
      const squares = (BOUNDARY_PIN_GRID_COLUMNS + 1) * (BOUNDARY_PIN_GRID_COLUMNS + 1);
      expect(drawn.clusters.length).toBeLessThanOrEqual(squares);
      // Every household is accounted for in exactly one group, so no door is silently dropped.
      expect(drawn.clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(count);
      expect(drawn.in_view).toBe(count);
      expect(drawn.total_geocoded).toBe(count);
    });

    it('reports nothing to draw, and no extent, for a workspace with no coordinates at all', async () => {
      const drawn = await controller.listHouseholdPins(auth, null);
      expect(drawn.pins).toEqual([]);
      expect(drawn.clusters).toEqual([]);
      expect(drawn.total_geocoded).toBe(0);
      expect(drawn.bounds).toBeNull();
    });
  });
});
