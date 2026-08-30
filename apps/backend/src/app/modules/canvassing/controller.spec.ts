import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoverageRequestType, IAuthKeyPayload } from '@common';
import { COVERAGE_MAX_DOORS } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { purgeCanvassPingsForTenant } from '../../lib/jobs/handlers/canvass-live.handlers';
import { hashToken } from '../../lib/token-hash';
import { CanvassingController, type CoverageFull } from './controller';
import { resolveTurfBoundary } from './lib/turf-boundary';

type Db = typeof BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  userId: string;
  campaignId: string;
  listId: string;
  /** The boundary map the seeded doors' area rows point at. */
  boundarySetId: string;
  householdIds: string[];
  /** The volunteer the Companion link is assigned to (not a list member). */
  volunteerPersonId: string;
  /** A second volunteer, for the group-canvassing tests. */
  volunteer2PersonId: string;
  /** Residents of householdIds[0], for person-level survey tests. */
  residentIds: string[];
}

/**
 * Seed a tenant plus a static household list of geocoded doors spread across two boundary areas.
 *
 * The areas come from a `boundary_sets` row and one `household_districts` row per household, which
 * is where the turf cutter reads them from. `households.ward` is not written at all — it is the
 * column this change stopped using.
 */
async function seed(db: Db, opts: { geocoded: number; ungeocoded: number }): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const listId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Canvass Test' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `t-${userId}@example.com`,
      password: 'x',
      first_name: 'T',
      last_name: 'U',
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
      name: 'C',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();
  await db
    .insertInto('lists')
    .values({
      id: listId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Persuasion universe',
      object: 'households',
      is_dynamic: false,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // The map the turfs are cut against. `jurisdiction: 'other'` and a null region match the seeded
  // campaign, which declares no office — the default every campaign that predates jurisdictions
  // has. Role 'subdivision' is what the resolver prefers.
  //
  // `boundary_sets.id` is GENERATED ALWAYS, so unlike the older tables in this seed it cannot be
  // given an id; the generated one is read back instead.
  const boundarySet = await db
    .insertInto('boundary_sets')
    .values({
      tenant_id: tenantId,
      slug: `test-areas-${rand()}`,
      label: 'Test areas',
      jurisdiction: 'other',
      role: 'subdivision',
      source: 'drawn',
      feature_count: 2,
      createdby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const boundarySetId = String(boundarySet.id);

  const householdIds: string[] = [];
  for (let i = 0; i < opts.geocoded; i++) {
    const hid = rand();
    householdIds.push(hid);
    await db
      .insertInto('households')
      .values({
        id: hid,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
        street_num: String(100 + i),
        street1: 'Main St',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        lat: 41.85 + (i % 8) * 0.001,
        lng: -87.69 + Math.floor(i / 8) * 0.001,
        geocoding_status: 'success',
      })
      .execute();
    await db
      .insertInto('household_districts')
      .values({
        tenant_id: tenantId,
        household_id: hid,
        set_id: boundarySetId,
        name: i % 2 === 0 ? 'W1' : 'W2',
      })
      .execute();
    await db
      .insertInto('map_lists_households')
      .values({ tenant_id: tenantId, list_id: listId, household_id: hid, createdby_id: userId, updatedby_id: userId })
      .execute();
  }
  for (let i = 0; i < opts.ungeocoded; i++) {
    const hid = rand();
    householdIds.push(hid);
    await db
      .insertInto('households')
      .values({ id: hid, tenant_id: tenantId, campaign_id: campaignId, createdby_id: userId, updatedby_id: userId })
      .execute();
    await db
      .insertInto('map_lists_households')
      .values({ tenant_id: tenantId, list_id: listId, household_id: hid, createdby_id: userId, updatedby_id: userId })
      .execute();
  }

  // The volunteer holding the Companion link (own household, not in the list).
  const volunteerHouseholdId = rand();
  const volunteerPersonId = rand();
  await db
    .insertInto('households')
    .values({
      id: volunteerHouseholdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('persons')
    .values({
      id: volunteerPersonId,
      tenant_id: tenantId,
      household_id: volunteerHouseholdId,
      first_name: 'Sam',
      last_name: 'Volunteer',
      email: 'sam@example.com',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // A second volunteer, so a turf can be walked by more than one person.
  const volunteer2PersonId = rand();
  await db
    .insertInto('persons')
    .values({
      id: volunteer2PersonId,
      tenant_id: tenantId,
      household_id: volunteerHouseholdId,
      first_name: 'Riya',
      last_name: 'Volunteer',
      email: 'riya@example.com',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // Two residents at the first door, for person-level survey tests.
  const residentIds: string[] = [];
  for (const [first, last] of [
    ['Alice', 'Door'],
    ['Bob', 'Door'],
  ] as const) {
    const pid = rand();
    residentIds.push(pid);
    await db
      .insertInto('persons')
      .values({
        id: pid,
        tenant_id: tenantId,
        household_id: householdIds[0]!,
        first_name: first,
        last_name: last,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  }

  return {
    tenantId,
    userId,
    campaignId,
    listId,
    boundarySetId,
    householdIds,
    volunteerPersonId,
    volunteer2PersonId,
    residentIds,
  };
}

/**
 * A geocoded household added to the universe list after a cut — the "new list member" every
 * refresh test needs. `area` files it in a named area of the seeded map; null leaves it with no
 * `household_districts` row, which is what "outside every area" means to the matcher.
 */
async function addListedHousehold(db: Db, s: Seed, opts: { area: string | null }): Promise<string> {
  const hid = rand();
  await db
    .insertInto('households')
    .values({
      id: hid,
      tenant_id: s.tenantId,
      campaign_id: s.campaignId,
      createdby_id: s.userId,
      updatedby_id: s.userId,
      street_num: '900',
      street1: 'New St',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      lat: 41.86,
      lng: -87.7,
      geocoding_status: 'success',
    })
    .execute();
  if (opts.area != null) {
    await db
      .insertInto('household_districts')
      .values({ tenant_id: s.tenantId, household_id: hid, set_id: s.boundarySetId, name: opts.area })
      .execute();
  }
  await db
    .insertInto('map_lists_households')
    .values({
      tenant_id: s.tenantId,
      list_id: s.listId,
      household_id: hid,
      createdby_id: s.userId,
      updatedby_id: s.userId,
    })
    .execute();
  return hid;
}

/** The household ids currently on one turf. */
async function doorsOf(db: Db, tenantId: string, turfId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('turf_households')
    .select('household_id')
    .where('tenant_id', '=', tenantId)
    .where('turf_id', '=', turfId)
    .execute();
  return rows.map((r) => String(r.household_id));
}

/**
 * Fabricate an approved companion volunteer + device session directly — these
 * tests exercise the canvassing surface; the verify/approve journey itself is
 * covered by companion-access/controller.spec.ts.
 */
async function mintApprovedSession(db: Db, tenantId: string, personId: string, userId: string): Promise<string> {
  await db
    .insertInto('companion_volunteers')
    .values({
      tenant_id: tenantId,
      person_id: personId,
      status: 'approved',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'person_id']).doNothing())
    .execute();
  const volunteer = await db
    .selectFrom('companion_volunteers')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('person_id', '=', personId)
    .executeTakeFirstOrThrow();
  const raw = `test-session-${rand()}`;
  await db
    .insertInto('companion_sessions')
    .values({
      tenant_id: tenantId,
      volunteer_id: String(volunteer.id),
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .execute();
  return raw;
}

/** Set the workspace roam policy the way the Settings page would. */
async function setRoamPolicy(db: Db, tenantId: string, userId: string, value: 'assigned' | 'campaign'): Promise<void> {
  // settings.value is jsonb, so the string has to arrive JSON-encoded ("campaign", not campaign).
  const json = JSON.stringify(value);
  await db
    .insertInto('settings')
    .values({
      tenant_id: tenantId,
      key: 'app.canvass_volunteer_roam',
      value: json,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'key']).doUpdateSet({ value: json }))
    .execute();
}

/** The per-volunteer override; null hands them back to the workspace setting. */
async function setVolunteerRoam(db: Db, tenantId: string, personId: string, canRoam: boolean | null): Promise<void> {
  await db
    .updateTable('companion_volunteers')
    .set({ can_roam: canRoam })
    .where('tenant_id', '=', tenantId)
    .where('person_id', '=', personId)
    .execute();
}

async function cleanup(db: Db, tenantId: string): Promise<void> {
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_ops').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_sessions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_volunteers').where('tenant_id', '=', tenantId).execute();
  // Stops reference both a route and a request, so they go before either of them.
  await db.deleteFrom('delivery_route_stops').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_routes').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_requests').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_person_facts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  // "Error in data" at the door opens a review task assigned to a real user, so tasks
  // have to go before persons and authusers or the teardown trips their foreign keys.
  await db.deleteFrom('tasks').where('tenant_id', '=', tenantId).execute();
  // Pings reference their shift, so they go first.
  await db.deleteFrom('canvass_location_pings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('canvass_shifts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_knocks').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_segment_claims').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_assignments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turfs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  // The boundary map the turfs were cut against: the per-household rows reference both the
  // household and the set, so they go before either.
  await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('CanvassingController', () => {
  const controller = new CanvassingController();
  const db = BaseRepository.dbInstance;
  let s: Seed;
  let auth: IAuthKeyPayload;

  beforeEach(async () => {
    s = await seed(db, { geocoded: 40, ungeocoded: 3 });
    auth = { tenant_id: s.tenantId, user_id: s.userId, name: 'T U', session_id: 'sess' };
  });

  afterEach(async () => {
    await cleanup(db, s.tenantId);
  });

  /**
   * Coverage as asked for with no rectangle — the answer that carries the turf outlines, the
   * by-area roll-up, the workspace door total and the area word. A request that carries a
   * rectangle deliberately carries none of those, so a test wanting them has to say so.
   */
  async function fullCoverage(input: CoverageRequestType): Promise<CoverageFull> {
    const cov = await controller.getCoverage(auth, input);
    if (cov.doors_only) throw new Error('expected the full coverage answer, not a doors-only one');
    return cov;
  }

  it('previews a cut with math that matches the engine, reporting unplaced doors', async () => {
    const preview = await controller.previewCut(auth, { list_id: s.listId, doors_per_turf: 20 });
    expect(preview.doors).toBe(40);
    expect(preview.unplaced).toBe(3);
    expect(preview.turfCount).toBeGreaterThanOrEqual(2);
    expect(preview.avgDoorsPerTurf).toBeGreaterThan(0);
    // The seeded map applies to this campaign, so the preview promises a bounded cut.
    expect(preview.bounded).toBe(true);
  });

  it('cuts turfs (draft, unassigned) with doors, never crossing a boundary', async () => {
    const res = await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    expect(res.created).toBeGreaterThanOrEqual(2);
    expect(res.unplaced).toBe(3);

    const turfs = await controller.getTurfs(auth);
    expect(turfs.length).toBe(res.created);
    for (const t of turfs) {
      expect(t.status).toBe('draft');
      expect(t.canvassers).toEqual([]);
      expect(t.door_count).toBeGreaterThan(0);
      expect(['W1', 'W2', null]).toContain(t.boundary_name);
    }
    // Every geocoded door placed exactly once across turfs.
    const total = turfs.reduce((n, t) => n + t.door_count, 0);
    expect(total).toBe(40);
  });

  it('renames a turf everywhere it is read, without disturbing its doors or its links', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');

    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    // Snapshot AFTER the assignment: putting a canvasser on a turf legitimately moves its
    // display status, so comparing against the pre-assign shape would blame the rename.
    const before = await controller.getTurfDetail(auth, turf.id);

    await controller.updateTurf(auth, turf.id, { name: 'North of Elm' });

    // The staff surfaces and the link a volunteer is already holding all read the new
    // name — a rename that only landed on the list would leave canvassers on the old one.
    const renamed = (await controller.getTurfs(auth)).find((t) => t.id === turf.id);
    expect(renamed?.name).toBe('North of Elm');
    const detail = await controller.getTurfDetail(auth, turf.id);
    expect(detail.name).toBe('North of Elm');
    expect(detail.door_count).toBe(before.door_count);
    expect(detail.status).toBe(before.status);
    expect(detail.canvassers.map((c) => c.name)).toEqual(before.canvassers.map((c) => c.name));
    const payload = await controller.getCompanionTurf(token, session);
    expect(payload.turf_name).toBe('North of Elm');

    await expect(controller.updateTurf(auth, rand(), { name: 'Nowhere' })).rejects.toThrow(/not found/i);
  });

  it('puts several volunteers on one turf, each with their own working link', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    // Turfs never cross a boundary, so the cut yields more than one; hold on to the
    // shape before assigning so the roster can be shown not to disturb it.
    const before = await controller.getTurfs(auth);
    const [turf] = before;
    if (!turf) throw new Error('expected a turf');

    const first = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const second = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteer2PersonId,
    });

    // The second assignment must NOT evict the first — that was the old behavior.
    const sessionA = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const sessionB = await mintApprovedSession(db, s.tenantId, s.volunteer2PersonId, s.userId);
    const payloadA = await controller.getCompanionTurf(first.token, sessionA);
    const payloadB = await controller.getCompanionTurf(second.token, sessionB);
    expect(payloadA.canvasser_name).toBe('Sam Volunteer');
    expect(payloadB.canvasser_name).toBe('Riya Volunteer');
    // Both walk the same doors.
    expect(payloadA.households.length).toBe(payloadB.households.length);

    const roster = await controller.getTurfCanvassers(auth, turf.id);
    expect(roster.map((c) => c.name).sort()).toEqual(['Riya Volunteer', 'Sam Volunteer']);

    const after = await controller.getTurfs(auth);
    const listed = after.find((t) => t.id === turf.id);
    expect(listed?.canvassers.length).toBe(2);
    expect(listed?.has_link).toBe(true);
    // Two volunteers on a turf must not fan the list out into a row per volunteer,
    // nor multiply the door count hanging off it.
    expect(after.length).toBe(before.length);
    expect(listed?.door_count).toBe(turf.door_count);
  });

  describe('advisory street claims', () => {
    /** One turf with both volunteers on it, and a session each. */
    async function turfWithTwoCanvassers(): Promise<{ turfId: string; sessionA: string; sessionB: string }> {
      await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
      const [turf] = await controller.getTurfs(auth);
      if (!turf) throw new Error('expected a turf');
      for (const personId of [s.volunteerPersonId, s.volunteer2PersonId]) {
        await controller.assignTurf(auth, { turf_id: turf.id, team_id: null, volunteer_person_id: personId });
      }
      return {
        turfId: turf.id,
        sessionA: await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId),
        sessionB: await mintApprovedSession(db, s.tenantId, s.volunteer2PersonId, s.userId),
      };
    }

    it('shows one volunteer’s street to the other, flagged as theirs and not mine', async () => {
      const { turfId, sessionA, sessionB } = await turfWithTwoCanvassers();

      await controller.claimSegment(sessionA, turfId, { street_key: 'scott blvd', street: 'Scott Blvd' });

      const mine = await controller.getCompanionTurfBySession(sessionA, turfId);
      expect(mine.segment_claims).toEqual([
        expect.objectContaining({ street_key: 'scott blvd', street: 'Scott Blvd', mine: true }),
      ]);
      const theirs = await controller.getCompanionTurfBySession(sessionB, turfId);
      expect(theirs.segment_claims[0]).toMatchObject({ canvasser_name: 'Sam Volunteer', mine: false });
    });

    it('never blocks the other volunteer from taking the same street', async () => {
      const { turfId, sessionA, sessionB } = await turfWithTwoCanvassers();
      await controller.claimSegment(sessionA, turfId, { street_key: 'scott blvd', street: 'Scott Blvd' });

      // Two people deciding to work one street together is their call, not the app's.
      await expect(
        controller.claimSegment(sessionB, turfId, { street_key: 'scott blvd', street: 'Scott Blvd' }),
      ).resolves.toEqual({ ok: true });
      const payload = await controller.getCompanionTurfBySession(sessionA, turfId);
      expect(payload.segment_claims).toHaveLength(2);
    });

    it('replaces a volunteer’s own claim rather than stacking them up', async () => {
      const { turfId, sessionA } = await turfWithTwoCanvassers();
      await controller.claimSegment(sessionA, turfId, { street_key: 'scott blvd', street: 'Scott Blvd' });
      await controller.claimSegment(sessionA, turfId, { street_key: 'alder st', street: 'Alder St' });

      const payload = await controller.getCompanionTurfBySession(sessionA, turfId);
      // Nobody is standing in two places.
      expect(payload.segment_claims.map((c) => c.street_key)).toEqual(['alder st']);
    });

    it('releases the street on a null key and drops expired claims', async () => {
      const { turfId, sessionA } = await turfWithTwoCanvassers();
      await controller.claimSegment(sessionA, turfId, { street_key: 'scott blvd', street: 'Scott Blvd' });
      await controller.claimSegment(sessionA, turfId, { street_key: null });
      expect((await controller.getCompanionTurfBySession(sessionA, turfId)).segment_claims).toEqual([]);

      await controller.claimSegment(sessionA, turfId, { street_key: 'alder st', street: 'Alder St' });
      await db
        .updateTable('turf_segment_claims')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('tenant_id', '=', s.tenantId)
        .execute();
      // A phone that went into a pocket must not tell tomorrow's group a street is taken.
      expect((await controller.getCompanionTurfBySession(sessionA, turfId)).segment_claims).toEqual([]);
    });

    it('refuses a claim from someone who is not on the turf', async () => {
      const { turfId } = await turfWithTwoCanvassers();
      await controller.removeVolunteerFromTurf(auth, { turf_id: turfId, volunteer_person_id: s.volunteer2PersonId });
      const stranger = await mintApprovedSession(db, s.tenantId, s.volunteer2PersonId, s.userId);

      await expect(
        controller.claimSegment(stranger, turfId, { street_key: 'scott blvd', street: 'Scott Blvd' }),
      ).rejects.toThrow(/not on this turf/i);
    });
  });

  it('removes one canvasser without disturbing the rest of the roster', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');

    const stays = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const goes = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteer2PersonId,
    });

    await controller.removeVolunteerFromTurf(auth, {
      turf_id: turf.id,
      volunteer_person_id: s.volunteer2PersonId,
    });

    const staysSession = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const goesSession = await mintApprovedSession(db, s.tenantId, s.volunteer2PersonId, s.userId);
    // The one who stayed is unaffected; the removed one's link is dead.
    await expect(controller.getCompanionTurf(stays.token, staysSession)).resolves.toBeTruthy();
    await expect(controller.getCompanionTurf(goes.token, goesSession)).rejects.toThrow();

    const roster = await controller.getTurfCanvassers(auth, turf.id);
    expect(roster.map((c) => c.name)).toEqual(['Sam Volunteer']);

    // Removing someone who is not on the turf is a clear error, not a silent no-op.
    await expect(
      controller.removeVolunteerFromTurf(auth, { turf_id: turf.id, volunteer_person_id: s.volunteer2PersonId }),
    ).rejects.toThrow();
  });

  it('reports a turf with nobody on it as draft rather than claiming it is assigned', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');

    await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    expect((await controller.getTurfs(auth))[0]?.status).toBe('assigned');

    await controller.removeVolunteerFromTurf(auth, {
      turf_id: turf.id,
      volunteer_person_id: s.volunteerPersonId,
    });
    const after = (await controller.getTurfs(auth))[0];
    expect(after?.status).toBe('draft');
    expect(after?.has_link).toBe(false);
  });

  it('re-assigning the same volunteer rotates their link instead of adding a second one', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');

    const original = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const reissued = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    expect(reissued.token).not.toBe(original.token);

    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    await expect(controller.getCompanionTurf(original.token, session)).rejects.toThrow();
    await expect(controller.getCompanionTurf(reissued.token, session)).resolves.toBeTruthy();
    expect(await controller.getTurfCanvassers(auth, turf.id)).toHaveLength(1);
  });

  it('lets a volunteer switch to another turf they are on, without any link', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const turfs = await controller.getTurfs(auth);
    const [first, second] = turfs;
    if (!first || !second) throw new Error('expected two turfs');

    for (const t of [first, second]) {
      await controller.assignTurf(auth, {
        turf_id: t.id,
        team_id: null,
        volunteer_person_id: s.volunteerPersonId,
      });
    }
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);

    const choices = await controller.getMyTurfs(session);
    expect(choices.mine.map((t) => t.turf_id).sort()).toEqual([first.id, second.id].sort());

    // Session + turf id is enough — the tokens are hashed and never handed back.
    const payload = await controller.getCompanionTurfBySession(session, second.id);
    expect(payload.turf_id).toBe(second.id);
    expect(payload.turf_name).toBe(second.name);
  });

  it('refuses a session-first request for a turf the volunteer is not on', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const turfs = await controller.getTurfs(auth);
    const [mine, theirs] = turfs;
    if (!mine || !theirs) throw new Error('expected two turfs');

    await controller.assignTurf(auth, {
      turf_id: mine.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);

    await expect(controller.getCompanionTurfBySession(session, theirs.id)).rejects.toThrow();
    await expect(controller.postCompanionResultsBySession(session, theirs.id, [])).rejects.toThrow();
  });

  it('offers claimable turfs and self-claims one when the workspace allows roaming', async () => {
    await setRoamPolicy(db, s.tenantId, s.userId, 'campaign');
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const turfs = await controller.getTurfs(auth);
    const [start, target] = turfs;
    if (!start || !target) throw new Error('expected two turfs');

    // Placed once first: a volunteer who already works a campaign roams inside it, and
    // nowhere else. (The never-placed case is the test above.)
    await controller.assignTurf(auth, {
      turf_id: start.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);

    const before = await controller.getMyTurfs(session);
    expect(before.may_roam).toBe(true);
    expect(before.available.map((t) => t.turf_id)).toContain(target.id);

    await controller.claimTurf(session, target.id);
    const after = await controller.getMyTurfs(session);
    expect(after.mine.map((t) => t.turf_id).sort()).toEqual([start.id, target.id].sort());
    // Claiming twice is not an error — a double tap on a slow connection is not a failure.
    await expect(controller.claimTurf(session, target.id)).resolves.toEqual({ turf_id: target.id });
    expect(await controller.getTurfCanvassers(auth, target.id)).toHaveLength(1);
  });

  it('lets a roaming volunteer with no assignment yet start from any active campaign', async () => {
    await setRoamPolicy(db, s.tenantId, s.userId, 'campaign');
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const turfs = await controller.getTurfs(auth);
    const [target] = turfs;
    if (!target) throw new Error('expected a turf');

    // Approved, verified, and never placed on anything by hand — the case an organizer
    // who turned roaming on expects to work without also assigning a first turf.
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);

    const choices = await controller.getMyTurfs(session);
    expect(choices.mine).toEqual([]);
    expect(choices.available.map((t) => t.turf_id)).toContain(target.id);
    expect(choices.available[0]?.campaign_name).toBeTruthy();

    // And the picker never lists what self-claim would refuse.
    await expect(controller.claimTurf(session, target.id)).resolves.toEqual({ turf_id: target.id });
    expect((await controller.getMyTurfs(session)).mine.map((t) => t.turf_id)).toEqual([target.id]);
  });

  it('refuses self-claim server-side when the workspace assigns turfs by hand', async () => {
    await setRoamPolicy(db, s.tenantId, s.userId, 'assigned');
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const turfs = await controller.getTurfs(auth);
    const [start, target] = turfs;
    if (!start || !target) throw new Error('expected two turfs');

    await controller.assignTurf(auth, {
      turf_id: start.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);

    const choices = await controller.getMyTurfs(session);
    expect(choices.may_roam).toBe(false);
    // Not merely hidden from the picker — the endpoint refuses.
    expect(choices.available).toEqual([]);
    await expect(controller.claimTurf(session, target.id)).rejects.toThrow();
  });

  it('lets a per-volunteer override beat the workspace roam setting, both ways', async () => {
    await setRoamPolicy(db, s.tenantId, s.userId, 'assigned');
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const turfs = await controller.getTurfs(auth);
    const [start, target] = turfs;
    if (!start || !target) throw new Error('expected two turfs');

    await controller.assignTurf(auth, {
      turf_id: start.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);

    // Trusted individually, inside a workspace that otherwise assigns by hand.
    await setVolunteerRoam(db, s.tenantId, s.volunteerPersonId, true);
    expect((await controller.getMyTurfs(session)).may_roam).toBe(true);
    await expect(controller.claimTurf(session, target.id)).resolves.toEqual({ turf_id: target.id });

    // And the reverse: pinned individually inside a roaming workspace.
    await setRoamPolicy(db, s.tenantId, s.userId, 'campaign');
    await setVolunteerRoam(db, s.tenantId, s.volunteerPersonId, false);
    expect((await controller.getMyTurfs(session)).may_roam).toBe(false);
  });

  it('assigns a turf to a volunteer, exposes the spec-§3 payload to a verified session, and syncs results', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');

    const { token, sent } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    expect(token.length).toBeGreaterThan(10);

    // Assignment sends the personal link — the volunteer has an email on file (no mobile).
    expect(sent).toEqual({ email: true, sms: false });
    const jobs = await db.selectFrom('background_jobs').select('payload').where('tenant_id', '=', s.tenantId).execute();
    const linkMail = jobs
      .map((j) => (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload))
      .find((p) => p?.type === 'send-transactional-email' && String(p?.to) === 'sam@example.com');
    expect(linkMail).toBeTruthy();
    expect(String(linkMail?.text)).toContain(`/t/${token}`);

    // No session → the access layer blocks the payload.
    await expect(controller.getCompanionTurf(token, null)).rejects.toThrow();

    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    expect(companion.turf_name).toBe(turf.name);
    expect(companion.canvasser_name).toBe('Sam Volunteer');
    expect(companion.households.length).toBe(turf.door_count);
    // Walk order is 1..N and the list arrives in that order.
    expect(companion.households.map((h) => h.walk_order)).toEqual(companion.households.map((_, i) => i + 1));
    // Payload minimization (spec §2): no emails/phones/notes anywhere.
    const json = JSON.stringify(companion);
    expect(json).not.toMatch(/@example\.com/);
    expect(json).not.toContain('notes');

    // Survey a resident through the batched ops endpoint.
    const home = companion.households.find((h) => h.people.length > 0);
    if (!home) throw new Error('expected a door with residents');
    const resident = home.people[0]!;
    const { acks } = await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-survey-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: resident.id,
          support: 'supporter',
          issues: ['Housing'],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          subscribe: false,
        },
      },
    ]);
    expect(acks[0]?.status).toBe('applied');

    // Re-sending the SAME op (offline re-sync) acks duplicate and applies once.
    const again = await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-survey-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: resident.id,
          support: 'supporter',
          issues: ['Housing'],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          subscribe: false,
        },
      },
    ]);
    expect(again.acks[0]?.status).toBe('duplicate');
    const knockRows = await db.selectFrom('turf_knocks').select('id').where('tenant_id', '=', s.tenantId).execute();
    expect(knockRows.length).toBe(1);

    const after = await controller.getTurfs(auth);
    const updated = after.find((t) => t.id === turf.id);
    expect(updated?.attempted).toBe(1);
    expect(updated?.conversations).toBe(1);
    expect(updated?.status).toBe('in_field');

    // Support fact written for the turf's campaign.
    const fact = await db
      .selectFrom('campaign_person_facts')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('person_id', '=', resident.id)
      .executeTakeFirst();
    expect(fact?.support_level).toBe('strong');
    expect(fact?.support_source).toBe('canvass');

    // Honest attribution: activity under the real deployer, via the volunteer's name.
    const activity = await db
      .selectFrom('user_activity')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('entity', '=', 'household')
      .execute();
    expect(activity.length).toBe(1);
    expect(String(activity[0]?.createdby_id)).toBe(s.userId);
    expect(JSON.stringify(activity[0]?.metadata)).toContain('Sam Volunteer');

    // The re-loaded payload pre-fills the surveyed resident (result + survey, no notes).
    const reload = await controller.getCompanionTurf(token, session);
    const reloadedPerson = reload.households.find((h) => h.id === home.id)?.people.find((p) => p.id === resident.id);
    expect(reloadedPerson?.result).toBe('canvassed');
    expect(reloadedPerson?.survey?.support).toBe('supporter');
    expect(reloadedPerson?.survey?.issues).toEqual(['Housing']);

    // …and tells the next volunteer at that door who was here and when.
    const reloadedDoor = reload.households.find((h) => h.id === home.id);
    expect(reloadedDoor?.last_knock?.canvasser_name).toBe('Sam Volunteer');
    expect(reloadedDoor?.last_knock?.conversation).toBe(true);
    expect(Date.parse(String(reloadedDoor?.last_knock?.at))).toBeLessThanOrEqual(Date.now());
    // A door nobody has been to has nothing to say about it.
    expect(reload.households.find((h) => h.id !== home.id)?.last_knock).toBeNull();
  });

  it('applies survey side-effects: yard sign intake, DNC, contact fill-if-blank, subscribe, volunteer tag', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    const home = companion.households.find((h) => h.people.length > 0);
    if (!home) throw new Error('expected a door with residents');
    const [alice, bob] = home.people;

    const { acks } = await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-fx-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: alice!.id,
          support: 'supporter',
          issues: ['Housing', 'Transit'],
          wants_volunteer: true,
          wants_yard_sign: true,
          set_dnc: false,
          contact_phone: '(613) 555-0100',
          contact_email: 'alice@newmail.test',
          subscribe: true,
        },
      },
      {
        op_id: 'op-fx-2',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: bob!.id,
          support: null,
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: true,
          subscribe: false,
        },
      },
    ]);
    expect(acks.map((a) => a.status)).toEqual(['applied', 'applied']);

    // Yard sign → a canvass-sourced delivery request in the intake pool.
    const request = await db
      .selectFrom('delivery_requests')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', home.id)
      .executeTakeFirst();
    expect(request?.source).toBe('canvass');
    expect(request?.status).toBe('new');

    // A second yard-sign survey at the same door doesn't duplicate the open request.
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-fx-3',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: alice!.id,
          support: 'supporter',
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: true,
          set_dnc: false,
          subscribe: false,
        },
      },
    ]);
    const requests = await db
      .selectFrom('delivery_requests')
      .select('id')
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', home.id)
      .execute();
    expect(requests.length).toBe(1);

    // Contact capture fills blanks only; subscribe wrote canvass-sourced consent.
    const alicePerson = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', alice!.id)
      .executeTakeFirstOrThrow();
    expect(alicePerson.mobile).toBe('(613) 555-0100');
    expect(alicePerson.email).toBe('alice@newmail.test');
    const sub = await db
      .selectFrom('campaign_subscriptions')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('person_id', '=', alice!.id)
      .executeTakeFirst();
    expect(sub?.status).toBe('subscribed');
    expect(sub?.consent_source).toBe('canvass');

    // "Wants to volunteer" sets first-class volunteer standing (§15), not a tag.
    const volunteerRow = await db
      .selectFrom('persons')
      .select('volunteer_status')
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', alice!.id)
      .executeTakeFirst();
    expect(volunteerRow?.volunteer_status).toBe('prospective');

    // DNC-only save (no support level) is allowed and flips the person flag.
    const bobPerson = await db
      .selectFrom('persons')
      .select('do_not_contact')
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', bob!.id)
      .executeTakeFirstOrThrow();
    expect(bobPerson.do_not_contact).toBe(true);
  });

  it('carries prior ID, unit and yard-sign standing out to the walk list', async () => {
    // A walk list is useful on its first morning only if it shows what the CRM already
    // knows — otherwise every door reads "no ID" until your own team has knocked it.
    const [alice] = s.residentIds;
    await db
      .insertInto('campaign_person_facts')
      .values({
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        person_id: alice!,
        support_level: 'leaning',
        voting_status: 'voted_advance',
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .execute();
    await db
      .updateTable('households')
      .set({ apt: '302' })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.householdIds[0]!)
      .execute();
    await db
      .insertInto('delivery_requests')
      .values({
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        household_id: s.householdIds[0]!,
        source: 'manual',
        status: 'new',
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .execute();

    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const turf = (await controller.getTurfs(auth)).find((t) => t.door_count > 0);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);

    const home = companion.households.find((h) => h.id === s.householdIds[0]);
    if (!home) throw new Error('expected the seeded door');
    expect(home.apt).toBe('302');
    // Bare digits get "Unit" in front so 302 cannot read as part of the street number.
    expect(home.address).toContain('Unit 302');
    expect(home.yard_sign?.status).toBe('requested');
    const person = home.people.find((p) => p.id === alice);
    expect(person?.support).toBe('leaning');
    expect(person?.voting_status).toBe('voted_advance');
    expect(person?.last_name).toBe('Door');
    // Still payload-minimized: prior ID widened the payload, contact details did not.
    expect(JSON.stringify(companion)).not.toMatch(/@example\.com/);
  });

  it('a canvasser delivering the sign closes the driver’s stop, and undo puts both back', async () => {
    const householdId = s.householdIds[0]!;
    const request = await db
      .insertInto('delivery_requests')
      .values({
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        household_id: householdId,
        source: 'manual',
        status: 'approved',
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    // A driver is already routed to this house — the case the whole feature exists to stop.
    const route = await db
      .insertInto('delivery_routes')
      .values({
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        name: 'Saturday run',
        status: 'assigned',
        start_address: '1 Campaign HQ, Ottawa',
        start_lat: 45.42,
        start_lng: -75.69,
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const stop = await db
      .insertInto('delivery_route_stops')
      .values({
        tenant_id: s.tenantId,
        route_id: String(route.id),
        request_id: String(request.id),
        seq: 1,
        status: 'pending',
        createdby_id: s.userId,
        updatedby_id: s.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const turf = (await controller.getTurfs(auth)).find((t) => t.door_count > 0);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const before = await controller.getCompanionTurf(token, session);
    expect(before.households.find((h) => h.id === householdId)?.yard_sign?.status).toBe('requested');

    const { acks } = await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-sign-1',
        recorded_at: null,
        type: 'yard_sign',
        payload: { household_id: householdId, delivered: true },
      },
    ]);
    expect(acks[0]?.status).toBe('applied');

    const readRequest = async () =>
      db
        .selectFrom('delivery_requests')
        .select(['status'])
        .where('tenant_id', '=', s.tenantId)
        .where('id', '=', String(request.id))
        .executeTakeFirst();
    const readStop = async () =>
      db
        .selectFrom('delivery_route_stops')
        .select(['status', 'acted_via'])
        .where('tenant_id', '=', s.tenantId)
        .where('id', '=', String(stop.id))
        .executeTakeFirst();

    expect((await readRequest())?.status).toBe('delivered');
    // The driver's stop is closed, so nobody is sent to a house that already has its sign.
    expect((await readStop())?.status).toBe('delivered');
    // Every stop is terminal, so the route completed itself exactly as it does for a driver.
    const routeRow = await db
      .selectFrom('delivery_routes')
      .select(['status'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', String(route.id))
      .executeTakeFirst();
    expect(routeRow?.status).toBe('completed');
    // And the door says so on the next load, instead of still asking for a sign.
    const after = await controller.getCompanionTurf(token, session);
    expect(after.households.find((h) => h.id === householdId)?.yard_sign?.status).toBe('delivered');

    // Undo returns the sign to owed and reopens the stop AND its route.
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-sign-2',
        recorded_at: null,
        type: 'yard_sign',
        payload: { household_id: householdId, delivered: false },
      },
    ]);
    expect((await readRequest())?.status).toBe('approved');
    expect((await readStop())?.status).toBe('pending');
  });

  it('records deceased, a data-error task, and the senior band from the door', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const turf = (await controller.getTurfs(auth)).find((t) => t.door_count > 0);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    const home = companion.households.find((h) => h.people.length > 1);
    if (!home) throw new Error('expected a door with two residents');
    // Pick the residents by name, not by position: the payload sorts them by person id and
    // the fixture assigns those ids randomly, so position does not tell you who is who.
    const alice = home.people.find((p) => p.name.startsWith('Alice'));
    const bob = home.people.find((p) => p.name.startsWith('Bob'));
    if (!alice || !bob) throw new Error('expected Alice and Bob at this door');

    const { acks } = await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-dead-1',
        recorded_at: null,
        type: 'person_result',
        payload: { household_id: home.id, person_id: alice.id, result: 'deceased' },
      },
      {
        op_id: 'op-err-1',
        recorded_at: null,
        type: 'person_result',
        payload: { household_id: home.id, person_id: bob.id, result: 'data_error', note: 'Nobody by that name here' },
      },
      {
        op_id: 'op-senior-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: bob.id,
          support: null,
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          senior: true,
          subscribe: false,
        },
      },
    ]);
    expect(acks.map((a) => a.status)).toEqual(['applied', 'applied', 'applied']);

    // Deceased stamps the date AND stops contact — the harm is one more letter.
    const alicePerson = await db
      .selectFrom('persons')
      .select(['deceased_at', 'do_not_contact'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', alice.id)
      .executeTakeFirstOrThrow();
    expect(alicePerson.deceased_at).not.toBeNull();
    expect(alicePerson.do_not_contact).toBe(true);

    // "Error in data" changes nothing about the person — it asks a human to look.
    const bobPerson = await db
      .selectFrom('persons')
      .select(['first_name', 'senior', 'do_not_contact'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', bob.id)
      .executeTakeFirstOrThrow();
    expect(bobPerson.first_name).toBe('Bob');
    expect(bobPerson.do_not_contact).toBe(false);
    // A save carrying only "65 or older" is still a save worth keeping.
    expect(bobPerson.senior).toBe(true);

    const tasks = await db
      .selectFrom('tasks')
      .select(['name', 'details', 'assigned_to', 'person_id'])
      .where('tenant_id', '=', s.tenantId)
      .execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toContain('Bob Door');
    expect(tasks[0]?.details).toContain('Nobody by that name here');
    // Owned by the campaign admin, because an unassigned task is one nobody notices.
    expect(String(tasks[0]?.assigned_to)).toBe(s.userId);

    // A second report about the same person does not become a second task.
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-err-2',
        recorded_at: null,
        type: 'person_result',
        payload: { household_id: home.id, person_id: bob.id, result: 'data_error', note: 'Still wrong' },
      },
    ]);
    expect(await db.selectFrom('tasks').select('id').where('tenant_id', '=', s.tenantId).execute()).toHaveLength(1);

    // Un-ticking the toggle is a correction, and only ever clears a value that was true.
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'op-senior-2',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: home.id,
          person_id: bob.id,
          support: 'undecided',
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          senior: false,
          subscribe: false,
        },
      },
    ]);
    const corrected = await db
      .selectFrom('persons')
      .select('senior')
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', bob.id)
      .executeTakeFirstOrThrow();
    expect(corrected.senior).toBe(false);

    // Everyone else stays NULL: "nobody has asked" is not the same claim as "under 65".
    const untouched = await db
      .selectFrom('persons')
      .select('senior')
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.volunteerPersonId)
      .executeTakeFirstOrThrow();
    expect(untouched.senior).toBeNull();

    // The door reads it back: a deceased resident is marked, not quietly removed.
    const after = await controller.getCompanionTurf(token, session);
    const reread = after.households.find((h) => h.id === home.id);
    expect(reread?.people.find((p) => p.id === alice.id)?.deceased).toBe(true);
    expect(reread?.people.find((p) => p.id === bob.id)?.result).toBe('canvassed');
  });

  it('handles door outcomes, clears, no-conversation codes, and add-person-at-door', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    const emptyDoor = companion.households.find((h) => h.people.length === 0);
    const homeDoor = companion.households.find((h) => h.people.length > 0);
    if (!emptyDoor || !homeDoor) throw new Error('expected doors');

    const { acks } = await controller.postCompanionResults(token, session, [
      {
        op_id: 'd1',
        recorded_at: null,
        type: 'door_outcome',
        payload: { household_id: emptyDoor.id, outcome: 'no_answer' },
      },
      {
        op_id: 'd2',
        recorded_at: null,
        type: 'person_result',
        payload: { household_id: homeDoor.id, person_id: homeDoor.people[0]!.id, result: 'moved' },
      },
      {
        op_id: 'd3',
        recorded_at: null,
        type: 'person_create',
        payload: { household_id: homeDoor.id, name: 'Casey New Neighbor' },
      },
    ]);
    expect(acks.map((a) => a.status)).toEqual(['applied', 'applied', 'applied']);
    const newPersonId = acks[2]?.person_id;
    expect(newPersonId).toBeTruthy();

    // Payload shows the outcome + the new person; clearing re-opens the door.
    let reload = await controller.getCompanionTurf(token, session);
    expect(reload.households.find((h) => h.id === emptyDoor.id)?.door_outcome).toBe('no_answer');
    expect(reload.households.find((h) => h.id === homeDoor.id)?.people.map((p) => p.id)).toContain(newPersonId);
    expect(
      reload.households.find((h) => h.id === homeDoor.id)?.people.find((p) => p.id === homeDoor.people[0]!.id)?.result,
    ).toBe('moved');

    await controller.postCompanionResults(token, session, [
      { op_id: 'd4', recorded_at: null, type: 'clear_outcome', payload: { household_id: emptyDoor.id } },
    ]);
    reload = await controller.getCompanionTurf(token, session);
    expect(reload.households.find((h) => h.id === emptyDoor.id)?.door_outcome).toBeNull();

    // "Added at door" tag on the created person.
    const tagged = await db
      .selectFrom('map_peoples_tags')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .select('tags.name')
      .where('map_peoples_tags.tenant_id', '=', s.tenantId)
      .where('map_peoples_tags.person_id', '=', String(newPersonId))
      .execute();
    expect(tagged.map((t) => t.name)).toContain('Added at door');

    // An op against a household outside the turf is rejected (ack, not throw).
    const bad = await controller.postCompanionResults(token, session, [
      {
        op_id: 'd5',
        recorded_at: null,
        type: 'door_outcome',
        payload: { household_id: '999999999', outcome: 'no_answer' },
      },
    ]);
    expect(bad.acks[0]?.status).toBe('rejected');
  });

  it('re-answers a retried person_create with the id it created the first time', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    const door = companion.households[0];
    if (!door) throw new Error('expected a door');

    const op = {
      op_id: 'op-create-retry',
      recorded_at: null,
      type: 'person_create' as const,
      payload: { household_id: door.id, name: 'Robin Newcomer' },
    };

    const first = await controller.postCompanionResults(token, session, [op]);
    expect(first.acks[0]?.status).toBe('applied');
    const personId = first.acks[0]?.person_id;
    expect(personId).toBeTruthy();

    // The phone never saw that reply (dropped connection) and sends the batch again.
    // Without the stored result this came back as a bare `duplicate`, the phone kept
    // its `tmp-…` placeholder, and every queued survey for that person jammed forever.
    const retry = await controller.postCompanionResults(token, session, [op]);
    expect(retry.acks[0]?.status).toBe('duplicate');
    expect(retry.acks[0]?.person_id).toBe(personId);

    // Still exactly one person: the duplicate answered from the ledger, it did not re-apply.
    const people = await db
      .selectFrom('persons')
      .select('id')
      .where('tenant_id', '=', s.tenantId)
      .where('first_name', '=', 'Robin')
      .execute();
    expect(people).toHaveLength(1);
  });

  it('rejects an invalid Companion token', async () => {
    await expect(controller.getCompanionTurf('not-a-real-token', null)).rejects.toThrow();
  });

  it('summarises the field for the header sentence', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    const summary = await controller.getFieldSummary(auth);
    expect(summary.turfCount).toBeGreaterThanOrEqual(2);
    expect(summary.doorsTotal).toBe(40);
    expect(summary.doorsAttempted).toBe(0);
    // Freshly cut, everything is waiting for a canvasser.
    expect(summary.waitingCount).toBe(summary.turfCount);
    expect(summary.inFieldCount).toBe(0);
  });

  it('builds a field report from synced knocks', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'fr-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: companion.households[0]!.id,
          person_id: null,
          support: 'supporter',
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          subscribe: false,
        },
      },
      {
        op_id: 'fr-2',
        recorded_at: null,
        type: 'door_outcome',
        payload: { household_id: companion.households[1]!.id, outcome: 'no_answer' },
      },
    ]);

    const report = await controller.getFieldReport(auth, { range: 'campaign' });
    expect(report.doors).toBe(2);
    expect(report.conversations).toBe(1);
    expect(report.supportIds).toBe(1);
    expect(report.contactRatePct).toBe(50);
    expect(report.topCanvassers[0]?.name).toBe('Sam Volunteer');
  });

  it('maps coverage: a door per geocoded household, coloured by its knock status, with turf hulls and a by-boundary roll-up', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'cov-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: companion.households[0]!.id,
          person_id: null,
          support: 'supporter',
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          subscribe: false,
        },
      },
      {
        op_id: 'cov-2',
        recorded_at: null,
        type: 'door_outcome',
        payload: { household_id: companion.households[1]!.id, outcome: 'no_answer' },
      },
    ]);

    const cov = await fullCoverage({ range: 'campaign' });

    // One dot per geocoded door only — the 3 ungeocoded households are excluded.
    expect(cov.doors.length).toBe(40);
    const byStatus = { conversation: 0, attempted: 0, not_yet: 0 };
    for (const d of cov.doors) byStatus[d.status] += 1;
    expect(byStatus.conversation).toBe(1);
    expect(byStatus.attempted).toBe(1);
    expect(byStatus.not_yet).toBe(38);

    // Every turf gets a boundary hull of at least a triangle, and carries its own exact counts.
    expect(cov.turfs.length).toBeGreaterThanOrEqual(1);
    for (const t of cov.turfs) expect(t.path.length).toBeGreaterThanOrEqual(3);
    // The per-turf counts are what the map shades by when there are too many doors to draw, so
    // they have to account for every door exactly once, like the by-area roll-up below does.
    expect(cov.turfs.reduce((n, t) => n + t.doors, 0)).toBe(40);
    expect(cov.turfs.reduce((n, t) => n + t.conversation, 0)).toBe(1);
    expect(cov.turfs.reduce((n, t) => n + t.attempted, 0)).toBe(1);
    expect(cov.turfs.reduce((n, t) => n + t.not_yet, 0)).toBe(38);

    // Both counts describe the same 40 doors when no rectangle was asked for.
    expect(cov.doors_in_view).toBe(40);
    expect(cov.doors_total).toBe(40);

    // By-boundary roll-up covers every mapped door exactly once.
    const areaDoors = cov.byBoundary.reduce((n, a) => n + a.doors, 0);
    expect(areaDoors).toBe(40);
    expect(cov.byBoundary.map((a) => a.boundary_name).sort()).toEqual(['W1', 'W2']);
    // The campaign declares no office, so the word is the neutral default rather than a guess.
    expect(cov.boundary_label).toBe('Subdivision');
    expect(cov.boundary_label_plural).toBe('Subdivisions');
  });

  it('maps coverage for only the rectangle asked for, and re-sends nothing that describes the workspace', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });

    // The seeded doors run from latitude 41.850 to 41.857. This rectangle takes the lower part of
    // that spread and every longitude, so it holds some doors but not all of them.
    const cov = await controller.getCoverage(auth, {
      range: 'campaign',
      viewport: { north: 41.8525, south: 41.8495, east: -87.6, west: -87.7 },
    });

    expect(cov.doors_only).toBe(true);
    expect(cov.doors_in_view).toBeGreaterThan(0);
    expect(cov.doors_in_view).toBeLessThan(40);
    expect(cov.doors.length).toBe(cov.doors_in_view);
    for (const d of cov.doors) {
      expect(d.lat).toBeGreaterThanOrEqual(41.8495);
      expect(d.lat).toBeLessThanOrEqual(41.8525);
    }

    // The turf outlines, the by-area roll-up, the workspace total and the area word all describe
    // the whole workspace, so moving the map cannot change any of them. Scoping them to the
    // rectangle would make a turf read as barely walked purely because most of it was off screen;
    // recomputing them unchanged would rebuild every turf's hull to send back what the caller
    // already has. So a rectangle request carries none of them, and the caller keeps its own.
    expect(Object.keys(cov).sort()).toEqual(['doors', 'doors_in_view', 'doors_only']);

    // The request with no rectangle is the one that carries them, over the same doors.
    const whole = await fullCoverage({ range: 'campaign' });
    expect(whole.doors_only).toBe(false);
    expect(whole.doors_total).toBe(40);
    expect(whole.turfs.reduce((n, t) => n + t.doors, 0)).toBe(40);
    expect(whole.byBoundary.reduce((n, a) => n + a.doors, 0)).toBe(40);
  });

  it('sends no doors at all once too many are in view, rather than a sample of them', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');

    // Enough extra doors in this turf to cross the cap. A sample would be worse than nothing here:
    // whichever doors happened to be sent would decide which parts of the map look walked.
    const extra = COVERAGE_MAX_DOORS + 1 - 40;
    const base = Number(rand()) * 10_000;
    const ids = Array.from({ length: extra }, (_unused, i) => String(base + i));
    await db
      .insertInto('households')
      .values(
        ids.map((id, i) => ({
          id,
          tenant_id: s.tenantId,
          campaign_id: s.campaignId,
          createdby_id: s.userId,
          updatedby_id: s.userId,
          street_num: String(i),
          street1: 'Crowded Ave',
          city: 'Springfield',
          lat: 41.85 + (i % 40) * 0.0005,
          lng: -87.69 + Math.floor(i / 40) * 0.0005,
          geocoding_status: 'success',
        })),
      )
      .execute();
    await db
      .insertInto('turf_households')
      .values(
        ids.map((id) => ({
          tenant_id: s.tenantId,
          turf_id: turf.id,
          household_id: id,
          createdby_id: s.userId,
          updatedby_id: s.userId,
        })),
      )
      .execute();

    const cov = await fullCoverage({ range: 'campaign' });

    expect(cov.doors_in_view).toBe(COVERAGE_MAX_DOORS + 1);
    expect(cov.doors).toEqual([]);
    // The shaded outlines are what the map falls back to, so they must still be there and must
    // still account for every door — that is the whole reason dropping the doors is acceptable.
    // Past the cap these counts come from the SQL aggregate, not from per-door rows, so this
    // also pins that the aggregate and the per-door derivation agree.
    expect(cov.turfs.length).toBeGreaterThanOrEqual(1);
    expect(cov.turfs.reduce((n, t) => n + t.doors, 0)).toBe(COVERAGE_MAX_DOORS + 1);
    for (const t of cov.turfs) expect(t.path.length).toBeGreaterThanOrEqual(3);
    // The by-area roll-up is folded from the same per-turf aggregate and still covers every door.
    expect(cov.byBoundary.reduce((n, a) => n + a.doors, 0)).toBe(COVERAGE_MAX_DOORS + 1);

    // A zoomed-out rectangle holds the same overflow. The pan path counts the doors in view
    // FIRST and skips the per-door read entirely when they will not be sent — so the answer is
    // the exact count with no doors, never a sample.
    const wide = await controller.getCoverage(auth, {
      range: 'campaign',
      viewport: { north: 90, south: -90, east: 180, west: -180 },
    });
    expect(wide.doors_only).toBe(true);
    expect(wide.doors).toEqual([]);
    expect(wide.doors_in_view).toBe(COVERAGE_MAX_DOORS + 1);
  });

  it('refreshes a turf from its list, dropping members that left (knocks preserved)', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    const droppedDoor = companion.households[0]!.id;
    await controller.postCompanionResults(token, session, [
      {
        op_id: 'rf-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: droppedDoor,
          person_id: null,
          support: 'undecided',
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          subscribe: false,
        },
      },
    ]);

    // Remove that household from the list universe.
    await db
      .deleteFrom('map_lists_households')
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', droppedDoor)
      .execute();

    const result = await controller.refreshFromList(auth, turf.id);
    expect(result.removed).toBe(1);
    // An ordinary turf still knows its map, so the response does not claim otherwise.
    expect(result.boundary_map_missing).toBe(false);

    // The knock history survives even though the door was removed.
    const knocks = await db
      .selectFrom('turf_knocks')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', droppedDoor)
      .execute();
    expect(knocks.length).toBe(1);
  });

  it('a turf cut outside every area of the map records the map, and refresh cannot steal doors from named areas', async () => {
    // Three doors lose their area rows: still geocoded, still in the list, but outside every
    // area of the map the cut resolves.
    const outside = s.householdIds.slice(0, 3);
    await db
      .deleteFrom('household_districts')
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', 'in', outside)
      .execute();

    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const turfs = await controller.getTurfs(auth);
    const leftover = turfs.find((t) => t.boundary_name == null);
    const w1 = turfs.find((t) => t.boundary_name === 'W1');
    if (!leftover || !w1) throw new Error('expected a leftover turf and a W1 turf');
    expect(leftover.door_count).toBe(3);

    // "Cut against map S, outside every area of it" (set kept, name null) is stored as a state
    // of its own, distinct from "cut with no map" (both null).
    const stored = await db
      .selectFrom('turfs')
      .select(['boundary_set_id', 'boundary_name'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', leftover.id)
      .executeTakeFirstOrThrow();
    expect(String(stored.boundary_set_id)).toBe(s.boundarySetId);
    expect(stored.boundary_name).toBeNull();

    // The coverage roll-up files those doors under 'Unbounded' — the same word the turf pages
    // use — never under 'Unassigned', which on the canvassing page means "no canvasser".
    const cov = await fullCoverage({ range: 'campaign' });
    const bucket = cov.byBoundary.find((a) => a.boundary_name === 'Unbounded');
    expect(bucket?.doors).toBe(3);
    expect(cov.byBoundary.map((a) => a.boundary_name)).not.toContain('Unassigned');

    // Two new list members: one inside W1, one outside every area.
    const insideNew = await addListedHousehold(db, s, { area: 'W1' });
    const outsideNew = await addListedHousehold(db, s, { area: null });

    // Refreshing the leftover turf FIRST takes only the door that is still outside every area.
    // Before the map id was stored, this turf read as "no map", every unassigned door matched,
    // and it permanently swallowed doors that belonged inside named areas.
    const leftoverRes = await controller.refreshFromList(auth, leftover.id);
    expect(leftoverRes).toEqual({ added: 1, removed: 0, boundary_map_missing: false });
    const leftoverDoors = await doorsOf(db, s.tenantId, leftover.id);
    expect(leftoverDoors).toContain(outsideNew);
    expect(leftoverDoors).not.toContain(insideNew);

    // The W1 door is still free, and the W1 turf picks it up.
    const w1Res = await controller.refreshFromList(auth, w1.id);
    expect(w1Res.added).toBe(1);
    expect(await doorsOf(db, s.tenantId, w1.id)).toContain(insideNew);
  });

  it('a turf cut with no map at all matches any unassigned door on refresh, and the preview owns up to it', async () => {
    // The workspace loses its map entirely before the cut.
    await db.deleteFrom('household_districts').where('tenant_id', '=', s.tenantId).execute();
    await db.deleteFrom('boundary_sets').where('tenant_id', '=', s.tenantId).execute();

    const preview = await controller.previewCut(auth, { list_id: s.listId, doors_per_turf: 40 });
    expect(preview.bounded).toBe(false);

    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const stored = await db
      .selectFrom('turfs')
      .select(['boundary_set_id', 'boundary_name'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', turf.id)
      .executeTakeFirstOrThrow();
    expect(stored.boundary_set_id).toBeNull();
    expect(stored.boundary_name).toBeNull();

    // One bucket, so any unassigned list member joins — the same rule the cutter used.
    const newDoor = await addListedHousehold(db, s, { area: null });
    const res = await controller.refreshFromList(auth, turf.id);
    expect(res).toEqual({ added: 1, removed: 0, boundary_map_missing: false });
    expect(await doorsOf(db, s.tenantId, turf.id)).toContain(newDoor);
  });

  it('is honest about a turf whose boundary map is gone: doors still leave, none are added, and the response says why', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const w1 = (await controller.getTurfs(auth)).find((t) => t.boundary_name === 'W1');
    if (!w1) throw new Error('expected a W1 turf');

    // Migration d's backfill shape — an area name with no map behind it. Deleting the map
    // produces the same state through the FK's ON DELETE SET NULL; writing it directly keeps
    // the other turf out of this test.
    await db
      .updateTable('turfs')
      .set({ boundary_set_id: null })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', w1.id)
      .execute();

    // One member leaves the list, one W1 member joins it.
    const [leaving] = await doorsOf(db, s.tenantId, w1.id);
    if (!leaving) throw new Error('expected the W1 turf to have doors');
    await db
      .deleteFrom('map_lists_households')
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', leaving)
      .execute();
    const joining = await addListedHousehold(db, s, { area: 'W1' });

    const res = await controller.refreshFromList(auth, w1.id);
    // The removal is work the refresh still does; the add phase is skipped because 'W1' can no
    // longer be resolved against any map — and the flag says so instead of the response reading
    // as "this turf already matches its list".
    expect(res).toEqual({ added: 0, removed: 1, boundary_map_missing: true });
    const doors = await doorsOf(db, s.tenantId, w1.id);
    expect(doors).not.toContain(leaving);
    expect(doors).not.toContain(joining);
  });

  it('picks the boundary map for the campaign’s chamber, not the finer map of the other chamber', async () => {
    // A two-chamber workspace: the seeded map becomes the upper-house map, and a FINER
    // lower-house map arrives. Finest-wins must not cross the chamber line.
    await db
      .updateTable('campaigns')
      .set({ chamber: 'upper' })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.campaignId)
      .execute();
    await db
      .updateTable('boundary_sets')
      .set({ chamber: 'upper' })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.boundarySetId)
      .execute();
    await db
      .insertInto('boundary_sets')
      .values({
        tenant_id: s.tenantId,
        slug: `house-map-${rand()}`,
        label: 'House districts',
        jurisdiction: 'other',
        role: 'subdivision',
        source: 'drawn',
        chamber: 'lower',
        feature_count: 99,
        createdby_id: s.userId,
      })
      .execute();

    const boundary = await resolveTurfBoundary(db, { tenant_id: s.tenantId, campaign_id: s.campaignId });
    expect(boundary.set_id).toBe(s.boundarySetId);
  });

  it('opens one turf: every door with what happened at it, and the roster with their work', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    const [turf] = await controller.getTurfs(auth);
    if (!turf) throw new Error('expected a turf');
    const { token } = await controller.assignTurf(auth, {
      turf_id: turf.id,
      team_id: null,
      volunteer_person_id: s.volunteerPersonId,
    });
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
    const companion = await controller.getCompanionTurf(token, session);
    const talked = companion.households[0]!.id;
    const noAnswer = companion.households[1]!.id;

    await controller.postCompanionResults(token, session, [
      {
        op_id: 'det-1',
        recorded_at: null,
        type: 'survey',
        payload: {
          household_id: talked,
          person_id: null,
          support: 'supporter',
          issues: [],
          wants_volunteer: false,
          wants_yard_sign: false,
          set_dnc: false,
          subscribe: false,
        },
      },
      {
        op_id: 'det-2',
        recorded_at: null,
        type: 'door_outcome',
        payload: { household_id: noAnswer, outcome: 'no_answer' },
      },
    ]);

    const detail = await controller.getTurfDetail(auth, turf.id);

    // Header numbers are the list page's, derived the same way.
    expect(detail.name).toBe(turf.name);
    expect(detail.door_count).toBe(turf.door_count);
    expect(detail.attempted).toBe(2);
    expect(detail.conversations).toBe(1);
    expect(detail.last_activity_at).not.toBeNull();

    // Every door of the turf is listed, in walk order, each with its own status.
    expect(detail.doors.length).toBe(turf.door_count);
    expect(detail.doors.map((d) => d.walk_order)).toEqual(
      [...detail.doors.map((d) => d.walk_order)].sort((a, b) => a - b),
    );
    // The address parts travel alongside the flattened address string, because the walking
    // order groups by street and sorts by house number and cannot re-parse "218 Alder St".
    const withStreet = detail.doors.find((d) => d.street != null && d.street_num != null);
    expect(withStreet).toBeDefined();
    expect(withStreet?.street).toBe('Main St');
    expect(withStreet?.address).toContain(String(withStreet?.street_num));
    expect(withStreet?.address).toContain('Main St');
    expect(detail.doors.every((d) => 'apt' in d)).toBe(true);

    const talkedDoor = detail.doors.find((d) => d.household_id === talked);
    expect(talkedDoor?.status).toBe('conversation');
    expect(talkedDoor?.last_outcome).toBe('conversation');
    expect(talkedDoor?.last_response).toBe('supporter');
    expect(talkedDoor?.last_canvasser).toBe('Sam Volunteer');
    expect(talkedDoor?.residents.length).toBeGreaterThan(0);
    expect(detail.doors.find((d) => d.household_id === noAnswer)?.status).toBe('attempted');
    expect(detail.doors.filter((d) => d.status === 'not_yet').length).toBe(turf.door_count - 2);

    // The turf is drawn from its own doors.
    expect(detail.boundary.length).toBeGreaterThanOrEqual(3);

    // The canvasser is credited with the doors they actually walked.
    expect(detail.canvassers.length).toBe(1);
    const [canvasser] = detail.canvassers;
    expect(canvasser?.name).toBe('Sam Volunteer');
    expect(canvasser?.active).toBe(true);
    expect(canvasser?.doors).toBe(2);
    expect(canvasser?.conversations).toBe(1);

    // Taking them off the turf does not unmake the doors they walked.
    await controller.removeVolunteerFromTurf(auth, {
      turf_id: turf.id,
      volunteer_person_id: s.volunteerPersonId,
    });
    const after = await controller.getTurfDetail(auth, turf.id);
    expect(after.canvassers.length).toBe(1);
    expect(after.canvassers[0]?.active).toBe(false);
    expect(after.canvassers[0]?.doors).toBe(2);
    expect(after.attempted).toBe(2);
  });

  describe('live volunteer locations', () => {
    /** Cut one turf, put the seed volunteer on it, and hand back their session. */
    async function assignedTurfWithSession(): Promise<{ turfId: string; session: string }> {
      await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
      const [turf] = await controller.getTurfs(auth);
      if (!turf) throw new Error('expected a turf');
      await controller.assignTurf(auth, {
        turf_id: turf.id,
        team_id: null,
        volunteer_person_id: s.volunteerPersonId,
      });
      const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.userId);
      return { turfId: turf.id, session };
    }

    it('opens a shift on the first ping and shows the canvasser live, then wraps on finish', async () => {
      const { turfId, session } = await assignedTurfWithSession();

      await controller.postLocationPing(session, turfId, { lat: 41.85, lng: -87.69, accuracy_m: 12 });
      // 80 m north a minute of wall-clock later would be walking pace; the accumulator
      // compares ping arrival times, so back-date the first ping's mirror to make the
      // second segment plausible rather than instantaneous.
      await db
        .updateTable('canvass_shifts')
        .set({ last_ping_at: new Date(Date.now() - 60_000) })
        .where('tenant_id', '=', s.tenantId)
        .execute();
      await controller.postLocationPing(session, turfId, { lat: 41.8507, lng: -87.69, accuracy_m: 10 });

      const live = await controller.getLive(auth);
      expect(live.out_now).toBe(1);
      expect(live.canvassers.length).toBe(1);
      const [row] = live.canvassers;
      expect(row?.name).toBe('Sam Volunteer');
      expect(row?.turf_id).toBe(turfId);
      expect(row?.location_state).toBe('sharing');
      expect(row?.position?.lat).toBeCloseTo(41.8507, 3);
      expect(row?.path?.length).toBeGreaterThanOrEqual(2);
      // ~78 m between the two pings, at a plausible walking speed.
      expect(row?.distance_m).toBeGreaterThan(50);
      expect(row?.distance_m).toBeLessThan(110);

      const summary = await controller.getFieldSummary(auth);
      expect(summary.outNowCount).toBe(1);

      // The turf reads as being walked while the shift is open.
      expect(live.turfs.find((t) => t.id === turfId)?.status).toBe('walking');

      // Finish: the dot and path go, the row moves to wrapped with an end time.
      await controller.finishCompanionShift(session);
      const after = await controller.getLive(auth);
      expect(after.out_now).toBe(0);
      expect(after.canvassers).toEqual([]);
      expect(after.wrapped.length).toBe(1);
      expect(after.wrapped[0]?.name).toBe('Sam Volunteer');
      expect(after.wrapped[0]?.distance_m).toBe(live.canvassers[0]?.distance_m);
      expect(after.last_shift_ended_at).not.toBeNull();
    });

    it('reports "location off" for a denied permission, and knocks still open the shift', async () => {
      const { turfId, session } = await assignedTurfWithSession();

      // A knock batch alone opens the shift — location never granted.
      const payload = await controller.getCompanionTurfBySession(session, turfId);
      const door = payload.households[0]!;
      await controller.postCompanionResultsBySession(session, turfId, [
        {
          op_id: 'op-live-knock-1',
          recorded_at: null,
          type: 'door_outcome',
          payload: { household_id: door.id, outcome: 'no_answer' },
        },
      ]);
      await controller.postLocationPing(session, turfId, { denied: true });

      const live = await controller.getLive(auth);
      expect(live.canvassers.length).toBe(1);
      const [row] = live.canvassers;
      expect(row?.location_state).toBe('off');
      expect(row?.position).toBeNull();
      expect(row?.path).toBeNull();
      expect(row?.doors).toBe(1);
      expect(row?.tape.some(Boolean)).toBe(true);
    });

    it('closes a quiet shift at its last activity, not the moment the timeout was noticed', async () => {
      const { turfId, session } = await assignedTurfWithSession();
      await controller.postLocationPing(session, turfId, { lat: 41.85, lng: -87.69, accuracy_m: 12 });

      const lastActivity = new Date(Date.now() - 45 * 60 * 1000);
      await db
        .updateTable('canvass_shifts')
        .set({ last_activity_at: lastActivity })
        .where('tenant_id', '=', s.tenantId)
        .execute();

      const live = await controller.getLive(auth);
      expect(live.out_now).toBe(0);
      // The claim under test is "closed at its last activity (45 min ago), not at notice time
      // (now)" — so read ended_at straight off the shift row. The previous assertions went
      // through live.wrapped, which filters to shifts that ended TODAY in the tenant's local
      // day: for 45 minutes after local midnight the closed shift legitimately belongs to
      // yesterday and vanishes from that group, which is exactly when CI runs this suite
      // (03:4x–04:1x UTC), and its 500ms toBeCloseTo also raced the ping round-trip. The 10s
      // window still separates the two hypotheses (last activity vs notice time) by 45 minutes.
      const closedShift = await db
        .selectFrom('canvass_shifts')
        .select('ended_at')
        .where('tenant_id', '=', s.tenantId)
        .executeTakeFirstOrThrow();
      expect(closedShift.ended_at).not.toBeNull();
      // Non-null proven by the assertion above.
      expect(Math.abs(new Date(closedShift.ended_at!).getTime() - lastActivity.getTime())).toBeLessThan(10_000);
    });

    it('never returns a coordinate on any surface under turf-level precision', async () => {
      await controller.updateCompanionSettings(auth, {
        campaign_id: s.campaignId,
        issues: [],
        script: null,
        location_precision: 'turf',
      });
      const { turfId, session } = await assignedTurfWithSession();
      await controller.postLocationPing(session, turfId, { lat: 41.85, lng: -87.69, accuracy_m: 12 });

      const live = await controller.getLive(auth);
      const [row] = live.canvassers;
      expect(row?.precision).toBe('turf');
      expect(row?.position).toBeNull();
      expect(row?.path).toBeNull();
      // Presence still reads: the turf, the person, and the last-heard-from time survive.
      expect(row?.turf_id).toBe(turfId);
      expect(row?.last_ping_at).not.toBeNull();

      const personLive = await controller.getPersonLive(auth, s.volunteerPersonId);
      expect(personLive.open?.position).toBeNull();
      expect(personLive.open?.path).toBeNull();

      const turfLive = await controller.getTurfLive(auth, turfId);
      expect(turfLive.now[0]?.position).toBeNull();
      expect(turfLive.now[0]?.path).toBeNull();

      expect(JSON.stringify(live)).not.toContain('87.69');
      expect(JSON.stringify(personLive)).not.toContain('87.69');
      expect(JSON.stringify(turfLive)).not.toContain('87.69');
    });

    it('serves the person block and the turf block from the same shift', async () => {
      const { turfId, session } = await assignedTurfWithSession();
      await controller.postLocationPing(session, turfId, { lat: 41.85, lng: -87.69, accuracy_m: 12 });
      const payload = await controller.getCompanionTurfBySession(session, turfId);
      const home = payload.households.find((h) => h.people.length > 0);
      if (!home) throw new Error('expected a door with residents');
      await controller.postCompanionResultsBySession(session, turfId, [
        {
          op_id: 'op-live-survey-1',
          recorded_at: null,
          type: 'survey',
          payload: {
            household_id: home.id,
            person_id: home.people[0]?.id ?? null,
            support: 'supporter',
            issues: [],
            wants_volunteer: false,
            wants_yard_sign: false,
            set_dnc: false,
            subscribe: false,
          },
        },
      ]);

      const personLive = await controller.getPersonLive(auth, s.volunteerPersonId);
      expect(personLive.open?.turf_id).toBe(turfId);
      expect(personLive.open?.position).not.toBeNull();
      expect(personLive.today.doors).toBe(1);
      expect(personLive.today.conversations).toBe(1);
      expect(personLive.today.support_ids).toBe(1);

      const turfLive = await controller.getTurfLive(auth, turfId);
      expect(turfLive.now.length).toBe(1);
      expect(turfLive.now[0]?.person_id).toBe(s.volunteerPersonId);
      expect(turfLive.earlier).toEqual([]);
    });

    it('purges yesterday’s pings at local midnight and keeps the shift aggregates', async () => {
      const { turfId, session } = await assignedTurfWithSession();
      await controller.postLocationPing(session, turfId, { lat: 41.85, lng: -87.69, accuracy_m: 12 });

      // Age the whole shift into yesterday: pings received before local midnight, the
      // shift opened before it and long quiet.
      const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
      await db
        .updateTable('canvass_location_pings')
        .set({ received_at: yesterday })
        .where('tenant_id', '=', s.tenantId)
        .execute();
      await db
        .updateTable('canvass_shifts')
        .set({ started_at: yesterday, last_activity_at: yesterday, last_ping_at: yesterday })
        .where('tenant_id', '=', s.tenantId)
        .execute();

      const deleted = await purgeCanvassPingsForTenant(db, s.tenantId);
      expect(deleted).toBe(1);

      const pings = await db
        .selectFrom('canvass_location_pings')
        .select('id')
        .where('tenant_id', '=', s.tenantId)
        .execute();
      expect(pings).toEqual([]);

      // The shift row survives with its totals; ended_at is its last activity (it went
      // quiet long before midnight), and no coordinate remains anywhere.
      const shift = await db
        .selectFrom('canvass_shifts')
        .selectAll()
        .where('tenant_id', '=', s.tenantId)
        .executeTakeFirstOrThrow();
      expect(shift.ended_at).not.toBeNull();
      expect(new Date(shift.ended_at ?? 0).getTime()).toBeCloseTo(yesterday.getTime(), -3);
      expect(shift.end_reason).toBe('timeout');
    });
  });
});
