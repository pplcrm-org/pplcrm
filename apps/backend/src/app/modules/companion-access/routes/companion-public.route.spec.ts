import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { generateToken, hashToken } from '../../../lib/token-hash';
import companionPublicRoute from './companion-public.route';

/**
 * HTTP-level tests for the public companion access API (mounted at /api/companion in
 * routes.ts). The controller has its own spec; this one pins the ROUTE contract the
 * mobile gate depends on:
 *
 * - The X-Companion-Session guard: no header and a garbage token are both 401, a valid
 *   session of an approved volunteer passes through to the handler, and a verified-but-
 *   not-yet-approved volunteer is 403 — the gate renders a different screen for each.
 * - The deliberate anti-probing shapes: /access and unknown capability tokens answer
 *   200 {state:'dead'} (never 404), join-code refusals are one uniform message, and
 *   /session/end always answers 200 so it can't be used to test whether a token lives.
 *
 * Seeds are the minimum the guard actually reads: a tenant, one person (volunteer),
 * a companion_volunteers row, a companion_sessions row holding the HASHED session
 * token, and a campaign_join_codes row for the session-guarded /join/attach endpoint.
 * The join code deliberately names no turf, so the happy path stops at {turf_id:null}
 * without needing a canvassing world.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

type Db = typeof BaseRepository.dbInstance;

describe('companion-public route (session guard + anti-probing contract)', () => {
  const db: Db = BaseRepository.dbInstance;
  let app: FastifyInstance;

  let tenantId: string;
  let adminId: string;
  let campaignId: string;
  let householdId: string;
  let personId: string;
  let volunteerId: string;
  let joinCode: string;
  let sessionToken: string;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(companionPublicRoute, { prefix: '/api/companion' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    tenantId = rand();
    adminId = rand();
    campaignId = rand();
    householdId = rand();
    personId = rand();
    joinCode = `JC${rand()}`; // stored uppercase; resolveByCode uppercases the input
    sessionToken = generateToken();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Companion Route Test' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: adminId,
        tenant_id: tenantId,
        email: `t-${adminId}@example.com`,
        password: 'x',
        first_name: 'Avery',
        last_name: 'Staff',
        role: 'admin',
        verified: true,
        createdby_id: adminId,
        updatedby_id: adminId,
      })
      .execute();
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
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: adminId,
        updatedby_id: adminId,
      })
      .execute();
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        household_id: householdId,
        first_name: 'Jordan',
        last_name: 'Rivera',
        email: `jordan-${personId}@example.com`,
        createdby_id: adminId,
        updatedby_id: adminId,
      })
      .execute();

    // companion_volunteers / companion_sessions ids are GENERATED ALWAYS — no explicit id.
    const volunteer = await db
      .insertInto('companion_volunteers')
      .values({
        tenant_id: tenantId,
        person_id: personId,
        status: 'approved',
        createdby_id: adminId,
        updatedby_id: adminId,
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    volunteerId = String(volunteer.id);

    await db
      .insertInto('companion_sessions')
      .values({
        tenant_id: tenantId,
        volunteer_id: volunteerId,
        token_hash: hashToken(sessionToken),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } as any)
      .execute();

    await db
      .insertInto('campaign_join_codes')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        code: joinCode,
        status: 'active',
        createdby_id: adminId,
        updatedby_id: adminId,
      } as any)
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('companion_sessions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaign_join_codes').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('companion_volunteers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function attach(headers: Record<string, string> = {}, code = joinCode) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/companion/join/attach',
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify({ code }),
    });
    return { statusCode: res.statusCode, body: res.json() as { error?: string; turf_id?: string | null } };
  }

  it('401s a session-guarded endpoint (/join/attach) when the X-Companion-Session header is missing', async () => {
    const { statusCode, body } = await attach();
    expect(statusCode).toBe(401);
    expect(body.error).toBe('Verify this device first.');
  });

  it('401s the same endpoint for a garbage session token', async () => {
    const { statusCode, body } = await attach({ 'x-companion-session': `garbage-${rand()}` });
    expect(statusCode).toBe(401);
    expect(body.error).toBe('Verify this device first.');
  });

  it('401s a revoked session — server-side revocation beats a copied token', async () => {
    await db
      .updateTable('companion_sessions')
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .execute();
    const { statusCode } = await attach({ 'x-companion-session': sessionToken });
    expect(statusCode).toBe(401);
  });

  it('lets a valid session of an approved volunteer through to the handler (200, turf_id null)', async () => {
    const { statusCode, body } = await attach({ 'x-companion-session': sessionToken });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ turf_id: null });
  });

  it('403s a valid session whose volunteer is verified but not yet approved', async () => {
    await db
      .updateTable('companion_volunteers')
      .set({ status: 'verified' })
      .where('tenant_id', '=', tenantId)
      .execute();
    const { statusCode, body } = await attach({ 'x-companion-session': sessionToken });
    expect(statusCode).toBe(403);
    expect(body.error).toBe('Waiting for your organizer to approve you.');
  });

  it('answers an unknown join code with the single uniform refusal (404) — codes cannot be probed', async () => {
    const { statusCode, body } = await attach({ 'x-companion-session': sessionToken }, `ZZ${rand()}`);
    expect(statusCode).toBe(404);
    expect(body.error).toBe('That code is not accepting new volunteers. Check with your organizer.');
  });

  it('GET /access answers 200 {state:"dead"} for an unknown capability token — never a 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/companion/access?kind=turf&token=${generateToken()}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'dead' });
  });

  it('GET /access answers 200 {state:"dead"} for a malformed query too (token below min length)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/companion/access?kind=turf&token=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'dead' });
  });

  it('GET /access?kind=session reports "ready" for a valid approved session (the guard passes on GET too)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/companion/access?kind=session',
      headers: { 'x-companion-session': sessionToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: string; volunteerName?: string };
    expect(body.state).toBe('ready');
    expect(body.volunteerName).toBe('Jordan');
  });

  it('GET /access?kind=session with no session header is the uniform dead state, not a 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/companion/access?kind=session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'dead' });
  });

  it('POST /session/end always answers 200 {ok:true}, even with no session header (no liveness probe)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/companion/session/end' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('POST /session/end with a valid token revokes the session server-side and still answers 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/companion/session/end',
      headers: { 'x-companion-session': sessionToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = await db
      .selectFrom('companion_sessions')
      .select('revoked_at')
      .where('tenant_id', '=', tenantId)
      .where('token_hash', '=', hashToken(sessionToken))
      .executeTakeFirst();
    expect(row?.revoked_at).not.toBeNull();
  });

  it('POST /verify/start rejects a malformed body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/companion/verify/start',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ kind: 'turf' }), // missing token + channel
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('Invalid request.');
  });
});
