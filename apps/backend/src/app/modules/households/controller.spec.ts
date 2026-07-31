import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HouseholdsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import type { IAuthKeyPayload } from '@common';

function rand() {
  return String(Math.floor(Math.random() * 100000000) + 10000000);
}

async function createTestSeed(db: any) {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const placeholderHouseholdId = rand();

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
      id: placeholderHouseholdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: placeholderHouseholdId })
    .where('id', '=', tenantId)
    .execute();

  await db
    .insertInto('settings')
    .values({
      tenant_id: tenantId,
      key: 'current_campaign',
      value: JSON.stringify({ id: Number(campaignId) }),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return { tenantId, userId, campaignId, placeholderHouseholdId };
}

async function createPerson(db: any, tenantId: string, campaignId: string, householdId: string, userId: string) {
  const result = await db
    .insertInto('persons')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: `Person-${rand()}`,
      createdby_id: userId,
      updatedby_id: userId,
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

  await db.deleteFrom('map_households_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('data_imports').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('HouseholdsController', () => {
  const controller = new HouseholdsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let placeholderHouseholdId: string;
  let auth: IAuthKeyPayload;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    placeholderHouseholdId = seed.placeholderHouseholdId;

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

  it('should create a household using the current campaign', async () => {
    const result = (await controller.addHousehold(
      { street1: '123 Main St', city: 'Springfield', state: 'IL', zip: '62701' },
      auth,
    )) as { id: string };

    expect(result.id).toBeDefined();
    const row = await db.selectFrom('households').selectAll().where('id', '=', result.id).executeTakeFirst();
    expect(row.campaign_id).toBe(campaignId);
    expect(row.address_fp_full).not.toBeNull();
  });

  it('should dedupe households with the same address fingerprint', async () => {
    const payload = { street1: '456 Oak Ave', city: 'Metropolis', state: 'NY', zip: '10001' };
    const first = (await controller.addHousehold(payload, auth)) as { id: string };
    const second = (await controller.addHousehold(payload, auth)) as { id: string };

    expect(second.id).toBe(first.id);
  });

  it('getCount excludes the placeholder household from the grain/count number', async () => {
    await controller.addHousehold({ street1: '1 Real St', city: 'Springfield', state: 'IL', zip: '62701' }, auth);
    await controller.addHousehold({ street1: '2 Real St', city: 'Springfield', state: 'IL', zip: '62701' }, auth);

    // Three rows exist (2 real + the permanent placeholder)...
    const raw = await db
      .selectFrom('households')
      .select((eb: any) => eb.fn.countAll().as('n'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    expect(Number(raw.n)).toBe(3);

    // ...but the count shown to the user excludes the placeholder.
    const count = await controller.getCount(tenantId);
    expect(count).toBe(2);
  });

  it('should flag the placeholder household when fetched by id', async () => {
    const fetched = (await controller.getOneById({ tenant_id: tenantId, id: placeholderHouseholdId })) as
      | { is_placeholder: boolean }
      | undefined;
    expect(fetched?.is_placeholder).toBe(true);

    const regular = (await controller.addHousehold({ street1: '1 Elm St' }, auth)) as { id: string };
    const fetchedRegular = (await controller.getOneById({ tenant_id: tenantId, id: regular.id })) as {
      is_placeholder: boolean;
    };
    expect(fetchedRegular.is_placeholder).toBe(false);
  });

  it('should refuse to update the placeholder household', async () => {
    await expect(
      controller.update({ tenant_id: tenantId, id: placeholderHouseholdId, row: { city: 'Nope' } as any }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('should update a household and recompute its address fingerprint', async () => {
    const created = (await controller.addHousehold({ street1: '9 Pine Rd' }, auth)) as { id: string };

    const updated = (await controller.update({
      tenant_id: tenantId,
      id: created.id,
      row: { city: 'Gotham' } as any,
    })) as { city: string };

    expect(updated.city).toBe('Gotham');
    const row = await db.selectFrom('households').selectAll().where('id', '=', created.id).executeTakeFirst();
    expect(row.address_fp_full).not.toBeNull();
  });

  it('should refuse to attach a tag to the placeholder household', async () => {
    await expect(controller.attachTag(placeholderHouseholdId, 'urgent', 'tag', auth)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('should attach and list tags on a household', async () => {
    const created = (await controller.addHousehold({ street1: '22 Birch Ln' }, auth)) as { id: string };
    await controller.attachTag(created.id, 'urgent', 'tag', auth);

    const tags = await controller.getTags(created.id, auth, 'tag');
    expect(tags.map((t) => t.name)).toContain('urgent');
  });

  it('should detach a tag from a household', async () => {
    const created = (await controller.addHousehold({ street1: '31 Cedar Ct' }, auth)) as { id: string };
    await controller.attachTag(created.id, 'follow-up', 'tag', auth);
    await controller.detachTag(tenantId, created.id, 'follow-up', 'tag', userId);

    const tags = await controller.getTags(created.id, auth, 'tag');
    expect(tags.map((t) => t.name)).not.toContain('follow-up');
  });

  it('should count people in a household via getPeopleCount and getAllWithPeopleCount', async () => {
    const created = (await controller.addHousehold({ street1: '77 Maple Dr' }, auth)) as { id: string };
    await createPerson(db, tenantId, campaignId, created.id, userId);
    await createPerson(db, tenantId, campaignId, created.id, userId);

    const count = await controller.getPeopleCount(created.id, auth);
    expect(count).toBe(2);

    const result = await controller.getAllWithPeopleCount(auth);
    const row = result.rows.find((r) => String(r['id']) === String(created.id)) as Record<string, unknown>;
    expect(Number(row['persons_count'])).toBe(2);
  });

  it('should count unhoused people (placeholder household members) via getUnhoused', async () => {
    const before = await controller.getUnhoused(auth);
    await createPerson(db, tenantId, campaignId, placeholderHouseholdId, userId);
    await createPerson(db, tenantId, campaignId, placeholderHouseholdId, userId);

    const after = await controller.getUnhoused(auth);
    expect(after.count).toBe(before.count + 2);
    expect(String(after.household_id)).toBe(String(placeholderHouseholdId));
  });

  it('should delete a household and reassign its members to the placeholder household', async () => {
    const created = (await controller.addHousehold({ street1: '5 Willow Way' }, auth)) as { id: string };
    const personId = await createPerson(db, tenantId, campaignId, created.id, userId);

    const deleted = await controller.deleteManyForTenant(auth, [created.id]);
    expect(deleted).toBeTruthy();

    const person = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
    expect(String(person.household_id)).toBe(String(placeholderHouseholdId));
  });

  it('should refuse to delete the placeholder household even if requested', async () => {
    const result = await controller.deleteManyForTenant(auth, [placeholderHouseholdId]);
    expect(result).toBe(false);

    const stillThere = await db
      .selectFrom('households')
      .selectAll()
      .where('id', '=', placeholderHouseholdId)
      .executeTakeFirst();
    expect(stillThere).toBeDefined();
  });

  it('should merge two households, moving tags and members to the target', async () => {
    const target = (await controller.addHousehold({ street1: '10 Target St' }, auth)) as { id: string };
    const source = (await controller.addHousehold({ street1: '20 Source St' }, auth)) as { id: string };
    await controller.attachTag(source.id, 'from-source', 'tag', auth);
    const personId = await createPerson(db, tenantId, campaignId, source.id, userId);

    const result = await controller.mergeHouseholds(target.id, source.id, auth);
    expect(result.success).toBe(true);

    const person = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
    expect(String(person.household_id)).toBe(String(target.id));

    const sourceRow = await db.selectFrom('households').selectAll().where('id', '=', source.id).executeTakeFirst();
    expect(sourceRow).toBeUndefined();

    const targetTags = await controller.getTags(target.id, auth, 'tag');
    expect(targetTags.map((t) => t.name)).toContain('from-source');
  });

  it('should throttle recompute-address-fingerprints requests to once per month', async () => {
    await controller.recomputeAddressFingerprints(tenantId);

    await expect(controller.recomputeAddressFingerprints(tenantId)).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const lastRun = await controller.getLastFingerprintRecomputation(tenantId);
    expect(lastRun.lastRunAt).not.toBeNull();
  });

  it('should import CSV rows, deduping by address and applying the batch tags', async () => {
    const existing = (await controller.addHousehold(
      { street_num: '12', street1: 'Oak St', city: 'Springfield', state: 'IL', zip: '62701' },
      auth,
    )) as { id: string };

    const importRow = await db
      .insertInto('data_imports')
      .values({
        tenant_id: tenantId,
        createdby_id: userId,
        updatedby_id: userId,
        file_name: 'doors.csv',
        source: 'households',
        row_count: 4,
        status: 'processing',
        processed_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const importId = String(importRow.id);

    const result = await controller.processImportRows(importId, tenantId, userId, campaignId, ['yard-sign'], 0, [
      // Duplicate of the household the tenant already has — skipped.
      { street_num: '12', street1: 'Oak St', city: 'Springfield', state: 'IL', zip: '62701' },
      { street_num: '34', street1: 'Elm St', city: 'Springfield', state: 'IL', zip: '62701' },
      // Repeated within the file — skipped.
      { street_num: '34', street1: 'Elm St', city: 'Springfield', state: 'IL', zip: '62701' },
      // Blank row — skipped.
      { street_num: '', street1: '' },
    ]);

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(3);
    expect(result.errors).toBe(0);

    const created = await db
      .selectFrom('households')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('file_id', '=', importId)
      .execute();
    expect(created).toHaveLength(1);
    expect(String(created[0].id)).not.toBe(String(existing.id));
    expect(created[0].address_fp_full).not.toBeNull();
    expect(created[0].slug).not.toBeNull();

    // The batch tag landed on the created household.
    const tags = await controller.getTags(String(created[0].id), auth, 'tag');
    expect(tags.map((t) => t.name)).toContain('yard-sign');

    // A geocoding job was queued for the new address (transactional outbox).
    const jobs = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).execute();
    const geocodeJobs = jobs.filter((j: any) => {
      const payload = typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload;
      return payload.type === 'geocode_household' && String(payload.household_id) === String(created[0].id);
    });
    expect(geocodeJobs).toHaveLength(1);

    // The history row's counters were kept current.
    const history = await db.selectFrom('data_imports').selectAll().where('id', '=', importId).executeTakeFirst();
    expect(history.inserted_count).toBe(1);
    expect(history.skipped_count).toBe(3);
    expect(history.households_created).toBe(1);
  });

  it('keeps counts correct when a lazy row source crosses the chunk boundary (105 rows)', async () => {
    const importRow = await db
      .insertInto('data_imports')
      .values({
        tenant_id: tenantId,
        createdby_id: userId,
        updatedby_id: userId,
        file_name: 'big.csv',
        source: 'households',
        row_count: 105,
        status: 'processing',
        processed_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const importId = String(importRow.id);

    // A generator — the import job hands processImportRows a lazy NDJSON
    // iterator, never a full array. 105 rows = chunks of 100 + 5:
    //   indexes 0..101  unique addresses            → 102 inserted
    //   index 102       repeats index 50 (cross-chunk duplicate) → skipped
    //   index 103       repeats it again            → skipped
    //   index 104       blank row                   → skipped
    function* rowGen(): Generator<Record<string, string>, void, undefined> {
      for (let i = 0; i <= 101; i++) {
        yield { street_num: String(i + 1), street1: 'Cedar Ave', city: 'Springfield', state: 'IL', zip: '62701' };
      }
      yield { street_num: '51', street1: 'Cedar Ave', city: 'Springfield', state: 'IL', zip: '62701' };
      yield { street_num: '51', street1: 'Cedar Ave', city: 'Springfield', state: 'IL', zip: '62701' };
      yield { street_num: '', street1: '' };
    }

    const result = await controller.processImportRows(importId, tenantId, userId, campaignId, [], 0, rowGen());

    expect(result.inserted).toBe(102);
    expect(result.skipped).toBe(3);
    expect(result.errors).toBe(0);

    const created = await db
      .selectFrom('households')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('file_id', '=', importId)
      .execute();
    expect(created).toHaveLength(102);

    const history = await db.selectFrom('data_imports').selectAll().where('id', '=', importId).executeTakeFirst();
    expect(history.inserted_count).toBe(102);
    expect(history.skipped_count).toBe(3);
    expect(history.error_count).toBe(0);
  });
});
