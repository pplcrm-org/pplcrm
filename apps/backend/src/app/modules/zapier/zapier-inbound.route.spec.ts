import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

import { TooManyRequestsError } from '../../errors/app-errors';

// Control the shared rate limiter so we can assert the route's onRequest hook
// translates a limit breach into a 429 without pumping 120 real requests.
vi.mock('../../lib/rate-limiter', () => ({ checkRateLimit: vi.fn() }));
// Stop the tenant lookup from touching Postgres; an unknown key -> 401. (Zapier
// authenticates with the shared workspace API key — lib/validate-api-key.)
vi.mock('../../lib/validate-api-key', () => ({ lookupTenantByApiKey: vi.fn().mockResolvedValue(null) }));
vi.mock('../persons/services/persons.service', () => ({ PersonsService: class {} }));

import { checkRateLimit } from '../../lib/rate-limiter';
import { lookupTenantByApiKey } from '../../lib/validate-api-key';
import { BaseRepository } from '../../lib/base.repo';
import zapierInboundRoute from './zapier-inbound.route';

const lookupMock = lookupTenantByApiKey as unknown as ReturnType<typeof vi.fn>;
const rateLimitMock = checkRateLimit as unknown as ReturnType<typeof vi.fn>;

async function buildApp() {
  const app = Fastify();
  await app.register(zapierInboundRoute, { prefix: '/api/zapier' });
  return app;
}

describe('zapier inbound rate limiting (SECURITY-REVIEW.md 2.4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 429 when the rate limit is exceeded', async () => {
    (checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new TooManyRequestsError('Too many requests. Retry in 30 seconds.', { retryAfterSec: 30 });
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/zapier/persons/upsert',
      headers: { authorization: 'Bearer any-key' },
      payload: { email: 'a@b.com' },
    });
    await app.close();

    expect(res.statusCode).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith(expect.stringContaining('zapier:'), 120, 60000);
  });

  it('lets a request through the hook when under the limit', async () => {
    (checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/zapier/persons/upsert',
      headers: { authorization: 'Bearer bad-key' },
      payload: { email: 'a@b.com' },
    });
    await app.close();

    // Hook passed; handler ran and rejected the unknown key.
    expect(res.statusCode).toBe(401);
  });
});

/**
 * The REST-hooks surface a published Zapier app drives: connection test, subscribe /
 * unsubscribe, and the read endpoints. Subscribe/unsubscribe run against the real database
 * (the multiple-hooks-per-event behavior lives in a constraint); the key lookup and the
 * rate limiter stay mocked.
 */
describe('zapier REST hooks endpoints', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test access to the shared Kysely instance
  const db = (BaseRepository as any)._db;
  const tenantId = String(Math.floor(Math.random() * 100000000) + 1000000);

  beforeAll(async () => {
    await db.insertInto('tenants').values({ id: tenantId, name: 'Zapier hooks spec' }).execute();
  });

  afterAll(async () => {
    await db.deleteFrom('zapier_subscriptions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockImplementation(() => undefined);
    lookupMock.mockResolvedValue(tenantId);
  });

  it('rejects every REST-hooks endpoint without a valid key', async () => {
    lookupMock.mockResolvedValue(null);
    const app = await buildApp();
    for (const [method, url] of [
      ['GET', '/api/zapier/me'],
      ['POST', '/api/zapier/subscribe'],
      ['DELETE', '/api/zapier/subscribe/1'],
      ['GET', '/api/zapier/persons/search?email=a@b.com'],
      ['GET', '/api/zapier/persons/recent'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { authorization: 'Bearer bad-key' } });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });

  it('spends the per-tenant budget once the key resolves — not only the per-IP one', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/zapier/me',
      headers: { authorization: 'Bearer good-key' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workspace: 'Zapier hooks spec' });
    expect(rateLimitMock).toHaveBeenCalledWith(`zapier:tenant:${tenantId}`, 120, 60000);
  });

  it('subscribe returns an id per hook URL; identical re-subscribe returns the same id', async () => {
    const app = await buildApp();
    const subscribe = (hook_url: string) =>
      app.inject({
        method: 'POST',
        url: '/api/zapier/subscribe',
        headers: { authorization: 'Bearer good-key' },
        payload: { event_type: 'person_created', hook_url },
      });

    const first = await subscribe('https://hooks.zapier.com/spec-a');
    const second = await subscribe('https://hooks.zapier.com/spec-b');
    const repeat = await subscribe('https://hooks.zapier.com/spec-a');
    await app.close();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).not.toBe(second.json().id);
    expect(repeat.json().id).toBe(first.json().id);
  });

  it('unsubscribe deletes the subscription and stays idempotent', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/zapier/subscribe',
      headers: { authorization: 'Bearer good-key' },
      payload: { event_type: 'person_deleted', hook_url: 'https://hooks.zapier.com/spec-del' },
    });
    const { id } = created.json();

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/zapier/subscribe/${id}`,
      headers: { authorization: 'Bearer good-key' },
    });
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/zapier/subscribe/${id}`,
      headers: { authorization: 'Bearer good-key' },
    });
    await app.close();

    expect(del.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    const rows = await db
      .selectFrom('zapier_subscriptions')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('event_type', '=', 'person_deleted')
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('subscribe validates the body: unknown event and non-https hook URL are 400', async () => {
    const app = await buildApp();
    const badEvent = await app.inject({
      method: 'POST',
      url: '/api/zapier/subscribe',
      headers: { authorization: 'Bearer good-key' },
      payload: { event_type: 'donation_created', hook_url: 'https://hooks.zapier.com/x' },
    });
    const badUrl = await app.inject({
      method: 'POST',
      url: '/api/zapier/subscribe',
      headers: { authorization: 'Bearer good-key' },
      payload: { event_type: 'person_created', hook_url: 'http://hooks.zapier.com/x' },
    });
    const badId = await app.inject({
      method: 'DELETE',
      url: '/api/zapier/subscribe/not-a-number',
      headers: { authorization: 'Bearer good-key' },
    });
    await app.close();

    expect(badEvent.statusCode).toBe(400);
    expect(badUrl.statusCode).toBe(400);
    expect(badId.statusCode).toBe(400);
  });

  it('search validates the email and returns an empty array — not 404 — on no match', async () => {
    const app = await buildApp();
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/zapier/persons/search?email=not-an-email',
      headers: { authorization: 'Bearer good-key' },
    });
    const empty = await app.inject({
      method: 'GET',
      url: '/api/zapier/persons/search?email=nobody@example.com',
      headers: { authorization: 'Bearer good-key' },
    });
    const recent = await app.inject({
      method: 'GET',
      url: '/api/zapier/persons/recent',
      headers: { authorization: 'Bearer good-key' },
    });
    await app.close();

    expect(invalid.statusCode).toBe(400);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    expect(recent.statusCode).toBe(200);
    expect(recent.json()).toEqual([]);
  });
});
