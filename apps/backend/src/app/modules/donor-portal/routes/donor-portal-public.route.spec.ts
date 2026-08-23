import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { generateToken, hashToken } from '../../../lib/token-hash';
import { PortalLinksRepo } from '../repositories/portal-links.repo';
import donorPortalPublicRoute from './donor-portal-public.route';

/**
 * HTTP-level tests for the public giving portal (mounted at /api/donor-portal in routes.ts,
 * consumed by the /g/:token page). The controller has its own spec; this one pins the ROUTE
 * contract:
 *
 * - Dead tokens are indistinguishable from outside: expired, revoked and never-existed all
 *   answer the SAME 404 body, byte for byte.
 * - Every reply carries X-Robots-Tag: noindex — these are personal pages.
 * - POST /request-link answers an identical 200 {ok:true} whether or not the email matches a
 *   donor (the lookup happens only inside the background job, so the endpoint cannot probe who
 *   has donated), and enqueues the send-donor-portal-link job either way. A malformed email is
 *   the one honest 400.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

type Db = typeof BaseRepository.dbInstance;

describe('donor-portal public route (uniform not-active + request-link privacy)', () => {
  const db: Db = BaseRepository.dbInstance;
  const linksRepo = new PortalLinksRepo();
  let app: FastifyInstance;

  let tenantId: string;
  let tenantSlug: string;
  let userId: string;
  let householdId: string;
  let personId: string;
  let personEmail: string;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(donorPortalPublicRoute, { prefix: '/api/donor-portal' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** The request-link durable limiter keys on the inject client IP (shared across runs within
   *  the hour) and on tenant+email — clear both so repeated local runs never trip 429. */
  async function clearDurableLimits(): Promise<void> {
    await db.deleteFrom('rate_limits').where('key', 'like', 'donor-portal-req-ip:%').execute();
    if (tenantId) {
      await db.deleteFrom('rate_limits').where('key', 'like', `donor-portal-req:${tenantId}:%`).execute();
    }
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    householdId = rand();
    tenantSlug = `test-${tenantId}`;
    personEmail = `donor-${tenantId}@example.com`;

    await clearDurableLimits();

    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'Donor Portal Route Tenant', slug: tenantSlug })
      .execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `admin-${userId}@example.com`,
        password: 'password',
        first_name: 'Avery',
        last_name: 'Admin',
        role: 'admin',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('households')
      .values({ id: householdId, tenant_id: tenantId, createdby_id: userId, updatedby_id: userId })
      .execute();
    const person = await db
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        household_id: householdId,
        first_name: 'Dana',
        last_name: 'Donor',
        email: personEmail,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    personId = String(person.id);
    await db
      .updateTable('tenants')
      .set({ admin_id: userId, createdby_id: userId })
      .where('id', '=', tenantId)
      .execute();
  });

  afterEach(async () => {
    await clearDurableLimits();
    await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
    for (const table of [
      'background_jobs',
      'user_activity',
      'donor_portal_links',
      'persons',
      'households',
      'authusers',
    ] as const) {
      await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function getSummary(token: string) {
    return app.inject({ method: 'GET', url: `/api/donor-portal/${token}` });
  }

  it('answers the SAME 404 body — byte for byte — for expired, revoked and never-existed tokens', async () => {
    const expired = await linksRepo.mint({ tenant_id: tenantId, person_id: personId });
    const revoked = await linksRepo.mint({ tenant_id: tenantId, person_id: personId });
    await db
      .updateTable('donor_portal_links')
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where('tenant_id', '=', tenantId)
      .where('token_hash', '=', hashToken(expired.token))
      .execute();
    await db
      .updateTable('donor_portal_links')
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('token_hash', '=', hashToken(revoked.token))
      .execute();

    const expiredRes = await getSummary(expired.token);
    const revokedRes = await getSummary(revoked.token);
    const missingRes = await getSummary(generateToken());

    expect(expiredRes.statusCode).toBe(404);
    expect(revokedRes.statusCode).toBe(404);
    expect(missingRes.statusCode).toBe(404);
    expect(expiredRes.body).toBe(missingRes.body);
    expect(revokedRes.body).toBe(missingRes.body);
    expect(missingRes.json()).toEqual({
      error: "This link isn't active. Request a new one from your organization's giving page.",
    });
  });

  it('marks every reply X-Robots-Tag: noindex — the 404s and the live page alike', async () => {
    const live = await linksRepo.mint({ tenant_id: tenantId, person_id: personId });

    const liveRes = await getSummary(live.token);
    const deadRes = await getSummary(generateToken());

    expect(liveRes.statusCode).toBe(200);
    expect((liveRes.json() as { first_name?: string }).first_name).toBe('Dana');
    expect(liveRes.headers['x-robots-tag']).toBe('noindex');
    expect(deadRes.headers['x-robots-tag']).toBe('noindex');
  });

  async function postRequestLink(email: string) {
    return app.inject({
      method: 'POST',
      url: `/api/donor-portal/request-link?t=${tenantSlug}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email }),
    });
  }

  it('POST /request-link answers an identical 200 for matching and non-matching emails, enqueuing the job either way', async () => {
    const matching = await postRequestLink(personEmail);
    const nonMatching = await postRequestLink(`nobody-${rand()}@example.com`);

    expect(matching.statusCode).toBe(200);
    expect(nonMatching.statusCode).toBe(200);
    expect(matching.body).toBe(nonMatching.body); // byte-identical — no donor probing
    expect(matching.json()).toEqual({ ok: true });

    const jobs = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).execute();
    const payloads = jobs
      .map((j) => (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload) as Record<string, unknown>)
      .filter((p) => p['type'] === 'send-donor-portal-link');
    expect(payloads).toHaveLength(2);
    const emails = payloads.map((p) => String(p['email'])).sort();
    expect(emails).toContain(personEmail);
  });

  it('POST /request-link rejects a malformed email with an honest 400', async () => {
    const res = await postRequestLink('not-an-email');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Enter a valid email address.' });
    const jobs = await db.selectFrom('background_jobs').select('id').where('tenant_id', '=', tenantId).execute();
    expect(jobs).toHaveLength(0);
  });
});
