import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IAuthKeyPayload } from '@common';
import type { BoundaryGeometryType } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import {
  BOUNDARY_FEATURE_CODE_MAX,
  BOUNDARY_FEATURE_NAME_MAX,
  boundaryBBoxOf,
} from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
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
});
