import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BoundaryGeometryType } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { boundaryBBoxOf } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { BaseRepository } from '../../lib/base.repo';
import {
  applyHouseholdMatches,
  matchHouseholdBoundaries,
  matchPointToSets,
  requiredSetIdsForTenant,
} from './boundary-match';
import { invalidateBoundarySetCache, loadBoundarySets } from './boundary-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reaches the shared Kysely handle
const db = (BaseRepository as any)._db;

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

describe('boundary matching', () => {
  let tenantId: string;
  let userId: string;

  async function makeSet(input: {
    slug: string;
    label: string;
    jurisdiction: string;
    role: string;
    source?: string;
    chamber?: string | null;
    region?: string | null;
    vintage?: string | null;
  }): Promise<string> {
    const row = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug: input.slug,
        label: input.label,
        jurisdiction: input.jurisdiction,
        role: input.role,
        chamber: input.chamber ?? null,
        region: input.region ?? null,
        vintage: input.vintage ?? null,
        source: input.source ?? 'drawn',
        feature_count: 0,
        createdby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  async function addFeature(setId: string, name: string, geometry: BoundaryGeometryType, code?: string): Promise<void> {
    await db
      .insertInto('boundary_features')
      .values({
        tenant_id: tenantId,
        set_id: setId,
        name,
        code: code ?? null,
        geometry: JSON.stringify(geometry),
        bbox: JSON.stringify(boundaryBBoxOf(geometry)),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    // These tests write features straight to the table rather than through the controller, so the
    // set row's updated_at is never bumped and the matcher's cache version would not change. Clear
    // the entry explicitly, exactly as the controller does after a save.
    invalidateBoundarySetCache(setId);
  }

  async function makeHousehold(lat: number, lng: number): Promise<string> {
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
    await db.insertInto('tenants').values({ id: tenantId, name: 'Boundary Test Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `boundary-${userId}@example.com`,
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
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_features').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('holds every level of government at once — the defect this rework exists to fix', async () => {
    // One address in Ohio sits inside a congressional district AND a state senate district AND a
    // state house district AND a precinct. The three text columns this replaced could hold three
    // answers, so each geocoding pass overwrote the previous campaign's geography.
    const cd = await makeSet({ slug: 'us-cd', label: 'Congressional', jurisdiction: 'us_federal', role: 'seat_area' });
    const sldu = await makeSet({
      slug: 'us-sldu',
      label: 'State senate',
      jurisdiction: 'us_state',
      role: 'seat_area',
      chamber: 'upper',
    });
    const sldl = await makeSet({
      slug: 'us-sldl',
      label: 'State house',
      jurisdiction: 'us_state',
      role: 'seat_area',
      chamber: 'lower',
    });
    const precincts = await makeSet({
      slug: 'us-vtd',
      label: 'Precincts',
      jurisdiction: 'us_state',
      role: 'subdivision',
    });

    const wide = box(-84, 39, -82, 41);
    await addFeature(cd, 'OH-3', wide);
    await addFeature(sldu, 'SD-16', wide);
    await addFeature(sldl, 'HD-24', wide);
    await addFeature(precincts, 'Precinct 12', box(-83.1, 39.9, -82.9, 40.1));

    const householdId = await makeHousehold(40, -83);
    const matches = await matchPointToSets(db, tenantId, 40, -83, [cd, sldu, sldl, precincts]);
    expect(matches).toHaveLength(4);

    await applyHouseholdMatches(db, tenantId, householdId, matches);
    const stored = await db
      .selectFrom('household_districts')
      .select(['set_id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    expect(stored.map((r: { name: string }) => r.name).sort()).toEqual(['HD-24', 'OH-3', 'Precinct 12', 'SD-16']);
  });

  it('holds a ward and a precinct at once — the Massachusetts case', async () => {
    // In Massachusetts cities a ward CONTAINS precincts and both are voting subdivisions; the ward
    // elects nobody. Two sets with the same role, one household in both.
    const wards = await makeSet({ slug: 'ma-wards', label: 'Wards', jurisdiction: 'us_local', role: 'subdivision' });
    const precincts = await makeSet({
      slug: 'ma-precincts',
      label: 'Precincts',
      jurisdiction: 'us_local',
      role: 'subdivision',
    });
    await addFeature(wards, 'Ward 5', box(-71.1, 42.3, -71.0, 42.4));
    await addFeature(precincts, 'Ward 5 Precinct 2', box(-71.06, 42.34, -71.04, 42.36));

    const householdId = await makeHousehold(42.35, -71.05);
    const matches = await matchPointToSets(db, tenantId, 42.35, -71.05, [wards, precincts]);
    await applyHouseholdMatches(db, tenantId, householdId, matches);

    const stored = await db
      .selectFrom('household_districts')
      .select('name')
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    expect(stored.map((r: { name: string }) => r.name).sort()).toEqual(['Ward 5', 'Ward 5 Precinct 2']);
  });

  it('holds two vintages of the same layer at once — the redistricting case', async () => {
    const oldMap = await makeSet({
      slug: 'ca-fed-2013',
      label: 'Ridings (2013)',
      jurisdiction: 'ca_federal',
      role: 'seat_area',
      vintage: '2013 representation order',
    });
    const newMap = await makeSet({
      slug: 'ca-fed-2023',
      label: 'Ridings (2023)',
      jurisdiction: 'ca_federal',
      role: 'seat_area',
      vintage: '2023 representation order',
    });
    await addFeature(oldMap, 'Ottawa Centre (old)', box(-76, 45, -75, 46));
    await addFeature(newMap, 'Ottawa Centre (new)', box(-76, 45, -75, 46));

    const householdId = await makeHousehold(45.4, -75.7);
    const matches = await matchPointToSets(db, tenantId, 45.4, -75.7, [oldMap, newMap]);
    await applyHouseholdMatches(db, tenantId, householdId, matches);

    const stored = await db
      .selectFrom('household_districts')
      .select('name')
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    expect(stored).toHaveLength(2);
  });

  it('resolves an overlap the same way on every run', async () => {
    const setId = await makeSet({ slug: 'drawn', label: 'Neighbourhoods', jurisdiction: 'other', role: 'subdivision' });
    // Deliberately overlapping, inserted in an order that does not match their names.
    await addFeature(setId, 'Zulu', box(-75.8, 45.3, -75.6, 45.5));
    await addFeature(setId, 'Alpha', box(-75.75, 45.35, -75.55, 45.55));

    const first = await matchPointToSets(db, tenantId, 45.4, -75.7, [setId]);
    invalidateBoundarySetCache();
    const second = await matchPointToSets(db, tenantId, 45.4, -75.7, [setId]);

    expect(first).toHaveLength(1);
    expect(first[0]?.name).toBe('Alpha');
    expect(second[0]?.name).toBe('Alpha');
  });

  it('returns nothing for a point outside every area', async () => {
    const setId = await makeSet({ slug: 'small', label: 'Small', jurisdiction: 'other', role: 'subdivision' });
    await addFeature(setId, 'Inner', box(-75.8, 45.3, -75.6, 45.5));

    expect(await matchPointToSets(db, tenantId, 10, 10, [setId])).toEqual([]);
  });

  it('leaves imported districts alone when geometry-derived areas are replaced', async () => {
    const drawn = await makeSet({ slug: 'drawn-2', label: 'Drawn', jurisdiction: 'other', role: 'subdivision' });
    const imported = await makeSet({
      slug: 'imported',
      label: 'From the voter file',
      jurisdiction: 'us_federal',
      role: 'seat_area',
      source: 'import',
    });
    await addFeature(drawn, 'Zone A', box(-75.8, 45.3, -75.6, 45.5));

    const householdId = await makeHousehold(45.4, -75.7);
    await db
      .insertInto('household_districts')
      .values({ tenant_id: tenantId, household_id: householdId, set_id: imported, name: 'OH-3', code: null })
      .execute();

    const matches = await matchPointToSets(db, tenantId, 45.4, -75.7, [drawn]);
    await applyHouseholdMatches(db, tenantId, householdId, matches);

    const stored = await db
      .selectFrom('household_districts')
      .select('name')
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    expect(stored.map((r: { name: string }) => r.name).sort()).toEqual(['OH-3', 'Zone A']);
  });

  it('keeps rows in a layer the workspace no longer requires when a re-match runs', async () => {
    // The workspace requires only its drawn layer (no active campaigns). A row in a bundled layer —
    // an archived campaign's map — was not matched against, so a re-match must not delete it. The
    // batch job already scoped its replace this way; this pins the single-household path.
    const drawn = await makeSet({ slug: 'drawn-4', label: 'Drawn', jurisdiction: 'other', role: 'subdivision' });
    const archived = await makeSet({
      slug: 'az-cd-old',
      label: 'Arizona congressional (archived campaign)',
      jurisdiction: 'us_federal',
      role: 'seat_area',
      region: 'AZ',
      source: 'bundled',
    });
    await addFeature(drawn, 'Zone A', box(-75.8, 45.3, -75.6, 45.5));

    const householdId = await makeHousehold(45.4, -75.7);
    await db
      .insertInto('household_districts')
      .values({ tenant_id: tenantId, household_id: householdId, set_id: archived, name: 'AZ-1', code: null })
      .execute();

    const matches = await matchHouseholdBoundaries(db, tenantId, householdId, 45.4, -75.7);
    expect(matches.map((m) => m.name)).toEqual(['Zone A']);

    const stored = await db
      .selectFrom('household_districts')
      .select('name')
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    expect(stored.map((r: { name: string }) => r.name).sort()).toEqual(['AZ-1', 'Zone A']);
  });

  it('matches areas whose positions carry a third elevation element', async () => {
    // QGIS and KML exports write [lng, lat, 0]; RFC 7946 allows the third element. The stored
    // geometry must parse on load and match on indices 0 and 1 alone.
    const setId = await makeSet({ slug: 'elevated', label: 'Elevated', jurisdiction: 'other', role: 'subdivision' });
    await addFeature(setId, 'Zone 3D', {
      type: 'Polygon',
      coordinates: [
        [
          [-75.8, 45.3, 0],
          [-75.6, 45.3, 0],
          [-75.6, 45.5, 0],
          [-75.8, 45.5, 0],
          [-75.8, 45.3, 0],
        ],
      ],
    });

    const matches = await matchPointToSets(db, tenantId, 45.4, -75.7, [setId]);
    expect(matches.map((m) => m.name)).toEqual(['Zone 3D']);
  });

  it('skips imported sets when loading, because they have no polygons', async () => {
    const imported = await makeSet({
      slug: 'imported-2',
      label: 'From the voter file',
      jurisdiction: 'us_federal',
      role: 'seat_area',
      source: 'import',
    });
    expect(await loadBoundarySets(db, tenantId, [imported])).toEqual([]);
  });

  it('requires every set the workspace drew, plus the ones its active campaigns need', async () => {
    const drawn = await makeSet({ slug: 'drawn-3', label: 'Drawn', jurisdiction: 'other', role: 'subdivision' });
    const ohio = await makeSet({
      slug: 'oh-cd',
      label: 'Ohio congressional',
      jurisdiction: 'us_federal',
      role: 'seat_area',
      region: 'OH',
      source: 'bundled',
    });
    const arizona = await makeSet({
      slug: 'az-cd',
      label: 'Arizona congressional',
      jurisdiction: 'us_federal',
      role: 'seat_area',
      region: 'AZ',
      source: 'bundled',
    });

    await db
      .insertInto('campaigns')
      .values({
        tenant_id: tenantId,
        name: 'Ohio 3rd',
        admin_id: userId,
        kind: 'election',
        status: 'active',
        jurisdiction: 'us_federal',
        office_region: 'OH',
        seat_type: 'district',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const required = await requiredSetIdsForTenant(db, tenantId);
    expect(required).toContain(drawn);
    expect(required).toContain(ohio);
    expect(required).not.toContain(arizona);
  });
});
