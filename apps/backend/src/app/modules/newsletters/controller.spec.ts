import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NewslettersController } from './controller';
import { BaseController } from '../../lib/base.controller';
import { BaseRepository } from '../../lib/base.repo';
import { executeJob } from '../../lib/jobs/job-handlers';
import { NewsletterEmailService } from '../../lib/mail/newsletter-mail.service';
import { NewsletterPreflightService, contentHashOf } from './preflight.service';
import { loadSendingTenant, remainingSendAllowance } from './send-guards';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  // 1. Tenant — on a paid plan so the anti-abuse send guards (free-tier phone verification and
  // warm-up cap) don't apply; the domain-verification gate is satisfied by the settings below.
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant',
      subscription_plan: 'movement',
    })
    .execute();

  // Sending identity: a verified domain matching the default From address (send-guards gate).
  await db
    .insertInto('settings')
    .values([
      {
        tenant_id: tenantId,
        key: 'communications.default_from_email',
        value: JSON.stringify('news@test-tenant.org'),
      },
      {
        tenant_id: tenantId,
        key: 'communications.verified_domains',
        value: JSON.stringify([{ domain: 'test-tenant.org', status: 'verified' }]),
      },
      {
        tenant_id: tenantId,
        key: 'organization.address',
        value: JSON.stringify('123 Test St, Testville'),
      },
    ])
    .execute();

  // 2. User
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

  // 3. Campaign
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Test Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // 4. Household
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

  // Update tenant
  await db
    .updateTable('tenants')
    .set({
      admin_id: userId,
      createdby_id: userId,
      placeholder_household_id: householdId,
    })
    .where('id', '=', tenantId)
    .execute();

  return { tenantId, userId, campaignId, householdId };
}

// Consent rows (§15): a person is only sendable with a subscribed row in the
// newsletter's campaign.
async function subscribe(
  db: any,
  tenantId: string,
  campaignId: string,
  personId: string,
  email: string,
  userId: string,
) {
  await db
    .insertInto('campaign_subscriptions')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      person_id: personId,
      email,
      status: 'subscribed',
      consent_source: 'import',
      consent_at: new Date(),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('email_suppressions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  // map_newsletters_lists rows cascade when newsletters/lists are deleted.
  // Newsletters reference campaigns (fk_newsletters_campaign), so they go first.
  await db.deleteFrom('newsletter_send_log').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('newsletter_content_checks').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('newsletters').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('NewslettersController Asynchronous Sending', () => {
  const controller = new NewslettersController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let tagId: string;
  let personId: string;

  beforeEach(async () => {
    // The send path crosses the content gate; pin its network seams shut so tests never call
    // Anthropic (even when a dev shell exports ANTHROPIC_API_KEY) or the Postmark spamcheck API.
    vi.spyOn(NewsletterPreflightService.prototype, 'aiReview').mockResolvedValue(null);
    vi.spyOn(NewsletterPreflightService.prototype, 'spamAssassinScore').mockResolvedValue(null);

    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;

    // Create a person
    personId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Alice',
        last_name: 'Smith',
        email: 'alice@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await subscribe(db, tenantId, campaignId, personId, 'alice@example.com', userId);

    // Create Tag
    tagId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tags')
      .values({
        id: tagId,
        tenant_id: tenantId,
        name: 'NewsletterTag',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Map Person to Tag
    await db
      .insertInto('map_peoples_tags')
      .values({
        tenant_id: tenantId,
        person_id: personId,
        tag_id: tagId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
    vi.restoreAllMocks();
  });

  it('should throw BadRequestError if newsletter is already sent or queuing/sending', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Already Sent Newsletter',
        status: 'sent',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await expect(controller.sendNewsletter(tenantId, id, userId)).rejects.toThrow(
      'Newsletter has already been sent or is currently sending',
    );
  });

  it('should throw BadRequestError if no recipients are resolved', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'No Recipients Newsletter',
        status: 'draft',
        segments: JSON.stringify(['NonExistentTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await expect(controller.sendNewsletter(tenantId, id, userId)).rejects.toThrow(
      'No recipients found for the selected lists or tags',
    );
  });

  it('should enqueue a background job and set status to queuing', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Valid Newsletter',
        status: 'draft',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const result = await controller.sendNewsletter(tenantId, id, userId);
    expect(result.status).toBe('queuing');
    expect(result.total_recipients).toBe(1);

    // Verify background job is enqueued
    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();

    expect(job).toBeDefined();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    expect(payload.type).toBe('send-newsletter');
    expect(payload.newsletterId).toBe(id);
    expect(payload.offset).toBe(0);
    expect(payload.deliveredCount).toBe(0);
  });

  it('rejects a send that would exceed the monthly plan email allowance', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Over Allowance Newsletter',
        status: 'draft',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Movement at quantity 1 allows 12,000 emails/month (12× the 1,000-subscriber bracket).
    // Exhaust it, so even a 1-recipient send must be refused with the exact numbers.
    await db
      .insertInto('newsletter_send_log')
      .values({ tenant_id: tenantId, newsletter_id: id, recipient_count: 12_000 })
      .execute();

    await expect(controller.sendNewsletter(tenantId, id, userId)).rejects.toThrow(/12,000 newsletter emails per month/);

    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    expect(job).toBeUndefined();
  });

  it('holds sending while the subscription payment is past due', async () => {
    await db.updateTable('tenants').set({ subscription_status: 'past_due' }).where('id', '=', tenantId).execute();

    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Payment Hold Newsletter',
        status: 'draft',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await expect(controller.sendNewsletter(tenantId, id, userId)).rejects.toThrow(/payment did not go through/);

    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    expect(job).toBeUndefined();
  });

  it('bounds the worker batch allowance by what remains of the monthly allowance', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Nearly Exhausted Newsletter',
        status: 'draft',
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 11,900 of the 12,000 monthly allowance used → 100 left. The hourly cap (20,000 on
    // Movement) leaves 8,100, so the monthly term must be the binding one.
    await db
      .insertInto('newsletter_send_log')
      .values({ tenant_id: tenantId, newsletter_id: id, recipient_count: 11_900 })
      .execute();

    const tenant = await loadSendingTenant(db, tenantId);
    expect(await remainingSendAllowance(db, tenant, new Date())).toBe(100);
  });

  it('freezes scored content once a newsletter is queuing/sending/sent (preflight TOCTOU guard)', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Locked Newsletter',
        status: 'queuing',
        subject: 'Benign subject',
        html_content: '<p>Benign body that passed preflight</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Swapping the content after send was requested would let the sent copy diverge from the
    // scored copy — refuse it.
    await expect(
      controller.update({
        tenant_id: tenantId,
        id,
        row: { html_content: '<p>Swapped-in phishing</p>', updatedby_id: userId },
      }),
    ).rejects.toThrow(/no longer be edited/);

    // A non-content edit (e.g. renaming) is still allowed in this state.
    const renamed = (await controller.update({
      tenant_id: tenantId,
      id,
      row: { name: 'Renamed', updatedby_id: userId },
    })) as Record<string, unknown>;
    expect(renamed['name']).toBe('Renamed');
  });

  it('should refuse to send when the content preflight lands in the blocked band', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    // Phishing-shaped content: anchor text claims one domain, href goes elsewhere, plus a raw-IP
    // link — the lint deductions alone push the score below the blocked threshold.
    const phishyHtml =
      `<p>${'Real newsletter text so the body is not image-only. '.repeat(5)}</p>` +
      '<a href="https://evil.example.net/login">www.yourbank.com</a>' +
      '<a href="https://93.184.216.34/pay">Confirm your payment</a>';
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Blocked Newsletter',
        status: 'draft',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: phishyHtml,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await expect(controller.sendNewsletter(tenantId, id, userId)).rejects.toThrow(/Deliverability score \d+/);

    // The send never got as far as enqueueing a job, and the check was cached for the panel.
    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    expect(job).toBeUndefined();
    const check = await db
      .selectFrom('newsletter_content_checks')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    expect(check?.band).toBe('blocked');
    expect(String(check?.newsletter_id)).toBe(id);
  });

  it('should reuse a cached preflight verdict at send time instead of recomputing', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    // Content that would lint into the blocked band if recomputed…
    const html = '<a href="https://evil.example.net">www.yourbank.com</a><a href="https://93.184.216.34/x">pay</a>';
    const subject = 'Hello';
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Cached Newsletter',
        status: 'draft',
        segments: JSON.stringify(['NewsletterTag']),
        subject,
        html_content: html,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    // …but a cached row (as the composer's runPreflight would have written) says it passed, so the
    // send must consume the cache rather than recompute, and backfill the newsletter id.
    await db
      .insertInto('newsletter_content_checks')
      .values({
        tenant_id: tenantId,
        newsletter_id: null,
        content_hash: contentHashOf(subject, html, null),
        score: 97,
        band: 'good',
        findings: JSON.stringify([]),
      })
      .execute();

    const result = await controller.sendNewsletter(tenantId, id, userId);
    expect(result.status).toBe('queuing');

    const check = await db
      .selectFrom('newsletter_content_checks')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    expect(String(check?.newsletter_id)).toBe(id);
  });

  it('should process newsletter sending, support batching, and update status/activity', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Send Worker Newsletter',
        status: 'queuing',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Create a mock job entry
    const jobId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('background_jobs')
      .values({
        id: jobId,
        tenant_id: tenantId,
        queue: 'default',
        status: 'processing',
        payload: JSON.stringify({
          type: 'send-newsletter',
          newsletterId: id,
          tenantId: tenantId,
          userId: userId,
          offset: 0,
          deliveredCount: 0,
        }),
        attempts: 1,
        max_attempts: 3,
        run_at: new Date(),
      })
      .execute();

    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);

    const job = await db.selectFrom('background_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;

    await executeJob(payload, db, jobId);

    expect(spy).toHaveBeenCalledTimes(1);

    // Verify newsletter is updated to 'sent'
    const newsletter = await db.selectFrom('newsletters').selectAll().where('id', '=', id).executeTakeFirst();
    expect(newsletter.status).toBe('sent');
    expect(Number(newsletter.delivered_count)).toBe(1);
    expect(newsletter.send_date).not.toBeNull();

    // Verify user activity is logged
    const activity = await db
      .selectFrom('user_activity')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('entity_id', '=', id)
      .executeTakeFirst();
    expect(activity).toBeDefined();
    expect(activity.activity).toBe('send');
    expect(Number(activity.quantity)).toBe(1);
  });

  it('reverts to draft instead of sending when content fails the send-time re-check (TOCTOU)', async () => {
    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    // Simulate a post-send content swap: the newsletter is queued to send, but the stored content
    // now lints into the blocked band. The worker must re-score and refuse rather than blast it.
    const phishyHtml =
      `<p>${'Real newsletter text so the body is not image-only. '.repeat(5)}</p>` +
      '<a href="https://evil.example.net/login">www.yourbank.com</a>' +
      '<a href="https://93.184.216.34/pay">Confirm your payment</a>';
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Swapped Newsletter',
        status: 'queuing',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: phishyHtml,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const jobId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('background_jobs')
      .values({
        id: jobId,
        tenant_id: tenantId,
        queue: 'default',
        status: 'processing',
        payload: JSON.stringify({
          type: 'send-newsletter',
          newsletterId: id,
          tenantId,
          userId,
          offset: 0,
          deliveredCount: 0,
        }),
        attempts: 1,
        max_attempts: 3,
        run_at: new Date(),
      })
      .execute();

    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);
    const job = await db.selectFrom('background_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;

    await executeJob(payload, db, jobId);

    // Nothing was sent, and the newsletter was returned to draft for the operator to fix.
    expect(spy).not.toHaveBeenCalled();
    const newsletter = await db.selectFrom('newsletters').selectAll().where('id', '=', id).executeTakeFirst();
    expect(newsletter.status).toBe('draft');
  });

  it('should process all recipients and set status to sent', async () => {
    // Add another person to make it 2 recipients
    const personId2 = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: personId2,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Bob',
        last_name: 'Jones',
        email: 'bob@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await subscribe(db, tenantId, campaignId, personId2, 'bob@example.com', userId);

    // Map second person to Tag
    await db
      .insertInto('map_peoples_tags')
      .values({
        tenant_id: tenantId,
        person_id: personId2,
        tag_id: tagId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const id = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Multiple Recipients Newsletter',
        status: 'queuing',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        total_recipients: 2,
        delivered_count: 0,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const jobId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('background_jobs')
      .values({
        id: jobId,
        tenant_id: tenantId,
        queue: 'default',
        status: 'processing',
        payload: JSON.stringify({
          type: 'send-newsletter',
          newsletterId: id,
          tenantId: tenantId,
          userId: userId,
          offset: 0,
          deliveredCount: 0,
        }),
        attempts: 1,
        max_attempts: 3,
        run_at: new Date(),
      })
      .execute();

    const _spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(2);

    const job = await db.selectFrom('background_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    await executeJob(payload, db, jobId);

    // Verify newsletter is now fully 'sent'
    const newsletter = await db.selectFrom('newsletters').selectAll().where('id', '=', id).executeTakeFirst();
    expect(newsletter.status).toBe('sent');
    expect(Number(newsletter.delivered_count)).toBe(2);
  });

  // ---- send-job edge cases (handleSendNewsletter) ----

  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  /** A queued newsletter + its processing job row, ready for executeJob. */
  async function seedQueuedNewsletter(overrides: Record<string, unknown> = {}) {
    const id = rand();
    const jobId = rand();
    await db
      .insertInto('newsletters')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Edge Case Newsletter',
        status: 'queuing',
        segments: JSON.stringify(['NewsletterTag']),
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        createdby_id: userId,
        updatedby_id: userId,
        ...overrides,
      })
      .execute();
    const payload = { type: 'send-newsletter', newsletterId: id, tenantId, userId, offset: 0, deliveredCount: 0 };
    await db
      .insertInto('background_jobs')
      .values({
        id: jobId,
        tenant_id: tenantId,
        queue: 'default',
        status: 'processing',
        payload: JSON.stringify(payload),
        attempts: 1,
        max_attempts: 3,
        run_at: new Date(),
      })
      .execute();
    return { id, jobId, payload };
  }

  it('always hands SendGrid a plain-text part: derived from the HTML when none was composed', async () => {
    const { jobId, payload } = await seedQueuedNewsletter({
      html_content: '<h1>Big news</h1><p>Hello supporters</p>',
      plain_text_content: null,
    });
    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);

    await executeJob(payload, db, jobId);

    const call = spy.mock.calls[0][0];
    // Derived text mirrors the HTML structure, and the mandatory footer (with the SendGrid
    // unsubscribe substitution tag) is appended to BOTH parts so it can never be edited out.
    expect(call.text).toBe(
      'Big news\n\nHello supporters\n\n----\n123 Test St, Testville\nUnsubscribe: <% unsubscribe %>\npowered by pplCRM (https://pplcrm.com)',
    );
    expect(call.html).toContain('<a href="<% unsubscribe %>">Unsubscribe</a>');
  });

  it('prefers the composed plain text over the derived one', async () => {
    const { jobId, payload } = await seedQueuedNewsletter({ plain_text_content: 'Hand-written text.' });
    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);

    await executeJob(payload, db, jobId);

    expect(spy.mock.calls[0][0].text).toBe(
      'Hand-written text.\n\n----\n123 Test St, Testville\nUnsubscribe: <% unsubscribe %>\npowered by pplCRM (https://pplcrm.com)',
    );
  });

  it('fails loudly instead of sending from a platform address when the From setting is missing', async () => {
    // Simulates the send-guard invariant being bypassed (e.g. settings wiped between gate and job).
    await db
      .deleteFrom('settings')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'communications.default_from_email')
      .execute();
    const { jobId, payload } = await seedQueuedNewsletter();
    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);

    await expect(executeJob(payload, db, jobId)).rejects.toThrow(/no verified From address/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('drops an unverified reply-to address but honors a verified one', async () => {
    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);
    await db
      .insertInto('settings')
      .values({ tenant_id: tenantId, key: 'communications.reply_to', value: JSON.stringify('reply@test-tenant.org') })
      .execute();

    const first = await seedQueuedNewsletter();
    await executeJob(first.payload, db, first.jobId);
    expect(spy.mock.calls[0][0].replyTo).toBeUndefined();

    await db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        key: 'communications.verified_emails',
        value: JSON.stringify(['reply@test-tenant.org']),
      })
      .execute();
    const second = await seedQueuedNewsletter();
    await executeJob(second.payload, db, second.jobId);
    expect(spy.mock.calls[1][0].replyTo).toBe('reply@test-tenant.org');
  });

  it('pauses mid-send (storing the resume point) when the tenant is blocked while in flight', async () => {
    const { id, jobId, payload } = await seedQueuedNewsletter();
    // Tripwire fires (via the SendGrid webhook) after the job was queued but before this batch.
    await db.updateTable('tenants').set({ sending_paused_at: new Date() }).where('id', '=', tenantId).execute();
    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);

    await executeJob(payload, db, jobId);

    expect(spy).not.toHaveBeenCalled();
    const newsletter = await db.selectFrom('newsletters').selectAll().where('id', '=', id).executeTakeFirst();
    expect(newsletter.status).toBe('paused');
    expect(Number(newsletter.send_offset)).toBe(0);
  });

  it('defers the remainder to a continuation job when the hourly send cap is exhausted', async () => {
    const { id, jobId, payload } = await seedQueuedNewsletter();
    // Movement plan: 20k/rolling hour. A batch of exactly that size leaves zero allowance.
    await db
      .insertInto('newsletter_send_log')
      .values({ tenant_id: tenantId, newsletter_id: id, recipient_count: 20000 })
      .execute();
    const spy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1);

    await executeJob(payload, db, jobId);

    expect(spy).not.toHaveBeenCalled();
    // The resume point is stored and a future-dated continuation job carries the send forward.
    const newsletter = await db.selectFrom('newsletters').selectAll().where('id', '=', id).executeTakeFirst();
    expect(Number(newsletter.send_offset)).toBe(0);
    expect(newsletter.status).not.toBe('sent');
    const continuation = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    expect(continuation).toBeDefined();
    const contPayload =
      typeof continuation.payload === 'string' ? JSON.parse(continuation.payload) : continuation.payload;
    expect(contPayload).toMatchObject({ type: 'send-newsletter', newsletterId: id, offset: 0 });
    expect(new Date(continuation.run_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('NewslettersController list targeting (map_newsletters_lists)', () => {
  const controller = new NewslettersController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let listA: string;
  let listB: string;

  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  beforeEach(async () => {
    // The send path crosses the content gate; pin its network seams shut so tests never call
    // Anthropic (even when a dev shell exports ANTHROPIC_API_KEY) or the Postmark spamcheck API.
    vi.spyOn(NewsletterPreflightService.prototype, 'aiReview').mockResolvedValue(null);
    vi.spyOn(NewsletterPreflightService.prototype, 'spamAssassinScore').mockResolvedValue(null);

    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;

    listA = rand();
    listB = rand();
    for (const [id, name] of [
      [listA, 'List A'],
      [listB, 'List B'],
    ]) {
      await db
        .insertInto('lists')
        .values({
          id,
          tenant_id: tenantId,
          campaign_id: campaignId,
          name,
          object: 'people',
          is_dynamic: false,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  async function mapRows(newsletterId: string) {
    const rows = await db
      .selectFrom('map_newsletters_lists')
      .select(['list_id', 'mode'])
      .where('tenant_id', '=', tenantId)
      .where('newsletter_id', '=', newsletterId)
      .execute();
    return rows.map((r: any) => `${r.list_id}:${r.mode}`).sort();
  }

  it('syncs map rows on add/update, dropping ids that do not resolve to a live list', async () => {
    const dangling = rand();
    const created = await controller.add({
      tenant_id: tenantId,
      name: 'Targeted Newsletter',
      status: 'draft',
      target_lists: JSON.stringify({ include: [listA, dangling], exclude: [listB] }),
      createdby_id: userId,
      updatedby_id: userId,
    } as any);
    const id = String((created as any).id);

    expect(await mapRows(id)).toEqual([`${listA}:include`, `${listB}:exclude`].sort());

    // Update replaces the whole set; bare-array shape means include-only.
    await controller.update({
      tenant_id: tenantId,
      id,
      row: { target_lists: JSON.stringify([listB]), updatedby_id: userId } as any,
    });
    expect(await mapRows(id)).toEqual([`${listB}:include`]);

    // Referential integrity: deleting the list cascades the map row away.
    await db.deleteFrom('lists').where('tenant_id', '=', tenantId).where('id', '=', listB).execute();
    expect(await mapRows(id)).toEqual([]);
  });

  it('buildRecipientQuery resolves include/exclude lists from the map table', async () => {
    // Person in list A with an email.
    const personId = rand();
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Bob',
        last_name: 'Jones',
        email: 'bob@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await subscribe(db, tenantId, campaignId, personId, 'bob@example.com', userId);
    await db
      .insertInto('map_lists_persons')
      .values({ tenant_id: tenantId, list_id: listA, person_id: personId, createdby_id: userId, updatedby_id: userId })
      .execute();

    const created = await controller.add({
      tenant_id: tenantId,
      name: 'Recipient Query Newsletter',
      status: 'draft',
      target_lists: JSON.stringify({ include: [listA], exclude: [] }),
      createdby_id: userId,
      updatedby_id: userId,
    } as any);
    const newsletter = { id: String((created as any).id), segments: null, campaign_id: campaignId };

    const query = await controller.buildRecipientQuery(tenantId, newsletter);
    const recipients = await query.select('persons.email').execute();
    expect(recipients.map((r: any) => r.email)).toContain('bob@example.com');

    // Excluding the same list must remove the recipient again.
    await controller.update({
      tenant_id: tenantId,
      id: newsletter.id,
      row: { target_lists: JSON.stringify({ include: [listA], exclude: [listA] }), updatedby_id: userId } as any,
    });
    const query2 = await controller.buildRecipientQuery(tenantId, newsletter);
    const recipients2 = await query2.select('persons.email').execute();
    expect(recipients2.map((r: any) => r.email)).not.toContain('bob@example.com');
  });
});

/**
 * Server-side scheduling validation (no dedicated endpoint — scheduling flows through generic
 * CRUD add/update, so the controller must reject a `scheduled` row with a null/past send_date;
 * the cron only fires `send_date <= now`, which NULL never matches, so such a row would sit
 * silently forever). Pure unit tests: the base CRUD layer and current-row lookup are spied out.
 */
describe('NewslettersController scheduling validation', () => {
  const controller = new NewslettersController();
  const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
  const PAST = new Date(Date.now() - 60 * 60 * 1000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('add: rejects scheduled without a send date', async () => {
    await expect(
      controller.add({ tenant_id: '1', name: 'n', status: 'scheduled', createdby_id: '1' } as any),
    ).rejects.toThrow(/send date/i);
    await expect(
      controller.add({ tenant_id: '1', name: 'n', status: 'scheduled', send_date: null, createdby_id: '1' } as any),
    ).rejects.toThrow(/send date/i);
  });

  it('add: rejects scheduled with a past send date', async () => {
    await expect(
      controller.add({ tenant_id: '1', name: 'n', status: 'scheduled', send_date: PAST, createdby_id: '1' } as any),
    ).rejects.toThrow(/future/i);
  });

  it('update: rejects clearing the send date of a scheduled newsletter', async () => {
    vi.spyOn(controller, 'getOneById').mockResolvedValue({ status: 'scheduled', send_date: FUTURE } as any);
    await expect(controller.update({ tenant_id: '1', id: '7', row: { send_date: null } as any })).rejects.toThrow(
      /send date/i,
    );
  });

  it('update: rejects re-scheduling to the past', async () => {
    await expect(
      controller.update({ tenant_id: '1', id: '7', row: { status: 'scheduled', send_date: PAST } as any }),
    ).rejects.toThrow(/future/i);
  });

  it('update: rejects switching to scheduled when no send date exists', async () => {
    vi.spyOn(controller, 'getOneById').mockResolvedValue({ status: 'draft', send_date: null } as any);
    await expect(controller.update({ tenant_id: '1', id: '7', row: { status: 'scheduled' } as any })).rejects.toThrow(
      /send date/i,
    );
  });

  it('update: accepts scheduling with a future send date', async () => {
    const baseUpdate = vi.spyOn(BaseController.prototype, 'update').mockResolvedValue({ id: '7' } as any);
    await controller.update({ tenant_id: '1', id: '7', row: { status: 'scheduled', send_date: FUTURE } as any });
    expect(baseUpdate).toHaveBeenCalledTimes(1);
  });

  it('update: leaves non-scheduling edits of a scheduled newsletter alone even when its time has come', async () => {
    // The cron is about to fire this row — editing an unrelated field must not throw.
    const baseUpdate = vi.spyOn(BaseController.prototype, 'update').mockResolvedValue({ id: '7' } as any);
    const lookup = vi
      .spyOn(controller, 'getOneById')
      .mockResolvedValue({ status: 'scheduled', send_date: PAST } as any);
    await controller.update({ tenant_id: '1', id: '7', row: { name: 'renamed' } as any });
    expect(baseUpdate).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });
});

/**
 * sendTest is authenticated but otherwise wide open by nature: it takes a recipient, a From
 * address and arbitrary HTML. Without these two checks it is a spoofing channel — mail any
 * content to any stranger, from any address (including the pplcrm.com preview fallback).
 */
describe('NewslettersController sendTestEmail sender/recipient hardening', () => {
  const controller = new NewslettersController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let callerEmail: string;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  const auth = () => ({ tenant_id: tenantId, user_id: userId, session_id: 'test-session' });
  const draft = (over: Record<string, unknown> = {}) => ({
    subject: 'Preview',
    html: '<p>Hello</p>',
    to: callerEmail,
    ...over,
  });

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    callerEmail = `test-${userId}@example.com`;

    // news@test-tenant.org is the seeded default From; mark it verified so the happy path passes.
    await db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        key: 'communications.verified_emails',
        value: JSON.stringify(['news@test-tenant.org']),
      })
      .execute();

    sendSpy = vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockResolvedValue(1 as any);
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
    vi.restoreAllMocks();
  });

  it('refuses a recipient that is not the caller’s own account address', async () => {
    await expect(controller.sendTestEmail(auth() as any, draft({ to: 'victim@example.com' }))).rejects.toThrow(
      /your own address/i,
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('refuses a From address the tenant has not verified', async () => {
    await expect(
      controller.sendTestEmail(auth() as any, draft({ fromEmail: 'security@some-bank.example' })),
    ).rejects.toThrow(/not a verified sending address/i);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('accepts a verified From address sent to the caller', async () => {
    await controller.sendTestEmail(auth() as any, draft({ fromEmail: 'news@test-tenant.org' }));
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((sendSpy.mock.calls[0][0] as any).fromEmail).toBe('news@test-tenant.org');
  });

  it('falls back to the configured default From when none is supplied', async () => {
    await controller.sendTestEmail(auth() as any, draft());
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((sendSpy.mock.calls[0][0] as any).fromEmail).toBe('news@test-tenant.org');
  });

  it('compares the recipient case-insensitively', async () => {
    await controller.sendTestEmail(auth() as any, draft({ to: callerEmail.toUpperCase() }));
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
