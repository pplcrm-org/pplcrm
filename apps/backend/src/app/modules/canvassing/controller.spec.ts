import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IAuthKeyPayload } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { hashToken } from '../../lib/token-hash';
import { CanvassingController } from './controller';

type Db = typeof BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  userId: string;
  campaignId: string;
  listId: string;
  householdIds: string[];
  /** The volunteer the Companion link is assigned to (not a list member). */
  volunteerPersonId: string;
  /** A second volunteer, for the group-canvassing tests. */
  volunteer2PersonId: string;
  /** Residents of householdIds[0], for person-level survey tests. */
  residentIds: string[];
}

/** Seed a tenant + a static household list of geocoded doors across two wards. */
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
        ward: i % 2 === 0 ? 'W1' : 'W2',
        geocoding_status: 'success',
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

  return { tenantId, userId, campaignId, listId, householdIds, volunteerPersonId, volunteer2PersonId, residentIds };
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
  await db.deleteFrom('delivery_requests').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_person_facts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_knocks').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_segment_claims').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_assignments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turfs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
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

  it('previews a cut with math that matches the engine, reporting unplaced doors', async () => {
    const preview = await controller.previewCut(auth, { list_id: s.listId, doors_per_turf: 20 });
    expect(preview.doors).toBe(40);
    expect(preview.unplaced).toBe(3);
    expect(preview.turfCount).toBeGreaterThanOrEqual(2);
    expect(preview.avgDoorsPerTurf).toBeGreaterThan(0);
  });

  it('cuts turfs (draft, unassigned) with doors, never crossing a ward', async () => {
    const res = await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 20 });
    expect(res.created).toBeGreaterThanOrEqual(2);
    expect(res.unplaced).toBe(3);

    const turfs = await controller.getTurfs(auth);
    expect(turfs.length).toBe(res.created);
    for (const t of turfs) {
      expect(t.status).toBe('draft');
      expect(t.canvassers).toEqual([]);
      expect(t.door_count).toBeGreaterThan(0);
      expect(['W1', 'W2', null]).toContain(t.ward);
    }
    // Every geocoded door placed exactly once across turfs.
    const total = turfs.reduce((n, t) => n + t.door_count, 0);
    expect(total).toBe(40);
  });

  it('puts several volunteers on one turf, each with their own working link', async () => {
    await controller.cutTurfs(auth, { list_id: s.listId, doors_per_turf: 40 });
    // Turfs never cross a ward, so the cut yields more than one; hold on to the
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

    // One assignment first: roaming widens a volunteer's reach within campaigns they
    // already work in, it does not place them into a campaign from nothing.
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

  it('maps coverage: a door per geocoded household, coloured by its knock status, with turf hulls and by-ward roll-up', async () => {
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

    const cov = await controller.getCoverage(auth, { range: 'campaign' });

    // One dot per geocoded door only — the 3 ungeocoded households are excluded.
    expect(cov.doors.length).toBe(40);
    const byStatus = { conversation: 0, attempted: 0, not_yet: 0 };
    for (const d of cov.doors) byStatus[d.status] += 1;
    expect(byStatus.conversation).toBe(1);
    expect(byStatus.attempted).toBe(1);
    expect(byStatus.not_yet).toBe(38);

    // Every turf gets a boundary hull of at least a triangle.
    expect(cov.turfs.length).toBeGreaterThanOrEqual(1);
    for (const t of cov.turfs) expect(t.path.length).toBeGreaterThanOrEqual(3);

    // By-ward roll-up covers every mapped door exactly once.
    const wardDoors = cov.byWard.reduce((n, w) => n + w.doors, 0);
    expect(wardDoors).toBe(40);
    expect(cov.byWard.map((w) => w.ward).sort()).toEqual(['W1', 'W2']);
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

    // The knock history survives even though the door was removed.
    const knocks = await db
      .selectFrom('turf_knocks')
      .selectAll()
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', droppedDoor)
      .execute();
    expect(knocks.length).toBe(1);
  });
});
