import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../../../env';
import { BaseRepository } from '../../../lib/base.repo';
import postmarkWebhookRoute from './postmark-webhook.route';

/**
 * The Postmark bounce/spam-complaint webhook is what keeps the transactional (Postmark)
 * mail stream honest: a hard bounce or complaint must land in `email_suppressions` for the
 * tenant the send carried in `Metadata.tenant_id`, and nothing else may write anything.
 * These tests drive the real route with Fastify inject against the test database. The
 * payload shapes mirror the route's own parsing (RecordType/Type/Email/BouncedAt/Metadata)
 * — Postmark's field casing, not ours.
 *
 * Auth is a shared token in the x-postmark-webhook-token header, compared timing-safely
 * against env.postmarkWebhookToken. Unlike /api/newsletters/webhook there is no raw-body
 * signature scheme, so the default JSON parser applies (matches fastify.server.ts, whose
 * RAW_BODY_WEBHOOK_PATHS set does not include /api/postmark/webhook).
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const TOKEN_HEADER = 'x-postmark-webhook-token';

describe('postmark webhook route (bounce/spam suppressions)', () => {
  const db = BaseRepository.dbInstance;
  let app: FastifyInstance;
  let savedToken: string | undefined;
  let webhookToken: string;
  let tenantId: string;

  interface PostmarkEventOverrides {
    [key: string]: unknown;
  }

  /** A hard-bounce event exactly as the route parses it; override per test. */
  const makeEvent = (overrides: PostmarkEventOverrides = {}): PostmarkEventOverrides => ({
    RecordType: 'Bounce',
    Type: 'HardBounce',
    Email: `dead-${rand()}@example.com`,
    BouncedAt: '2026-08-19T12:00:00.000Z',
    Metadata: { tenant_id: tenantId },
    ...overrides,
  });

  async function post(
    payload: unknown,
    headers: Record<string, string> = { [TOKEN_HEADER]: webhookToken },
  ): Promise<{ statusCode: number; body: any }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/postmark/webhook',
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(payload),
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function suppressionsForTenant(): Promise<Array<{ email: string; reason: string; occurred_at: Date }>> {
    return db
      .selectFrom('email_suppressions')
      .select(['email', 'reason', 'occurred_at'])
      .where('tenant_id', '=', tenantId)
      .orderBy('email')
      .execute() as any;
  }

  beforeEach(async () => {
    savedToken = env.postmarkWebhookToken;
    webhookToken = `pm-test-token-${rand()}`;
    env.postmarkWebhookToken = webhookToken;

    app = Fastify({ logger: false });
    await app.register(postmarkWebhookRoute, { prefix: '/api/postmark' });
    await app.ready();

    tenantId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'Postmark Webhook Test Tenant' }).execute();
  });

  afterEach(async () => {
    env.postmarkWebhookToken = savedToken;
    await app.close();
    await db.deleteFrom('email_suppressions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('rejects a request with no token header (401) and stores nothing', async () => {
    const { statusCode, body } = await post([makeEvent()], {});
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(await suppressionsForTenant()).toHaveLength(0);
  });

  it('rejects a wrong token the same way (401) and stores nothing', async () => {
    const { statusCode, body } = await post([makeEvent()], { [TOKEN_HEADER]: `wrong-${webhookToken}` });
    expect(statusCode).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(await suppressionsForTenant()).toHaveLength(0);
  });

  it('rejects every request when no webhook token is configured (fails closed)', async () => {
    env.postmarkWebhookToken = undefined;
    const { statusCode } = await post([makeEvent()], { [TOKEN_HEADER]: 'anything' });
    expect(statusCode).toBe(401);
    expect(await suppressionsForTenant()).toHaveLength(0);
  });

  it('writes a hard_bounce suppression for the tenant carried in the event metadata', async () => {
    const email = `dead-${rand()}@example.com`;
    const { statusCode, body } = await post([makeEvent({ Email: email })]);

    expect(statusCode).toBe(200);
    expect(body).toEqual({ success: true, processed: 1 });

    const rows = await suppressionsForTenant();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe(email);
    expect(rows[0]?.reason).toBe('hard_bounce');
    // BouncedAt is decoded into the row's occurred_at.
    expect(new Date(rows[0]?.occurred_at as Date).toISOString()).toBe('2026-08-19T12:00:00.000Z');
  });

  it('treats BadEmailAddress as a hard failure too (HARD_BOUNCE_TYPES)', async () => {
    const email = `bad-${rand()}@example.com`;
    const { statusCode } = await post([makeEvent({ Type: 'BadEmailAddress', Email: email })]);

    expect(statusCode).toBe(200);
    const rows = await suppressionsForTenant();
    expect(rows).toEqual([expect.objectContaining({ email, reason: 'hard_bounce' })]);
  });

  it('writes a spam_complaint suppression for a SpamComplaint event', async () => {
    const email = `angry-${rand()}@example.com`;
    const { statusCode, body } = await post([
      makeEvent({ RecordType: 'SpamComplaint', Type: undefined, Email: email }),
    ]);

    expect(statusCode).toBe(200);
    expect(body).toEqual({ success: true, processed: 1 });
    const rows = await suppressionsForTenant();
    expect(rows).toEqual([expect.objectContaining({ email, reason: 'spam_complaint' })]);
  });

  it('stores the suppressed address lowercased so case-insensitive checks match', async () => {
    await post([makeEvent({ Email: 'Mixed.Case@Example.COM' })]);

    const rows = await suppressionsForTenant();
    expect(rows).toEqual([expect.objectContaining({ email: 'mixed.case@example.com' })]);
  });

  it('ignores a soft bounce (Type "Transient") — transient, not a dead address', async () => {
    const { statusCode, body } = await post([makeEvent({ Type: 'Transient' })]);

    expect(statusCode).toBe(200);
    expect(body).toEqual({ success: true, processed: 0 });
    expect(await suppressionsForTenant()).toHaveLength(0);
  });

  it('ignores unrelated record types (Delivery/Open)', async () => {
    const { body } = await post([
      makeEvent({ RecordType: 'Delivery', Type: undefined }),
      makeEvent({ RecordType: 'Open', Type: undefined }),
    ]);

    expect(body).toEqual({ success: true, processed: 0 });
    expect(await suppressionsForTenant()).toHaveLength(0);
  });

  it('writes nothing and does not crash for an event with no tenant metadata', async () => {
    const email = `no-tenant-${rand()}@example.com`;
    const { statusCode, body } = await post([makeEvent({ Email: email, Metadata: undefined })]);

    expect(statusCode).toBe(200);
    expect(body).toEqual({ success: true, processed: 0 });
    const rows = await db.selectFrom('email_suppressions').select('id').where('email', '=', email).execute();
    expect(rows).toHaveLength(0);
  });

  it('writes nothing for a non-numeric tenant id in the metadata', async () => {
    const email = `bad-tenant-${rand()}@example.com`;
    const { body } = await post([makeEvent({ Email: email, Metadata: { tenant_id: 'not-a-number; DROP' } })]);

    expect(body).toEqual({ success: true, processed: 0 });
    const rows = await db.selectFrom('email_suppressions').select('id').where('email', '=', email).execute();
    expect(rows).toHaveLength(0);
  });

  it('survives an unknown (numeric but nonexistent) tenant id — the FK failure is caught per event', async () => {
    const email = `ghost-tenant-${rand()}@example.com`;
    // rand() ids are 8-digit; prefix keeps this out of any real seeded range.
    const { statusCode, body } = await post([makeEvent({ Email: email, Metadata: { tenant_id: `999${rand()}` } })]);

    expect(statusCode).toBe(200);
    expect(body).toEqual({ success: true, processed: 0 });
    const rows = await db.selectFrom('email_suppressions').select('id').where('email', '=', email).execute();
    expect(rows).toHaveLength(0);
  });

  it('skips an event with no Email and processes the rest of the batch', async () => {
    const email = `batch-${rand()}@example.com`;
    const { body } = await post([makeEvent({ Email: undefined }), makeEvent({ Email: email })]);

    expect(body).toEqual({ success: true, processed: 1 });
    const rows = await suppressionsForTenant();
    expect(rows).toEqual([expect.objectContaining({ email })]);
  });

  it('accepts a single event object (not wrapped in an array) — Postmark posts one per delivery', async () => {
    const email = `single-${rand()}@example.com`;
    const { statusCode, body } = await post(makeEvent({ Email: email }));

    expect(statusCode).toBe(200);
    expect(body).toEqual({ success: true, processed: 1 });
    expect(await suppressionsForTenant()).toEqual([expect.objectContaining({ email, reason: 'hard_bounce' })]);
  });

  it('dedupes on (tenant, email, reason): a replayed bounce leaves a single row', async () => {
    const email = `replay-${rand()}@example.com`;
    await post([makeEvent({ Email: email })]);
    const { statusCode } = await post([makeEvent({ Email: email })]);

    expect(statusCode).toBe(200);
    expect(await suppressionsForTenant()).toHaveLength(1);
  });
});
