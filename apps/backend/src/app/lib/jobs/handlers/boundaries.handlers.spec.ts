import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BoundaryGeometryType } from '../../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { boundaryBBoxOf } from '../../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { BaseRepository } from '../../base.repo';
import { invalidateBoundarySetCache } from '../../gis/boundary-store';
import type { JobPayloadOf } from '../job-payloads';
import { handleMatchBoundaries } from './boundaries.handlers';

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

/**
 * The batch match job.
 *
 * These tests pin the three behaviours a page of matching must get right beyond the matching
 * itself: a household whose geocode FAILED is never matched off its leftover coordinates, the
 * 'unmatched' scope converges (a household outside every polygon is examined once per map change,
 * not once per night forever), and two concurrent jobs break their tie by job id instead of both
 * standing down.
 */
describe('handleMatchBoundaries', () => {
  let tenantId: string;
  let userId: string;

  function matchPayload(scope: 'all' | 'unmatched'): JobPayloadOf<'match_boundaries'> {
    return { type: 'match_boundaries', tenant_id: tenantId, set_id: null, scope, cursor: null };
  }

  async function makeSet(slug: string): Promise<string> {
    const row = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug,
        label: slug,
        jurisdiction: 'other',
        role: 'subdivision',
        source: 'drawn',
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
    // Features are written straight to the table, so the set row's cache version never moves;
    // clear the entry explicitly, exactly as the controller does after a save.
    invalidateBoundarySetCache(setId);
  }

  async function makeHousehold(lat: number, lng: number, geocodingStatus: string): Promise<string> {
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
        geocoding_status: geocodingStatus,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    return id;
  }

  async function districtNamesOf(householdId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('household_districts')
      .select('name')
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    return rows.map((row) => row.name).sort();
  }

  async function checkedAtOf(householdId: string): Promise<Date | null> {
    const row = await db
      .selectFrom('households')
      .select('boundary_checked_at')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', householdId)
      .executeTakeFirstOrThrow();
    return row.boundary_checked_at;
  }

  async function insertProcessingMatchJob(): Promise<string> {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status: 'processing',
        payload: JSON.stringify({ type: 'match_boundaries', tenant_id: tenantId, set_id: null, scope: 'all' }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'Boundary Handler Test' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `bh-${userId}@example.com`,
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

  it('never matches a household whose geocode failed, even with leftover coordinates', async () => {
    // A failed geocode clears the household's district rows but leaves its old lat/lng. The pass
    // must not resurrect districts from those coordinates — the current address is unplaceable.
    const setId = await makeSet('wards');
    await addFeature(setId, 'Ward 1', box(-76, 45, -75, 46));

    const placed = await makeHousehold(45.5, -75.5, 'success');
    const unplaceable = await makeHousehold(45.5, -75.5, 'failed');

    await handleMatchBoundaries(matchPayload('all'), db);

    expect(await districtNamesOf(placed)).toEqual(['Ward 1']);
    expect(await districtNamesOf(unplaceable)).toEqual([]);
    expect(await checkedAtOf(placed)).not.toBeNull();
    expect(await checkedAtOf(unplaceable)).toBeNull();
  });

  it('converges: a household outside every polygon is stamped once and skipped until a map changes', async () => {
    const setId = await makeSet('wards');
    await addFeature(setId, 'Ward 1', box(-76, 45, -75, 46));
    const outside = await makeHousehold(10, 10, 'success');

    // First sweep pass examines it — no district row, but the stamp lands.
    await handleMatchBoundaries(matchPayload('unmatched'), db);
    const firstStamp = await checkedAtOf(outside);
    expect(firstStamp).not.toBeNull();
    expect(await districtNamesOf(outside)).toEqual([]);

    // Second sweep pass with unchanged maps selects nothing: the stamp does not move.
    await handleMatchBoundaries(matchPayload('unmatched'), db);
    expect((await checkedAtOf(outside))?.getTime()).toBe(firstStamp?.getTime());

    // A map edit bumps the set's updated_at past the stamp; the next sweep re-examines.
    const aged = new Date(Date.now() - 3_600_000);
    await db
      .updateTable('households')
      .set({ boundary_checked_at: aged })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', outside)
      .execute();
    await db
      .updateTable('boundary_sets')
      .set({ updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', setId)
      .execute();

    await handleMatchBoundaries(matchPayload('unmatched'), db);
    const rechecked = await checkedAtOf(outside);
    expect(rechecked).not.toBeNull();
    expect(rechecked?.getTime()).toBeGreaterThan(aged.getTime());
  });

  it('breaks a concurrent-job tie by id: higher defers with jitter, lowest proceeds', async () => {
    const setId = await makeSet('wards');
    await addFeature(setId, 'Ward 1', box(-76, 45, -75, 46));
    const householdId = await makeHousehold(45.5, -75.5, 'success');

    // The worker marks a job 'processing' before invoking the handler, so two processing rows is
    // exactly what each of two concurrent handlers observes.
    const lowerJobId = await insertProcessingMatchJob();
    const higherJobId = await insertProcessingMatchJob();
    expect(BigInt(higherJobId)).toBeGreaterThan(BigInt(lowerJobId));

    // The higher id stands down: no matching happens, and one requeued job appears with the defer
    // delay plus jitter.
    const before = Date.now();
    await handleMatchBoundaries(matchPayload('all'), db, higherJobId);
    const after = Date.now();

    expect(await districtNamesOf(householdId)).toEqual([]);
    const requeued = await db
      .selectFrom('background_jobs')
      .select(['id', 'run_at'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'pending')
      .execute();
    expect(requeued).toHaveLength(1);
    const runAtValue = requeued[0]?.run_at;
    const runAt = runAtValue instanceof Date ? runAtValue.getTime() : new Date(String(runAtValue)).getTime();
    expect(runAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(runAt).toBeLessThanOrEqual(after + 60_000 + 15_000);

    // The lowest id has the right of way and does the work.
    await handleMatchBoundaries(matchPayload('all'), db, lowerJobId);
    expect(await districtNamesOf(householdId)).toEqual(['Ward 1']);
  });

  it('defers when it cannot identify itself among concurrent jobs', async () => {
    const setId = await makeSet('wards');
    await addFeature(setId, 'Ward 1', box(-76, 45, -75, 46));
    const householdId = await makeHousehold(45.5, -75.5, 'success');

    await insertProcessingMatchJob();
    await insertProcessingMatchJob();

    // No job id passed: the handler must not claim the right of way it cannot prove it holds.
    await handleMatchBoundaries(matchPayload('all'), db);
    expect(await districtNamesOf(householdId)).toEqual([]);
  });
});
