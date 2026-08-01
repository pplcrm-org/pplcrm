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
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('newsletters').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
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

  // ---------------------------------------------------------------------------------------------
  // Cross-feature protection. A `files` row is shared whenever two uploads have the same bytes,
  // so the row an email attachment points at can equally be a profile photo, a person photo or a
  // newsletter image. Deleting the email must not destroy those.
  // ---------------------------------------------------------------------------------------------

  it('keeps a file that a profile photo also points at', async () => {
    const storageKey = `emails/attachments/${rand()}_headshot.png`;
    const { emailId, fileId } = await seedTrashedEmailWithAttachment(storageKey, rand() + rand());

    // Explicit id on purpose: profiles rows created by sign-up copy the authusers id, so a row
    // drawn from profiles_id_seq (which starts at 1 independently) collides with them across the
    // parallel suite. Every other spec that seeds a profile does the same.
    await db
      .insertInto('profiles')
      .values({ id: rand(), tenant_id: tenantId, auth_id: userId, avatar_file_id: fileId })
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    expect(await fileExists(fileId)).toBe(true);
    expect(storageDeleteSpy).not.toHaveBeenCalledWith(storageKey);
  });

  it('keeps a file that a person photo also points at', async () => {
    const storageKey = `emails/attachments/${rand()}_portrait.png`;
    const { emailId, fileId } = await seedTrashedEmailWithAttachment(storageKey, rand() + rand());

    const household = await db
      .insertInto('households')
      .values({ tenant_id: tenantId, createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        household_id: String(household.id),
        first_name: 'Photo',
        last_name: 'Owner',
        file_id: fileId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    expect(await fileExists(fileId)).toBe(true);
    expect(storageDeleteSpy).not.toHaveBeenCalledWith(storageKey);
  });

  it('keeps a newsletter image, which nothing points at but the newsletter owns', async () => {
    // Newsletter images are owned only by the files.entity_type / entity_id tag — no column
    // anywhere holds their id. A reference check that looked at columns alone would delete them.
    const storageKey = `emails/attachments/${rand()}_banner.png`;
    const { emailId, fileId } = await seedTrashedEmailWithAttachment(storageKey, rand() + rand());

    const newsletter = await db
      .insertInto('newsletters')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Weekly update',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('files')
      .set({ entity_type: 'newsletter', entity_id: String(newsletter.id) })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    expect(await fileExists(fileId)).toBe(true);
    expect(storageDeleteSpy).not.toHaveBeenCalledWith(storageKey);
  });

  it('still deletes a file whose entity tag names a newsletter that no longer exists', async () => {
    // The other half of the ownership rule: a tag left behind by a deleted newsletter must not
    // make the file undeletable forever, or the tenant can never reclaim the storage.
    const storageKey = `emails/attachments/${rand()}_stale.png`;
    const { emailId, fileId } = await seedTrashedEmailWithAttachment(storageKey, rand() + rand());

    await db
      .updateTable('files')
      .set({ entity_type: 'newsletter', entity_id: rand() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .execute();

    await controller.deleteMany(tenantId as any, [emailId]);

    expect(await fileExists(fileId)).toBe(false);
    expect(storageDeleteSpy).toHaveBeenCalledWith(storageKey);
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
