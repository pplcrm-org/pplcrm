import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { generateToken, hashToken } from '../../../lib/token-hash';
import deliveriesPublicRoute from './deliveries-public.route';

/**
 * HTTP-level tests for the public volunteer delivery page (mounted at /api/deliveries in
 * routes.ts, consumed by the /r/:token companion). The controller has its own spec; this
 * one pins the ROUTE contract:
 *
 * - The two-credential model: the capability token in the URL says WHAT (one route), the
 *   X-Companion-Session header says WHO. No header and a garbage token are both 401
 *   (the gate re-verifies), a verified-but-unapproved volunteer is 403 (the gate shows
 *   "waiting for approval"), and only those two statuses pass through — everything else
 *   is the uniform 404 "not active" body, so dead, expired, canceled and never-existed
 *   tokens are indistinguishable from outside.
 * - Input validation on the stop-action POST (action allow-list, op_id length bounds).
 *
 * Seeds are the minimum the guard reads: tenant → admin → campaign → household → person,
 * one delivery_routes row holding the HASHED share token (with a future expiry — links
 * expire by default per volunteer-link-policy), and the person's companion_volunteers +
 * companion_sessions rows. No stops: the guard and status codes are the subject.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const NOT_ACTIVE_MSG = "This route link isn't active. Ask your organizer for a new one.";

type Db = typeof BaseRepository.dbInstance;

describe('deliveries-public route (session guard + uniform not-active contract)', () => {
  const db: Db = BaseRepository.dbInstance;
  let app: FastifyInstance;

  let tenantId: string;
  let adminId: string;
  let campaignId: string;
  let householdId: string;
  let personId: string;
  let routeId: string;
  let routeToken: string;
  let sessionToken: string;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(deliveriesPublicRoute, { prefix: '/api/deliveries' });
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
    routeToken = generateToken();
    sessionToken = generateToken();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Deliveries Route Test' }).execute();
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

    // delivery_routes.id is GENERATED ALWAYS — no explicit id. Expiry is set in the
    // future because volunteer links expire by default (volunteer-link-policy).
    const route = await db
      .insertInto('delivery_routes')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Maple Street run',
        status: 'assigned',
        volunteer_person_id: personId,
        start_address: '1 Test Way',
        start_lat: 45.42,
        start_lng: -75.69,
        share_token_hash: hashToken(routeToken),
        share_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdby_id: adminId,
        updatedby_id: adminId,
      } as any)
      .returning('id')
      .executeTakeFirstOrThrow();
    routeId = String(route.id);

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

    await db
      .insertInto('companion_sessions')
      .values({
        tenant_id: tenantId,
        volunteer_id: String(volunteer.id),
        token_hash: hashToken(sessionToken),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } as any)
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('companion_sessions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('companion_volunteers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('companion_ops').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('delivery_route_stops').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('delivery_routes').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function getRoute(token: string, headers: Record<string, string> = {}) {
    const res = await app.inject({ method: 'GET', url: `/api/deliveries/r/${token}`, headers });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function postStop(
    token: string,
    stopId: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/deliveries/r/${token}/stops/${stopId}`,
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(payload),
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it('GET /r/:token answers the uniform 404 "not active" body for an unknown token', async () => {
    const { statusCode, body } = await getRoute(generateToken());
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: NOT_ACTIVE_MSG });
  });

  it('GET /r/:token is 401 when the X-Companion-Session header is missing', async () => {
    const { statusCode, body } = await getRoute(routeToken);
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'Verification required.' });
  });

  it('GET /r/:token is 401 for a garbage session token', async () => {
    const { statusCode, body } = await getRoute(routeToken, { 'x-companion-session': `garbage-${rand()}` });
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'Verification required.' });
  });

  it('GET /r/:token is 403 for a valid session whose volunteer is not yet approved', async () => {
    await db
      .updateTable('companion_volunteers')
      .set({ status: 'verified' })
      .where('tenant_id', '=', tenantId)
      .execute();
    const { statusCode, body } = await getRoute(routeToken, { 'x-companion-session': sessionToken });
    expect(statusCode).toBe(403);
    expect(body).toEqual({ error: 'Waiting for organizer approval.' });
  });

  it('GET /r/:token with a valid approved session reaches the handler and returns the payload', async () => {
    const { statusCode, body } = await getRoute(routeToken, { 'x-companion-session': sessionToken });
    expect(statusCode).toBe(200);
    expect(body['route_name']).toBe('Maple Street run');
    expect(body['status']).toBe('assigned');
    expect(body['organization_name']).toBe('Deliveries Route Test');
    expect(body['stops_total']).toBe(0);
    expect(body['stops']).toEqual([]);
  });

  it('GET /r/:token is 401 when the route has no volunteer attached — the link must be re-sent', async () => {
    await db
      .updateTable('delivery_routes')
      .set({ volunteer_person_id: null })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', routeId)
      .execute();
    const { statusCode, body } = await getRoute(routeToken, { 'x-companion-session': sessionToken });
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'This link needs to be re-sent by your organizer.' });
  });

  it('GET /r/:token on a canceled route is the same uniform 404 as an unknown token', async () => {
    await db
      .updateTable('delivery_routes')
      .set({ status: 'canceled' })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', routeId)
      .execute();
    const { statusCode, body } = await getRoute(routeToken, { 'x-companion-session': sessionToken });
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: NOT_ACTIVE_MSG });
  });

  it('GET /r/:token on an expired share token is the same uniform 404 (expiry is the default policy)', async () => {
    await db
      .updateTable('delivery_routes')
      .set({ share_token_expires_at: new Date(Date.now() - 60 * 1000) })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', routeId)
      .execute();
    const { statusCode, body } = await getRoute(routeToken, { 'x-companion-session': sessionToken });
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: NOT_ACTIVE_MSG });
  });

  it('POST a stop action rejects an unknown action with 400 before touching the token', async () => {
    const { statusCode, body } = await postStop(routeToken, rand(), { action: 'set-on-fire' });
    expect(statusCode).toBe(400);
    expect(body).toEqual({ error: 'Unknown action.' });
  });

  it('POST a stop action rejects a malformed op_id (too short) with 400', async () => {
    const { statusCode, body } = await postStop(routeToken, rand(), { action: 'deliver', op_id: 'abc' });
    expect(statusCode).toBe(400);
    expect(body).toEqual({ error: 'Invalid op_id.' });
  });

  it('POST a stop action on an unknown token is the uniform 404', async () => {
    const { statusCode, body } = await postStop(generateToken(), rand(), { action: 'deliver' });
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: NOT_ACTIVE_MSG });
  });

  it('POST a stop action without a session is 401 — the guard runs before the stop lookup', async () => {
    const { statusCode, body } = await postStop(routeToken, rand(), { action: 'deliver' });
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'Verification required.' });
  });

  it('POST with a valid session but an unknown stop id passes the guard and 404s uniformly', async () => {
    const { statusCode, body } = await postStop(
      routeToken,
      rand(),
      { action: 'deliver' },
      { 'x-companion-session': sessionToken },
    );
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: NOT_ACTIVE_MSG });
  });
});
