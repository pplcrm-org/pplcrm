import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { PersonsService } from './services/persons.service';
import { HouseholdsController } from '../households/controller';

/**
 * Bulk "Add tag" (grid selection): one INSERT … SELECT round trip instead of one attachTag
 * mutation per selected row. These tests pin the semantics that matter: already-tagged members
 * are not duplicated, ids outside the tenant are ignored, the returned count is the number of
 * NEWLY tagged records, and the households variant skips the placeholder household instead of
 * refusing the whole batch.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('bulk tag attach', () => {
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let personA: string;
  let personB: string;
  let foreignPersonId: string;

  const auth = () => ({ tenant_id: tenantId, user_id: userId, name: 'Bulk Tagger', session_id: 's' });

  beforeEach(async () => {
    tenantId = rand();
    otherTenantId = rand();
    userId = rand();
    campaignId = rand();
    householdId = rand();

    for (const [id, name] of [
      [tenantId, 'Bulk Tag Tenant'],
      [otherTenantId, 'Bulk Tag Other Tenant'],
    ] as const) {
      await db.insertInto('tenants').values({ id, name }).execute();
    }
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `bulk-${userId}@example.com`,
        first_name: 'Bulk',
        last_name: 'Tagger',
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
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const seedPerson = async (tenant: string, first: string): Promise<string> => {
      const row = await db
        .insertInto('persons')
        .values({
          tenant_id: tenant,
          ...(tenant === tenantId ? { campaign_id: campaignId, household_id: householdId } : {}),
          first_name: first,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return String(row.id);
    };
    personA = await seedPerson(tenantId, 'Alpha');
    personB = await seedPerson(tenantId, 'Beta');
    // A person in ANOTHER tenant: passing their id must tag nothing.
    const foreignCampaign = rand();
    const foreignHousehold = rand();
    await db
      .insertInto('campaigns')
      .values({
        id: foreignCampaign,
        tenant_id: otherTenantId,
        admin_id: userId,
        name: 'Foreign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('households')
      .values({
        id: foreignHousehold,
        tenant_id: otherTenantId,
        campaign_id: foreignCampaign,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    const foreign = await db
      .insertInto('persons')
      .values({
        tenant_id: otherTenantId,
        campaign_id: foreignCampaign,
        household_id: foreignHousehold,
        first_name: 'Foreign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    foreignPersonId = String(foreign.id);
  });

  afterEach(async () => {
    // BOTH tenants' campaigns reference the first tenant's user as admin (fk_admin_id), so all
    // campaign rows must go before any authusers row does.
    for (const tid of [tenantId, otherTenantId]) {
      await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('map_households_tags').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('user_activity').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('persons').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('tags').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('households').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('campaigns').where('tenant_id', '=', tid).execute();
    }
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    for (const tid of [tenantId, otherTenantId]) {
      await db.deleteFrom('tenants').where('id', '=', tid).execute();
    }
  });

  it('tags every selected person once, skipping the already-tagged and foreign-tenant ids', async () => {
    const svc = new PersonsService();
    // personA is tagged up front; a second bulk attach must not duplicate the mapping.
    await svc.attachTag(personA, 'bulk-tag', 'tag', auth());

    const result = await svc.attachTagToMany([personA, personB, foreignPersonId], 'bulk-tag', 'tag', auth());

    expect(result.tagged).toBe(1); // only personB is new

    const mappings = await db
      .selectFrom('map_peoples_tags')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .select(['map_peoples_tags.person_id'])
      .where('map_peoples_tags.tenant_id', '=', tenantId)
      .where('tags.name', '=', 'bulk-tag')
      .execute();
    const taggedIds = mappings.map((m: { person_id: unknown }) => String(m.person_id)).sort();
    expect(taggedIds).toEqual([personA, personB].sort());

    // The foreign tenant gained nothing — not a mapping, not a tag.
    const foreignRows = await db
      .selectFrom('map_peoples_tags')
      .select('person_id')
      .where('tenant_id', '=', otherTenantId)
      .execute();
    expect(foreignRows).toHaveLength(0);
  });

  it('households variant skips the placeholder household instead of refusing the batch', async () => {
    // Mark the seeded household as the tenant's placeholder.
    await db.updateTable('tenants').set({ placeholder_household_id: householdId }).where('id', '=', tenantId).execute();
    const realHousehold = await db
      .insertInto('households')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const realId = String(realHousehold.id);

    const controller = new HouseholdsController();
    const result = await controller.attachTagToMany([householdId, realId], 'bulk-hh-tag', 'tag', auth());

    expect(result.tagged).toBe(1);
    const mappings = await db
      .selectFrom('map_households_tags')
      .select('household_id')
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(mappings.map((m: { household_id: unknown }) => String(m.household_id))).toEqual([realId]);

    // Unmark before afterEach deletes the household (FK on tenants.placeholder_household_id).
    await db.updateTable('tenants').set({ placeholder_household_id: null }).where('id', '=', tenantId).execute();
  });
});
