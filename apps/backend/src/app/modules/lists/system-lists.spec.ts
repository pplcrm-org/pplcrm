import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IAuthKeyPayload } from '@common';
import { SYSTEM_LISTS } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { ListsController } from './controller';
import { ensureSystemLists } from './system-lists';

// Seeding the built-ins enqueues real `refresh_list` rows. No queue lock is needed for them: the
// three spec files that read background_jobs globally insert their own rows in a high priority
// band, so `claimNextPendingJob` never prefers a row this file left behind. Everything this file
// reads back is scoped to its own tenant_id.

const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

async function createTestSeed(db: any) {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'System Lists Tenant' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `system-lists-${userId}@example.com`,
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
      name: 'Office',
      kind: 'office',
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

async function cleanTenant(db: any, tenantId: string) {
  // Let any in-flight lazy-refresh promise settle before the rows vanish.
  await new Promise((resolve) => setTimeout(resolve, 150));
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('Built-in lists', () => {
  const controller = new ListsController();
  const db = BaseRepository.dbInstance as any;
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
    auth = { tenant_id: tenantId, user_id: userId, name: 'Test User', session_id: 'test-session' };
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  const systemRows = () =>
    db
      .selectFrom('lists')
      .select(['id', 'name', 'system_key', 'is_dynamic'])
      .where('tenant_id', '=', tenantId)
      .where('system_key', 'is not', null)
      .orderBy('system_key')
      .execute();

  it('seeds one of each built-in and is idempotent', async () => {
    const first = await ensureSystemLists({ tenant_id: tenantId, campaign_id: campaignId, user_id: userId });
    const second = await ensureSystemLists({ tenant_id: tenantId, campaign_id: campaignId, user_id: userId });

    expect(first).toBe(SYSTEM_LISTS.length);
    expect(second).toBe(0);

    const rows = await systemRows();
    expect(rows.map((r: any) => r.system_key)).toEqual(['all_subscribers', 'all_volunteers']);
    expect(rows.map((r: any) => r.name)).toEqual(['All Subscribers', 'All Volunteers']);
    expect(rows.every((r: any) => r.is_dynamic)).toBe(true);
  });

  it('re-creates the built-ins on read for a context that never had them', async () => {
    const result: any = await controller.getAllForContext(auth, { campaignId });
    const names = (result?.rows ?? []).map((r: any) => r.name);

    expect(names).toContain('All Subscribers');
    expect(names).toContain('All Volunteers');
    // The grid's generic non-deletable guard reads this flag.
    expect((result.rows as any[]).filter((r) => r.system_key).every((r) => r.deletable === false)).toBe(true);
  });

  it('refuses to delete a built-in, singly or in bulk', async () => {
    await ensureSystemLists({ tenant_id: tenantId, campaign_id: campaignId, user_id: userId });
    const [subscribers] = await systemRows();

    await expect(controller.delete(tenantId, String(subscribers.id), userId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(controller.deleteMany(tenantId, [String(subscribers.id)])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const rows = await systemRows();
    expect(rows).toHaveLength(SYSTEM_LISTS.length);
  });

  it('refuses to rename or re-rule a built-in but allows a new description', async () => {
    await ensureSystemLists({ tenant_id: tenantId, campaign_id: campaignId, user_id: userId });
    const [subscribers] = await systemRows();
    const id = String(subscribers.id);

    await expect(controller.updateList(id, { name: 'Everyone' }, auth)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(controller.updateList(id, { definition: { filterModel: {} } }, auth)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await controller.updateList(id, { description: 'Our opted-in supporters' }, auth);
    const row = await db.selectFrom('lists').selectAll().where('id', '=', id).executeTakeFirst();
    expect(row.description).toBe('Our opted-in supporters');
    expect(row.name).toBe('All Subscribers');
  });

  it('resolves each built-in against the right people', async () => {
    await ensureSystemLists({ tenant_id: tenantId, campaign_id: campaignId, user_id: userId });

    const volunteerId = rand();
    const subscriberId = rand();
    const bystanderId = rand();
    const people = [
      { id: volunteerId, first_name: 'Vera', volunteer_status: 'active' },
      { id: subscriberId, first_name: 'Sam', volunteer_status: null },
      { id: bystanderId, first_name: 'Bo', volunteer_status: null },
    ];
    for (const p of people) {
      await db
        .insertInto('persons')
        .values({
          id: p.id,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: p.first_name,
          last_name: 'Tester',
          volunteer_status: p.volunteer_status,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }
    // Sam opted in; Bo asked to be removed — only Sam is a subscriber.
    await db
      .insertInto('campaign_subscriptions')
      .values([
        {
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: subscriberId,
          email: 'sam@example.com',
          status: 'subscribed',
          createdby_id: userId,
          updatedby_id: userId,
        },
        {
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: bystanderId,
          email: 'bo@example.com',
          status: 'unsubscribed',
          createdby_id: userId,
          updatedby_id: userId,
        },
      ])
      .execute();

    const rows = await systemRows();
    const byKey = new Map(rows.map((r: any) => [r.system_key, String(r.id)]));

    const subscribers = await controller.getCurrentMembers(auth, byKey.get('all_subscribers') as string);
    const volunteers = await controller.getCurrentMembers(auth, byKey.get('all_volunteers') as string);

    expect(subscribers.ids).toEqual([subscriberId]);
    expect(volunteers.ids).toEqual([volunteerId]);
  });
});
