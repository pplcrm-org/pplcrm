import { createSign, generateKeyPairSync } from 'crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../../../env';
import { BaseRepository } from '../../../lib/base.repo';
import newslettersWebhookRoute from './newsletters-webhook.route';

/**
 * The SendGrid event webhook is the entry point for engagement stats, consent side-effects
 * (suppressions, unsubscribes) and the abuse tripwires that pause/suspend a tenant. These tests
 * drive the real route with genuinely ECDSA-signed payloads against the test database, mirroring
 * the raw-body content-type parser from fastify.server.ts.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

// Same key shape SendGrid uses: ECDSA P-256, public key distributed as base64 DER (spki).
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

function signedHeaders(rawBody: string): Record<string, string> {
  const timestamp = String(Math.floor(1752700000));
  const signer = createSign('sha256');
  signer.update(timestamp + rawBody);
  signer.end();
  return {
    'content-type': 'application/json',
    'x-twilio-email-event-webhook-signature': signer.sign(privateKey).toString('base64'),
    'x-twilio-email-event-webhook-timestamp': timestamp,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  // Mirror fastify.server.ts: webhook paths receive the raw string body for signature checks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (req.url.includes('/newsletters/webhook')) done(null, body);
    else done(null, JSON.parse(body as string));
  });
  await app.register(newslettersWebhookRoute, { prefix: '/api/newsletters' });
  return app;
}

interface EventOverrides {
  [key: string]: unknown;
}

describe('newsletters webhook route (SendGrid events)', () => {
  const db = (BaseRepository as any)._db;
  let app: FastifyInstance;
  let savedKey: string | undefined;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let newsletterId: string;

  const makeEvent = (overrides: EventOverrides = {}): EventOverrides => ({
    tenant_id: tenantId,
    newsletter_id: newsletterId,
    sg_event_id: `ev-${rand()}`,
    sg_message_id: 'msg-1',
    event: 'delivered',
    email: 'a@example.com',
    timestamp: 1752700000,
    ...overrides,
  });

  async function post(events: unknown): Promise<{ statusCode: number; body: any }> {
    const rawBody = JSON.stringify(events);
    const res = await app.inject({
      method: 'POST',
      url: '/api/newsletters/webhook',
      headers: signedHeaders(rawBody),
      payload: rawBody,
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function newsletterRow(): Promise<any> {
    return db.selectFrom('newsletters').selectAll().where('id', '=', newsletterId).executeTakeFirst();
  }

  async function tenantRow(): Promise<any> {
    return db.selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirst();
  }

  beforeEach(async () => {
    savedKey = env.sendgridWebhookVerificationKey;
    env.sendgridWebhookVerificationKey = publicKeyBase64;
    app = await buildApp();

    tenantId = rand();
    userId = rand();
    campaignId = rand();
    newsletterId = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Webhook Test Tenant' }).execute();
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
        name: 'Webhook Campaign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('newsletters')
      .values({
        id: newsletterId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Webhook Newsletter',
        subject: 'Hello',
        status: 'sent',
        total_recipients: 100,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    env.sendgridWebhookVerificationKey = savedKey;
    await app.close();
    await db.deleteFrom('newsletter_events').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('email_suppressions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('newsletters').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('rejects an unsigned request and stores nothing', async () => {
    const rawBody = JSON.stringify([makeEvent()]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/newsletters/webhook',
      headers: { 'content-type': 'application/json' },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    const events = await db.selectFrom('newsletter_events').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(events).toHaveLength(0);
  });

  it('rejects a tampered payload (signature computed over different bytes)', async () => {
    const headers = signedHeaders(JSON.stringify([makeEvent()]));
    const res = await app.inject({
      method: 'POST',
      url: '/api/newsletters/webhook',
      headers,
      payload: JSON.stringify([makeEvent({ event: 'open' })]),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for a correctly signed but non-JSON body', async () => {
    const rawBody = 'not-json';
    const res = await app.inject({
      method: 'POST',
      url: '/api/newsletters/webhook',
      headers: signedHeaders(rawBody),
      payload: rawBody,
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores events, dedupes on sg_event_id, and skips events missing routing ids', async () => {
    const ev = makeEvent();
    const { statusCode } = await post([
      ev,
      ev,
      makeEvent({ sg_event_id: undefined }),
      makeEvent({ tenant_id: undefined }),
    ]);
    expect(statusCode).toBe(200);

    const events = await db.selectFrom('newsletter_events').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('delivered');
    // Unix-seconds timestamp is decoded to a real Date.
    expect(new Date(events[0].timestamp).getTime()).toBe(1752700000 * 1000);
  });

  it('recomputes newsletter aggregates: unique opens/clicks, rates, and top links', async () => {
    await post([
      makeEvent({ event: 'delivered', email: 'a@example.com' }),
      makeEvent({ event: 'open', email: 'a@example.com' }),
      makeEvent({ event: 'open', email: 'a@example.com' }), // repeat open, same address
      makeEvent({ event: 'open', email: 'b@example.com' }),
      makeEvent({ event: 'click', email: 'b@example.com', url: 'https://vote.example.org/donate' }),
      makeEvent({ event: 'unsubscribe', email: 'c@example.com' }),
    ]);

    const row = await newsletterRow();
    expect(Number(row.delivered_count)).toBe(1);
    expect(Number(row.unique_opens)).toBe(2);
    expect(Number(row.unique_clicks)).toBe(1);
    expect(Number(row.unsubscribe_count)).toBe(1);
    expect(Number(row.open_rate)).toBeCloseTo(2);
    expect(Number(row.click_rate)).toBeCloseTo(1);
    const topLinks = typeof row.top_links === 'string' ? JSON.parse(row.top_links) : row.top_links;
    expect(topLinks).toEqual([{ url: 'https://vote.example.org/donate', clicks: 1 }]);
  });

  it('suppresses bounced and complaining addresses globally', async () => {
    await post([
      makeEvent({ event: 'bounce', email: 'dead@example.com', type: 'bounce', reason: 'Mailbox does not exist' }),
      makeEvent({ event: 'spamreport', email: 'angry@example.com' }),
    ]);

    const suppressions = await db
      .selectFrom('email_suppressions')
      .select(['email', 'reason'])
      .where('tenant_id', '=', tenantId)
      .orderBy('email')
      .execute();
    expect(suppressions).toEqual([
      { email: 'angry@example.com', reason: 'spam_complaint' },
      { email: 'dead@example.com', reason: 'hard_bounce' },
    ]);
  });

  it('does NOT suppress a SOFT bounce (type "blocked") — it is transient, not a dead address', async () => {
    await post([makeEvent({ event: 'bounce', email: 'greylisted@example.com', type: 'blocked' })]);

    const suppressions = await db
      .selectFrom('email_suppressions')
      .select('email')
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(suppressions).toEqual([]);
  });

  it('stores the suppressed address lowercased so case-insensitive checks match mixed-case persons', async () => {
    await post([makeEvent({ event: 'bounce', email: 'Mixed.Case@Example.COM', type: 'bounce' })]);

    const suppressions = await db
      .selectFrom('email_suppressions')
      .select('email')
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(suppressions).toEqual([{ email: 'mixed.case@example.com' }]);
  });

  it('marks the campaign subscription unsubscribed when the recipient opts out', async () => {
    const householdId = rand();
    const personId = rand();
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
        first_name: 'Opt',
        last_name: 'Out',
        email: 'optout@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaign_subscriptions')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        person_id: personId,
        email: 'optout@example.com',
        status: 'subscribed',
        consent_source: 'import',
        consent_at: new Date(),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await post([makeEvent({ event: 'unsubscribe', email: 'optout@example.com' })]);

    const sub = await db
      .selectFrom('campaign_subscriptions')
      .select(['status', 'unsubscribed_at'])
      .where('tenant_id', '=', tenantId)
      .where('email', '=', 'optout@example.com')
      .executeTakeFirst();
    expect(sub?.status).toBe('unsubscribed');
    expect(sub?.unsubscribed_at).not.toBeNull();
  });

  it('pauses tenant sending when the hard-bounce rate crosses the tripwire', async () => {
    // 6 distinct hard bounces on a 100-recipient send = 6% > the 5% pause threshold.
    await post(
      Array.from({ length: 6 }, (_, i) =>
        makeEvent({ event: 'bounce', type: 'bounce', email: `dead${i}@example.com` }),
      ),
    );

    const tenant = await tenantRow();
    expect(tenant.sending_paused_at).not.toBeNull();
    expect(tenant.sending_paused_reason).toBe(`hard_bounce_rate:${newsletterId}`);
    expect(tenant.suspended_at).toBeNull();
  });

  it('does NOT count soft bounces (type "blocked") against the tripwire', async () => {
    await post(
      Array.from({ length: 10 }, (_, i) =>
        makeEvent({ event: 'bounce', type: 'blocked', email: `soft${i}@example.com` }),
      ),
    );

    const tenant = await tenantRow();
    expect(tenant.sending_paused_at).toBeNull();
    expect(tenant.suspended_at).toBeNull();
  });

  it('suspends the tenant when the spam-complaint rate crosses the tripwire', async () => {
    // 2 complaints on a 100-recipient send = 2% > the 1% suspend threshold.
    await post([
      makeEvent({ event: 'spamreport', email: 'angry1@example.com' }),
      makeEvent({ event: 'spamreport', email: 'angry2@example.com' }),
    ]);

    const tenant = await tenantRow();
    expect(tenant.suspended_at).not.toBeNull();
    expect(tenant.sending_paused_at).not.toBeNull();
    expect(tenant.sending_paused_reason).toBe(`spam_complaint_rate:${newsletterId}`);
  });

  it('leaves small sends alone: tripwires need the minimum sample size', async () => {
    await db.updateTable('newsletters').set({ total_recipients: 10 }).where('id', '=', newsletterId).execute();
    await post(Array.from({ length: 5 }, (_, i) => makeEvent({ event: 'spamreport', email: `tiny${i}@example.com` })));

    const tenant = await tenantRow();
    expect(tenant.suspended_at).toBeNull();
    expect(tenant.sending_paused_at).toBeNull();
  });
});
