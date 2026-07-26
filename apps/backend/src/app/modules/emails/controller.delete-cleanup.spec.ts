import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmailsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';

// Integration tests for attachment cleanup when an email is permanently deleted.
//
// Permanently deleting an email (one already in Trash) must remove its
// attachment rows (DB cascade), the underlying files rows, and the stored
// blobs — but only for files no longer referenced by any other attachment,
// since files are sha256-deduped and can be shared across emails.
describe('EmailsController attachment delete cleanup (integration)', () => {
  const controller = new EmailsController();
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let storageDeleteSpy: ReturnType<typeof vi.spyOn>;

  const TRASH = '5';

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    storageDeleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

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
    for (const table of ['email_recipients', 'email_attachments', 'email_headers', 'email_bodies', 'email_trash']) {
      await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  // Creates an email (in Trash, so deleteMany hard-deletes it) with a single
  // attachment linked to a file. Returns { emailId, fileId }.
  async function seedTrashedEmailWithAttachment(storageKey: string, sha256: string) {
    const email = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: TRASH,
        from_email: `user-${userId}@example.com`,
        to_email: 'external@gmail.com',
        subject: 'Has attachment',
        preview: 'p',
        is_favourite: false,
        status: 'open',
        deleted_at: new Date(),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const file = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'doc.pdf',
        mime_type: 'application/pdf',
        size_bytes: 100,
        storage_key: storageKey,
        sha256_hex: sha256,
        uploaded_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('email_attachments')
      .values({
        tenant_id: tenantId,
        email_id: String(email.id),
        filename: 'doc.pdf',
        content_type: 'application/pdf',
        size_bytes: 100,
        cid: null,
        is_inline: false,
        pos: 1,
        file_id: String(file.id),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    return { emailId: String(email.id), fileId: String(file.id) };
  }

  const fileExists = async (fileId: string) =>
    !!(await db
      .selectFrom('files')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .executeTakeFirst());

  const attachmentCount = async (emailId: string) =>
    (
      await db
        .selectFrom('email_attachments')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('email_id', '=', emailId)
        .execute()
    ).length;

  it('deletes attachment rows, file row, and storage blob on permanent delete', async () => {
    const storageKey = `emails/attachments/${rand()}_doc.pdf`;
    const { emailId, fileId } = await seedTrashedEmailWithAttachment(storageKey, rand() + rand());

    await controller.deleteMany(tenantId as any, [emailId]);

    // Email + attachments gone (cascade), file row gone, blob deleted.
    const email = await db
      .selectFrom('emails')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', emailId)
      .executeTakeFirst();
    expect(email).toBeUndefined();
    expect(await attachmentCount(emailId)).toBe(0);
    expect(await fileExists(fileId)).toBe(false);
    expect(storageDeleteSpy).toHaveBeenCalledWith(storageKey);
  });

  it('keeps a shared file until the last referencing email is deleted', async () => {
    const sharedKey = `emails/attachments/${rand()}_shared.pdf`;
    const sharedSha = rand() + rand();
    const first = await seedTrashedEmailWithAttachment(sharedKey, sharedSha);

    // Second email references the SAME file row (sha256 dedup).
    const email2 = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: TRASH,
        from_email: `user-${userId}@example.com`,
        to_email: 'external@gmail.com',
        subject: 'Shares attachment',
        preview: 'p',
        is_favourite: false,
        status: 'open',
        deleted_at: new Date(),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto('email_attachments')
      .values({
        tenant_id: tenantId,
        email_id: String(email2.id),
        filename: 'doc.pdf',
        content_type: 'application/pdf',
        size_bytes: 100,
        cid: null,
        is_inline: false,
        pos: 1,
        file_id: first.fileId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Delete the first email — the file is still referenced by email2, keep it.
    await controller.deleteMany(tenantId as any, [first.emailId]);
    expect(await fileExists(first.fileId)).toBe(true);
    expect(storageDeleteSpy).not.toHaveBeenCalled();

    // Delete the second — now nothing references the file, purge it.
    await controller.deleteMany(tenantId as any, [String(email2.id)]);
    expect(await fileExists(first.fileId)).toBe(false);
    expect(storageDeleteSpy).toHaveBeenCalledWith(sharedKey);
  });

  it('deletes the body blob on permanent delete', async () => {
    // Bodies live in blob storage once they exceed the inline threshold, and unlike attachment
    // files they are not deduped — one blob belongs to exactly one email — so a hard delete must
    // remove it unconditionally or it is orphaned forever.
    const bodyKey = `emails/bodies/${rand()}.html`;
    const { emailId } = await seedTrashedEmailWithAttachment(`emails/attachments/${rand()}_doc.pdf`, rand() + rand());

    await db
      .insertInto('email_bodies')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        body_html: null,
        storage_key: bodyKey,
        body_text: 'the searchable part',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    expect(storageDeleteSpy).toHaveBeenCalledWith(bodyKey);
  });

  it('leaves the body blob alone on a soft delete', async () => {
    const bodyKey = `emails/bodies/${rand()}.html`;
    const { emailId } = await seedTrashedEmailWithAttachment(`emails/attachments/${rand()}_doc.pdf`, rand() + rand());

    await db
      .insertInto('email_bodies')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        body_html: null,
        storage_key: bodyKey,
        body_text: 'still needed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Back to Inbox, so deleting only moves it to Trash and the body must remain readable.
    await db
      .updateTable('emails')
      .set({ folder_id: '11', deleted_at: null })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', emailId)
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    expect(storageDeleteSpy).not.toHaveBeenCalled();
  });

  it('moves to trash (no hard delete) when the email is not already in trash', async () => {
    const storageKey = `emails/attachments/${rand()}_doc.pdf`;
    const { emailId, fileId } = await seedTrashedEmailWithAttachment(storageKey, rand() + rand());

    // Put it back in Inbox so the first delete is a soft delete (move to trash).
    await db
      .updateTable('emails')
      .set({ folder_id: '11', deleted_at: null })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', emailId)
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    // Soft delete: nothing purged, attachment + file intact.
    expect(await fileExists(fileId)).toBe(true);
    expect(await attachmentCount(emailId)).toBe(1);
    expect(storageDeleteSpy).not.toHaveBeenCalled();
  });
});
