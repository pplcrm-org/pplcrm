import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HouseholdsController } from './controller';
import { HouseholdRepo } from './repositories/households.repo';
import { resolveSeatSetId } from './electoral-areas';
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

/** Create a boundary map for a workspace and put one household on it. */
async function placeHouseholdOnMap(
  db: any,
  args: {
    tenantId: string;
    userId: string;
    householdId: string;
    slug: string;
    label: string;
    role: 'seat_area' | 'subdivision' | 'locality';
    areaName: string;
  },
) {
  const set = await db
    .insertInto('boundary_sets')
    .values({
      tenant_id: args.tenantId,
      slug: args.slug,
      label: args.label,
      jurisdiction: 'other',
      role: args.role,
      source: 'drawn',
      createdby_id: args.userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('household_districts')
    .values({
      tenant_id: args.tenantId,
      household_id: args.householdId,
      set_id: String(set.id),
      name: args.areaName,
    })
    .execute();
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();

  await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
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

  it('returns every boundary map a household is on, seat areas before subdivisions', async () => {
    const created = (await controller.addHousehold({ street1: '12 Boundary Way' }, auth)) as { id: string };

    // Inserted worst-first on purpose: the subdivision goes in before either seat area, and the
    // labels are not in alphabetical order either, so a result that comes back sorted proves the
    // ordering is applied rather than accidental.
    await placeHouseholdOnMap(db, {
      tenantId,
      userId,
      householdId: created.id,
      slug: `polls-${rand()}`,
      label: 'Polling divisions',
      role: 'subdivision',
      areaName: 'Poll 12',
    });
    await placeHouseholdOnMap(db, {
      tenantId,
      userId,
      householdId: created.id,
      slug: `federal-${rand()}`,
      label: 'Federal ridings',
      role: 'seat_area',
      areaName: 'Ottawa Centre',
    });
    await placeHouseholdOnMap(db, {
      tenantId,
      userId,
      householdId: created.id,
      slug: `wards-${rand()}`,
      label: 'City wards',
      role: 'seat_area',
      areaName: 'Ward 4',
    });

    const fetched = (await controller.getOneById({ tenant_id: tenantId, id: created.id })) as {
      electoral_areas: { set_label: string; name: string }[];
    };

    expect(fetched.electoral_areas).toEqual([
      { set_label: 'City wards', name: 'Ward 4' },
      { set_label: 'Federal ridings', name: 'Ottawa Centre' },
      { set_label: 'Polling divisions', name: 'Poll 12' },
    ]);
  });

  it('returns an empty boundary list for a household that is on no map', async () => {
    const created = (await controller.addHousehold({ street1: '3 Nowhere Ln' }, auth)) as { id: string };
    const fetched = (await controller.getOneById({ tenant_id: tenantId, id: created.id })) as {
      electoral_areas: { set_label: string; name: string }[];
    };
    expect(fetched.electoral_areas).toEqual([]);
  });

  it('never returns another workspace’s boundaries', async () => {
    const other = await createTestSeed(db);
    try {
      const mine = (await controller.addHousehold({ street1: '5 Mine St' }, auth)) as { id: string };
      await placeHouseholdOnMap(db, {
        tenantId,
        userId,
        householdId: mine.id,
        slug: `mine-${rand()}`,
        label: 'City wards',
        role: 'seat_area',
        areaName: 'Ward 1',
      });

      const theirHousehold = await db
        .insertInto('households')
        .values({
          tenant_id: other.tenantId,
          campaign_id: other.campaignId,
          street1: '5 Theirs St',
          createdby_id: other.userId,
          updatedby_id: other.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await placeHouseholdOnMap(db, {
        tenantId: other.tenantId,
        userId: other.userId,
        householdId: String(theirHousehold.id),
        slug: `theirs-${rand()}`,
        label: 'Their wards',
        role: 'seat_area',
        areaName: 'Ward 99',
      });

      // My household shows only my map.
      const fetchedMine = (await controller.getOneById({ tenant_id: tenantId, id: mine.id })) as {
        electoral_areas: { set_label: string; name: string }[];
      };
      expect(fetchedMine.electoral_areas).toEqual([{ set_label: 'City wards', name: 'Ward 1' }]);

      // Asking for their household with my workspace id returns nothing at all.
      const fetchedTheirs = await controller.getOneById({ tenant_id: tenantId, id: String(theirHousehold.id) });
      expect(fetchedTheirs).toBeUndefined();

      // And the boundary read itself refuses to cross the workspace line.
      const leaked = await new HouseholdRepo().getElectoralAreas(tenantId, String(theirHousehold.id));
      expect(leaked).toEqual([]);
    } finally {
      await cleanTenant(db, other.tenantId);
    }
  });

  it('ignores a sortModel colId the query cannot serve (a saved sort on the removed ward column)', async () => {
    await controller.addHousehold({ street1: '1 Sort St', city: 'Springfield' }, auth);

    // 'ward' was a real column once, so a browser can still hold a persisted sort on it. It must
    // be skipped — passed through it becomes ORDER BY "ward", Postgres rejects the query, and the
    // grid never loads. The known column in the same model still sorts.
    const result = await controller.getAllWithPeopleCount(auth, {
      sortModel: [
        { colId: 'ward', sort: 'asc' },
        { colId: 'city', sort: 'asc' },
      ],
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by the electoral columns from the grid filter model, with a matching count', async () => {
    const inWard = (await controller.addHousehold({ street1: '4 Ward Rd' }, auth)) as { id: string };
    await controller.addHousehold({ street1: '9 Mapless Ave' }, auth);
    await placeHouseholdOnMap(db, {
      tenantId,
      userId,
      householdId: inWard.id,
      slug: `wards-${rand()}`,
      label: 'City wards',
      role: 'seat_area',
      areaName: 'Ward 4',
    });

    // No electoral filter: the count query runs without the lateral join and still agrees.
    const unfiltered = await controller.getAllWithPeopleCount(auth);
    expect(unfiltered.rows).toHaveLength(2);
    expect(unfiltered.count).toBe(2);

    // electoral_area (the seat-set value) narrows to the household on the map — and the count
    // query, which only now carries the lateral join, agrees with the rows.
    const filtered = await controller.getAllWithPeopleCount(auth, {
      filterModel: { electoral_area: { op: 'contains', value: 'ward 4' } },
    });
    expect(filtered.rows).toHaveLength(1);
    expect(String(filtered.rows[0]['id'])).toBe(String(inWard.id));
    expect(filtered.count).toBe(1);

    // any_electoral_area (every boundary, joined) narrows the same way.
    const anyFiltered = await controller.getAllWithPeopleCount(auth, {
      filterModel: { any_electoral_area: { op: 'contains', value: 'ward' } },
    });
    expect(anyFiltered.rows).toHaveLength(1);
    expect(anyFiltered.count).toBe(1);
  });

  it('counts distinct areas on the campaign’s own seat map when a campaign is given', async () => {
    const hh1 = (await controller.addHousehold({ street1: '11 Two Maps Way' }, auth)) as { id: string };
    const hh2 = (await controller.addHousehold({ street1: '22 Two Maps Way' }, auth)) as { id: string };

    // Older seat map matching the seed campaign's jurisdiction ('other'), holding two areas…
    const otherSet = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug: `wards-${rand()}`,
        label: 'City wards',
        jurisdiction: 'other',
        role: 'seat_area',
        source: 'drawn',
        createdby_id: userId,
        created_at: new Date('2026-01-01T00:00:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // …and a newer seat map for a different jurisdiction, holding one. The campaign-free
    // fallback (newest seat-area set) picks this one.
    const federalSet = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: tenantId,
        slug: `federal-${rand()}`,
        label: 'Federal ridings',
        jurisdiction: 'ca_federal',
        role: 'seat_area',
        source: 'upload',
        createdby_id: userId,
        created_at: new Date('2026-02-01T00:00:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const place = (householdId: string, setId: unknown, name: string) =>
      db
        .insertInto('household_districts')
        .values({ tenant_id: tenantId, household_id: householdId, set_id: String(setId), name })
        .execute();
    await place(hh1.id, otherSet.id, 'Ward 1');
    await place(hh2.id, otherSet.id, 'Ward 2');
    await place(hh1.id, federalSet.id, 'Ottawa Centre');

    // Without a campaign: the workspace fallback set (newest seat map) → 1 riding.
    expect(await controller.countDistinctWards(auth)).toBe(1);
    // With the campaign (jurisdiction 'other'): its own seat map → 2 wards.
    expect(await controller.countDistinctWards(auth, campaignId)).toBe(2);
  });

  it('breaks created_at ties between seat maps by newest id — one import stamps several sets with the same now()', async () => {
    const tiedAt = new Date('2026-03-01T00:00:00Z');
    const insertSet = (slug: string) =>
      db
        .insertInto('boundary_sets')
        .values({
          tenant_id: tenantId,
          slug,
          label: slug,
          jurisdiction: 'other',
          role: 'seat_area',
          source: 'import',
          createdby_id: userId,
          created_at: tiedAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    await insertSet(`tie-a-${rand()}`);
    const second = await insertSet(`tie-b-${rand()}`);

    // Both branches — jurisdiction-matched (campaign says 'other') and the campaign-free
    // fallback — must resolve the same set every time, not whichever the planner returns first.
    expect(await resolveSeatSetId(db, tenantId, campaignId)).toBe(String(second.id));
    expect(await resolveSeatSetId(db, tenantId)).toBe(String(second.id));
  });

  it('replaces only the layers an address edit re-matched, never a set outside the required list', async () => {
    const created = (await controller.addHousehold({ street1: '7 Rematch Rd' }, auth)) as { id: string };

    const addSet = (slug: string, source: string, jurisdiction: string) =>
      db
        .insertInto('boundary_sets')
        .values({
          tenant_id: tenantId,
          slug,
          label: slug,
          jurisdiction,
          role: 'seat_area',
          source,
          createdby_id: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    // Bundled federal map while the only active campaign contests 'other' — NOT in the required
    // list, so an address edit never looks at it and must not touch its rows.
    const outsideSet = await addSet(`outside-${rand()}`, 'bundled', 'ca_federal');
    // A drawn map is always required. It holds no polygons here, so the re-match finds nothing
    // in it and the household's old row in it is honestly cleared.
    const requiredSet = await addSet(`required-${rand()}`, 'drawn', 'other');

    const place = (setId: unknown, name: string) =>
      db
        .insertInto('household_districts')
        .values({ tenant_id: tenantId, household_id: created.id, set_id: String(setId), name })
        .execute();
    await place(outsideSet.id, 'Old Riding');
    await place(requiredSet.id, 'Old Ward');

    // Address edit arriving with coordinates (the autocomplete shape) triggers the inline match.
    await controller.update({
      tenant_id: tenantId,
      id: created.id,
      row: { street1: '8 Rematch Rd', lat: 45.42, lng: -75.7 } as any,
    });

    const rows = await db
      .selectFrom('household_districts')
      .select(['set_id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', created.id)
      .execute();
    const bySet = new Map(rows.map((r: any) => [String(r.set_id), r.name]));
    // The layer outside the required list kept its row…
    expect(bySet.get(String(outsideSet.id))).toBe('Old Riding');
    // …while the re-matched layer's stale row was replaced (by nothing — no polygon contains it).
    expect(bySet.has(String(requiredSet.id))).toBe(false);
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

    // A generator — the import job hands processImportRows a lazy row
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
