import type { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { handleExportCsv } from './export.handlers';

/**
 * A households CSV used to carry `district`, `precinct` and `ward` as plain columns of the
 * `households` table. Electoral geography now lives in `household_districts` — one row per
 * household per boundary map — so those three columns went away and the export silently lost them.
 *
 * These tests assert on the CSV bytes handed to blob storage, because that file is the thing a
 * campaign opens in a spreadsheet. Asserting on the query builder would pass against a version that
 * builds the right SQL and writes the wrong header.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('handleExportCsv households electoral columns', () => {
  let tenantId: string;
  let userId: string;
  let householdId: string;
  let otherTenantId: string;
  let otherHouseholdId: string;
  let wardSetId: string;
  let precinctSetId: string;
  let uploaded: string;

  /** Runs a households export and returns the CSV text the job streamed to storage. */
  async function runHouseholdsExport(columns: string[] | null): Promise<string> {
    const exportRow = await db
      .insertInto('data_exports')
      .values({
        tenant_id: tenantId,
        user_id: userId,
        entity: 'households',
        file_name: 'households-export.csv',
        status: 'pending',
        columns: columns ? JSON.stringify(columns) : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await handleExportCsv(
      {
        type: 'export_csv',
        export_id: String(exportRow.id),
        tenant_id: tenantId,
        user_id: userId,
        entity: 'households',
        table: 'households',
        options: {},
        columns,
        file_name: 'households-export.csv',
      },
      db,
    );
    return uploaded;
  }

  function headerOf(csv: string): string[] {
    return csv.split('\n')[0]?.split(',') ?? [];
  }

  beforeEach(async () => {
    tenantId = rand();
    otherTenantId = rand();
    userId = rand();
    uploaded = '';

    vi.spyOn(StorageService.prototype, 'uploadStream').mockImplementation(
      async (_key: string, stream: Readable): Promise<void> => {
        const chunks: string[] = [];
        for await (const chunk of stream) chunks.push(String(chunk));
        uploaded = chunks.join('');
      },
    );
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    for (const id of [tenantId, otherTenantId]) {
      await db
        .insertInto('tenants')
        .values({ id, name: `Electoral Export Tenant ${id}` })
        .execute();
    }
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `member-${userId}@example.com`,
        first_name: 'Member',
        last_name: 'Person',
        verified: true,
        role: 'admin',
        password: 'argon2id$not-a-real-hash',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const household = await db
      .insertInto('households')
      .values({
        tenant_id: tenantId,
        street_num: '24',
        street1: 'Sussex Drive',
        city: 'Ottawa',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    householdId = String(household.id);

    const otherHousehold = await db
      .insertInto('households')
      .values({
        tenant_id: otherTenantId,
        street_num: '1',
        street1: 'Other Street',
        city: 'Elsewhere',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    otherHouseholdId = String(otherHousehold.id);

    // Two maps for the exporting workspace. 'Ottawa wards' is a seat area and must therefore come
    // first in the CSV; 'City precincts' is a subdivision.
    const ward = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug: 'ottawa-wards',
        label: 'Ottawa wards',
        jurisdiction: 'ca_municipal',
        role: 'seat_area',
        source: 'drawn',
        createdby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    wardSetId = String(ward.id);

    const precinct = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug: 'city-precincts',
        label: 'City precincts',
        jurisdiction: 'ca_municipal',
        role: 'subdivision',
        source: 'import',
        createdby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    precinctSetId = String(precinct.id);

    await db
      .insertInto('household_districts')
      .values([
        { tenant_id: tenantId, household_id: householdId, set_id: wardSetId, name: 'Ward 12', code: '12' },
        { tenant_id: tenantId, household_id: householdId, set_id: precinctSetId, name: 'Poll 043', code: null },
      ])
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const ids = [tenantId, otherTenantId];
    // Table by table across both workspaces, not workspace by workspace: the second workspace's
    // household names the first workspace's user as its creator, so every household in the run has
    // to be gone before any `authusers` row is deleted.
    for (const id of ids) await db.deleteFrom('household_districts').where('tenant_id', '=', id).execute();
    for (const id of ids) await db.deleteFrom('boundary_sets').where('tenant_id', '=', id).execute();
    for (const id of ids) await db.deleteFrom('user_activity').where('tenant_id', '=', id).execute();
    for (const id of ids) await db.deleteFrom('data_exports').where('tenant_id', '=', id).execute();
    for (const id of ids) await db.deleteFrom('households').where('tenant_id', '=', id).execute();
    for (const id of ids) await db.deleteFrom('authusers').where('tenant_id', '=', id).execute();
    for (const id of ids) await db.deleteFrom('tenants').where('id', '=', id).execute();
  });

  it('carries one column per boundary map, seat areas first', async () => {
    const csv = await runHouseholdsExport(null);
    const header = headerOf(csv);

    expect(header).toContain('Ottawa wards');
    expect(header).toContain('City precincts');
    expect(header.indexOf('Ottawa wards')).toBeLessThan(header.indexOf('City precincts'));

    // One value per cell, which is what makes the file sortable and filterable in a spreadsheet.
    const row = csv.split('\n')[1]?.split(',') ?? [];
    expect(row[header.indexOf('Ottawa wards')]).toBe('Ward 12');
    expect(row[header.indexOf('City precincts')]).toBe('Poll 043');
  });

  it('adds the boundary columns even when the caller asked for a short column list', async () => {
    // The grid asks for its visible columns, and none of them can name an aggregate over another
    // table, so the electoral columns have to be added by the job rather than requested.
    const csv = await runHouseholdsExport(['id', 'street1', 'city']);
    const header = headerOf(csv);

    expect(header).toEqual(['id', 'street1', 'city', 'Ottawa wards', 'City precincts']);
    expect(csv).toContain('Ward 12');
  });

  it('emits one row per household, not one row per boundary', async () => {
    const csv = await runHouseholdsExport(['id']);
    const dataLines = csv.trim().split('\n').slice(1);

    expect(dataLines).toHaveLength(1);
  });

  it('leaves the cells empty for a household that matches no boundary', async () => {
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();

    const csv = await runHouseholdsExport(['id']);
    const header = headerOf(csv);
    const row = csv.split('\n')[1]?.split(',') ?? [];

    expect(header).toEqual(['id', 'Ottawa wards', 'City precincts']);
    expect(row[1]).toBe('');
    expect(row[2]).toBe('');
    expect(csv).toContain(householdId);
  });

  it('does not read another workspace’s boundary rows', async () => {
    // A boundary row belonging to the other tenant, deliberately pointed at this tenant's map id,
    // is the shape a missing tenant filter on the aggregate would leak.
    await db
      .insertInto('household_districts')
      .values({
        tenant_id: otherTenantId,
        household_id: otherHouseholdId,
        set_id: wardSetId,
        name: 'LEAKED-OTHER-TENANT-WARD',
        code: null,
      })
      .execute();

    const csv = await runHouseholdsExport(null);

    expect(csv).not.toContain('LEAKED-OTHER-TENANT-WARD');
    expect(csv).toContain('Ward 12');
  });

  it('exports normally for a workspace that holds no boundary maps at all', async () => {
    await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();

    const csv = await runHouseholdsExport(['id', 'city']);

    expect(headerOf(csv)).toEqual(['id', 'city']);
    expect(csv).toContain('Ottawa');
  });
});
