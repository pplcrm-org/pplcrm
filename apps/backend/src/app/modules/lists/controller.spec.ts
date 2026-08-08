import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ListsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { MapListsPersonsRepo } from './repositories/map-lists-persons.repo';
import type { IAuthKeyPayload } from '@common';

// These tests commit `pending` background_jobs rows (the refresh-list enqueue). No queue lock is
// needed for them: the three spec files that read the queue globally insert their own rows in a
// high priority band, so `claimNextPendingJob` never prefers a row this file left behind.
// Everything this file reads back is scoped to its own tenant_id.

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

  // Update tenant admin, creator, and placeholder household
  await db
    .updateTable('tenants')
    .set({
      admin_id: userId,
      createdby_id: userId,
      placeholder_household_id: householdId,
    })
    .where('id', '=', tenantId)
    .execute();

  return { tenantId, userId, campaignId, householdId };
}

async function cleanTenant(db: any, tenantId: string) {
  // Allow any in-flight un-awaited background promises from lazy list refresh to finish
  await new Promise((resolve) => setTimeout(resolve, 150));

  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('ListsController Background Refresh', () => {
  const controller = new ListsController();
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

  it('should enqueue a background job when creating a dynamic list', async () => {
    const list = await controller.addList(
      {
        name: 'Dynamic Test List',
        description: 'A dynamic list for testing background jobs',
        object: 'people',
        is_dynamic: true,
        definition: {
          filterModel: {
            tags_expression: { kind: 'rule', id: 'rule1', field: 'tag', op: 'eq', value: 'volunteer' },
          },
          tags: ['volunteer'],
        },
      },
      auth,
    );

    // Verify list status is refreshing
    const listInDb = await db.selectFrom('lists').selectAll().where('id', '=', list.id).executeTakeFirst();
    expect(listInDb.status).toBe('refreshing');

    // Verify background job is enqueued
    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();

    expect(job).toBeDefined();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(payload.type).toBe('refresh_list');
    expect(payload.list_id).toBe(list.id);
  });

  it('should execute list refresh and populate people mapping correctly', async () => {
    // 1. Add some test people
    const personId1 = String(Math.floor(Math.random() * 100000000) + 10000000);
    const personId2 = String(Math.floor(Math.random() * 100000000) + 10000000);

    await db
      .insertInto('persons')
      .values({
        id: personId1,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Alice',
        last_name: 'Smith',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('persons')
      .values({
        id: personId2,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Bob',
        last_name: 'Jones',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Attach "Volunteer" tag to Alice
    const tagId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tags')
      .values({
        id: tagId,
        tenant_id: tenantId,
        name: 'volunteer',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('map_peoples_tags')
      .values({
        tenant_id: tenantId,
        person_id: personId1,
        tag_id: tagId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 2. Pre-insert a dynamic list targeting "Volunteer" tag
    const listId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Volunteers List',
        object: 'people',
        is_dynamic: true,
        status: 'refreshing',
        definition: JSON.stringify({ tags: ['volunteer'] }),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 3. Execute the actual refresh (usually called by worker)
    await controller.executeListRefresh(tenantId, listId, userId);

    // 4. Verify mappings in database: Alice should be present, Bob should not.
    const mappings = await db.selectFrom('map_lists_persons').selectAll().where('list_id', '=', listId).execute();

    expect(mappings.length).toBe(1);
    expect(mappings[0].person_id).toBe(personId1);

    // Verify list status is back to idle and last_refreshed_at is set
    const list = await db.selectFrom('lists').selectAll().where('id', '=', listId).executeTakeFirst();
    expect(list.status).toBe('idle');
    expect(list.last_refreshed_at).not.toBeNull();
  });

  it('should lazily trigger a refresh job when getOneById is called on a stale dynamic list', async () => {
    // 1. Pre-insert a dynamic list in idle state, but last_refreshed_at is 25 hours ago
    const listId = String(Math.floor(Math.random() * 100000000) + 10000000);
    const staleTime = new Date(Date.now() - 25 * 3600 * 1000);
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Stale List',
        object: 'people',
        is_dynamic: true,
        status: 'idle',
        last_refreshed_at: staleTime,
        definition: JSON.stringify({ tags: ['volunteer'] }),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 2. Query the list by ID
    const list = await controller.getOneById({ tenant_id: tenantId, id: listId });
    expect(list).toBeDefined();

    // Await the lazy refresh background promise to ensure it completes before asserting/cleaning up
    if ((controller as any)._lastLazyRefreshPromise) {
      await (controller as any)._lastLazyRefreshPromise;
    }

    // Poll the database until status is 'refreshing' and job is enqueued (max 2 seconds)
    let listInDb;
    let job;
    for (let i = 0; i < 20; i++) {
      listInDb = await db.selectFrom('lists').selectAll().where('id', '=', listId).executeTakeFirst();
      job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();

      if (listInDb?.status === 'refreshing' && job) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(listInDb).toBeDefined();
    expect(listInDb.status).toBe('refreshing');
    expect(job).toBeDefined();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(payload.type).toBe('refresh_list');
    expect(payload.list_id).toBe(listId);
  });

  it('getAll runs the real grid query (counts + LAST USED IN subquery + GROUP BY) without error', async () => {
    // Regression guard: getAllWithCounts selects lists.definition and a correlated
    // subquery referencing lists.tenant_id alongside aggregate COUNTs — both must be
    // in GROUP BY or Postgres rejects the query at plan time ("must appear in the
    // GROUP BY" / "subquery uses ungrouped column"). The mocked router spec never
    // executed this SQL; the People grid does, so run it against the real DB.
    await controller.addList(
      {
        name: 'Grid Query List',
        description: 'exercises the real getAll query',
        object: 'people',
        is_dynamic: false,
        definition: { filterModel: {} },
      },
      auth,
    );

    const result: any = await controller.getAll(tenantId);
    const rows: any[] = Array.isArray(result) ? result : (result?.rows ?? []);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r) => r.name === 'Grid Query List')).toBe(true);
  });

  /** Insert `count` bare persons and one static list; returns their ids for mapping rows. */
  async function seedPersonsAndStaticList(count: number): Promise<{ listId: string; personIds: string[] }> {
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const personIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const personId = rand();
      personIds.push(personId);
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: `Person${i}`,
          last_name: 'Chunk',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }
    const listId = rand();
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: `Chunk List ${listId}`,
        object: 'people',
        is_dynamic: false,
        status: 'idle',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    return { listId, personIds };
  }

  function membershipRows(listId: string, personIds: string[]) {
    return personIds.map((person_id) => ({
      tenant_id: tenantId,
      list_id: listId,
      person_id,
      createdby_id: userId,
      updatedby_id: userId,
    }));
  }

  describe('addManyChunked', () => {
    const repo = new MapListsPersonsRepo();

    it('returns 0 and issues no insert for an empty row set', async () => {
      const inserted = await repo.addManyChunked({ rows: [], chunkSize: 2 });
      expect(inserted).toBe(0);
    });

    it('inserts a row set exactly one chunk long in a single statement', async () => {
      const { listId, personIds } = await seedPersonsAndStaticList(2);
      const inserted = await repo.addManyChunked({ rows: membershipRows(listId, personIds) as any, chunkSize: 2 });
      expect(inserted).toBe(2);

      const mappings = await db.selectFrom('map_lists_persons').selectAll().where('list_id', '=', listId).execute();
      expect(mappings.map((m: any) => m.person_id).sort()).toEqual([...personIds].sort());
    });

    it('inserts chunk size + 1 rows across two statements and counts them all', async () => {
      const { listId, personIds } = await seedPersonsAndStaticList(3);
      const inserted = await repo.addManyChunked({ rows: membershipRows(listId, personIds) as any, chunkSize: 2 });
      expect(inserted).toBe(3);

      const mappings = await db.selectFrom('map_lists_persons').selectAll().where('list_id', '=', listId).execute();
      expect(mappings.map((m: any) => m.person_id).sort()).toEqual([...personIds].sort());
    });

    it('rejects a non-positive chunk size', async () => {
      await expect(repo.addManyChunked({ rows: [], chunkSize: 0 })).rejects.toThrow(/positive integer/);
    });
  });

  it('keeps the previous membership intact when the refresh insert fails mid-swap', async () => {
    // New membership: Alice, tagged "volunteer". Previous membership: Bob.
    const { personIds } = await seedPersonsAndStaticList(2);
    const [aliceId, bobId] = personIds;

    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const tagId = rand();
    await db
      .insertInto('tags')
      .values({ id: tagId, tenant_id: tenantId, name: 'volunteer', createdby_id: userId, updatedby_id: userId })
      .execute();
    await db
      .insertInto('map_peoples_tags')
      .values({ tenant_id: tenantId, person_id: aliceId, tag_id: tagId, createdby_id: userId, updatedby_id: userId })
      .execute();

    const listId = rand();
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Refresh Failure List',
        object: 'people',
        is_dynamic: true,
        status: 'refreshing',
        definition: JSON.stringify({ tags: ['volunteer'] }),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // The membership as it stood before the refresh.
    await db
      .insertInto('map_lists_persons')
      .values({ tenant_id: tenantId, list_id: listId, person_id: bobId, createdby_id: userId, updatedby_id: userId })
      .execute();

    // A local controller so the spy can't leak into the shared instance.
    const failingController = new ListsController();
    vi.spyOn((failingController as any).mapListsPersonsRepo, 'addManyChunked').mockRejectedValue(
      new Error('insert blew up'),
    );

    await expect(failingController.executeListRefresh(tenantId, listId, userId)).rejects.toThrow('insert blew up');

    // The delete rolled back with the failed insert: Bob is still a member.
    const mappings = await db.selectFrom('map_lists_persons').selectAll().where('list_id', '=', listId).execute();
    expect(mappings.length).toBe(1);
    expect(mappings[0].person_id).toBe(bobId);

    // And the list reports the failure instead of pretending it refreshed.
    const listRow = await db.selectFrom('lists').selectAll().where('id', '=', listId).executeTakeFirst();
    expect(listRow.status).toBe('failed');
    expect(listRow.last_refreshed_at).toBeNull();
  });

  it('executeListRefresh replaces the previous membership on success', async () => {
    // Previous membership: Bob. New membership after refresh: Alice (tagged).
    const { personIds } = await seedPersonsAndStaticList(2);
    const [aliceId, bobId] = personIds;

    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const tagId = rand();
    await db
      .insertInto('tags')
      .values({ id: tagId, tenant_id: tenantId, name: 'volunteer', createdby_id: userId, updatedby_id: userId })
      .execute();
    await db
      .insertInto('map_peoples_tags')
      .values({ tenant_id: tenantId, person_id: aliceId, tag_id: tagId, createdby_id: userId, updatedby_id: userId })
      .execute();

    const listId = rand();
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Refresh Swap List',
        object: 'people',
        is_dynamic: true,
        status: 'refreshing',
        definition: JSON.stringify({ tags: ['volunteer'] }),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('map_lists_persons')
      .values({ tenant_id: tenantId, list_id: listId, person_id: bobId, createdby_id: userId, updatedby_id: userId })
      .execute();

    await controller.executeListRefresh(tenantId, listId, userId);

    const mappings = await db.selectFrom('map_lists_persons').selectAll().where('list_id', '=', listId).execute();
    expect(mappings.length).toBe(1);
    expect(mappings[0].person_id).toBe(aliceId);
  });
});
