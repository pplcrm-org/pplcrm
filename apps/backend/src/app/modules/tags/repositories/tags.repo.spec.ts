import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TagsRepo } from './tags.repo';
import { BaseRepository } from '../../../lib/base.repo';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  // 1. Tenant
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant',
    })
    .execute();

  // 2. User
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

  // Update tenant admin and creator
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  // 3. Campaign
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

  // 4. Household
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

  return { tenantId, userId, campaignId, householdId };
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_households_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('TagsRepo Integration', () => {
  const repo = new TagsRepo();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should delete tags and their mapping associations', async () => {
    const tag = await repo.add({
      row: {
        tenant_id: tenantId,
        name: 'DeletableTag',
        deletable: true,
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    await db
      .insertInto('map_households_tags')
      .values({
        tenant_id: tenantId,
        household_id: householdId,
        tag_id: tag.id,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Verify mapping exists
    const mapping = await db.selectFrom('map_households_tags').selectAll().where('tag_id', '=', tag.id).execute();
    expect(mapping).toHaveLength(1);

    // Delete tag
    const deleted = await repo.deleteMany({ tenant_id: tenantId, ids: [tag.id] });
    expect(deleted).toBe(true);

    // Verify tag is deleted
    const checkTag = await repo.getOneBy('id', { tenant_id: tenantId, value: tag.id });
    expect(checkTag).toBeUndefined();

    // Verify mapping is deleted
    const checkMapping = await db.selectFrom('map_households_tags').selectAll().where('tag_id', '=', tag.id).execute();
    expect(checkMapping).toHaveLength(0);
  });

  it('should lowercase tag name and handle queries/conflicts case-insensitively', async () => {
    // 1. Adding a tag with mixed case should store it in lowercase
    const tag = await repo.add({
      row: {
        tenant_id: tenantId,
        name: 'MixedCaseTag',
        deletable: true,
        createdby_id: userId,
        updatedby_id: userId,
      },
    });
    expect(tag.name).toBe('mixedcasetag');

    // 2. addOrGet with conflicting name (mixed case) should resolve to the same tag case-insensitively
    const retrieved = await repo.addOrGet({
      row: {
        tenant_id: tenantId,
        name: 'MIXEDCASETAG',
        deletable: true,
        createdby_id: userId,
        updatedby_id: userId,
      },
      onConflictColumn: 'name',
    });
    expect(retrieved?.id).toBe(tag.id);
    expect(retrieved?.name).toBe('mixedcasetag');

    // 3. getIdByName should work case-insensitively
    const idObj = await repo.getIdByName({
      tenant_id: tenantId,
      name: 'mIxEdCaSeTaG',
    });
    expect(idObj?.id).toBe(tag.id);
  });

  it('ranks the top area inside the campaign’s own seat map when getAdminList is given a campaign', async () => {
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

    // Second household so the two maps cover a different number of households.
    const householdId2 = rand();
    await db
      .insertInto('households')
      .values({
        id: householdId2,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const addSet = (slug: string, jurisdiction: string) =>
      db
        .insertInto('boundary_sets')
        .values({
          tenant_id: tenantId,
          slug,
          label: slug,
          jurisdiction,
          role: 'seat_area',
          source: 'drawn',
          createdby_id: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    // Ward map covers BOTH households → the campaign-free fallback (most households) picks it.
    const wardSet = await addSet(`wards-${rand()}`, 'other');
    // Federal map covers one household → only the campaign's jurisdiction reaches it.
    const federalSet = await addSet(`federal-${rand()}`, 'ca_federal');

    const place = (hhId: string, setId: unknown, name: string) =>
      db
        .insertInto('household_districts')
        .values({ tenant_id: tenantId, household_id: hhId, set_id: String(setId), name })
        .execute();
    await place(householdId, wardSet.id, 'Ward 1');
    await place(householdId2, wardSet.id, 'Ward 2');
    await place(householdId, federalSet.id, 'Ottawa Centre');

    // Two tagged people, one per household.
    const issue = await repo.add({
      row: {
        tenant_id: tenantId,
        name: 'transit',
        type: 'issue',
        deletable: true,
        createdby_id: userId,
        updatedby_id: userId,
      },
    });
    const addTaggedPerson = async (hhId: string) => {
      const personId = rand();
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: hhId,
          first_name: `Voter-${personId}`,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
      await db
        .insertInto('map_peoples_tags')
        .values({
          tenant_id: tenantId,
          person_id: personId,
          tag_id: issue.id,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    };
    await addTaggedPerson(householdId);
    await addTaggedPerson(householdId2);

    // The campaign contests a federal seat, so its heading word is "riding" — the ranking must
    // come from the same map the word does.
    await db.updateTable('campaigns').set({ jurisdiction: 'ca_federal' }).where('id', '=', campaignId).execute();

    // Campaign-free: most-covered map (wards); tie between Ward 1 and Ward 2 breaks by name.
    const withoutCampaign = await repo.getAdminList({ tenant_id: tenantId, type: 'issue' });
    expect(withoutCampaign.find((r) => r.name === 'transit')?.top_ward).toBe('Ward 1');

    // With the campaign: its own seat map (federal ridings).
    const withCampaign = await repo.getAdminList({ tenant_id: tenantId, type: 'issue', campaignId });
    expect(withCampaign.find((r) => r.name === 'transit')?.top_ward).toBe('Ottawa Centre');
  });
});
