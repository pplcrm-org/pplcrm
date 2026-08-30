import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { PersonsController } from './controller';
import { HouseholdsController } from '../households/controller';

/**
 * The ids-only twin of the grid queries ("select all matching" / record navigation). These tests
 * pin what the shape exists for: the SAME filter predicate as the full-row query, the caller's
 * sort order preserved, tenant scoping, alias sorts surviving the trimmed select, and the
 * households variant never handing out the placeholder household.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('getMatchingIds', () => {
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let personAlpha: string;
  let personBeta: string;
  let personCarol: string;

  const auth = () => ({ tenant_id: tenantId, user_id: userId, name: 'Ids Tester', session_id: 's' });

  beforeEach(async () => {
    tenantId = rand();
    otherTenantId = rand();
    userId = rand();
    campaignId = rand();
    householdId = rand();

    for (const [id, name] of [
      [tenantId, 'Matching Ids Tenant'],
      [otherTenantId, 'Matching Ids Other Tenant'],
    ] as const) {
      await db.insertInto('tenants').values({ id, name }).execute();
    }
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `ids-${userId}@example.com`,
        first_name: 'Ids',
        last_name: 'Tester',
        verified: true,
        role: 'user',
        password: 'not-a-real-hash',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        city: 'Springfield',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const seedPerson = async (tenant: string, household: string | null, first: string, last: string) => {
      const row = await db
        .insertInto('persons')
        .values({
          tenant_id: tenant,
          ...(household != null ? { household_id: household } : {}),
          first_name: first,
          last_name: last,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return String(row.id);
    };
    personAlpha = await seedPerson(tenantId, householdId, 'Alpha', 'Anders');
    personBeta = await seedPerson(tenantId, householdId, 'Beta', 'Baker');
    personCarol = await seedPerson(tenantId, householdId, 'Carol', 'Chan');

    // A person in ANOTHER tenant, sharing a first-name prefix: must never appear in the answer.
    const foreignHousehold = rand();
    await db
      .insertInto('households')
      .values({ id: foreignHousehold, tenant_id: otherTenantId, createdby_id: userId, updatedby_id: userId })
      .execute();
    await seedPerson(otherTenantId, foreignHousehold, 'Alpha', 'Foreign');
  });

  afterEach(async () => {
    // The campaign references the user as admin (fk_admin_id): campaigns before authusers.
    for (const tid of [tenantId, otherTenantId]) {
      await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('user_activity').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('persons').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('tags').where('tenant_id', '=', tid).execute();
      await db.updateTable('tenants').set({ placeholder_household_id: null }).where('id', '=', tid).execute();
      await db.deleteFrom('households').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('campaigns').where('tenant_id', '=', tid).execute();
    }
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    for (const tid of [tenantId, otherTenantId]) {
      await db.deleteFrom('tenants').where('id', '=', tid).execute();
    }
  });

  it('returns every matching person id in the requested sort order, never a foreign tenant`s', async () => {
    const controller = new PersonsController();

    const result = await controller.getMatchingIds(auth(), {
      sortModel: [{ colId: 'last_name', sort: 'desc' }],
    });

    expect(result.ids).toEqual([personCarol, personBeta, personAlpha]);
    expect(result.count).toBe(3);
    expect(result.capped).toBe(false);
  });

  it('applies the same filters as the full-row grid query', async () => {
    const controller = new PersonsController();

    const result = await controller.getMatchingIds(auth(), { searchStr: 'alpha' });

    expect(result.ids).toEqual([personAlpha]);
    expect(result.count).toBe(1);
  });

  it('survives a sort on an alias column the ids query cannot select verbatim', async () => {
    const controller = new PersonsController();

    // support_level lives on the campaign-facts join (an output alias in the data query); tags is
    // an array_agg with no backing column at all — that term is skipped, never a failed query.
    const aliased = await controller.getMatchingIds(auth(), {
      sortModel: [
        { colId: 'support_level', sort: 'asc' },
        { colId: 'tags', sort: 'asc' },
      ],
    });

    expect(new Set(aliased.ids)).toEqual(new Set([personAlpha, personBeta, personCarol]));
    expect(aliased.count).toBe(3);
  });

  it('households variant excludes the placeholder household, so bulk actions can trust the ids', async () => {
    const controller = new HouseholdsController();
    const real = await db
      .insertInto('households')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        city: 'Realville',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const realId = String(real.id);
    await db.updateTable('tenants').set({ placeholder_household_id: householdId }).where('id', '=', tenantId).execute();

    const result = await controller.getMatchingIds(auth(), {});

    expect(result.ids).toEqual([realId]);
    expect(result.count).toBe(1);
    expect(result.capped).toBe(false);
  });
});
