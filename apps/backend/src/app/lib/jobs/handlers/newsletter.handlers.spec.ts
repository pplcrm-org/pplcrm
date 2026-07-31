import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InternalError } from '../../../errors/app-errors';
import { BaseRepository } from '../../base.repo';
import { NewsletterEmailService } from '../../mail/newsletter-mail.service';
import { buildNewsletterAttachments, handleSendNewsletter } from './newsletter.handlers';

vi.mock('../../storage.service', () => {
  class StorageService {
    public async download(): Promise<Buffer> {
      return Buffer.from('fake-file-bytes');
    }
  }
  return { StorageService };
});

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('buildNewsletterAttachments', () => {
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let newsletterId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    newsletterId = rand();

    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'Attachment Test Tenant', subscription_plan: 'free' })
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
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
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
        name: 'Spring gala follow-up',
        subject: 'Spring gala follow-up',
        status: 'draft',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('newsletters').where('id', '=', newsletterId).execute();
    await db.deleteFrom('campaigns').where('id', '=', campaignId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('returns undefined when no files are attached', async () => {
    const attachments = await buildNewsletterAttachments(db, tenantId, newsletterId);
    expect(attachments).toBeUndefined();
  });

  it('downloads and base64-encodes files attached to the newsletter', async () => {
    await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'flyer.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        storage_key: `uploads/${tenantId}/flyer.pdf`,
        entity_type: 'newsletter',
        entity_id: newsletterId,
      })
      .execute();

    const attachments = await buildNewsletterAttachments(db, tenantId, newsletterId);

    expect(attachments).toHaveLength(1);
    expect(attachments?.[0]).toMatchObject({ filename: 'flyer.pdf', type: 'application/pdf' });
    expect(attachments?.[0]?.content).toBe(Buffer.from('fake-file-bytes').toString('base64'));
  });

  it('skips attachments when the tenant is at or over its storage quota', async () => {
    const { getPlanLimits } = await import('../../../modules/billing/usage-limits');
    const quota = getPlanLimits('free').storageBytes;

    await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'flyer.pdf',
        mime_type: 'application/pdf',
        size_bytes: quota,
        storage_key: `uploads/${tenantId}/flyer.pdf`,
        entity_type: 'newsletter',
        entity_id: newsletterId,
      })
      .execute();

    const attachments = await buildNewsletterAttachments(db, tenantId, newsletterId);
    expect(attachments).toBeUndefined();
  });

  it('ignores files not linked to this newsletter', async () => {
    await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'unrelated.pdf',
        storage_key: `uploads/${tenantId}/unrelated.pdf`,
      })
      .execute();

    const attachments = await buildNewsletterAttachments(db, tenantId, newsletterId);
    expect(attachments).toBeUndefined();
  });
});

/**
 * The send job persists its resume cursor BEFORE calling SendGrid (at-most-once), so when the
 * mail service still fails after its in-place retries, the job retry resumes PAST the batch and
 * those recipients are skipped. These tests pin the failure-visibility contract: the error the
 * handler throws (recorded on the job row by the worker) must name the newsletter, the skipped
 * recipient count, and the exact email range (cursor exclusive → nextCursor inclusive).
 */
describe('handleSendNewsletter — skipped-batch visibility on send failure', () => {
  const db = (BaseRepository as any)._db;
  const EMAIL_A = 'nl-batch-a@example.com';
  const EMAIL_B = 'nl-batch-b@example.com';
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let newsletterId: string;
  let tagId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    householdId = rand();
    newsletterId = rand();
    tagId = rand();

    // Paid plan: no free-tier warm-up cap, so the whole 2-person audience fits one batch.
    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'Send Failure Test Tenant', subscription_plan: 'movement' })
      .execute();
    await db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        key: 'communications.default_from_email',
        value: JSON.stringify('news@send-failure-test.org'),
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
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
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
      .insertInto('tags')
      .values({ id: tagId, tenant_id: tenantId, name: 'SendFailureTag', createdby_id: userId, updatedby_id: userId })
      .execute();
    await db
      .insertInto('newsletters')
      .values({
        id: newsletterId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Send failure newsletter',
        subject: 'Hello',
        html_content: '<p>Hi</p>',
        segments: JSON.stringify(['SendFailureTag']),
        status: 'sending',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    for (const email of [EMAIL_A, EMAIL_B]) {
      const personId = rand();
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: 'Pat',
          last_name: 'Recipient',
          email,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
      await db
        .insertInto('map_peoples_tags')
        .values({ tenant_id: tenantId, person_id: personId, tag_id: tagId, createdby_id: userId, updatedby_id: userId })
        .execute();
      // Sendability (§15): an explicit subscribed row in the newsletter's campaign.
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('newsletter_send_log').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('newsletters').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  /** Runs the handler and returns the error it throws (null if it unexpectedly succeeds). */
  function runAndCatch(cursor: string | null, offset: number, deliveredCount: number): Promise<unknown> {
    // offset > 0 marks this a resumed send, which skips the offset-0 preflight re-check — the
    // path under test is the batch send failure, not the content gate.
    return handleSendNewsletter(
      { type: 'send-newsletter', tenantId, newsletterId, userId, offset, deliveredCount, cursor },
      db,
    ).then(
      () => null,
      (e: unknown) => e,
    );
  }

  it('throws a job error naming the newsletter, skipped count, and full range when the first batch fails', async () => {
    const upstream = new Error('SendGrid API responded with status 503: unavailable');
    vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockRejectedValue(upstream);

    const error = await runAndCatch(null, 1, 0);

    expect(error).toBeInstanceOf(InternalError);
    const message = (error as Error).message;
    expect(message).toContain(newsletterId);
    expect(message).toContain('2 recipients skipped');
    expect(message).toContain('start of audience');
    expect(message).toContain(`up to ${EMAIL_B} inclusive`);
    // The real SendGrid failure must survive as the cause for debugging.
    expect((error as Error).cause).toBe(upstream);
  });

  it('names the exclusive lower bound when a resumed send fails mid-audience', async () => {
    vi.spyOn(NewsletterEmailService.prototype, 'sendNewsletter').mockRejectedValue(new Error('boom'));

    const error = await runAndCatch(EMAIL_A, 1, 1);

    expect(error).toBeInstanceOf(InternalError);
    const message = (error as Error).message;
    expect(message).toContain('1 recipients skipped');
    expect(message).toContain(`after ${EMAIL_A} (exclusive)`);
    expect(message).toContain(`up to ${EMAIL_B} inclusive`);
  });
});
