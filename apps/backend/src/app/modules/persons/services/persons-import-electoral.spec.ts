import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import * as geocodeAddress from '../../../lib/gis/geocode-address';
import { PersonsService } from './persons.service';

/**
 * A purchased US voter file is one row per voter, so a campaign imports it through the People
 * importer rather than the Households one, and it routinely already names the congressional
 * district, both state legislative district numbers, the precinct and the ward on every row.
 *
 * These tests drive the real import against Postgres and assert on the `household_districts` rows
 * that come out, because those rows are what the map, turf cutting and smart lists read. They also
 * assert that no paid address lookup happens: taking a district name that arrived in the file costs
 * nothing, and that is the entire reason this path is worth having.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/** One row of a voter file: a person, an address, and the districts the vendor already knew. */
function voterRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: `ada-${rand()}@example.com`,
    street_num: '742',
    street1: 'Evergreen Terrace',
    city: 'Columbus',
    state: 'OH',
    zip: '43004',
    congressional_district: 'OH-3',
    legislative_district: '18',
    state_house_district: '21',
    state_senate_district: '15',
    ward: 'Ward 5',
    precinct: 'Precinct 12',
    ...overrides,
  };
}

describe('People import: electoral columns from a voter file', () => {
  let service: PersonsService;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let importId: string;
  let geocodeSpy: ReturnType<typeof vi.spyOn>;

  /** Every boundary area recorded for this workspace, as "<map label> => <area name>" pairs. */
  async function recordedAreas(): Promise<Array<{ label: string; source: string; role: string; name: string }>> {
    const rows = await db
      .selectFrom('household_districts as hd')
      .innerJoin('boundary_sets as bs', 'bs.id', 'hd.set_id')
      .select(['bs.label as label', 'bs.source as source', 'bs.role as role', 'hd.name as name'])
      .where('hd.tenant_id', '=', tenantId)
      .orderBy('bs.label')
      .execute();
    return rows.map((r: { label: string; source: string; role: string; name: string }) => ({
      label: r.label,
      source: r.source,
      role: r.role,
      name: r.name,
    }));
  }

  async function runImport(rows: Record<string, string>[]): Promise<void> {
    await service.processImportRows(importId, tenantId, userId, campaignId, ['Imported-test'], 0, rows);
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    service = new PersonsService();

    // The paid Google lookup. It must never be reached by this path.
    geocodeSpy = vi.spyOn(geocodeAddress, 'geocodeAddress');

    await db.insertInto('tenants').values({ id: tenantId, name: 'Voter File Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `organizer-${userId}@example.com`,
        first_name: 'Organizer',
        last_name: 'Person',
        verified: true,
        role: 'admin',
        password: 'argon2id$not-a-real-hash',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const campaign = await db
      .insertInto('campaigns')
      .values({
        tenant_id: tenantId,
        name: 'Ohio 3rd',
        admin_id: userId,
        jurisdiction: 'us_federal',
        office_region: 'OH',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    campaignId = String(campaign.id);

    const dataImport = await db
      .insertInto('data_imports')
      .values({
        tenant_id: tenantId,
        file_name: 'voterfile.csv',
        source: 'persons',
        row_count: 2,
        status: 'processing',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    importId = String(dataImport.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('data_imports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('records every district column the file carried, one boundary map per column', async () => {
    await runImport([voterRow()]);

    const areas = await recordedAreas();

    expect(areas).toEqual([
      {
        label: 'Congressional districts (from a spreadsheet)',
        source: 'import',
        role: 'seat_area',
        name: 'OH-3',
      },
      { label: 'Legislative districts (from a spreadsheet)', source: 'import', role: 'seat_area', name: '18' },
      {
        label: 'Precincts / polling divisions (from a spreadsheet)',
        source: 'import',
        role: 'subdivision',
        name: 'Precinct 12',
      },
      { label: 'State house districts (from a spreadsheet)', source: 'import', role: 'seat_area', name: '21' },
      { label: 'State senate districts (from a spreadsheet)', source: 'import', role: 'seat_area', name: '15' },
      { label: 'Wards (from a spreadsheet)', source: 'import', role: 'seat_area', name: 'Ward 5' },
    ]);
  });

  it('never calls the paid address-lookup service', async () => {
    await runImport([voterRow()]);

    // The area names arrived in the file, so there is nothing to look up and nothing to bill.
    expect(geocodeSpy).not.toHaveBeenCalled();
  });

  it('takes the jurisdiction of the importing campaign for the maps it creates', async () => {
    await runImport([voterRow()]);

    const jurisdictions = await db
      .selectFrom('boundary_sets')
      .select('jurisdiction')
      .where('tenant_id', '=', tenantId)
      .execute();

    expect(jurisdictions.every((row: { jurisdiction: string }) => row.jurisdiction === 'us_federal')).toBe(true);
  });

  it('handles several voters at one address without failing the batch', async () => {
    // Two rows for the same door land on one household. Writing both as separate rows in one
    // statement would make Postgres refuse it outright ("ON CONFLICT DO UPDATE command cannot
    // affect row a second time"), so they have to be merged before the write.
    await runImport([voterRow({ first_name: 'Ada' }), voterRow({ first_name: 'Charles', last_name: 'Babbage' })]);

    const households = await db
      .selectFrom('households')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('street1', '=', 'Evergreen Terrace')
      .execute();
    expect(households).toHaveLength(1);

    const areas = await recordedAreas();
    expect(areas).toHaveLength(6);
    expect(areas.map((a) => a.name)).toContain('OH-3');
  });

  it('records districts for an address the workspace already had', async () => {
    // The common case for a purchased file: the doors are already in the CRM, and the file is what
    // finally says which districts they are in.
    await runImport([voterRow({ first_name: 'Ada' })]);
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();

    await runImport([voterRow({ first_name: 'Grace', last_name: 'Hopper' })]);

    const areas = await recordedAreas();
    expect(areas.map((a) => a.name).sort()).toEqual(['15', '18', '21', 'OH-3', 'Precinct 12', 'Ward 5']);
  });

  it('refreshes an area name when a later file disagrees', async () => {
    await runImport([voterRow({ first_name: 'Ada' })]);
    await runImport([voterRow({ first_name: 'Grace', last_name: 'Hopper', ward: 'Ward 9' })]);

    const wards = (await recordedAreas()).filter((a) => a.label.startsWith('Wards'));
    // One row, not two: UNIQUE (household_id, set_id) means a re-import corrects rather than piles up.
    expect(wards).toEqual([
      { label: 'Wards (from a spreadsheet)', source: 'import', role: 'seat_area', name: 'Ward 9' },
    ]);
  });

  it('never attaches a district to the shared no-address household', async () => {
    // Everyone imported without an address shares one household row, so a district recorded there
    // would be claimed by every address-less person in the workspace.
    await runImport([
      { first_name: 'Nomad', last_name: 'Person', email: `nomad-${rand()}@example.com`, ward: 'Ward 5' },
    ]);

    expect(await recordedAreas()).toEqual([]);
  });

  it('writes nothing extra for an ordinary file with no district columns', async () => {
    await runImport([
      {
        first_name: 'Plain',
        last_name: 'Row',
        email: `plain-${rand()}@example.com`,
        street_num: '10',
        street1: 'Main Street',
        city: 'Columbus',
      },
    ]);

    expect(await recordedAreas()).toEqual([]);
    const sets = await db.selectFrom('boundary_sets').select('id').where('tenant_id', '=', tenantId).execute();
    expect(sets).toEqual([]);
  });
});
