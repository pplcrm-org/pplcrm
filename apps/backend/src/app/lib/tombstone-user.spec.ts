import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Transaction } from 'kysely';
import type { Models } from '../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from './base.repo';
import { StorageService } from './storage.service';
import { tombstoneAuthUser } from './tombstone-user';

// Tombstoning a departing user removes their avatar's `files` row and blob. Uploads are
// sha256-deduped, so that row can be the same one an email attachment resolves to. Account
// deletion must never fail over this, so a shared row is simply kept.
describe('tombstoneAuthUser — avatar cleanup', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  let tenantId: string;
  let userId: string;
  let campaignId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Tombstone Avatar Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `leaving-${userId}@example.com`,
        password: 'hash',
        first_name: 'Trish',
        last_name: 'Leaving',
        role: 'user',
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

  /** An avatar: a files row plus the profile row pointing at it. */
  async function seedAvatar(storageKey: string): Promise<string> {
    const file = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: 'avatar.png',
        mime_type: 'image/png',
        size_bytes: 20,
        storage_key: storageKey,
        sha256_hex: rand() + rand(),
        uploaded_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Explicit id: profiles rows created by sign-up copy the authusers id, so a row drawn from
    // profiles_id_seq (which starts at 1 independently) collides with them across the parallel
    // suite. Every other spec that seeds a profile does the same.
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
        from_email: `leaving-${userId}@example.com`,
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
        filename: 'avatar.png',
        content_type: 'image/png',
        size_bytes: 20,
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

  const isTombstoned = async () =>
    (
      await db
        .selectFrom('authusers')
        .select('deleted_at')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', userId)
        .executeTakeFirst()
    )?.deleted_at != null;

  const run = (): Promise<string | null> =>
    db
      .transaction()
      .execute((trx: Transaction<Models>) => tombstoneAuthUser(trx, { tenantId, userId, updatedbyId: userId }));

  it('keeps the avatar file an email attachment still references, and still tombstones the user', async () => {
    const key = `avatars/${tenantId}/${userId}/a.png`;
    const fileId = await seedAvatar(key);
    await attachFileToEmail(fileId);

    const blobKey = await run();

    expect(blobKey).toBeNull();
    expect(await fileExists(fileId)).toBe(true);
    expect(await isTombstoned()).toBe(true);
  });

  it('deletes the avatar file and hands back its blob key when nothing else references it', async () => {
    const key = `avatars/${tenantId}/${userId}/a.png`;
    const fileId = await seedAvatar(key);

    const blobKey = await run();

    expect(blobKey).toBe(key);
    expect(await fileExists(fileId)).toBe(false);
    expect(await isTombstoned()).toBe(true);
  });
});
