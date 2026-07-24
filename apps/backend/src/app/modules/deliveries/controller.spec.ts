import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAuthKeyPayload } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { generateToken, hashToken } from '../../lib/token-hash';
import { CompanionAccessController } from '../companion-access/controller';
import { DeliveriesController } from './controller';

type Db = typeof BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  adminId: string;
  organizerId: string;
  campaignId: string;
  volunteerPersonId: string;
  routeId: string;
  routeToken: string;
  stopIds: string[]; // in seq order 1..3
}

/** Seed a tenant with a three-stop route whose share link belongs to a volunteer person. */
async function seed(db: Db): Promise<Seed> {
  const tenantId = rand();
  const adminId = rand();
  const organizerId = rand();
  const campaignId = rand();
  const volunteerPersonId = rand();
  const routeToken = generateToken();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Deliveries Test' }).execute();
  for (const [id, role, first] of [
    [adminId, 'admin', 'Avery'],
    [organizerId, 'user', 'Sam'],
  ] as const) {
    await db
      .insertInto('authusers')
      .values({
        id,
        tenant_id: tenantId,
        email: `t-${id}@example.com`,
        password: 'x',
        first_name: first,
        last_name: 'Staff',
        role,
        verified: true,
        createdby_id: id,
        updatedby_id: id,
      })
      .execute();
  }
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: adminId,
      name: 'C',
      createdby_id: adminId,
      updatedby_id: adminId,
    })
    .execute();

  // The volunteer driving the route.
  const volunteerHouseholdId = rand();
  await db
    .insertInto('households')
    .values({
      id: volunteerHouseholdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();
  await db
    .insertInto('persons')
    .values({
      id: volunteerPersonId,
      tenant_id: tenantId,
      household_id: volunteerHouseholdId,
      first_name: 'Jordan',
      last_name: 'Rivera',
      email: 'jordan@example.com',
      mobile: '(613) 555-0142',
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .execute();

  // delivery_* ids are GENERATED ALWAYS — let Postgres assign them.
  const routeRow = await db
    .insertInto('delivery_routes')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Maple St area — test',
      status: 'assigned',
      volunteer_person_id: volunteerPersonId,
      start_address: '1 Test Way',
      start_lat: 45.0,
      start_lng: -75.0,
      est_minutes: 30,
      est_km: 5,
      share_token_hash: hashToken(routeToken),
      share_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      params: JSON.stringify({}),
      createdby_id: organizerId,
      updatedby_id: organizerId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const routeId = String(routeRow.id);

  const stopIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const householdId = rand();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        street_num: String(i),
        street1: 'Maple St',
        lat: 45.0 + i / 1000,
        lng: -75.0 - i / 1000,
        createdby_id: organizerId,
        updatedby_id: organizerId,
      })
      .execute();
    const requestRow = await db
      .insertInto('delivery_requests')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        person_id: null,
        source: 'manual',
        status: 'approved',
        createdby_id: organizerId,
        updatedby_id: organizerId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const stopRow = await db
      .insertInto('delivery_route_stops')
      .values({
        tenant_id: tenantId,
        route_id: routeId,
        request_id: String(requestRow.id),
        seq: i,
        leg_minutes: 2,
        status: 'pending',
        createdby_id: organizerId,
        updatedby_id: organizerId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    stopIds.push(String(stopRow.id));
  }

  return { tenantId, adminId, organizerId, campaignId, volunteerPersonId, routeId, routeToken, stopIds };
}

/** Insert an approved companion volunteer + device session directly; returns the raw session token. */
async function mintApprovedSession(db: Db, tenantId: string, personId: string, createdBy: string): Promise<string> {
  const volunteer = await db
    .insertInto('companion_volunteers')
    .values({
      tenant_id: tenantId,
      person_id: personId,
      status: 'approved',
      verified_at: new Date(),
      approved_by: createdBy,
      approved_at: new Date(),
      createdby_id: createdBy,
      updatedby_id: createdBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const raw = generateToken();
  await db
    .insertInto('companion_sessions')
    .values({
      tenant_id: tenantId,
      volunteer_id: volunteer.id,
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .execute();
  return raw;
}

/** Flip the Workspace → App link-expiry policy for the seeded tenant (absent row = ON). */
async function setLinkExpiryPolicy(db: Db, tenantId: string, userId: string, expire: boolean): Promise<void> {
  await db
    .insertInto('settings')
    .values({
      tenant_id: tenantId,
      key: 'app.volunteer_links_expire',
      value: JSON.stringify(expire),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'key']).doUpdateSet({ value: JSON.stringify(expire) }))
    .execute();
}

async function cleanup(db: Db, tenantId: string): Promise<void> {
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_ops').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_sessions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companion_volunteers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_route_stops').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_requests').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_routes').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('DeliveriesController — public volunteer path', () => {
  const controller = new DeliveriesController();
  const db = BaseRepository.dbInstance;
  let s: Seed;
  let staffAuth: IAuthKeyPayload;

  beforeEach(async () => {
    s = await seed(db);
    staffAuth = { tenant_id: s.tenantId, user_id: s.organizerId, name: 'Sam Staff', session_id: 'sess', role: 'user' };
  });

  afterEach(async () => {
    await cleanup(db, s.tenantId);
  });

  it('assigning a volunteer mints a fresh personal link and sends it by email and text', async () => {
    const res = await controller.assignVolunteer(staffAuth, { route_id: s.routeId, person_id: s.volunteerPersonId });
    expect(res.sent).toEqual({ email: true, sms: true });

    // Both channels went through the outbox, carrying the same freshly minted token.
    const jobs = (
      await db.selectFrom('background_jobs').select('payload').where('tenant_id', '=', s.tenantId).execute()
    ).map((j) => (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload));
    const mail = jobs.find((p) => p?.type === 'send-transactional-email' && String(p?.to) === 'jordan@example.com');
    const sms = jobs.find((p) => p?.type === 'send-sms');
    expect(mail).toBeTruthy();
    expect(sms).toBeTruthy();
    const tokenFromMail = String(mail?.text).match(/\/r\/([A-Za-z0-9_-]+)/)?.[1];
    expect(tokenFromMail).toBeTruthy();
    expect(String(sms?.body)).toContain(`/r/${tokenFromMail}`);
    expect(String(sms?.to)).toBe('+16135550142');

    // The emailed token is the live one — its hash replaced the seed link on the route.
    const row = await db
      .selectFrom('delivery_routes')
      .select(['share_token_hash'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .executeTakeFirst();
    expect(row?.share_token_hash).toBe(hashToken(String(tokenFromMail)));

    // Unassigning sends nothing.
    const cleared = await controller.assignVolunteer(staffAuth, { route_id: s.routeId, person_id: null });
    expect(cleared.sent).toEqual({ email: false, sms: false });
  });

  it('resendVolunteerLink mints a fresh link, sends it, and retires the old one', async () => {
    const res = await controller.resendVolunteerLink(staffAuth, s.routeId);
    expect(res.sent).toEqual({ email: true, sms: true });

    // The message carries the fresh token — its hash replaced the seed link on the route.
    const jobs = (
      await db.selectFrom('background_jobs').select('payload').where('tenant_id', '=', s.tenantId).execute()
    ).map((j) => (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload));
    const mail = jobs.find((p) => p?.type === 'send-transactional-email');
    const sms = jobs.find((p) => p?.type === 'send-sms');
    expect(mail).toBeTruthy();
    expect(sms).toBeTruthy();
    const tokenFromMail = String(mail?.text).match(/\/r\/([A-Za-z0-9_-]+)/)?.[1];
    expect(tokenFromMail).toBeTruthy();
    expect(String(sms?.body)).toContain(`/r/${tokenFromMail}`);
    const row = await db
      .selectFrom('delivery_routes')
      .select(['share_token_hash'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .executeTakeFirst();
    expect(row?.share_token_hash).toBe(hashToken(String(tokenFromMail)));
    expect(row?.share_token_hash).not.toBe(hashToken(s.routeToken));

    // No volunteer behind the route → nothing to send to.
    await controller.assignVolunteer(staffAuth, { route_id: s.routeId, person_id: null });
    await expect(controller.resendVolunteerLink(staffAuth, s.routeId)).rejects.toThrow(/assign a volunteer/i);
  });

  it('resendVolunteerLink keeps the existing link when the volunteer has no contacts', async () => {
    await db
      .updateTable('persons')
      .set({ email: null, mobile: null })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.volunteerPersonId)
      .execute();
    await expect(controller.resendVolunteerLink(staffAuth, s.routeId)).rejects.toThrow(/no email or mobile/i);

    // The failed resend rolled back — the seed link still works and nothing was enqueued.
    const row = await db
      .selectFrom('delivery_routes')
      .select(['share_token_hash'])
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .executeTakeFirst();
    expect(row?.share_token_hash).toBe(hashToken(s.routeToken));
    const jobs = await db.selectFrom('background_jobs').select('id').where('tenant_id', '=', s.tenantId).execute();
    expect(jobs).toHaveLength(0);
  });

  it('getPublicRoute requires an approved companion session and then returns the minimized payload', async () => {
    // A bare capability link is no longer enough — the stranger with a forwarded URL gets the wall.
    await expect(controller.getPublicRoute(s.routeToken, null)).rejects.toThrow(/verification/i);

    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.organizerId);
    const payload = await controller.getPublicRoute(s.routeToken, session);
    expect(payload).not.toBeNull();
    expect(payload?.organization_name).toBeTruthy();
    expect(payload?.stops).toHaveLength(3);

    // Payload minimization (spec §4.4): first name + address only — never
    // emails, phones, notes, or person/request ids.
    const stopKeys = Object.keys(payload?.stops[0] ?? {}).sort();
    expect(stopKeys).toEqual(['acted_at', 'address', 'first_name', 'id', 'lat', 'lng', 'reason', 'seq', 'status']);
    expect(JSON.stringify(payload)).not.toMatch(/email|phone|mobile|person_id|request_id/);

    // A session for someone else's volunteer identity is rejected.
    await expect(controller.getPublicRoute(s.routeToken, generateToken())).rejects.toThrow(/verification/i);
  });

  it('a replayed stop action with the same op_id applies exactly once', async () => {
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.organizerId);
    const [a, b, c] = s.stopIds;
    const opX = `op-${rand()}-x`;
    const opY = `op-${rand()}-y`;

    const orderOf = (payload: { stops: { id: string }[] } | null): string[] =>
      (payload?.stops ?? []).map((stop) => stop.id);

    // Defer A → B, C, A. Then defer B → C, A, B.
    const first = await controller.publicStopAction(s.routeToken, String(a), 'defer', null, session, opX);
    expect(orderOf(first)).toEqual([b, c, a]);
    const second = await controller.publicStopAction(s.routeToken, String(b), 'defer', null, session, opY);
    expect(orderOf(second)).toEqual([c, a, b]);

    // Replaying the first defer must NOT move A to the end again — the ledger
    // swallows it and we get the current authoritative payload back.
    const replay = await controller.publicStopAction(s.routeToken, String(a), 'defer', null, session, opX);
    expect(orderOf(replay)).toEqual([c, a, b]);
  });

  it('an expired link is dead by default, but the Workspace → App policy can turn expiry off', async () => {
    const session = await mintApprovedSession(db, s.tenantId, s.volunteerPersonId, s.organizerId);
    await db
      .updateTable('delivery_routes')
      .set({ share_token_expires_at: new Date(Date.now() - 1000) })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .execute();

    // Default (no setting row): the stored expiry is enforced on both enforcement points —
    // the data endpoint AND the companion gate's resolveLink.
    await expect(controller.getPublicRoute(s.routeToken, session)).resolves.toBeNull();
    const gate = new CompanionAccessController();
    expect((await gate.getAccess('route', s.routeToken, session)).state).toBe('dead');

    // Workspace turns expiry off: the very same link comes back to life immediately.
    await setLinkExpiryPolicy(db, s.tenantId, s.organizerId, false);
    const payload = await controller.getPublicRoute(s.routeToken, session);
    expect(payload?.stops).toHaveLength(3);
    expect((await gate.getAccess('route', s.routeToken, session)).state).toBe('ready');

    // Turning it back on re-applies the stored date just as immediately.
    await setLinkExpiryPolicy(db, s.tenantId, s.organizerId, true);
    await expect(controller.getPublicRoute(s.routeToken, session)).resolves.toBeNull();
  });

  it('mintShareLink and getRouteById reflect the workspace expiry policy', async () => {
    // Policy ON (default): a fresh mint carries an expiry date.
    const minted = await controller.mintShareLink(staffAuth, { route_id: s.routeId, regenerate: true });
    expect(minted.status).toBe('minted');
    if (minted.status === 'minted') expect(minted.expires_at).toEqual(expect.any(String));

    // Policy OFF: an EXPIRED stored date no longer forces a regenerate — the link counts as
    // active ('exists'), and no misleading date is reported anywhere.
    await setLinkExpiryPolicy(db, s.tenantId, s.organizerId, false);
    await db
      .updateTable('delivery_routes')
      .set({ share_token_expires_at: new Date(Date.now() - 1000) })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .execute();
    const existing = await controller.mintShareLink(staffAuth, { route_id: s.routeId });
    expect(existing).toEqual({ status: 'exists', expires_at: null });

    const detail = await controller.getRouteById(staffAuth, s.routeId);
    expect(detail.link_active).toBe(true);
    expect(detail.link_expires_at).toBeNull();

    // And a mint under the disabled policy reports no expiry (the date is still stored as data).
    const remint = await controller.mintShareLink(staffAuth, { route_id: s.routeId, regenerate: true });
    expect(remint.status).toBe('minted');
    if (remint.status === 'minted') expect(remint.expires_at).toBeNull();
    const row = await db
      .selectFrom('delivery_routes')
      .select('share_token_expires_at')
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .executeTakeFirst();
    expect(row?.share_token_expires_at).not.toBeNull();
  });

  it('mintShareLink refuses a route with no volunteer attached', async () => {
    await db
      .updateTable('delivery_routes')
      .set({ volunteer_person_id: null, share_token_hash: null, share_token_expires_at: null })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', s.routeId)
      .execute();
    await expect(controller.mintShareLink(staffAuth, { route_id: s.routeId })).rejects.toThrow(/assign a volunteer/i);
  });
});

describe('DeliveriesController — one open request per household', () => {
  const controller = new DeliveriesController();
  const db = BaseRepository.dbInstance;
  let s: Seed;
  let staffAuth: IAuthKeyPayload;

  const freshHousehold = async (): Promise<string> => {
    const householdId = rand();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: s.tenantId,
        campaign_id: s.campaignId,
        createdby_id: s.organizerId,
        updatedby_id: s.organizerId,
      })
      .execute();
    return householdId;
  };

  beforeEach(async () => {
    s = await seed(db);
    staffAuth = { tenant_id: s.tenantId, user_id: s.organizerId, name: 'Sam Staff', session_id: 'sess', role: 'user' };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup(db, s.tenantId);
  });

  it('the pre-check refuses a second open request for the same household (fast path)', async () => {
    const householdId = await freshHousehold();
    const first = await controller.addRequest(staffAuth, { household_id: householdId, campaign_id: s.campaignId });
    expect(first.id).toBeTruthy();

    // The SELECT-then-INSERT pre-check sees the existing open request and refuses — a 409, not a
    // duplicate stop on a route.
    await expect(
      controller.addRequest(staffAuth, { household_id: householdId, campaign_id: s.campaignId }),
    ).rejects.toThrow(/already has an open delivery request/i);

    const open = await db
      .selectFrom('delivery_requests')
      .select(['id'])
      .where('tenant_id', '=', s.tenantId)
      .where('household_id', '=', householdId)
      .where('status', 'in', ['new', 'approved'])
      .execute();
    expect(open).toHaveLength(1);
  });

  it('converts a concurrent-insert 23505 (past the pre-check) into a graceful conflict, never a 500', async () => {
    // Simulate the race the new partial unique index closes: both callers clear the pre-check, then
    // one insert loses on uq_delivery_requests_open_per_household. The controller must translate that
    // Postgres unique-violation into the same "already open" 409 the pre-check throws.
    const householdId = await freshHousehold();
    const violation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'uq_delivery_requests_open_per_household',
    });
    const addSpy = vi.spyOn((controller as any).requestsRepo, 'add').mockRejectedValue(violation);

    await expect(
      controller.addRequest(staffAuth, { household_id: householdId, campaign_id: s.campaignId }),
    ).rejects.toThrow(/already has an open delivery request/i);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('re-throws an unrelated database error rather than masking it as a conflict', async () => {
    const householdId = await freshHousehold();
    const other = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    vi.spyOn((controller as any).requestsRepo, 'add').mockRejectedValue(other);

    await expect(
      controller.addRequest(staffAuth, { household_id: householdId, campaign_id: s.campaignId }),
    ).rejects.toThrow(/deadlock detected/i);
  });
});

describe('DeliveriesController — reorderStops (drag-to-reorder)', () => {
  const controller = new DeliveriesController();
  const db = BaseRepository.dbInstance;
  let s: Seed;
  let staffAuth: IAuthKeyPayload;

  const seqOf = async (stopId: string): Promise<number> => {
    const row = await db
      .selectFrom('delivery_route_stops')
      .select('seq')
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', stopId)
      .executeTakeFirstOrThrow();
    return Number(row.seq);
  };

  beforeEach(async () => {
    s = await seed(db);
    staffAuth = { tenant_id: s.tenantId, user_id: s.organizerId, name: 'Sam Staff', session_id: 'sess', role: 'user' };
  });

  afterEach(async () => {
    await cleanup(db, s.tenantId);
  });

  it('reseats pending stops into the requested order, dodging the unique(route_id, seq) index', async () => {
    const [a, b, c] = s.stopIds; // seq 1,2,3

    // A full reversal forces overlapping seq targets — proves the temp-offset write is unique-safe.
    const res = await controller.reorderStops(staffAuth, {
      route_id: s.routeId,
      ordered_stop_ids: [String(c), String(b), String(a)],
    });
    expect(res.stops.map((stop) => stop.id)).toEqual([String(c), String(b), String(a)]);
    expect(await seqOf(String(c))).toBe(1);
    expect(await seqOf(String(b))).toBe(2);
    expect(await seqOf(String(a))).toBe(3);

    // Exactly one reorder activity is logged for the resequence.
    const activity = await db
      .selectFrom('user_activity')
      .select(['metadata'])
      .where('tenant_id', '=', s.tenantId)
      .where('entity', '=', 'delivery_routes')
      .where('entity_id', '=', s.routeId)
      .execute();
    const reorders = activity.filter((r) => (r.metadata as { action?: string })?.action === 'stop_reordered');
    expect(reorders).toHaveLength(1);
  });

  it('keeps delivered/skipped stops fixed and only permutes the pending stops', async () => {
    const [a, b, c] = s.stopIds; // seq 1,2,3
    // Mark the middle stop delivered — it must keep seq 2 and stay out of the movable set.
    await db
      .updateTable('delivery_route_stops')
      .set({ status: 'delivered' })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', String(b))
      .execute();

    // Swap the two pending stops (a<->c); b stays put.
    await controller.reorderStops(staffAuth, { route_id: s.routeId, ordered_stop_ids: [String(c), String(a)] });
    expect(await seqOf(String(c))).toBe(1);
    expect(await seqOf(String(b))).toBe(2); // delivered stop unmoved
    expect(await seqOf(String(a))).toBe(3);
  });

  it('rejects a non-pending id in the order', async () => {
    const [a, b, c] = s.stopIds;
    await db
      .updateTable('delivery_route_stops')
      .set({ status: 'delivered' })
      .where('tenant_id', '=', s.tenantId)
      .where('id', '=', String(b))
      .execute();
    // Including the delivered stop id (or all three) is not "exactly the pending set".
    await expect(
      controller.reorderStops(staffAuth, {
        route_id: s.routeId,
        ordered_stop_ids: [String(a), String(b), String(c)],
      }),
    ).rejects.toThrow(/pending stops/i);
  });

  it('rejects a stop id that belongs to another route', async () => {
    const [a, b] = s.stopIds;
    // A foreign id is not in this route's pending set → rejected.
    await expect(
      controller.reorderStops(staffAuth, {
        route_id: s.routeId,
        ordered_stop_ids: [String(a), String(b), '999999999'],
      }),
    ).rejects.toThrow(/pending stops/i);
  });

  it('rejects a route from another tenant (tenant scoping)', async () => {
    const other = await seed(db);
    const otherAuth: IAuthKeyPayload = {
      tenant_id: other.tenantId,
      user_id: other.organizerId,
      name: 'Other',
      session_id: 'sess2',
      role: 'user',
    };
    try {
      // s.routeId belongs to tenant s, not to otherAuth's tenant → route not found.
      await expect(
        controller.reorderStops(otherAuth, { route_id: s.routeId, ordered_stop_ids: s.stopIds.map(String) }),
      ).rejects.toThrow(/route not found/i);
    } finally {
      await cleanup(db, other.tenantId);
    }
  });
});
