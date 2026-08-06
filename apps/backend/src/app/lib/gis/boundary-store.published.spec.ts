import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BoundaryGeometryType } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import { BaseRepository } from '../base.repo';
import { invalidateBoundarySetCache, loadBoundarySets, setCatalogFileReaderForTests } from './boundary-store';

const db = BaseRepository.dbInstance;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/**
 * Published maps are loaded from a file the catalog describes, not from rows.
 *
 * These tests drive that path through the local-directory resolution step, which is the same code a
 * blob download feeds: the bytes arrive, their SHA-256 is checked against the catalog, and only then
 * are they parsed. Supplying the file from a directory exercises the checksum gate without needing a
 * storage account, and the gate is the part that must not be got wrong — matching households against
 * boundaries nobody can vouch for is worse than matching them against none.
 *
 * The catalog is empty in this release, so every test here builds its own temporary entry and points
 * `GIS_BOUNDARY_DATA_DIR` at a directory it wrote. That is also why they are honest as written: they
 * describe the mechanism, not any particular published map.
 */

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

function featureCollection(areas: { name: string; code: string; geometry: BoundaryGeometryType }[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: areas.map((area) => ({
      type: 'Feature',
      properties: { name: area.name, code: area.code },
      geometry: area.geometry,
    })),
  });
}

describe('loading a published boundary map from its file', () => {
  let dataDir: string;
  let previousDataDir: string | undefined;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;

  /**
   * Register a catalog entry for the duration of one test.
   *
   * The catalog is a module-level array the application imports, so this pushes onto the same array
   * the loader reads and empties it again afterwards. `findPublishedBoundary` scans that array on
   * every call rather than consulting an index built at load time, which is what makes this work —
   * and is the reason it is written that way. Reaching into a shared constant is acceptable here and
   * nowhere else: these tests exist to prove the loader's behaviour for entries that do not exist yet.
   */
  async function publishEntry(slug: string, body: string, overrides: { sha256?: string } = {}): Promise<void> {
    const bytes = Buffer.from(body, 'utf8');
    await fs.writeFile(path.join(dataDir, `${slug}.geojson`), bytes);

    const { PUBLISHED_BOUNDARY_ENTRIES } = await import('../../../../../../libs/common/src/lib/boundaries/catalog');
    (PUBLISHED_BOUNDARY_ENTRIES as unknown as Record<string, unknown>[]).push({
      slug,
      label: slug,
      jurisdiction: 'ca_federal',
      region: null,
      chamber: null,
      role: 'seat_area',
      vintage: 'test edition',
      publisher: 'Test publisher',
      licence: 'Test licence',
      attribution: 'Test attribution',
      sourceUrl: 'https://example.invalid/',
      nameProperty: 'name',
      codeProperty: 'code',
      featureCount: 1,
      bytes: bytes.byteLength,
      sha256: overrides.sha256 ?? createHash('sha256').update(bytes).digest('hex'),
      supersededBy: null,
    });
  }

  async function makePublishedSet(tenant: string, slug: string): Promise<string> {
    const row = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenant,
        slug,
        label: slug,
        jurisdiction: 'ca_federal',
        role: 'seat_area',
        source: 'bundled',
        name_property: 'name',
        code_property: 'code',
        feature_count: 1,
        createdby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pplcrm-boundary-'));
    previousDataDir = process.env['GIS_BOUNDARY_DATA_DIR'];
    process.env['GIS_BOUNDARY_DATA_DIR'] = dataDir;
    invalidateBoundarySetCache();

    // Storage is the last resort after the local directories, and these tests always supply the
    // file locally. A reader that refuses immediately keeps a deliberately-unreadable local file
    // from falling through to a real blob client and waiting out its retries.
    setCatalogFileReaderForTests({
      download: () => Promise.reject(new Error('no catalog storage in tests')),
    });

    tenantId = rand();
    otherTenantId = rand();
    userId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'Published Map Tenant' }).execute();
    await db.insertInto('tenants').values({ id: otherTenantId, name: 'Second Published Map Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `published-${userId}@example.com`,
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
    if (previousDataDir === undefined) delete process.env['GIS_BOUNDARY_DATA_DIR'];
    else process.env['GIS_BOUNDARY_DATA_DIR'] = previousDataDir;
    setCatalogFileReaderForTests(null);
    invalidateBoundarySetCache();

    const { PUBLISHED_BOUNDARY_ENTRIES } = await import('../../../../../../libs/common/src/lib/boundaries/catalog');
    (PUBLISHED_BOUNDARY_ENTRIES as unknown as unknown[]).length = 0;

    await db.deleteFrom('boundary_sets').where('tenant_id', 'in', [tenantId, otherTenantId]).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', 'in', [tenantId, otherTenantId]).execute();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('reads the areas out of the file the catalog names', async () => {
    const slug = `pub-${rand()}`;
    await publishEntry(slug, featureCollection([{ name: 'Riding 1', code: '35001', geometry: box(-76, 45, -75, 46) }]));
    const setId = await makePublishedSet(tenantId, slug);

    const [layer] = await loadBoundarySets(db, tenantId, [setId]);
    expect(layer?.features).toHaveLength(1);
    expect(layer?.features[0]?.name).toBe('Riding 1');
    expect(layer?.features[0]?.code).toBe('35001');
    // The wrapper names THIS workspace's set, which is what the matcher writes to household_districts.
    expect(layer?.id).toBe(setId);
  });

  it('refuses a file whose bytes do not match the checksum the catalog records', async () => {
    // The catalog is what told the workspace how many areas it was getting and who published them.
    // Bytes that do not match it are not a slightly different map, they are an unknown one.
    const slug = `tampered-${rand()}`;
    await publishEntry(slug, featureCollection([{ name: 'Riding 1', code: '1', geometry: box(-76, 45, -75, 46) }]), {
      sha256: 'f'.repeat(64),
    });
    const setId = await makePublishedSet(tenantId, slug);

    // Left out of the result entirely, not returned empty. A caller scopes its replace to the
    // layers it got back, so omitting this one is what stops a re-match erasing every household's
    // area for a map it could not open.
    expect(await loadBoundarySets(db, tenantId, [setId])).toEqual([]);
  });

  it('omits a layer whose slug the catalog does not publish, rather than failing', async () => {
    // A row left behind by an older release naming a map this release dropped. It must not throw:
    // the boundaries page has to render, and every other layer has to keep matching.
    const setId = await makePublishedSet(tenantId, `unknown-${rand()}`);
    expect(await loadBoundarySets(db, tenantId, [setId])).toEqual([]);
  });

  it('parses one copy of a published map however many workspaces hold it', async () => {
    // This is the property that makes a national map affordable. Keyed by set id, two hundred
    // workspaces holding the same file would hold two hundred parsed copies of it in the cache.
    const slug = `shared-${rand()}`;
    await publishEntry(slug, featureCollection([{ name: 'Riding 1', code: '1', geometry: box(-76, 45, -75, 46) }]));
    const mine = await makePublishedSet(tenantId, slug);
    const theirs = await makePublishedSet(otherTenantId, slug);

    const [minelayer] = await loadBoundarySets(db, tenantId, [mine]);
    const [theirLayer] = await loadBoundarySets(db, otherTenantId, [theirs]);

    // Same array instance, not merely equal contents.
    expect(minelayer?.features).toBe(theirLayer?.features);
    // …while each workspace's layer still names its own set.
    expect(minelayer?.id).toBe(mine);
    expect(theirLayer?.id).toBe(theirs);
  });

  it('shares a frozen list, so one workspace cannot reshape every other workspace’s map', async () => {
    const slug = `frozen-${rand()}`;
    await publishEntry(slug, featureCollection([{ name: 'Riding 1', code: '1', geometry: box(-76, 45, -75, 46) }]));
    const setId = await makePublishedSet(tenantId, slug);

    const [layer] = await loadBoundarySets(db, tenantId, [setId]);
    expect(Object.isFrozen(layer?.features)).toBe(true);
  });
});
