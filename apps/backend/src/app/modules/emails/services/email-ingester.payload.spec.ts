import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../../lib/base.repo';
import { StorageService } from '../../../lib/storage.service';
import { EmailIngesterService, type IngestableEmail } from './email-ingester.service';
import { EmailBodiesRepo } from '../repositories/email-body.repo';
import { EAGER_ATTACHMENT_MAX_BYTES } from '../../../../../../../libs/common/src/lib/emails';

// What a synced message costs us in storage is decided here: which attachment payloads get pulled
// during sync, and where the body HTML lands. These are integration tests against the real schema
// because the whole point is what ends up in the rows.
describe('EmailIngesterService payload policy (integration)', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let ingester: EmailIngesterService;
  let uploadSpy: ReturnType<typeof vi.spyOn>;

  const INBOX = '11';
  const SPAM = '4';
  const TRASH = '5';

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    ingester = new EmailIngesterService(db, 'google');

    // Storage is not exercised in tests; we only care that it is called the right number of times.
    uploadSpy = vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined);
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

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
    vi.restoreAllMocks();
    for (const table of ['email_recipients', 'email_attachments', 'email_headers', 'email_bodies']) {
      await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  function makeEmail(providerId: string, overrides: Partial<IngestableEmail> = {}): IngestableEmail {
    return {
      id: providerId,
      internetMessageId: `<${providerId}@example.com>`,
      fromEmail: 'sender@example.com',
      toEmail: `user-${userId}@example.com`,
      subject: 'Subject',
      dateSent: new Date(),
      bodyHtml: '<p>Body</p>',
      recipients: [{ kind: 'to', name: null, email: `user-${userId}@example.com` }],
      attachments: [],
      ...overrides,
    };
  }

  function attachment(name: string, size: number, content: Buffer, remoteRef = 'REMOTE_1') {
    return {
      name,
      contentType: 'application/pdf',
      size,
      contentId: null,
      isInline: false,
      remoteRef,
      fetchContent: async () => content,
    };
  }

  const attachmentsFor = async (providerId: string) =>
    db
      .selectFrom('emails')
      .innerJoin('email_attachments', 'email_attachments.email_id', 'emails.id')
      .selectAll('email_attachments')
      .where('emails.tenant_id', '=', tenantId)
      .where('emails.preview', '=', `google:${providerId}`)
      .execute();

  const bodyFor = async (providerId: string) =>
    db
      .selectFrom('emails')
      .innerJoin('email_bodies', 'email_bodies.email_id', 'emails.id')
      .selectAll('email_bodies')
      .where('emails.tenant_id', '=', tenantId)
      .where('emails.preview', '=', `google:${providerId}`)
      .executeTakeFirst();

  describe('attachments', () => {
    it('fetches a small Inbox attachment during sync', async () => {
      const content = Buffer.from('small');
      await ingester.ingestEmail(
        makeEmail('MSG_SMALL', { attachments: [attachment('small.pdf', content.length, content)] }),
        tenantId,
        campaignId,
        userId,
        INBOX,
      );

      const rows = await attachmentsFor('MSG_SMALL');
      expect(rows).toHaveLength(1);
      expect(rows[0].file_id).not.toBeNull();
      expect(uploadSpy).toHaveBeenCalledTimes(1);
    });

    it('defers an oversized attachment, recording it without the payload', async () => {
      const size = EAGER_ATTACHMENT_MAX_BYTES + 1;
      let fetched = false;
      const att = {
        ...attachment('big.pdf', size, Buffer.alloc(0)),
        fetchContent: async () => {
          fetched = true;
          return Buffer.alloc(size);
        },
      };

      await ingester.ingestEmail(makeEmail('MSG_BIG', { attachments: [att] }), tenantId, campaignId, userId, INBOX);

      const rows = await attachmentsFor('MSG_BIG');
      expect(rows).toHaveLength(1);
      // Recorded so the user sees it exists...
      expect(rows[0].filename).toBe('big.pdf');
      expect(Number(rows[0].size_bytes)).toBe(size);
      expect(rows[0].remote_ref).toBe('REMOTE_1');
      // ...but nothing was downloaded or stored.
      expect(rows[0].file_id).toBeNull();
      expect(fetched).toBe(false);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('never fetches a spam attachment, however small', async () => {
      const content = Buffer.from('junk');
      let fetched = false;
      const att = {
        ...attachment('invoice.pdf', content.length, content),
        fetchContent: async () => {
          fetched = true;
          return content;
        },
      };

      await ingester.ingestEmail(makeEmail('MSG_SPAM', { attachments: [att] }), tenantId, campaignId, userId, SPAM);

      const rows = await attachmentsFor('MSG_SPAM');
      expect(rows).toHaveLength(1);
      expect(rows[0].file_id).toBeNull();
      expect(fetched).toBe(false);
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('does not fetch trash attachments during sync', async () => {
      const content = Buffer.from('deleted');
      await ingester.ingestEmail(
        makeEmail('MSG_TRASH', { attachments: [attachment('old.pdf', content.length, content)] }),
        tenantId,
        campaignId,
        userId,
        TRASH,
      );

      const rows = await attachmentsFor('MSG_TRASH');
      expect(rows[0].file_id).toBeNull();
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('reuses an identical blob instead of uploading it twice', async () => {
      // The dedupe check must happen BEFORE the upload. Uploading first and then linking the
      // pre-existing file row strands the second blob: its storage_key is recorded nowhere, so
      // nothing can ever find it to delete.
      const content = Buffer.from('identical bytes');
      const first = attachment('a.pdf', content.length, content, 'REF_A');
      const second = attachment('b.pdf', content.length, content, 'REF_B');

      await ingester.ingestEmail(makeEmail('MSG_D1', { attachments: [first] }), tenantId, campaignId, userId, INBOX);
      await ingester.ingestEmail(makeEmail('MSG_D2', { attachments: [second] }), tenantId, campaignId, userId, INBOX);

      expect(uploadSpy).toHaveBeenCalledTimes(1);

      const files = await db.selectFrom('files').selectAll().where('tenant_id', '=', tenantId).execute();
      expect(files).toHaveLength(1);

      // Both attachments point at that single file row.
      const [rowA] = await attachmentsFor('MSG_D1');
      const [rowB] = await attachmentsFor('MSG_D2');
      expect(String(rowA.file_id)).toBe(String(rowB.file_id));
    });
  });

  describe('bodies', () => {
    it('keeps a small body inline and still extracts searchable text', async () => {
      await ingester.ingestEmail(
        makeEmail('MSG_TINY', { bodyHtml: '<p>Short message</p>' }),
        tenantId,
        campaignId,
        userId,
        INBOX,
      );

      const body = await bodyFor('MSG_TINY');
      expect(body?.storage_key).toBeNull();
      expect(body?.body_html).toContain('Short message');
      expect(body?.body_text).toBe('Short message');
    });

    it('offloads a large body to storage, leaving only the text extract in Postgres', async () => {
      const bulky = `<p>Real words here</p><div style="${'x'.repeat(20_000)}"></div>`;

      await ingester.ingestEmail(makeEmail('MSG_BULKY', { bodyHtml: bulky }), tenantId, campaignId, userId, INBOX);

      const body = await bodyFor('MSG_BULKY');
      expect(body?.storage_key).toMatch(/^emails\/bodies\//);
      expect(body?.body_html).toBeNull();
      expect(body?.body_text).toContain('Real words here');
      // The 20KB of inline CSS must not have been indexed as text.
      expect((body?.body_text ?? '').length).toBeLessThan(1000);
      expect(uploadSpy).toHaveBeenCalledTimes(1);
    });

    it('stores a display snippet on the row, never the dedupe key', async () => {
      await ingester.ingestEmail(
        makeEmail('MSG_SNIPPET', { bodyHtml: '<p>Bonjour! We talked at the market.</p>' }),
        tenantId,
        campaignId,
        userId,
        INBOX,
      );

      const row = await db
        .selectFrom('emails')
        .select(['preview', 'preview_text'])
        .where('tenant_id', '=', tenantId)
        .where('preview', '=', 'google:MSG_SNIPPET')
        .executeTakeFirst();

      // The regression: the inbox list renders preview_text, and `preview` is the dedupe key.
      // If a snippet ever lands in `preview`, dedupe breaks; if the key lands in `preview_text`,
      // the user reads "google:MSG_SNIPPET" under every subject.
      expect(row?.preview_text).toBe('Bonjour! We talked at the market.');
      expect(row?.preview).toBe('google:MSG_SNIPPET');
      expect(row?.preview_text).not.toMatch(/^(google|ms):/);
    });

    it('leaves the snippet null for a body with no prose, rather than an empty line', async () => {
      await ingester.ingestEmail(
        makeEmail('MSG_IMG_ONLY', { bodyHtml: '<div><img src="https://example.com/a.png" /></div>' }),
        tenantId,
        campaignId,
        userId,
        INBOX,
      );

      const row = await db
        .selectFrom('emails')
        .select('preview_text')
        .where('tenant_id', '=', tenantId)
        .where('preview', '=', 'google:MSG_IMG_ONLY')
        .executeTakeFirst();

      expect(row?.preview_text).toBeNull();
    });
  });

  // Bodies live in two places, so nothing may read `body_html` directly. The inline fallback in
  // particular is load-bearing: every row written before the storage split is inline-only, and
  // losing it would blank the historical inbox.
  describe('read path', () => {
    const emailIdFor = async (providerId: string) => {
      const row = await db
        .selectFrom('emails')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('preview', '=', `google:${providerId}`)
        .executeTakeFirstOrThrow();
      return String(row.id);
    };

    it('reads a blob-backed body back out of storage', async () => {
      const bulky = `<p>Stored remotely</p><div style="${'x'.repeat(20_000)}"></div>`;
      vi.spyOn(StorageService.prototype, 'download').mockResolvedValue(Buffer.from(bulky, 'utf8'));

      await ingester.ingestEmail(makeEmail('MSG_READ_BLOB', { bodyHtml: bulky }), tenantId, campaignId, userId, INBOX);

      const repo = new EmailBodiesRepo();
      const html = await repo.getBodyHtml(tenantId, await emailIdFor('MSG_READ_BLOB'));
      expect(html).toContain('Stored remotely');
    });

    it('returns inline HTML without touching storage', async () => {
      const downloadSpy = vi.spyOn(StorageService.prototype, 'download');

      await ingester.ingestEmail(
        makeEmail('MSG_READ_INLINE', { bodyHtml: '<p>Kept inline</p>' }),
        tenantId,
        campaignId,
        userId,
        INBOX,
      );

      const repo = new EmailBodiesRepo();
      const html = await repo.getBodyHtml(tenantId, await emailIdFor('MSG_READ_INLINE'));
      expect(html).toContain('Kept inline');
      expect(downloadSpy).not.toHaveBeenCalled();
    });

    it('degrades to an empty body rather than throwing when the blob is unreadable', async () => {
      const bulky = `<p>Unreachable</p><div style="${'x'.repeat(20_000)}"></div>`;
      await ingester.ingestEmail(makeEmail('MSG_READ_FAIL', { bodyHtml: bulky }), tenantId, campaignId, userId, INBOX);

      vi.spyOn(StorageService.prototype, 'download').mockRejectedValue(new Error('storage down'));

      const repo = new EmailBodiesRepo();
      // Sender, subject and attachments are still worth showing, so this must not surface as an error.
      await expect(repo.getBodyHtml(tenantId, await emailIdFor('MSG_READ_FAIL'))).resolves.toBe('');
    });

    it('returns null when the email has no body row', async () => {
      const repo = new EmailBodiesRepo();
      await expect(repo.getBodyHtml(tenantId, '999999999')).resolves.toBeNull();
    });
  });
});
