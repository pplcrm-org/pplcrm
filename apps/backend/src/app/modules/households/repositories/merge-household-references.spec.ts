import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { HouseholdRepo } from './households.repo';

/**
 * Merging two households deletes the source household row. Almost every table that names a
 * household does so with `ON DELETE CASCADE`, so anything still pointing at the source when
 * the delete runs is erased outright — canvass knocks, turf membership, boundary-area rows and
 * yard-sign requests all go with it. `mergeHouseholds` has to move each of those onto the
 * surviving household first, and the last test in this file is the tripwire that notices when a
 * new table starts naming a household and nobody taught the merge about it.
 *
 * Note on isolation: `HouseholdRepo.mergeHouseholds` opens its own Kysely transaction and takes
 * no external transaction argument, so `useTestTransaction()` cannot wrap it — its writes would
 * commit outside the test's transaction and its reads would deadlock against it. This file
 * therefore uses the same seed-a-throwaway-tenant / delete-it-afterwards shape as the sibling
 * spec `merge-person-references.spec.ts`, and every row it creates is scoped to that tenant.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  userId: string;
  campaignId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createSeed(db: any): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Merge HH Tenant' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `merge-hh-${userId}@example.com`,
      password: 'password',
      first_name: 'Merge',
      last_name: 'Households',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Merge HH Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return { tenantId, userId, campaignId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanTenant(db: any, tenantId: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  for (const table of [
    'turf_knocks',
    'turf_households',
    'turf_assignments',
    'turfs',
    'delivery_requests',
    'household_districts',
    'boundary_features',
    'boundary_sets',
    'map_households_tags',
    'map_lists_households',
    'lists',
    'tags',
    'potential_duplicates',
    'persons',
    'households',
    'campaigns',
    'sessions',
    'authusers',
  ]) {
    await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
  }
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('mergeHouseholds moves everything that names the source household', () => {
  const repo = new HouseholdRepo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (BaseRepository as any)._db;
  let seed: Seed;

  const addHousehold = async (street1: string, tenant?: Seed): Promise<string> => {
    const s = tenant ?? seed;
    const id = rand();
    await db
      .insertInto('households')
      .values({
        id,
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        street1,
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .execute();
    return id;
  };

  const addTurf = async (name: string, tenant?: Seed): Promise<string> => {
    const s = tenant ?? seed;
    const id = rand();
    await db
      .insertInto('turfs')
      .values({
        id,
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        name,
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .execute();
    return id;
  };

  const addKnock = async (
    turfId: string,
    householdId: string,
    outcome: string,
    notes: string,
    tenant?: Seed,
  ): Promise<string> => {
    const s = tenant ?? seed;
    const id = rand();
    await db
      .insertInto('turf_knocks')
      .values({
        id,
        tenant_id: s.tenantId,
        turf_id: turfId,
        household_id: householdId,
        outcome,
        notes,
        source: 'companion',
        canvasser_name: 'Field Volunteer',
        knocked_at: new Date(),
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .execute();
    return id;
  };

  const addTurfDoor = async (turfId: string, householdId: string, walkOrder: number): Promise<void> => {
    await db
      .insertInto('turf_households')
      .values({
        tenant_id: seed.tenantId,
        turf_id: turfId,
        household_id: householdId,
        walk_order: walkOrder,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
  };

  const addBoundarySet = async (slug: string): Promise<string> => {
    const row = await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: seed.tenantId,
        slug,
        label: slug,
        jurisdiction: 'other',
        role: 'seat_area',
        source: 'import',
        createdby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  const addDistrict = async (householdId: string, setId: string, name: string): Promise<void> => {
    await db
      .insertInto('household_districts')
      .values({ tenant_id: seed.tenantId, household_id: householdId, set_id: setId, name })
      .execute();
  };

  const addDeliveryRequest = async (householdId: string, status: string, notes: string): Promise<string> => {
    const row = await db
      .insertInto('delivery_requests')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: householdId,
        source: 'manual',
        status,
        notes,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  const addTag = async (name: string): Promise<string> => {
    const id = rand();
    await db
      .insertInto('tags')
      .values({ id, tenant_id: seed.tenantId, name, createdby_id: seed.userId, updatedby_id: seed.userId })
      .execute();
    return id;
  };

  const addTagLink = async (householdId: string, tagId: string): Promise<void> => {
    await db
      .insertInto('map_households_tags')
      .values({
        tenant_id: seed.tenantId,
        household_id: householdId,
        tag_id: tagId,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
  };

  const addList = async (name: string): Promise<string> => {
    const id = rand();
    await db
      .insertInto('lists')
      .values({
        id,
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        name,
        object: 'households',
        is_dynamic: false,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
    return id;
  };

  const addListMembership = async (householdId: string, listId: string): Promise<void> => {
    await db
      .insertInto('map_lists_households')
      .values({
        tenant_id: seed.tenantId,
        household_id: householdId,
        list_id: listId,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
  };

  const merge = async (targetId: string, sourceId: string, tenant?: Seed): Promise<{ success: boolean }> => {
    const s = tenant ?? seed;
    return repo.mergeHouseholds({
      tenant_id: s.tenantId,
      target_id: targetId,
      source_id: sourceId,
      user_id: s.userId,
    });
  };

  beforeEach(async () => {
    seed = await createSeed(db);
  });

  afterEach(async () => {
    await cleanTenant(db, seed.tenantId);
  });

  it('deletes the source household and moves its residents to the survivor', async () => {
    const target = await addHousehold('10 Target St');
    const source = await addHousehold('10 Target Street');
    const personId = rand();
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: source,
        first_name: 'Resident',
        last_name: 'OfSource',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();

    const result = await merge(target, source);
    expect(result.success).toBe(true);

    const sourceRow = await db
      .selectFrom('households')
      .select('id')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', source)
      .executeTakeFirst();
    expect(sourceRow).toBeUndefined();

    const person = await db
      .selectFrom('persons')
      .select('household_id')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', personId)
      .executeTakeFirst();
    expect(String(person.household_id)).toBe(String(target));
  });

  it('moves canvass knocks recorded at the source address, which the delete cascade would erase', async () => {
    const target = await addHousehold('12 Knock Rd');
    const source = await addHousehold('12 Knock Road');
    const turf = await addTurf('Knock Turf');
    const knockId = await addKnock(turf, source, 'supporter', 'Voting for us, wants a sign');

    await merge(target, source);

    const knock = await db
      .selectFrom('turf_knocks')
      .select(['household_id', 'outcome', 'notes'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', knockId)
      .executeTakeFirst();

    expect(knock, 'the knock was cascade-deleted with the source household').toBeDefined();
    expect(String(knock.household_id)).toBe(String(target));
    expect(knock.outcome).toBe('supporter');
    expect(knock.notes).toBe('Voting for us, wants a sign');
  });

  it('moves the source address into the turfs it was walked in', async () => {
    const target = await addHousehold('14 Walk Ave');
    const source = await addHousehold('14 Walk Avenue');
    const turf = await addTurf('Walk Turf');
    await addTurfDoor(turf, source, 7);

    await merge(target, source);

    const doors = await db
      .selectFrom('turf_households')
      .select(['turf_id', 'household_id', 'walk_order'])
      .where('tenant_id', '=', seed.tenantId)
      .where('turf_id', '=', turf)
      .execute();

    expect(doors).toHaveLength(1);
    expect(String(doors[0].household_id)).toBe(String(target));
    expect(doors[0].walk_order).toBe(7);
  });

  it('keeps the survivor’s own walk order when both households are doors in the same turf', async () => {
    const target = await addHousehold('16 Shared Ln');
    const source = await addHousehold('16 Shared Lane');
    const sharedTurf = await addTurf('Shared Turf');
    const otherTurf = await addTurf('Other Turf');
    await addTurfDoor(sharedTurf, target, 3);
    await addTurfDoor(sharedTurf, source, 9);
    await addTurfDoor(otherTurf, source, 4);

    // Without the collision handling this violates turf_households_pk.
    await merge(target, source);

    const shared = await db
      .selectFrom('turf_households')
      .select(['household_id', 'walk_order'])
      .where('tenant_id', '=', seed.tenantId)
      .where('turf_id', '=', sharedTurf)
      .execute();
    expect(shared).toHaveLength(1);
    expect(String(shared[0].household_id)).toBe(String(target));
    expect(shared[0].walk_order).toBe(3);

    const other = await db
      .selectFrom('turf_households')
      .select(['household_id', 'walk_order'])
      .where('tenant_id', '=', seed.tenantId)
      .where('turf_id', '=', otherTurf)
      .execute();
    expect(other).toHaveLength(1);
    expect(String(other[0].household_id)).toBe(String(target));
    expect(other[0].walk_order).toBe(4);
  });

  it('copies the source’s boundary-area rows onto the survivor, keeping the survivor’s row for a map both are on', async () => {
    const target = await addHousehold('18 Boundary Blvd');
    const source = await addHousehold('18 Boundary Boulevard');
    const sharedSet = await addBoundarySet(`shared-${rand()}`);
    const sourceOnlySet = await addBoundarySet(`source-only-${rand()}`);
    await addDistrict(target, sharedSet, 'Target Riding');
    await addDistrict(source, sharedSet, 'Source Riding');
    await addDistrict(source, sourceOnlySet, 'Ward 4');

    await merge(target, source);

    const rows = await db
      .selectFrom('household_districts')
      .select(['set_id', 'name'])
      .where('tenant_id', '=', seed.tenantId)
      .where('household_id', '=', target)
      .execute();
    const bySet = new Map(rows.map((r: { set_id: string; name: string }) => [String(r.set_id), r.name]));

    // The set the source alone was on is carried over; these names came from a spreadsheet
    // import and cannot be recomputed from any polygon.
    expect(bySet.get(String(sourceOnlySet))).toBe('Ward 4');
    // Where both had a row for the same map, the survivor's own row wins.
    expect(bySet.get(String(sharedSet))).toBe('Target Riding');

    const orphaned = await db
      .selectFrom('household_districts')
      .select('id')
      .where('tenant_id', '=', seed.tenantId)
      .where('household_id', '=', source)
      .execute();
    expect(orphaned).toHaveLength(0);
  });

  it('moves yard-sign requests that are not open, with their status untouched', async () => {
    const target = await addHousehold('20 Sign St');
    const source = await addHousehold('20 Sign Street');
    const deliveredId = await addDeliveryRequest(source, 'delivered', 'Sign is up');
    const openId = await addDeliveryRequest(source, 'new', 'Wants a sign');

    await merge(target, source);

    const rows = await db
      .selectFrom('delivery_requests')
      .select(['id', 'household_id', 'status', 'skip_reason'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    const byId = new Map(
      rows.map((r: { id: string; household_id: string; status: string; skip_reason: string | null }) => [
        String(r.id),
        r,
      ]),
    );

    expect(byId.size).toBe(2);
    expect(String(byId.get(deliveredId).household_id)).toBe(String(target));
    expect(byId.get(deliveredId).status).toBe('delivered');
    // The survivor had no open request, so the source's open one stays open under the survivor.
    expect(String(byId.get(openId).household_id)).toBe(String(target));
    expect(byId.get(openId).status).toBe('new');
    expect(byId.get(openId).skip_reason).toBeNull();
  });

  it('declines the source’s open yard-sign request when the survivor already has one open', async () => {
    const target = await addHousehold('22 Double Dr');
    const source = await addHousehold('22 Double Drive');
    const targetOpenId = await addDeliveryRequest(target, 'approved', 'Survivor request');
    const sourceOpenId = await addDeliveryRequest(source, 'new', 'Duplicate request');

    // Without the collision handling this violates uq_delivery_requests_open_per_household.
    await merge(target, source);

    const rows = await db
      .selectFrom('delivery_requests')
      .select(['id', 'household_id', 'status', 'skip_reason'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    const byId = new Map(
      rows.map((r: { id: string; household_id: string; status: string; skip_reason: string | null }) => [
        String(r.id),
        r,
      ]),
    );

    expect(byId.get(targetOpenId).status).toBe('approved');
    // The duplicate is kept as history, not deleted, and moves to the survivor.
    expect(byId.get(sourceOpenId).status).toBe('declined');
    expect(String(byId.get(sourceOpenId).skip_reason)).toContain('merged');
    expect(String(byId.get(sourceOpenId).household_id)).toBe(String(target));
  });

  it('moves tag links and does not duplicate a tag both households already carry', async () => {
    const target = await addHousehold('24 Tag Ter');
    const source = await addHousehold('24 Tag Terrace');
    const sharedTag = await addTag(`shared-${rand()}`);
    const sourceTag = await addTag(`source-only-${rand()}`);
    await addTagLink(target, sharedTag);
    await addTagLink(source, sharedTag);
    await addTagLink(source, sourceTag);

    await merge(target, source);

    const links = await db
      .selectFrom('map_households_tags')
      .select(['household_id', 'tag_id'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();

    expect(links.every((l: { household_id: string }) => String(l.household_id) === String(target))).toBe(true);
    const tagIds = links.map((l: { tag_id: string }) => String(l.tag_id)).sort();
    expect(tagIds).toEqual([String(sharedTag), String(sourceTag)].sort());
  });

  it('moves list memberships and does not duplicate a list both households are on', async () => {
    const target = await addHousehold('26 List Loop');
    const source = await addHousehold('26 List Lp');
    const sharedList = await addList(`Shared ${rand()}`);
    const sourceList = await addList(`Source only ${rand()}`);
    await addListMembership(target, sharedList);
    await addListMembership(source, sharedList);
    await addListMembership(source, sourceList);

    await merge(target, source);

    const rows = await db
      .selectFrom('map_lists_households')
      .select(['household_id', 'list_id'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();

    expect(rows.every((r: { household_id: string }) => String(r.household_id) === String(target))).toBe(true);
    const listIds = rows.map((r: { list_id: string }) => String(r.list_id)).sort();
    expect(listIds).toEqual([String(sharedList), String(sourceList)].sort());
  });

  describe('tenant scoping', () => {
    let otherSeed: Seed;

    beforeEach(async () => {
      otherSeed = await createSeed(db);
    });

    afterEach(async () => {
      await cleanTenant(db, otherSeed.tenantId);
    });

    it('refuses a merge whose household ids belong to a different workspace, changing nothing', async () => {
      const target = await addHousehold('28 Cross St');
      const source = await addHousehold('28 Cross Street');
      const turf = await addTurf('Cross Turf');
      const knockId = await addKnock(turf, source, 'supporter', 'Still ours');

      await expect(merge(target, source, otherSeed)).rejects.toThrow(/not found/i);

      const stillThere = await db
        .selectFrom('households')
        .select('id')
        .where('tenant_id', '=', seed.tenantId)
        .where('id', '=', source)
        .executeTakeFirst();
      expect(stillThere).toBeDefined();

      const knock = await db
        .selectFrom('turf_knocks')
        .select('household_id')
        .where('tenant_id', '=', seed.tenantId)
        .where('id', '=', knockId)
        .executeTakeFirst();
      expect(String(knock.household_id)).toBe(String(source));
    });

    it('leaves another workspace’s households and canvass history untouched', async () => {
      const target = await addHousehold('30 Local St');
      const source = await addHousehold('30 Local Street');

      const otherTarget = await addHousehold('30 Local St', otherSeed);
      const otherSource = await addHousehold('30 Local Street', otherSeed);
      const otherTurf = await addTurf('Other Workspace Turf', otherSeed);
      const otherKnockId = await addKnock(otherTurf, otherSource, 'undecided', 'Other workspace', otherSeed);

      await merge(target, source);

      const otherHouseholds = await db
        .selectFrom('households')
        .select('id')
        .where('tenant_id', '=', otherSeed.tenantId)
        .execute();
      expect(otherHouseholds.map((h: { id: string }) => String(h.id)).sort()).toEqual(
        [String(otherTarget), String(otherSource)].sort(),
      );

      const otherKnock = await db
        .selectFrom('turf_knocks')
        .select('household_id')
        .where('tenant_id', '=', otherSeed.tenantId)
        .where('id', '=', otherKnockId)
        .executeTakeFirst();
      expect(String(otherKnock.household_id)).toBe(String(otherSource));
    });
  });

  /**
   * Columns that name a household and are deliberately left alone by the merge. Each needs a
   * reason, because the default answer for a column that names a household is "move it".
   */
  const NOT_RE_POINTED: Record<string, string> = {
    'potential_duplicates.household_id':
      'Duplicate-detection scratch data, ON DELETE CASCADE on purpose. Every read of it in ' +
      'households.repo.ts inner-joins households and keeps only groups with more than one ' +
      'surviving member, so a merged-away household drops out of its group by itself and the ' +
      'group disappears when only one household is left. Carrying the row across would create a ' +
      'group where the same household appears twice.',
    'tenants.placeholder_household_id':
      'Not a household’s data — it is the workspace pointer to the holding pen for people with ' +
      'no address. HouseholdsController.mergeHouseholds refuses outright (BadRequestError) when ' +
      'either side of the merge is the placeholder, so the merge never runs against this column. ' +
      'The foreign key is ON DELETE SET NULL and nothing recreates the pointer, which is exactly ' +
      'why the controller blocks it instead of the repo handling it.',
  };

  it('fails when a new table names a household and the merge was not taught about it', async () => {
    // Two sources, because neither alone is enough:
    //
    //  - Column NAME, so a table that names a household without declaring a constraint is still
    //    caught (the same reason the persons version of this guard does not rely on constraints).
    //  - Foreign keys read from `pg_catalog`, so a reference under a different column name is
    //    caught too. This deliberately does NOT use `information_schema.constraint_column_usage`:
    //    that view only shows constraints on tables the current role owns, the specs connect as
    //    `pplcrm_app` while the tables are owned by `pplcrm_owner`, and it therefore returns zero
    //    rows here — a foreign-key clause written against it is silently dead.
    const byName = await sql<{ table_name: string; column_name: string }>`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
         AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public'
         AND c.column_name LIKE '%household_id'
       ORDER BY 1, 2
    `.execute(db);

    const byForeignKey = await sql<{ table_name: string; column_name: string }>`
      SELECT child.relname AS table_name, att.attname AS column_name
        FROM pg_constraint con
        JOIN pg_class child ON child.oid = con.conrelid
        JOIN pg_class parent ON parent.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = child.relnamespace
        JOIN unnest(con.conkey) AS k(attnum) ON true
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.contype = 'f'
         AND ns.nspname = 'public'
         AND parent.relname = 'households'
         AND child.relname <> 'households'
       ORDER BY 1, 2
    `.execute(db);

    // A half that silently matches nothing is not a guard, so assert each one found something
    // before trusting the combined list.
    expect(byName.rows.length, 'no column named like %household_id was found at all').toBeGreaterThan(0);
    expect(byForeignKey.rows.length, 'no foreign key to households(id) was found at all').toBeGreaterThan(0);

    const columns = {
      rows: [...new Set([...byName.rows, ...byForeignKey.rows].map((r) => `${r.table_name}.${r.column_name}`))]
        .sort()
        .map((key) => {
          const [table_name, column_name] = key.split('.');
          return { table_name, column_name };
        }),
    };

    const source = readFileSync(join(__dirname, 'households.repo.ts'), 'utf8');
    const markerIndex = source.indexOf('public async mergeHouseholds');
    expect(markerIndex, 'mergeHouseholds was renamed — this guard test can no longer find it').toBeGreaterThan(-1);
    const mergeBody = source.slice(markerIndex);

    const unhandled = columns.rows
      .filter((row) => {
        if (NOT_RE_POINTED[`${row.table_name}.${row.column_name}`]) return false;
        // household_districts is written with a raw `INSERT INTO household_districts`, so an
        // unquoted match is required as well as the quoted Kysely table names.
        return !new RegExp(`(?<![a-z_])${row.table_name}(?![a-z_])`).test(mergeBody);
      })
      .map((row) => `${row.table_name}.${row.column_name}`);

    expect(
      unhandled,
      [
        `These columns name a household but mergeHouseholds() never mentions their table:`,
        `  ${unhandled.join('\n  ')}`,
        ``,
        `Merging two households deletes the source household row, so each of these is either`,
        `cascade-deleted with it, set to null, or (with no foreign key) left pointing at a row`,
        `that no longer exists. Pick one and do it in`,
        `apps/backend/src/app/modules/households/repositories/households.repo.ts:`,
        ``,
        `  1. No per-household uniqueness -> add a plain UPDATE ... SET <col> = target alongside`,
        `     persons/turf_knocks.`,
        `  2. Unique or primary key includes the household -> follow turf_households or`,
        `     delivery_requests: decide which row survives a collision, drop or close the other,`,
        `     then move the rest.`,
        `  3. Genuinely fine to lose -> add it to NOT_RE_POINTED in this file WITH the reason,`,
        `     the way potential_duplicates.household_id is documented.`,
        ``,
        `Every statement must carry .where('tenant_id', ...) and stay inside the merge`,
        `transaction. Add a case to this spec file for whichever branch you picked.`,
      ].join('\n'),
    ).toEqual([]);
  });
});
