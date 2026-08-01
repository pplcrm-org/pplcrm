import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IAuthKeyPayload } from '@common';
import { AuthController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';

// Replacing an avatar deletes the old avatar's files row and blob. Uploads are sha256-deduped, so
// that old row can be the same one an email attachment resolves to — in which case deleting it
// left the email pointing at nothing (the foreign key is ON DELETE SET NULL, so the attachment
// silently became "no longer available"). These tests pin both directions.
describe('AuthController.uploadAvatar — previous-avatar cleanup', () => {
  const controller = new AuthController();
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  const PNG_BASE64 = Buffer.from('a tiny fake png').toString('base64');

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let auth: IAuthKeyPayload;
  let storageDeleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    auth = { tenant_id: tenantId, user_id: userId, name: 'Test User', session_id: 'test-session' };

    vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined);
    storageDeleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Avatar Test Tenant' }).execute();
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
    await db.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  /** An existing avatar: a files row plus the profile row pointing at it. */
  async function seedExistingAvatar(storageKey: string): Promise<string> {
    const file = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'old-avatar.png',
        mime_type: 'image/png',
        size_bytes: 15,
        storage_key: storageKey,
        sha256_hex: rand() + rand(),
        uploaded_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Explicit id on purpose: profiles rows created by sign-up copy the authusers id, so a row
    // drawn from profiles_id_seq (which starts at 1 independently) collides with them across the
    // parallel suite. Every other spec that seeds a profile does the same.
    await db
      .insertInto('profiles')
      .values({ id: rand(), tenant_id: tenantId, auth_id: userId, avatar_file_id: String(file.id) })
      .execute();

    return String(file.id);
  }

  async function attachFileToEmail(fileId: string): Promise<void> {
    const email = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: '11',
        from_email: `user-${userId}@example.com`,
        to_email: 'external@gmail.com',
        subject: 'Shares the avatar bytes',
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
        filename: 'old-avatar.png',
        content_type: 'image/png',
        size_bytes: 15,
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

  const attachmentFileId = async (fileId: string) =>
    (
      await db
        .selectFrom('email_attachments')
        .select('file_id')
        .where('tenant_id', '=', tenantId)
        .where('file_id', '=', fileId)
        .executeTakeFirst()
    )?.file_id ?? null;

  it('keeps the old avatar file when an email attachment still references it', async () => {
    const oldKey = `avatars/${tenantId}/${userId}/old.png`;
    const oldFileId = await seedExistingAvatar(oldKey);
    await attachFileToEmail(oldFileId);

    const result = await controller.uploadAvatar(auth, {
      dataBase64: PNG_BASE64,
      mimeType: 'image/png',
      filename: 'new-avatar.png',
    });

    // New avatar in place, old row and blob untouched, attachment still resolvable.
    expect(result.file_id).not.toBe(oldFileId);
    expect(await fileExists(oldFileId)).toBe(true);
    expect(String(await attachmentFileId(oldFileId))).toBe(oldFileId);
    expect(storageDeleteSpy).not.toHaveBeenCalledWith(oldKey);
  });

  it('deletes the old avatar file when nothing else references it', async () => {
    const oldKey = `avatars/${tenantId}/${userId}/old.png`;
    const oldFileId = await seedExistingAvatar(oldKey);

    const result = await controller.uploadAvatar(auth, {
      dataBase64: PNG_BASE64,
      mimeType: 'image/png',
      filename: 'new-avatar.png',
    });

    expect(result.file_id).not.toBe(oldFileId);
    expect(await fileExists(oldFileId)).toBe(false);
    expect(storageDeleteSpy).toHaveBeenCalledWith(oldKey);
  });
});
