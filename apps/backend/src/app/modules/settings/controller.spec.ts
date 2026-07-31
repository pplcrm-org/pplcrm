import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SettingsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { TRPCError } from '@trpc/server';
import { createSigner } from 'fast-jwt';
import { env } from '../../../env';
import { HouseholdsController } from '../households/controller';
import { assertPlanSelected } from '../demo/demo-guard';
import { DEMO_MANIFEST_SETTINGS_KEY } from '../demo/demo-seed';
import { STRIPE_ACCOUNT_ID_KEY, STRIPE_ACCOUNT_STATUS_KEY } from '../donations/stripe-connect';
import { sql } from 'kysely';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
  const tenantId = rand();
  const userId = rand();

  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant Settings',
      // Sender/phone/domain verification is gated on a settled plan (see demo-guard); the
      // baseline tenant has one so these specs exercise the behaviour under test, not the gate.
      subscription_plan: 'free',
      subscription_status: 'active',
    })
    .execute();

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

  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  return { tenantId, userId };
}

async function cleanTenant(db: any, tenantId: string) {
  // Durable rate-limit buckets embed the tenant id in their key rather than a tenant_id column.
  await db.deleteFrom('rate_limits').where('key', 'like', `%${tenantId}%`).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('workspace_api_keys').where('tenant_id', '=', tenantId).execute();
  // Activity rows reference authusers, so they have to go first — any controller method under
  // test that logs activity would otherwise break teardown for the whole file.
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('SettingsController Integration', () => {
  const controller = new SettingsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should block direct updates to communications.verified_emails', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    await expect(
      controller.upsert(auth, [{ key: 'communications.verified_emails', value: ['spam@example.com'] }]),
    ).rejects.toThrow(
      new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Verified emails list cannot be modified directly.',
      }),
    );
  });

  it('should block direct updates to every server-managed settings key', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    await expect(
      controller.upsert(auth, [
        { key: 'communications.verified_domains', value: [{ domain: 'evil.com', status: 'verified' }] },
      ]),
    ).rejects.toThrow(/cannot be modified directly/);

    // Forging the Stripe Connect status would bypass the donations fail-closed gate.
    await expect(
      controller.upsert(auth, [{ key: STRIPE_ACCOUNT_STATUS_KEY, value: { chargesEnabled: true } }]),
    ).rejects.toThrow(/cannot be modified directly/);
    await expect(controller.upsert(auth, [{ key: STRIPE_ACCOUNT_ID_KEY, value: 'acct_evil' }])).rejects.toThrow(
      /cannot be modified directly/,
    );

    await expect(controller.upsert(auth, [{ key: DEMO_MANIFEST_SETTINGS_KEY, value: {} }])).rejects.toThrow(
      /cannot be modified directly/,
    );
  });

  it('should allow ordinary settings updates while the tenant is in demo mode', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;
    await db.updateTable('tenants').set({ demo_mode_at: new Date() }).where('id', '=', tenantId).execute();

    const snapshot = await controller.upsert(auth, [{ key: 'organization.name', value: 'Demo Org' }]);
    expect(snapshot['organization.name']).toBe('Demo Org');
  });

  it('should block sender verification until a plan is chosen', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;
    await db.updateTable('tenants').set({ subscription_status: null }).where('id', '=', tenantId).execute();

    await expect(controller.requestEmailVerification(auth, 'no-plan@example.com')).rejects.toThrow(/plan/i);
    await expect(controller.addVerifiedDomain(auth, 'no-plan.com')).rejects.toThrow(/plan/i);
    await expect(controller.requestPhoneVerification(auth, '+14165550123')).rejects.toThrow(/plan/i);
  });

  it('should not gate sender verification on demo mode once a plan is chosen', async () => {
    // The go-live wizard verifies the phone and the sending domain BEFORE the demo data is
    // removed. Gating those on demo mode deadlocked it — the step that unblocks demo removal
    // was itself blocked by the demo.
    await db
      .updateTable('tenants')
      .set({ demo_mode_at: new Date(), subscription_status: 'active', subscription_plan: 'free' })
      .where('id', '=', tenantId)
      .execute();

    await expect(assertPlanSelected(db, tenantId)).resolves.toBeUndefined();
  });

  it('should block a From address on an unverified domain, and an unverified reply_to', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    // The From address is gated on the DOMAIN, matching the send guard.
    await expect(
      controller.upsert(auth, [{ key: 'communications.default_from_email', value: 'unverified@example.com' }]),
    ).rejects.toThrow(/domain you have verified/i);

    // Reply-to is gated on single-address verification, which is unchanged: it only has to be
    // an address the tenant proved it controls, since nothing is sent *from* it.
    await expect(
      controller.upsert(auth, [{ key: 'communications.reply_to', value: 'unverified@example.com' }]),
    ).rejects.toThrow(
      new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email address must be verified before it can be configured as a Reply-to Email.',
      }),
    );
  });

  /**
   * Single-sender verification proves an address is yours; it does NOT make bulk mail from it
   * deliverable, because DMARC aligns on the domain. Accepting a verified Gmail as the From
   * address used to save fine and then fail at the moment of sending — the exact trap this
   * asserts is gone.
   */
  it('should refuse a verified single-sender address whose domain is not verified', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;
    await controller.getRepo().upsertMany({
      tenant_id: tenantId,
      user_id: userId,
      entries: [{ key: 'communications.verified_emails', value: ['someone@gmail.com'] }],
    });

    await expect(
      controller.upsert(auth, [{ key: 'communications.default_from_email', value: 'someone@gmail.com' }]),
    ).rejects.toThrow(/domain you have verified|pplCRM sending address/i);

    // ...but it is perfectly good as a Reply-to, which is the whole point of the shared-domain path.
    const result = await controller.upsert(auth, [{ key: 'communications.reply_to', value: 'someone@gmail.com' }]);
    expect(result['communications.reply_to']).toBe('someone@gmail.com');
  });

  it('should allow a From address on a verified domain', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;
    await controller.getRepo().upsertMany({
      tenant_id: tenantId,
      user_id: userId,
      entries: [
        { key: 'communications.verified_domains', value: [{ domain: 'vote-jane.org', status: 'verified' }] },
        { key: 'communications.verified_emails', value: ['news@vote-jane.org'] },
      ],
    });

    const result = await controller.upsert(auth, [
      { key: 'communications.default_from_email', value: 'news@vote-jane.org' },
      { key: 'communications.reply_to', value: 'news@vote-jane.org' },
    ]);

    expect(result['communications.default_from_email']).toBe('news@vote-jane.org');
    expect(result['communications.reply_to']).toBe('news@vote-jane.org');
  });

  describe('platform sending domain', () => {
    let savedDomain: string | undefined;

    beforeEach(async () => {
      savedDomain = env.sendgridSharedSendingDomain;
      env.sendgridSharedSendingDomain = 'send.pplcrm.test';
      await db
        .updateTable('tenants')
        .set({ slug: `t-${tenantId}` })
        .where('id', '=', tenantId)
        .execute();
    });

    afterEach(() => {
      env.sendgridSharedSendingDomain = savedDomain;
    });

    it('accepts this tenant’s own platform address with nothing verified', async () => {
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      const result = await controller.upsert(auth, [
        { key: 'communications.default_from_email', value: `t-${tenantId}@send.pplcrm.test` },
      ]);

      expect(result['communications.default_from_email']).toBe(`t-${tenantId}@send.pplcrm.test`);
    });

    // The domain is shared, so a domain-only check would let any tenant send as any other.
    it('refuses another workspace’s platform address', async () => {
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      await expect(
        controller.upsert(auth, [{ key: 'communications.default_from_email', value: 'someone-else@send.pplcrm.test' }]),
      ).rejects.toThrow(/belongs to another workspace/i);
    });

    it('refuses the platform address when the feature is switched off', async () => {
      env.sendgridSharedSendingDomain = undefined;
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      await expect(
        controller.upsert(auth, [
          { key: 'communications.default_from_email', value: `t-${tenantId}@send.pplcrm.test` },
        ]),
      ).rejects.toThrow(/domain you have verified/i);
    });
  });

  it('should enqueue a verification email on requestEmailVerification', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    const res = await controller.requestEmailVerification(auth, 'verify-me@example.com');
    expect(res.success).toBe(true);

    // Verify background job was enqueued
    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();

    expect(job).toBeDefined();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(payload.type).toBe('send-transactional-email');
    expect(payload.to).toBe('verify-me@example.com');
    expect(payload.subject).toContain('Verify your sender email address');
  });

  it('should enforce requestEmailVerification rate limit', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    // First request should pass
    await controller.requestEmailVerification(auth, 'ratelimit@example.com');

    // Second request within a minute should fail with TOO_MANY_REQUESTS
    await expect(controller.requestEmailVerification(auth, 'ratelimit@example.com')).rejects.toThrow(/Please wait/);
  });

  it('should enforce verifyVerifiedDomain rate limit', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    // Add the domain first
    await controller.addVerifiedDomain(auth, 'ratelimit.com');

    // First check should pass
    await controller.verifyVerifiedDomain(auth, 'ratelimit.com');

    // Second check within a minute should fail with TOO_MANY_REQUESTS
    await expect(controller.verifyVerifiedDomain(auth, 'ratelimit.com')).rejects.toThrow(/Please wait/);
  });

  it('should cap phone verification SMS per tenant with a durable counter', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;
    // Random numbers per run: the per-number bucket lives in Postgres and would otherwise
    // collide across test runs inside the same hour window.
    const base = 2000000 + Math.floor(Math.random() * 7000000);
    const number = (i: number) => `+1416${base + i}`;
    const usedKeys = [0, 1, 2, 3].map((i) => `phoneVerifyRequest:${number(i)}`);

    try {
      for (let i = 0; i < 3; i++) {
        const res = await controller.requestPhoneVerification(auth, number(i));
        expect(res.success).toBe(true);
      }
      // Distinct destination each time, so only the per-tenant ceiling can refuse this one.
      await expect(controller.requestPhoneVerification(auth, number(3))).rejects.toThrow(/too many requests/i);

      // The counter must live in Postgres, not a per-process Map: each pass costs a Twilio
      // SMS, so the ceiling has to survive a deploy and be shared across replicas.
      const bucket = await db
        .selectFrom('rate_limits')
        .select(['count'])
        .where('key', '=', `phoneVerifyRequest:${tenantId}`)
        .executeTakeFirst();
      expect(bucket).toBeDefined();
    } finally {
      await db.deleteFrom('rate_limits').where('key', 'in', usedKeys).execute();
    }
  });

  it('should cap phone verification SMS per destination number across tenants', async () => {
    // SMS-bombing a victim from several workspaces: the per-number bucket is shared, so a
    // fresh tenant gets refused once the number itself is exhausted.
    const victimNumber = `+1416${2000000 + Math.floor(Math.random() * 7000000)}`;
    const other = await createTestSeed(db);
    try {
      const authA = { tenant_id: tenantId, user_id: userId } as any;
      for (let i = 0; i < 3; i++) {
        await controller.requestPhoneVerification(authA, victimNumber);
      }
      const authB = { tenant_id: other.tenantId, user_id: other.userId } as any;
      await expect(controller.requestPhoneVerification(authB, victimNumber)).rejects.toThrow(/too many requests/i);
    } finally {
      await db.deleteFrom('rate_limits').where('key', '=', `phoneVerifyRequest:${victimNumber}`).execute();
      await cleanTenant(db, other.tenantId);
    }
  });

  it('should add the email to verified_emails upon verifySenderEmail', async () => {
    const key = process.env['SHARED_SECRET'] || env.sharedSecret;
    const signer = createSigner({
      algorithm: 'HS256',
      key,
      expiresIn: '24h',
    });

    const token = signer({
      tenant_id: tenantId,
      email: 'success@example.com',
      purpose: 'verify-sender-email',
    });

    const res = await controller.verifySenderEmail(token);
    expect(res.success).toBe(true);
    expect(res.email).toBe('success@example.com');

    // Retrieve settings
    const snapshot = await controller.getSnapshot({ tenant_id: tenantId } as any);
    expect(snapshot['communications.verified_emails']).toContain('success@example.com');
  });

  it('should add a pending domain entry on addVerifiedDomain', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    const list = await controller.addVerifiedDomain(auth, 'testorg.com');
    expect(list).toBeDefined();
    expect(list.length).toBe(1);

    const domainEntry = list[0];
    expect(domainEntry.domain).toBe('testorg.com');
    expect(domainEntry.status).toBe('pending');
    expect(domainEntry.spf).toBe(false);
    expect(domainEntry.dkim).toBe(false);
    expect(domainEntry.dmarc).toBe(false);
    expect(domainEntry.domainAuthId).toBeDefined();
    expect(domainEntry.linkBrandingId).toBeDefined();
    expect(domainEntry.domainAuthDns?.mail_cname?.host).toBe('em.testorg.com');
    expect(domainEntry.linkBrandingDns?.domain?.host).toBe('email.testorg.com');

    // Check settings snapshot
    const snapshot = await controller.getSnapshot(auth);
    const verifiedDomains = snapshot['communications.verified_domains'] as any[];
    expect(verifiedDomains).toBeDefined();
    expect(verifiedDomains.length).toBe(1);
    expect(verifiedDomains[0].domain).toBe('testorg.com');
  });

  it('should honour a chosen link subdomain when adding a domain', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    const list = await controller.addVerifiedDomain(auth, 'chosen-label.com', 'links');
    const entry = list[0];
    expect(entry.linkSubdomain).toBe('links');
    expect(entry.linkBrandingDns?.domain?.host).toBe('links.chosen-label.com');
  });

  it('should reject a link subdomain that is not a single DNS label', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    // A dot would silently produce a deeper host than the checklist shows the user.
    await expect(controller.addVerifiedDomain(auth, 'bad-label.com', 'a.b')).rejects.toThrow(/single DNS label/i);
    await expect(controller.addVerifiedDomain(auth, 'bad-label.com', '-nope')).rejects.toThrow(/single DNS label/i);
  });

  /**
   * The collision that makes a different label necessary usually surfaces AFTER the domain is
   * added — you find out `email.<domain>` is taken when you go to create the record — so this has
   * to work without discarding the rest of the setup.
   */
  it('should move the link subdomain without touching the domain authentication', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    const added = await controller.addVerifiedDomain(auth, 'moveme.com');
    const originalAuthId = added[0].domainAuthId;
    expect(added[0].linkBrandingDns?.domain?.host).toBe('email.moveme.com');

    const moved = await controller.setLinkSubdomain(auth, 'moveme.com', 'Go ');
    const entry = moved.find((d: any) => d.domain === 'moveme.com');

    expect(entry.linkSubdomain).toBe('go');
    expect(entry.linkBrandingDns?.domain?.host).toBe('go.moveme.com');
    // The DKIM/SPF side is untouched — re-doing it would throw away possibly-validated records.
    expect(entry.domainAuthId).toBe(originalAuthId);
    // The new CNAME cannot be in DNS yet, so the domain drops back to pending.
    expect(entry.linkBranded).toBe(false);
    expect(entry.status).toBe('pending');
  });

  it('should verify a domain successfully on verifyVerifiedDomain', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    // First add the domain
    await controller.addVerifiedDomain(auth, 'mytestdomain.com');

    // Perform verification (auto-passes only because ALLOW_MOCK_DOMAIN_VERIFICATION=true in .env.test)
    const list = await controller.verifyVerifiedDomain(auth, 'mytestdomain.com');
    expect(list).toBeDefined();

    const entry = list.find((d) => d.domain === 'mytestdomain.com');
    expect(entry).toBeDefined();
    expect(entry.status).toBe('verified');
    expect(entry.spf).toBe(true);
    expect(entry.dkim).toBe(true);
    expect(entry.dmarc).toBe(true);
    expect(entry.linkBranded).toBe(true);
  });

  it('should NOT auto-verify a domain without the explicit mock opt-in (fail closed)', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    await controller.addVerifiedDomain(auth, 'failclosed.example');

    // Simulate a deploy with no SendGrid key and no ALLOW_MOCK_DOMAIN_VERIFICATION: the
    // real DNS checks fail (the domain doesn't exist) and nothing may auto-pass.
    const original = env.allowMockDomainVerification;
    (env as { allowMockDomainVerification: boolean }).allowMockDomainVerification = false;
    try {
      const list = await controller.verifyVerifiedDomain(auth, 'failclosed.example');
      const entry = list.find((d) => d.domain === 'failclosed.example');
      expect(entry).toBeDefined();
      expect(entry.status).toBe('pending');
      expect(entry.spf).toBe(false);
      expect(entry.dkim).toBe(false);
      expect(entry.linkBranded).toBe(false);
    } finally {
      (env as { allowMockDomainVerification: boolean }).allowMockDomainVerification = original;
    }
  });

  it('should remove the domain from verified list on deleteVerifiedDomain', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;

    // Add domain
    await controller.addVerifiedDomain(auth, 'deleteme.com');

    // Delete it
    const list = await controller.deleteVerifiedDomain(auth, 'deleteme.com');
    expect(list.length).toBe(0);

    // Snapshot check
    const snapshot = await controller.getSnapshot(auth);
    const verifiedDomains = snapshot['communications.verified_domains'] as any[];
    expect(verifiedDomains.length).toBe(0);
  });

  it('should enforce recomputeAddressFingerprints rate limit of once a month', async () => {
    const householdsController = new HouseholdsController();

    // First recompute request should successfully queue a job
    await householdsController.recomputeAddressFingerprints(tenantId);

    // Verify a background job was created
    const job = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where(sql`payload->>'type'`, '=', 'recompute_address_fingerprints')
      .executeTakeFirst();

    expect(job).toBeDefined();

    // Second request should fail since one exists in the 30-day window
    await expect(householdsController.recomputeAddressFingerprints(tenantId)).rejects.toThrow(
      /Address fingerprints can only be recomputed once a month/,
    );
  });

  describe('workspace API keys', () => {
    /** API access is Grassroots+ (GATED_FEATURES.api); the baseline seed is Free. */
    async function entitle(id: string) {
      await db.updateTable('tenants').set({ subscription_plan: 'grassroots' }).where('id', '=', id).execute();
    }

    it('should refuse to issue a key on the Free plan', async () => {
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      await expect(controller.createApiKey(auth)).rejects.toThrow(/plan/i);
      expect(await controller.listApiKeys(auth)).toEqual([]);
    });

    it('should return the raw key exactly once, then only a preview', async () => {
      await entitle(tenantId);
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      const created = await controller.createApiKey(auth);
      expect(created.key).toMatch(/\S/);
      expect(created.slot).toBe(1);

      const [stored] = await controller.listApiKeys(auth);
      // The preview is a prefix, never the key — anything else means the key is retrievable twice.
      expect(stored.preview).toBe(created.preview);
      expect(stored.preview).not.toBe(created.key);
      expect(created.key).toContain(created.preview);
      expect(stored.lastUsedAt).toBeNull();
    });

    it('should hold two keys at once so a rotation can overlap, and refuse a third', async () => {
      await entitle(tenantId);
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      const first = await controller.createApiKey(auth);
      const second = await controller.createApiKey(auth);

      // The whole point: issuing the second key must NOT invalidate the first, or rotation is
      // still an outage.
      expect(second.key).not.toBe(first.key);
      expect([first.slot, second.slot].sort()).toEqual([1, 2]);
      expect((await controller.listApiKeys(auth)).length).toBe(2);

      await expect(controller.createApiKey(auth)).rejects.toThrow(/Revoke one/i);
    });

    it('should free the slot on revoke so a replacement can be issued', async () => {
      await entitle(tenantId);
      const auth = { tenant_id: tenantId, user_id: userId } as any;

      await controller.createApiKey(auth);
      const second = await controller.createApiKey(auth);
      await controller.revokeApiKey(auth, 1);

      const remaining = await controller.listApiKeys(auth);
      expect(remaining.length).toBe(1);
      expect(remaining[0].preview).toBe(second.preview);

      const replacement = await controller.createApiKey(auth);
      expect(replacement.slot).toBe(1);
    });

    it('should let a downgraded tenant still list and revoke keys it can no longer use', async () => {
      await entitle(tenantId);
      const auth = { tenant_id: tenantId, user_id: userId } as any;
      await controller.createApiKey(auth);

      await db.updateTable('tenants').set({ subscription_plan: 'free' }).where('id', '=', tenantId).execute();

      // Taking a credential out of service must never require an upgrade.
      expect((await controller.listApiKeys(auth)).length).toBe(1);
      await controller.revokeApiKey(auth, 1);
      expect(await controller.listApiKeys(auth)).toEqual([]);
    });

    it('should not let one tenant revoke another tenant key', async () => {
      const victim = await createTestSeed(db);
      try {
        await entitle(tenantId);
        await entitle(victim.tenantId);
        const victimAuth = { tenant_id: victim.tenantId, user_id: victim.userId } as any;
        const attackerAuth = { tenant_id: tenantId, user_id: userId } as any;

        const victimKey = await controller.createApiKey(victimAuth);
        await controller.createApiKey(attackerAuth);
        // Same slot number, different tenant — revoke is keyed on both.
        await controller.revokeApiKey(attackerAuth, 1);

        const survivors = await controller.listApiKeys(victimAuth);
        expect(survivors.length).toBe(1);
        expect(survivors[0].preview).toBe(victimKey.preview);
      } finally {
        await cleanTenant(db, victim.tenantId);
      }
    });
  });
});
