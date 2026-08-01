import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FilesController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';
import { ConflictError } from '../../errors/app-errors';

// Deleting a file from the Files page removes the row and the stored blob. Uploads are
// sha256-deduped, so that row can be the same one an email attachment, a profile photo or a
// person record resolves to — and five of the seven columns that hold a files.id have no foreign
// key, so nothing in Postgres objects. These tests pin the refusal, and pin that a file nothing
// uses is still genuinely deleted.
describe('FilesController delete — cross-feature references', () => {
  const controller = new FilesController();
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let storageDeleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    storageDeleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Files Ref Tenant' }).execute();
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
    await db.deleteFrom('email_attachments').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function seedFile(storageKey: string): Promise<string> {
    const file = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'shared.pdf',
        mime_type: 'application/pdf',
        size_bytes: 100,
        storage_key: storageKey,
        sha256_hex: rand() + rand(),
        uploaded_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(file.id);
  }

  /** An email whose single attachment points at the given file. */
  async function attachFileToEmail(fileId: string): Promise<void> {
    const email = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: '11',
        from_email: `user-${userId}@example.com`,
        to_email: 'external@gmail.com',
        subject: 'Has attachment',
        preview: 'p',
        is_favourite: false,
        status: 'open',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('email_attachments')
      .values({
        tenant_id: tenantId,
        email_id: String(email.id),
        filename: 'shared.pdf',
        content_type: 'application/pdf',
        size_bytes: 100,
        cid: null,
        is_inline: false,
        pos: 1,
        file_id: fileId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  }

  const fileExists = async (fileId: string) =>
    !!(await db
      .selectFrom('files')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .executeTakeFirst());

  it('refuses to delete a file an email attachment still references, and keeps the blob', async () => {
    const storageKey = `uploads/${tenantId}/${rand()}_shared.pdf`;
    const fileId = await seedFile(storageKey);
    await attachFileToEmail(fileId);

    await expect(controller.delete(tenantId, fileId, userId)).rejects.toBeInstanceOf(ConflictError);

    expect(await fileExists(fileId)).toBe(true);
    expect(storageDeleteSpy).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced file — row and blob', async () => {
    const storageKey = `uploads/${tenantId}/${rand()}_lonely.pdf`;
    const fileId = await seedFile(storageKey);

    const deleted = await controller.delete(tenantId, fileId, userId);

    expect(deleted).toBeTruthy();
    expect(await fileExists(fileId)).toBe(false);
    expect(storageDeleteSpy).toHaveBeenCalledWith(storageKey);
  });

  it('deletes a newsletter image, because this endpoint is how the newsletter editor removes it', async () => {
    // The entity_type ownership tag must not block the owner's own delete: newsletter-detail.ts
    // calls files.delete to detach and delete an image.
    const storageKey = `uploads/${tenantId}/${rand()}_banner.png`;
    const fileId = await seedFile(storageKey);
    await db
      .updateTable('files')
      .set({ entity_type: 'newsletter', entity_id: rand() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fileId)
      .execute();

    const deleted = await controller.delete(tenantId, fileId, userId);

    expect(deleted).toBeTruthy();
    expect(await fileExists(fileId)).toBe(false);
    expect(storageDeleteSpy).toHaveBeenCalledWith(storageKey);
  });

  it('deleteMany removes the free files, keeps the in-use one, and reports it', async () => {
    const freeKey = `uploads/${tenantId}/${rand()}_free.pdf`;
    const heldKey = `uploads/${tenantId}/${rand()}_held.pdf`;
    const freeId = await seedFile(freeKey);
    const heldId = await seedFile(heldKey);
    await attachFileToEmail(heldId);

    await expect(controller.deleteMany(tenantId, [freeId, heldId], userId)).rejects.toBeInstanceOf(ConflictError);

    expect(await fileExists(freeId)).toBe(false);
    expect(await fileExists(heldId)).toBe(true);
    expect(storageDeleteSpy).toHaveBeenCalledWith(freeKey);
    expect(storageDeleteSpy).not.toHaveBeenCalledWith(heldKey);
  });
});
