import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { encodeUnsubscribeToken } from '../unsubscribe-token';
import unsubscribeRoute from './unsubscribe.route';

/**
 * The RFC 8058 contract for the automation-email unsubscribe route:
 *  - GET never mutates (mail scanners prefetch links) — it renders a confirm page.
 *  - POST mutates. Both the confirm page's <form> submit and a one-click client POST arrive as
 *    application/x-www-form-urlencoded, which the global server does not parse — the route must
 *    register its own formbody parser or Fastify 415s before the handler runs (the 2026-07-24
 *    regression this spec pins).
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

async function buildApp(): Promise<FastifyInstance> {
  // Mirror fastify.server.ts: without maxParamLength the router 404s any param over
  // find-my-way's 100-char default — and real unsubscribe tokens are ~140+ chars.
  const app = Fastify({ routerOptions: { maxParamLength: 1024 } });
  await app.register(unsubscribeRoute, { prefix: '/api/unsubscribe' });
  return app;
}

describe('unsubscribe route (automation emails)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;
  let app: FastifyInstance;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let personId: string;
  let subscriptionId: string;
  let token: string;

  async function subscriptionRow(): Promise<{ status: string; unsubscribed_at: Date | null } | undefined> {
    return db
      .selectFrom('campaign_subscriptions')
      .select(['status', 'unsubscribed_at'])
      .where('id', '=', subscriptionId)
      .executeTakeFirst();
  }

  beforeEach(async () => {
    app = await buildApp();

    tenantId = rand();
    userId = rand();
    campaignId = rand();
    householdId = rand();
    personId = rand();
    subscriptionId = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Unsubscribe Test Tenant' }).execute();
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
        name: 'Unsubscribe Campaign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Sam',
        last_name: 'Supporter',
        email: 'supporter@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaign_subscriptions')
      .values({
        id: subscriptionId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        person_id: personId,
        createdby_id: userId,
        updatedby_id: userId,
        email: 'supporter@example.com',
        status: 'subscribed',
      })
      .execute();

    token = encodeUnsubscribeToken({ tenantId, personId, email: 'supporter@example.com' });
  });

  afterEach(async () => {
    await app.close();
    await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('GET renders the confirm page and does NOT unsubscribe', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/unsubscribe/${token}` });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('method="POST"');
    expect(res.body).toContain('supporter@example.com');

    const row = await subscriptionRow();
    expect(row?.status).toBe('subscribed');
    expect(row?.unsubscribed_at).toBeNull();
  });

  it('POST from the confirm page form (urlencoded, empty body) unsubscribes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/unsubscribe/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('unsubscribed');

    const row = await subscriptionRow();
    expect(row?.status).toBe('unsubscribed');
    expect(row?.unsubscribed_at).not.toBeNull();
  });

  it('POST with the RFC 8058 one-click body unsubscribes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/unsubscribe/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });

    expect(res.statusCode).toBe(200);

    const row = await subscriptionRow();
    expect(row?.status).toBe('unsubscribed');
  });

  it('404s a tampered token on both GET and POST without mutating', async () => {
    const bad = `${token.slice(0, -2)}xx`;

    const getRes = await app.inject({ method: 'GET', url: `/api/unsubscribe/${bad}` });
    expect(getRes.statusCode).toBe(404);

    const postRes = await app.inject({
      method: 'POST',
      url: `/api/unsubscribe/${bad}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(postRes.statusCode).toBe(404);

    const row = await subscriptionRow();
    expect(row?.status).toBe('subscribed');
  });
});
