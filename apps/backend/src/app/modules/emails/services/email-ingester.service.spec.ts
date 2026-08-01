import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BaseRepository } from '../../../lib/base.repo';
import { EmailIngesterService, type IngestableEmail } from './email-ingester.service';

// Integration tests for sync de-duplication against locally composed/sent emails.
//
// Microsoft Graph reassigns a message's ID when it moves between folders
// (e.g. Drafts -> Sent), so the optimistically-saved local copy and the
// copy pulled back by sync have different provider IDs. The stable
// internetMessageId header is used to reconcile them. These tests guard
// against the duplicate-in-Sent regression and preserve the send-to-self
// (Sent + Inbox) behaviour.
describe('EmailIngesterService dedup (integration)', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let ingester: EmailIngesterService;

  const SENT = '3';
  const INBOX = '11';

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    ingester = new EmailIngesterService(db, 'ms');

    await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `user-${userId}@example.com`,
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
        name: 'Test Campaign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    for (const table of ['email_recipients', 'email_attachments', 'email_headers', 'email_bodies']) {
      await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  // Mirrors what the send route persists: a local copy in Sent tagged with the
  // draft's provider ID, with the stable Message-ID in email_headers.
  async function seedLocalSentEmail(internetMessageId: string, draftId: string) {
    const created = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: SENT,
        from_email: `user-${userId}@example.com`,
        to_email: 'external@gmail.com',
        subject: 'Hello',
        preview: `ms:${draftId}`,
        assigned_to: userId,
        is_favourite: false,
        status: 'open',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto('email_headers')
      .values({
        tenant_id: tenantId,
        email_id: String(created.id),
        headers_json: JSON.stringify({ internetMessageId }),
        raw_headers: `Message-ID: ${internetMessageId}\r\nSubject: Hello\r\n`,
        date_sent: new Date(),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    return String(created.id);
  }

  function makeIngestable(internetMessageId: string, providerId: string): IngestableEmail {
    return {
      id: providerId,
      internetMessageId,
      fromEmail: `user-${userId}@example.com`,
      toEmail: 'external@gmail.com',
      subject: 'Hello',
      dateSent: new Date(),
      bodyHtml: '<p>Hello</p>',
      recipients: [{ kind: 'to', name: null, email: 'external@gmail.com' }],
      attachments: [],
    };
  }

  const countByFolder = async (folderId: string) => {
    const rows = await db
      .selectFrom('emails')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('folder_id', '=', folderId)
      .execute();
    return rows.length;
  };

  it('does not duplicate a sent email when sync returns it under a new provider ID', async () => {
    const imid = `<${rand()}@example.com>`;
    await seedLocalSentEmail(imid, 'DRAFT_ID');

    // Sync pulls the Sent item back with a DIFFERENT provider ID.
    const inserted = await ingester.ingestEmail(makeIngestable(imid, 'SENT_ID'), tenantId, campaignId, userId, SENT);

    expect(inserted).toBe(false); // reconciled, not inserted
    expect(await countByFolder(SENT)).toBe(1);

    // The local copy's dedupe key should be refreshed to the new provider ID
    // so subsequent syncs match by preview directly.
    const refreshed = await db
      .selectFrom('emails')
      .select('preview')
      .where('tenant_id', '=', tenantId)
      .where('folder_id', '=', SENT)
      .executeTakeFirst();
    expect(refreshed?.preview).toBe('ms:SENT_ID');
  });

  it('is idempotent across repeated syncs of the same sent item', async () => {
    const imid = `<${rand()}@example.com>`;
    await seedLocalSentEmail(imid, 'DRAFT_ID');

    await ingester.ingestEmail(makeIngestable(imid, 'SENT_ID'), tenantId, campaignId, userId, SENT);
    await ingester.ingestEmail(makeIngestable(imid, 'SENT_ID'), tenantId, campaignId, userId, SENT);
    await ingester.ingestEmail(makeIngestable(imid, 'SENT_ID_2'), tenantId, campaignId, userId, SENT);

    expect(await countByFolder(SENT)).toBe(1);
  });

  it('keeps a single copy per folder for send-to-self (Sent + Inbox)', async () => {
    const imid = `<${rand()}@example.com>`;
    await seedLocalSentEmail(imid, 'DRAFT_ID');

    // Same message comes back from Sent and Inbox (each with its own provider ID).
    await ingester.ingestEmail(makeIngestable(imid, 'SENT_ID'), tenantId, campaignId, userId, SENT);
    await ingester.ingestEmail(makeIngestable(imid, 'INBOX_ID'), tenantId, campaignId, userId, INBOX);

    expect(await countByFolder(SENT)).toBe(1);
    expect(await countByFolder(INBOX)).toBe(1);
  });

  it('handles send-to-self when Inbox is synced before Sent', async () => {
    const imid = `<${rand()}@example.com>`;
    await seedLocalSentEmail(imid, 'DRAFT_ID');

    await ingester.ingestEmail(makeIngestable(imid, 'INBOX_ID'), tenantId, campaignId, userId, INBOX);
    await ingester.ingestEmail(makeIngestable(imid, 'SENT_ID'), tenantId, campaignId, userId, SENT);

    expect(await countByFolder(SENT)).toBe(1);
    expect(await countByFolder(INBOX)).toBe(1);
  });

  // Detaching is what the sync does when a message merely leaves the folder. Disconnecting the
  // mailbox is different: the user asked for the synced copy to be gone, and that must still
  // destroy everything, including the comments — otherwise "remove local emails" is a lie.
  describe('detach vs. destroy', () => {
    async function seedSyncedInboxEmailWithComment(providerId: string) {
      const created = await db
        .insertInto('emails')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          folder_id: INBOX,
          from_email: 'sender@example.com',
          to_email: `user-${userId}@example.com`,
          subject: 'Synced message',
          preview: `ms:${providerId}`,
          assigned_to: userId,
          is_favourite: true,
          status: 'closed',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const emailId = String(created.id);
      await db
        .insertInto('email_comments')
        .values({
          tenant_id: tenantId,
          email_id: emailId,
          author_id: userId,
          comment: 'Internal note',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      return emailId;
    }

    const emailRow = async (emailId: string) =>
      await db
        .selectFrom('emails')
        .select(['id', 'detached_at', 'assigned_to', 'status', 'is_favourite'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', emailId)
        .executeTakeFirst();

    const commentCount = async (emailId: string) => {
      const rows = await db
        .selectFrom('email_comments')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('email_id', '=', emailId)
        .execute();
      return rows.length;
    };

    it('detachMessage keeps the row, its comment, its assignee and its status', async () => {
      const emailId = await seedSyncedInboxEmailWithComment('GONE_FROM_FOLDER');

      await ingester.detachMessage(tenantId, campaignId, 'GONE_FROM_FOLDER');

      const row = await emailRow(emailId);
      expect(row).toBeTruthy();
      expect(row?.detached_at).not.toBeNull();
      expect(String(row?.assigned_to)).toBe(userId);
      expect(row?.status).toBe('closed');
      expect(row?.is_favourite).toBe(true);
      expect(await commentCount(emailId)).toBe(1);
    });

    it('detachMessage keeps the original detach time when the sync repeats', async () => {
      // Every incremental sync re-reports the same message as gone. If each one rewrote the
      // timestamp, the retention sweep's age clock would reset forever and a row that carries
      // nothing would never become eligible for pruning.
      const emailId = await seedSyncedInboxEmailWithComment('REPEATED');
      // Whole seconds: the row is read back and stringified for comparison, and a stringified JS
      // Date carries no milliseconds.
      const hundredDaysAgo = Date.now() - 100 * 24 * 60 * 60 * 1000;
      const detachedLongAgo = new Date(Math.floor(hundredDaysAgo / 1000) * 1000);

      await db
        .updateTable('emails')
        .set({ detached_at: detachedLongAgo })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', emailId)
        .execute();

      await ingester.detachMessage(tenantId, campaignId, 'REPEATED');

      const after = (await emailRow(emailId))?.detached_at;
      expect(after).toBeTruthy();
      expect(new Date(String(after)).getTime()).toBe(detachedLongAgo.getTime());
    });

    it('removeAllLocalEmails (mailbox disconnect) still hard-deletes the row and its comment', async () => {
      const emailId = await seedSyncedInboxEmailWithComment('DISCONNECTED');

      await ingester.removeAllLocalEmails(tenantId, campaignId);

      expect(await emailRow(emailId)).toBeUndefined();
      expect(await commentCount(emailId)).toBe(0);
    });
  });
});
