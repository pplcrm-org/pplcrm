import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../../lib/base.repo';
import { StorageService } from '../../../lib/storage.service';
import { GoogleOAuthService } from '../../google-sync/google-oauth.service';
import { materializeAttachment } from './attachment-materializer';

// Attachments synced without their payload are fetched here, on first click. What matters:
// the spam refusal cannot be bypassed, an unreachable provider reports honestly instead of as a
// server error, and a successful fetch is stored once and remembered.
describe('materializeAttachment (integration)', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  const INBOX = '11';
  const SPAM = '4';

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let uploadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();

    uploadSpy = vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined);
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    vi.spyOn(GoogleOAuthService.prototype, 'getValidToken').mockResolvedValue('test-token');

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
    vi.unstubAllGlobals();
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

  /** Seeds an email plus a deferred attachment row (no payload), and returns the attachment. */
  async function seedDeferredAttachment(opts: { folderId: string; preview: string; fileId?: string | null }) {
    const email = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: opts.folderId,
        from_email: 'sender@example.com',
        to_email: `user-${userId}@example.com`,
        subject: 'Has an attachment',
        preview: opts.preview,
        is_favourite: false,
        status: 'open',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const attachment = await db
      .insertInto('email_attachments')
      .values({
        tenant_id: tenantId,
        email_id: String(email.id),
        filename: 'report.pdf',
        content_type: 'application/pdf',
        size_bytes: 4096,
        cid: null,
        is_inline: false,
        pos: 1,
        file_id: opts.fileId ?? null,
        remote_ref: 'REMOTE_REF_1',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: String(attachment.id),
      email_id: String(email.id),
      filename: String(attachment.filename),
      content_type: String(attachment.content_type),
      size_bytes: Number(attachment.size_bytes),
      file_id: attachment.file_id === null ? null : String(attachment.file_id),
      remote_ref: attachment.remote_ref === null ? null : String(attachment.remote_ref),
    };
  }

  /** Gmail responses for the two calls the Google path makes: the message, then the payload. */
  function stubGmail(content: Buffer, filename = 'report.pdf') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/attachments/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: content.toString('base64url') }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            payload: { parts: [{ filename, body: { attachmentId: 'FRESH_ATTACHMENT_ID' } }] },
          }),
        };
      }),
    );
  }

  const attachmentFileId = async (attachmentId: string) => {
    const row = await db
      .selectFrom('email_attachments')
      .select('file_id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', attachmentId)
      .executeTakeFirst();
    return row?.file_id == null ? null : String(row.file_id);
  };

  it('refuses a spam attachment without contacting the provider', async () => {
    const attachment = await seedDeferredAttachment({ folderId: SPAM, preview: 'google:MSG_SPAM' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await materializeAttachment(db, tenantId, attachment);

    expect(result.status).toBe('forbidden');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    // And nothing was recorded: spam payloads never enter the storage account.
    expect(await attachmentFileId(attachment.id)).toBeNull();
  });

  it('fetches, stores and remembers an Inbox attachment on first request', async () => {
    const content = Buffer.from('the actual pdf bytes');
    const attachment = await seedDeferredAttachment({ folderId: INBOX, preview: 'google:MSG_1' });
    stubGmail(content);

    const result = await materializeAttachment(db, tenantId, attachment);

    expect(result.status).toBe('ok');
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    // The row now points at the stored file, so a second request serves from storage.
    const fileId = await attachmentFileId(attachment.id);
    expect(fileId).not.toBeNull();
    expect(result.status === 'ok' && result.fileId).toBe(fileId);

    const file = await db
      .selectFrom('files')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(fileId))
      .executeTakeFirst();
    expect(Number(file?.size_bytes)).toBe(content.length);
  });

  it('serves an already-materialized attachment without touching the provider', async () => {
    const file = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 10,
        storage_key: `emails/attachments/${rand()}_report.pdf`,
        sha256_hex: rand() + rand(),
        uploaded_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const attachment = await seedDeferredAttachment({
      folderId: INBOX,
      preview: 'google:MSG_2',
      fileId: String(file.id),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await materializeAttachment(db, tenantId, attachment);

    expect(result).toEqual({ status: 'ok', fileId: String(file.id) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports unavailable when the provider no longer has the message', async () => {
    const attachment = await seedDeferredAttachment({ folderId: INBOX, preview: 'google:MSG_GONE' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    const result = await materializeAttachment(db, tenantId, attachment);

    // Not a 500: the file is genuinely beyond reach, and the route says so.
    expect(result.status).toBe('unavailable');
    expect(await attachmentFileId(attachment.id)).toBeNull();
  });

  it('reports unavailable when the provider connection times out', async () => {
    const attachment = await seedDeferredAttachment({ folderId: INBOX, preview: 'google:MSG_SLOW' });
    // What AbortSignal.timeout() produces when the deadline passes mid-request.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))),
    );

    const result = await materializeAttachment(db, tenantId, attachment);

    expect(result.status).toBe('unavailable');
    expect(await attachmentFileId(attachment.id)).toBeNull();
  });

  it('reports unavailable for an email with no provider key', async () => {
    // A locally composed message has no provider-side copy to fetch from.
    const attachment = await seedDeferredAttachment({ folderId: INBOX, preview: 'a plain preview' });

    const result = await materializeAttachment(db, tenantId, attachment);

    expect(result.status).toBe('unavailable');
  });

  it('reuses an existing blob when two messages carry identical content', async () => {
    const content = Buffer.from('identical attachment bytes');
    const first = await seedDeferredAttachment({ folderId: INBOX, preview: 'google:MSG_A' });
    const second = await seedDeferredAttachment({ folderId: INBOX, preview: 'google:MSG_B' });
    stubGmail(content);

    const a = await materializeAttachment(db, tenantId, first);
    const b = await materializeAttachment(db, tenantId, second);

    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    // Hashed and deduped before upload — the second fetch must not write a second blob.
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(await attachmentFileId(first.id)).toBe(await attachmentFileId(second.id));
  });
});
