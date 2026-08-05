import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import type { IAuthKeyPayload } from '@common';

function rand() {
  return String(Math.floor(Math.random() * 100000000) + 10000000);
}

async function createTestSeed(db: any) {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant' }).execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `test-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
      verified: true,
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
      name: 'Test Campaign',
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
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: householdId })
    .where('id', '=', tenantId)
    .execute();

  return { tenantId, userId, campaignId, householdId };
}

async function createHousehold(db: any, tenantId: string, campaignId: string, userId: string) {
  const result = await db
    .insertInto('households')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(result.id);
}

async function createCompany(db: any, tenantId: string, userId: string) {
  const result = await db
    .insertInto('companies')
    .values({
      tenant_id: tenantId,
      name: `Company-${rand()}`,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(result.id);
}

async function createPerson(
  db: any,
  tenantId: string,
  campaignId: string,
  householdId: string,
  userId: string,
  extra: Record<string, unknown> = {},
) {
  const result = await db
    .insertInto('persons')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: `Person-${rand()}`,
      last_name: 'Test',
      createdby_id: userId,
      updatedby_id: userId,
      ...extra,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(result.id);
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();

  await db.deleteFrom('teams').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companies').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('PersonsController', () => {
  const controller = new PersonsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let auth: IAuthKeyPayload;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;

    auth = {
      tenant_id: tenantId,
      user_id: userId,
      name: 'Test User',
      session_id: 'test-session',
    };
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should list persons joined with their household address', async () => {
    await db.updateTable('households').set({ city: 'Springfield' }).where('id', '=', householdId).execute();
    await createPerson(db, tenantId, campaignId, householdId, userId);

    const result = await controller.getAllWithAddress(auth);
    expect(result.count).toBeGreaterThanOrEqual(1);
    const row = result.rows.find((r) => r['household_id'] != null) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
  });

  it('should return persons for a given household id', async () => {
    const personId = await createPerson(db, tenantId, campaignId, householdId, userId);
    const otherHousehold = await createHousehold(db, tenantId, campaignId, userId);
    await createPerson(db, tenantId, campaignId, otherHousehold, userId);

    const rows = (await controller.getByHouseholdId(householdId, auth)) as Array<{ id: string }>;
    expect(rows.map((r) => String(r.id))).toEqual([personId]);
  });

  it('should return and count persons for a given company id', async () => {
    const companyId = await createCompany(db, tenantId, userId);
    await createPerson(db, tenantId, campaignId, householdId, userId, { company_id: companyId });
    await createPerson(db, tenantId, campaignId, householdId, userId, { company_id: companyId });
    await createPerson(db, tenantId, campaignId, householdId, userId);

    const count = await controller.countByCompanyId(companyId, auth);
    expect(count).toBe(2);

    const rows = (await controller.getByCompanyId(companyId, auth)) as Array<{ id: string }>;
    expect(rows).toHaveLength(2);
  });

  it('should list and get distinct tags for a person', async () => {
    const personId = await createPerson(db, tenantId, campaignId, householdId, userId);
    const tag = await db
      .insertInto('tags')
      .values({ tenant_id: tenantId, name: 'vip', createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('map_peoples_tags')
      .values({
        tenant_id: tenantId,
        person_id: personId,
        tag_id: tag.id,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const tags = await controller.getTags(personId, auth);
    expect(tags.map((t) => t.name)).toContain('vip');

    const distinct = await controller.getDistinctTags(auth);
    expect(distinct.map((t) => t.name)).toContain('vip');
  });

  it('should move an entire household of persons to a new household', async () => {
    // A real household of its own, not the shared fixture's `householdId` — that one is this
    // tenant's placeholder (see the setup above), the bucket every person without an address
    // sits in, and moving everyone out of it in one call is now refused on purpose.
    const sourceHousehold = await createHousehold(db, tenantId, campaignId, userId);
    const personA = await createPerson(db, tenantId, campaignId, sourceHousehold, userId);
    const personB = await createPerson(db, tenantId, campaignId, sourceHousehold, userId);
    const newHousehold = await createHousehold(db, tenantId, campaignId, userId);

    await controller.moveEntireHousehold(sourceHousehold, newHousehold, tenantId);

    const rows = await db.selectFrom('persons').selectAll().where('id', 'in', [personA, personB]).execute();
    for (const row of rows) {
      expect(String(row.household_id)).toBe(String(newHousehold));
    }
  });

  it('should refuse to delete a team captain without force', async () => {
    const captainId = await createPerson(db, tenantId, campaignId, householdId, userId);
    await db
      .insertInto('teams')
      .values({
        tenant_id: tenantId,
        name: 'Captained Team',
        team_captain_id: captainId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await expect(controller.deleteMany(tenantId, [captainId])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should delete a team captain and unset captaincy when forced', async () => {
    const captainId = await createPerson(db, tenantId, campaignId, householdId, userId);
    const team = await db
      .insertInto('teams')
      .values({
        tenant_id: tenantId,
        name: 'Captained Team 2',
        team_captain_id: captainId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const result = await controller.deleteMany(tenantId, [captainId], true);
    expect(result).toBe(true);

    const teamRow = await db.selectFrom('teams').selectAll().where('id', '=', team.id).executeTakeFirst();
    expect(teamRow.team_captain_id).toBeNull();

    const personRow = await db.selectFrom('persons').selectAll().where('id', '=', captainId).executeTakeFirst();
    expect(personRow).toBeUndefined();
  });

  it('should delete a single person via delete() and log the activity', async () => {
    const personId = await createPerson(db, tenantId, campaignId, householdId, userId);

    const result = await controller.delete(tenantId, personId, userId);
    expect(result).toBe(true);

    const row = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('should return false from deleteMany when given an empty list of ids', async () => {
    const result = await controller.deleteMany(tenantId, []);
    expect(result).toBe(false);
  });

  it('should export persons to CSV including requested columns', async () => {
    await createPerson(db, tenantId, campaignId, householdId, userId, { email: 'export-me@example.com' } as any);

    const response = await controller.exportCsv({ tenant_id: tenantId, columns: ['first_name', 'email'] }, auth);

    if (response.status === 'processing') {
      throw new Error('Expected an inline CSV response, not a background job');
    }
    expect(response.columns).toEqual(['first_name', 'email']);
    expect(response.csv).toContain('export-me@example.com');
    expect(response.rowCount).toBeGreaterThanOrEqual(1);
  });
});
