import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import webFormsPublicRoute from './web-forms-public.route';
import { BaseRepository } from '../../../lib/base.repo';
import { generateApiKey, getKeyPreview, hashApiKey } from '../../../lib/api-key';
import { DonationsController } from '../../donations/controller';
import { env } from '../../../../env';

/**
 * Regression spec for the public forms REST surface (mounted at /api/forms in routes.ts):
 *   GET  /f/:slug      — JSON config for the SPA public form page
 *   GET  /d/:slug      — server-rendered donation page
 *   POST /submit/:slug — public submission endpoint (JSON + form-encoded)
 *   GET  /success      — post-checkout confirmation page (mock-payment fail-closed gate)
 *
 * Conventions: real test Postgres (env injected by apps/backend/vite.config.ts), rows seeded per
 * test and deleted per tenant afterwards. The submission rate limiter in WebFormsController is a
 * module-level in-memory Map keyed by client IP, so every test injects a unique remoteAddress to
 * stay out of each other's sliding windows.
 */

const db = (BaseRepository as any)._db;
const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

// Unique client IP per request so the controller's in-memory per-IP rate limiter never bleeds
// across tests (RATE_LIMIT_MAX=5/minute, module-level state).
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.42.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

// New-model FormField[] shape: full_name required, email (identity key), optional mobile.
const PUBLISHED_FIELDS = [
  { key: 'full_name', label: 'Full name', type: 'text', on: true, required: true },
  { key: 'email', label: 'Email', type: 'text', on: true, required: true },
  { key: 'mobile', label: 'Mobile / Phone', type: 'text', on: true, required: false },
  { key: 'favorite_color', label: 'Favourite colour', type: 'text', on: true, required: false },
];

interface Seed {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  campaignId: string;
  householdId: string;
  otherTenantId: string;
  otherTenantSlug: string;
  publishedFormId: string;
  publishedSlug: string;
  draftSlug: string;
  donationSlug: string;
}

async function createSeed(): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();
  const otherTenantId = rand();
  const tenantSlug = `spec${tenantId}`;
  const otherTenantSlug = `spec${otherTenantId}`;

  // Forms are Grassroots+ (GATED_FEATURES.forms) and submitFormPublic enforces it, so a Free
  // tenant's published form refuses submissions. These specs exercise the submission path itself,
  // not the gate — the gate has its own coverage below.
  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: 'Spec Tenant', slug: tenantSlug, subscription_plan: 'grassroots' })
    .execute();
  await db
    .insertInto('tenants')
    .values({ id: otherTenantId, name: 'Other Tenant', slug: otherTenantSlug, subscription_plan: 'grassroots' })
    .execute();

  await db
    .insertInto('settings')
    .values({ tenant_id: tenantId, key: 'organization.name', value: JSON.stringify('Spec Org') })
    .execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `spec-${userId}@example.com`,
      password: 'password',
      first_name: 'Spec',
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
      name: 'Spec Campaign',
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
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: householdId })
    .where('id', '=', tenantId)
    .execute();

  const publishedSlug = 'join-us';
  const draftSlug = 'draft-form';
  const donationSlug = 'donate';

  const published = await db
    .insertInto('web_forms')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Join us',
      slug: publishedSlug,
      status: 'published',
      form_type: 'standard',
      type: 'signup',
      fields: JSON.stringify(PUBLISHED_FIELDS),
      target_tags: JSON.stringify([]),
      target_lists: JSON.stringify([]),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('web_forms')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Draft form',
      slug: draftSlug,
      status: 'draft',
      form_type: 'standard',
      type: 'survey',
      fields: JSON.stringify(PUBLISHED_FIELDS),
      target_tags: JSON.stringify([]),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .insertInto('web_forms')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      name: 'Give today',
      slug: donationSlug,
      status: 'published',
      form_type: 'donation',
      fields: JSON.stringify(['first_name:required', 'last_name:required', 'mobile']),
      target_tags: JSON.stringify([]),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return {
    tenantId,
    tenantSlug,
    userId,
    campaignId,
    householdId,
    otherTenantId,
    otherTenantSlug,
    publishedFormId: String(published.id),
    publishedSlug,
    draftSlug,
    donationSlug,
  };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('workspace_api_keys').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('form_submissions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  // map_web_forms_lists rows cascade with web_forms.
  await db.deleteFrom('web_forms').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

function parseJson(value: unknown): Record<string, unknown> {
  return typeof value === 'string' ? JSON.parse(value) : ((value as Record<string, unknown>) ?? {});
}

describe('web-forms public route (/api/forms)', () => {
  let app: FastifyInstance;
  let seed: Seed;

  beforeAll(async () => {
    // Mirror routes.ts: fastify.register(webFormsPublicRoute, { prefix: '/api/forms' })
    app = Fastify();
    await app.register(webFormsPublicRoute, { prefix: '/api/forms' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    seed = await createSeed();
  });

  afterEach(async () => {
    await cleanTenant(seed.tenantId);
    await cleanTenant(seed.otherTenantId);
    vi.restoreAllMocks();
  });

  // Helpers -------------------------------------------------------------------------------------

  const getForm = (slug: string, tenantSlug: string) =>
    app.inject({ method: 'GET', url: `/api/forms/f/${slug}?t=${tenantSlug}`, remoteAddress: nextIp() });

  const postJson = (slug: string, tenantSlug: string, payload: Record<string, string>, ip?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/forms/submit/${slug}?t=${tenantSlug}`,
      remoteAddress: ip ?? nextIp(),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      payload,
    });

  const submissions = () =>
    db.selectFrom('form_submissions').selectAll().where('tenant_id', '=', seed.tenantId).execute();
  const persons = () => db.selectFrom('persons').selectAll().where('tenant_id', '=', seed.tenantId).execute();

  // GET /f/:slug --------------------------------------------------------------------------------

  describe('GET /f/:slug', () => {
    it('returns the open render config for a published form (and marks it noindex)', async () => {
      const res = await getForm(seed.publishedSlug, seed.tenantSlug);

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-robots-tag']).toBe('noindex');
      const body = res.json();
      expect(body.status).toBe('open');
      expect(body.orgName).toBe('Spec Org');
      expect(body.form.name).toBe('Join us');
      expect(body.form.id).toBe(seed.publishedFormId);
      // Only fields that are "on" render publicly; the email identity field is forced required.
      const keys = body.form.fields.map((f: { key: string }) => f.key);
      expect(keys).toContain('full_name');
      expect(keys).toContain('email');
      const email = body.form.fields.find((f: { key: string }) => f.key === 'email');
      expect(email.required).toBe(true);
      expect(email.on).toBe(true);
    });

    it('returns a closed status (not the definition) for an unpublished form', async () => {
      const res = await getForm(seed.draftSlug, seed.tenantSlug);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('closed');
      expect(body.name).toBe('Draft form');
      expect(body.form).toBeUndefined();
    });

    it('404s for an unknown slug and for an unknown tenant', async () => {
      const missingSlug = await getForm('no-such-form', seed.tenantSlug);
      expect(missingSlug.statusCode).toBe(404);
      expect(missingSlug.json()).toEqual({ error: 'Form not found.' });

      const missingTenant = await getForm(seed.publishedSlug, `nope${rand()}`);
      expect(missingTenant.statusCode).toBe(404);
    });

    it("does not serve tenant A's form when the request resolves tenant B (cross-tenant isolation)", async () => {
      const res = await getForm(seed.publishedSlug, seed.otherTenantSlug);
      expect(res.statusCode).toBe(404);
    });

    it('resolves the tenant from the Host subdomain when no ?t= is given', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/forms/f/${seed.publishedSlug}`,
        headers: { host: `${seed.tenantSlug}.localhost` },
        remoteAddress: nextIp(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('open');
    });

    it('404s donation forms — they only render on the server-rendered /d/:slug page', async () => {
      const res = await getForm(seed.donationSlug, seed.tenantSlug);
      expect(res.statusCode).toBe(404);
    });
  });

  // GET /d/:slug --------------------------------------------------------------------------------

  describe('GET /d/:slug', () => {
    it('renders the donation page HTML with honeypot and amount fields', async () => {
      vi.spyOn(DonationsController.prototype, 'mayAcceptDonations').mockResolvedValue(true as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/forms/d/${seed.donationSlug}?t=${seed.tenantSlug}`,
        remoteAddress: nextIp(),
      });

      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/html');
      expect(res.body).toContain('Give today');
      expect(res.body).toContain('name="_hp"');
      expect(res.body).toContain('name="amount"');
      // Submit action carries the tenant subdomain back to /submit/:slug.
      expect(res.body).toContain(`/api/forms/submit/${seed.donationSlug}?t=${seed.tenantSlug}`);
    });

    it('403s with friendly copy when the residency gate fails (fail-closed)', async () => {
      vi.spyOn(DonationsController.prototype, 'mayAcceptDonations').mockResolvedValue(false as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/forms/d/${seed.donationSlug}?t=${seed.tenantSlug}`,
        remoteAddress: nextIp(),
      });

      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('isn’t accepting online donations yet');
    });

    it('404s standard forms on the donation page', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/forms/d/${seed.publishedSlug}?t=${seed.tenantSlug}`,
        remoteAddress: nextIp(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // POST /submit/:slug --------------------------------------------------------------------------

  describe('POST /submit/:slug', () => {
    it('happy path: creates the person, submission row, consent, source tag and outbox job', async () => {
      const res = await postJson(seed.publishedSlug, seed.tenantSlug, {
        _hp: '',
        full_name: 'Anne Marie Smith',
        email: 'Anne@Example.com',
        mobile: '555-0101',
        favorite_color: 'teal',
        // Not one of this form's fields — must never reach the person record or the answers.
        street1: '1 Nowhere Lane',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, redirect_url: null });

      // Person upserted by email; full_name split on the last space.
      const people = await persons();
      expect(people).toHaveLength(1);
      expect(people[0].email).toBe('Anne@Example.com');
      expect(people[0].first_name).toBe('Anne Marie');
      expect(people[0].last_name).toBe('Smith');
      expect(String(people[0].household_id)).toBe(seed.householdId); // placeholder household (no address given)

      // Durable response record: every payload key the form DEFINES, except the honeypot, lands in
      // answers. Keys the form does not define are dropped before anything reads them.
      const subs = await submissions();
      expect(subs).toHaveLength(1);
      expect(String(subs[0].form_id)).toBe(seed.publishedFormId);
      expect(String(subs[0].person_id)).toBe(String(people[0].id));
      const answers = parseJson(subs[0].answers);
      expect(answers['favorite_color']).toBe('teal');
      expect(answers['street1']).toBeUndefined();
      expect(answers['email']).toBe('Anne@Example.com');
      expect(answers['_hp']).toBeUndefined();

      // Consent (§15): subscribed immediately when double opt-in is off, sourced to the form's campaign.
      const consent = await db
        .selectFrom('campaign_subscriptions')
        .selectAll()
        .where('tenant_id', '=', seed.tenantId)
        .execute();
      expect(consent).toHaveLength(1);
      expect(consent[0].status).toBe('subscribed');
      expect(consent[0].consent_source).toBe('form');
      expect(String(consent[0].campaign_id)).toBe(seed.campaignId);

      // Read-only provenance tag applied to the person.
      const tag = await db
        .selectFrom('tags')
        .selectAll()
        .where('tenant_id', '=', seed.tenantId)
        .where('name', '=', 'source: join us')
        .executeTakeFirst();
      expect(tag).toBeDefined();
      const mapped = await db
        .selectFrom('map_peoples_tags')
        .selectAll()
        .where('tenant_id', '=', seed.tenantId)
        .where('person_id', '=', people[0].id)
        .where('tag_id', '=', tag.id)
        .executeTakeFirst();
      expect(mapped).toBeDefined();

      // Notification email goes through the transactional outbox, never inline.
      const jobs = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', seed.tenantId).execute();
      const types = jobs.map((j: { payload: unknown }) => parseJson(j.payload)['type']);
      expect(types).toContain('send-webform-notifications');

      // Attribution: the submission activity is logged against the form's creator.
      const activity = await db
        .selectFrom('user_activity')
        .selectAll()
        .where('tenant_id', '=', seed.tenantId)
        .where('entity', '=', 'web_forms')
        .executeTakeFirst();
      expect(activity).toBeDefined();
      expect(String(activity.user_id)).toBe(seed.userId);
    });

    it('browser (form-encoded, no JSON accept) submissions redirect to the success page', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/forms/submit/${seed.publishedSlug}?t=${seed.tenantSlug}`,
        remoteAddress: nextIp(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'full_name=Carl+Ng&email=carl%40example.com&_hp=',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/api/forms/success');
      expect(await submissions()).toHaveLength(1);
    });

    it('rejects a submission with no email (the identity-key invariant) and writes nothing', async () => {
      const res = await postJson(seed.publishedSlug, seed.tenantSlug, { full_name: 'No Email' });

      // The visitor gets the actionable message, not a generic 500 (TRPCError → HTTP mapping).
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Email address is required.');
      expect(await persons()).toHaveLength(0);
      expect(await submissions()).toHaveLength(0);
    });

    it('rejects a submission missing a configured required field and writes nothing', async () => {
      const res = await postJson(seed.publishedSlug, seed.tenantSlug, { email: 'missing-name@example.com' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/is required\./);
      expect(await persons()).toHaveLength(0);
      expect(await submissions()).toHaveLength(0);
    });

    it('silently accepts a honeypot-tripped submission without creating any rows', async () => {
      const res = await postJson(seed.publishedSlug, seed.tenantSlug, {
        _hp: 'I am a bot',
        full_name: 'Bot Bot',
        email: 'bot@example.com',
      });

      // Bots get a success response (no tell), but nothing is persisted.
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(await persons()).toHaveLength(0);
      expect(await submissions()).toHaveLength(0);
    });

    it('rejects submissions to an unpublished form', async () => {
      const res = await postJson(seed.draftSlug, seed.tenantSlug, {
        full_name: 'Early Bird',
        email: 'early@example.com',
      });

      expect(res.statusCode).toBe(404);
      expect(await submissions()).toHaveLength(0);
    });

    it("rejects a submission for tenant A's slug resolved under tenant B", async () => {
      const res = await postJson(seed.publishedSlug, seed.otherTenantSlug, {
        full_name: 'Cross Tenant',
        email: 'cross@example.com',
      });

      expect(res.statusCode).toBe(404);
      expect(await submissions()).toHaveLength(0);
      expect(await persons()).toHaveLength(0);
    });

    it('rate limits the 6th submission from the same IP within the window', async () => {
      const ip = nextIp();
      for (let i = 0; i < 5; i++) {
        const ok = await postJson(
          seed.publishedSlug,
          seed.tenantSlug,
          { full_name: 'Rate Limit', email: 'rate@example.com', _hp: '' },
          ip,
        );
        expect(ok.statusCode).toBe(200);
      }

      const blocked = await postJson(
        seed.publishedSlug,
        seed.tenantSlug,
        { full_name: 'Rate Limit', email: 'rate@example.com', _hp: '' },
        ip,
      );

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe('Rate limit exceeded. Please try again in a minute.');
      // Only the five allowed submissions persisted (all merged onto one person).
      expect(await submissions()).toHaveLength(5);
      expect(await persons()).toHaveLength(1);
    });

    it('re-submission merges onto the existing person and never resurrects an unsubscribe', async () => {
      const first = await postJson(seed.publishedSlug, seed.tenantSlug, {
        full_name: 'Bob Jones',
        email: 'bob@example.com',
      });
      expect(first.statusCode).toBe(200);

      // The person later unsubscribes — a deliberate opt-out must win over re-submits.
      await db
        .updateTable('campaign_subscriptions')
        .set({ status: 'unsubscribed' })
        .where('tenant_id', '=', seed.tenantId)
        .execute();

      const second = await postJson(seed.publishedSlug, seed.tenantSlug, {
        full_name: 'Bob Jones',
        email: 'BOB@example.com', // case-insensitive match
        notes: 'second visit',
      });
      expect(second.statusCode).toBe(200);

      expect(await persons()).toHaveLength(1);
      expect(await submissions()).toHaveLength(2);
      const consent = await db
        .selectFrom('campaign_subscriptions')
        .selectAll()
        .where('tenant_id', '=', seed.tenantId)
        .execute();
      expect(consent).toHaveLength(1);
      expect(consent[0].status).toBe('unsubscribed');
    });

    it('double opt-in: new subscribers land pending with a confirmation email queued in the outbox', async () => {
      await db
        .insertInto('settings')
        .values({ tenant_id: seed.tenantId, key: 'communications.double_opt_in', value: JSON.stringify(true) })
        .execute();

      const res = await postJson(seed.publishedSlug, seed.tenantSlug, {
        full_name: 'Opt In',
        email: 'optin@example.com',
      });
      expect(res.statusCode).toBe(200);

      const consent = await db
        .selectFrom('campaign_subscriptions')
        .selectAll()
        .where('tenant_id', '=', seed.tenantId)
        .execute();
      expect(consent).toHaveLength(1);
      expect(consent[0].status).toBe('pending');
      expect(consent[0].consent_at).toBeNull();

      const jobs = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', seed.tenantId).execute();
      const types = jobs.map((j: { payload: unknown }) => parseJson(j.payload)['type']);
      expect(types).toContain('send-subscription-confirmation');
    });

    describe('workspace API key (server-side integrations)', () => {
      // Mirrors the settings flow: only the SHA-256 hash and a preview are stored.
      async function createWorkspaceKey(tenantId: string): Promise<string> {
        const key = generateApiKey();
        await db
          .insertInto('workspace_api_keys')
          .values({ tenant_id: tenantId, key_hash: hashApiKey(key), key_preview: getKeyPreview(key) })
          .execute();
        return key;
      }

      // No ?t= and no subdomain — the key alone must identify the tenant.
      const postKeyed = (slug: string, key: string, payload: Record<string, string>, ip?: string) =>
        app.inject({
          method: 'POST',
          url: `/api/forms/submit/${slug}`,
          remoteAddress: ip ?? nextIp(),
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
          payload,
        });

      it('identifies the tenant from the key alone and stamps last_used_at', async () => {
        const key = await createWorkspaceKey(seed.tenantId);
        const res = await postKeyed(seed.publishedSlug, key, {
          full_name: 'Server Side',
          email: 'server@example.com',
        });

        expect(res.statusCode).toBe(200);
        expect(await submissions()).toHaveLength(1);
        const keyRow = await db
          .selectFrom('workspace_api_keys')
          .selectAll()
          .where('tenant_id', '=', seed.tenantId)
          .executeTakeFirstOrThrow();
        expect(keyRow.last_used_at).not.toBeNull();
      });

      it('rejects an unknown key with 401 and writes nothing', async () => {
        const res = await postKeyed(seed.publishedSlug, 'ws_definitely-not-a-real-key', {
          full_name: 'Nope',
          email: 'nope@example.com',
        });

        expect(res.statusCode).toBe(401);
        expect(await submissions()).toHaveLength(0);
        expect(await persons()).toHaveLength(0);
      });

      it("never reaches across tenants — tenant B's key cannot submit tenant A's form", async () => {
        const otherKey = await createWorkspaceKey(seed.otherTenantId);
        const res = await postKeyed(seed.publishedSlug, otherKey, {
          full_name: 'Cross Tenant',
          email: 'cross-key@example.com',
        });

        expect(res.statusCode).toBe(404);
        expect(await submissions()).toHaveLength(0);
        expect(await persons()).toHaveLength(0);
      });

      it('bypasses the per-IP limit — server integrations share one IP', async () => {
        const key = await createWorkspaceKey(seed.tenantId);
        const ip = nextIp();
        for (let i = 0; i < 6; i++) {
          const ok = await postKeyed(
            seed.publishedSlug,
            key,
            { full_name: 'Batch Import', email: `batch-${i}@example.com`, _hp: '' },
            ip,
          );
          expect(ok.statusCode).toBe(200);
        }
        // The anonymous per-IP cap is 5/minute; all six keyed submissions landed.
        expect(await submissions()).toHaveLength(6);
      });
    });

    it('rejects an oversized payload at the body-size limit', async () => {
      const res = await postJson(seed.publishedSlug, seed.tenantSlug, {
        full_name: 'Big Payload',
        email: 'big@example.com',
        notes: 'x'.repeat(1_100_000), // over Fastify's default 1 MiB bodyLimit
      });

      expect(res.statusCode).toBe(413);
      expect(await submissions()).toHaveLength(0);
    });
  });

  // GET /success --------------------------------------------------------------------------------

  describe('GET /success', () => {
    it('never records a mock donation when ALLOW_MOCK_PAYMENTS is off (fail-closed)', async () => {
      const spy = vi.spyOn(DonationsController.prototype, 'confirmMockDonation').mockResolvedValue(undefined as any);

      // Local dev .env.test files may opt in to mock payments; pin the gate OFF so this test
      // always asserts the production (fail-closed) posture. Restored below.
      const previous = env.allowMockPayments;
      (env as any).allowMockPayments = false;
      try {
        const res = await app.inject({
          method: 'GET',
          url:
            `/api/forms/success?is_mock=true&checkout_session_id=cs_test_123&person_id=1` +
            `&tenant_id=${seed.tenantId}&amount_cents=5000&user_id=${seed.userId}`,
          remoteAddress: nextIp(),
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Submission Successful');
        // Attacker-controlled params must not mint donations unless mock payments are explicitly on.
        expect(spy).not.toHaveBeenCalled();
      } finally {
        (env as any).allowMockPayments = previous;
      }
    });
  });
});
