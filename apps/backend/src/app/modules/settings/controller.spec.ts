import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SettingsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { TRPCError } from '@trpc/server';
import { createSigner } from 'fast-jwt';
import { env } from '../../../env';
import { HouseholdsController } from '../households/controller';
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
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
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

  it('should still block sender verification while the tenant is in demo mode', async () => {
    const auth = { tenant_id: tenantId, user_id: userId } as any;
    await db.updateTable('tenants').set({ demo_mode_at: new Date() }).where('id', '=', tenantId).execute();

    await expect(controller.requestEmailVerification(auth, 'demo-blocked@example.com')).rejects.toThrow(/demo/i);
    await expect(controller.addVerifiedDomain(auth, 'demo-blocked.com')).rejects.toThrow(/demo/i);
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
});
