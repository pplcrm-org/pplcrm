import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IAuthKeyPayload } from '@common';
import { FilesController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { signUploadHandle } from '../../lib/signed-download';

vi.mock('../../lib/storage.service', () => {
  class StorageService {
    public async upload(): Promise<void> {
      return undefined;
    }
    public async uploadStream(): Promise<void> {
      return undefined;
    }
    public async generateWriteSasUrl(): Promise<string> {
      return 'https://mock-storage.example.com/sas-upload-url';
    }
    public async download(): Promise<Buffer> {
      return Buffer.from('');
    }
    public async delete(): Promise<void> {
      return undefined;
    }
    public async getSizeBytes(): Promise<number | null> {
      return 0;
    }
  }
  return { StorageService };
});

import { StorageService } from '../../lib/storage.service';

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('FilesController', () => {
  const controller = new FilesController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let auth: IAuthKeyPayload;

  beforeEach(async () => {
    vi.restoreAllMocks();
    tenantId = rand();
    userId = rand();
    auth = { tenant_id: tenantId, user_id: userId, name: 'Test User', session_id: 'test-session' };

    await db.insertInto('tenants').values({ id: tenantId, name: 'Files Test Tenant' }).execute();
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
  });

  /** Mint the handle getUploadUrl would have returned for this key. */
  const handleFor = (key: string): string => signUploadHandle(key, tenantId);

  /** Stub the size storage reports back for the next registerFile call(s). */
  const stubSize = (...sizes: number[]): void => {
    const spy = vi.spyOn(StorageService.prototype, 'getSizeBytes');
    for (const size of sizes) spy.mockResolvedValueOnce(size);
  };

  afterEach(async () => {
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('registers a newly uploaded file', async () => {
    const file = await controller.registerFile(
      {
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        uploadHandle: handleFor(`uploads/${tenantId}/report.pdf`),
        sha256Hex: 'abc123',
      },
      auth,
    );

    expect(file).toBeDefined();
    expect(file.filename).toBe('report.pdf');
    expect(file.storage_key).toBe(`uploads/${tenantId}/report.pdf`);
    expect(file.uploaded_by).toBe(userId);
  });

  it('returns the existing record and deletes the duplicate blob when sha256 matches an existing file', async () => {
    const deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    const first = await controller.registerFile(
      {
        filename: 'first.pdf',
        uploadHandle: handleFor(`uploads/${tenantId}/first.pdf`),
        sha256Hex: 'duplicate-hash',
      },
      auth,
    );

    const second = await controller.registerFile(
      {
        filename: 'second-copy.pdf',
        uploadHandle: handleFor(`uploads/${tenantId}/second-copy.pdf`),
        sha256Hex: 'duplicate-hash',
      },
      auth,
    );

    expect(second.id).toBe(first.id);
    expect(deleteSpy).toHaveBeenCalledWith(`uploads/${tenantId}/second-copy.pdf`);

    const allFilesForHash = await db
      .selectFrom('files')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('sha256_hex', '=', 'duplicate-hash')
      .execute();
    expect(allFilesForHash).toHaveLength(1);
  });

  it('generates a SAS upload URL via the storage service', async () => {
    const sasSpy = vi
      .spyOn(StorageService.prototype, 'generateWriteSasUrl')
      .mockResolvedValue('https://sas.example.com/x');

    const url = await controller.generateUploadSasUrl(`uploads/${tenantId}/new-file.pdf`, 30);

    expect(url).toBe('https://sas.example.com/x');
    expect(sasSpy).toHaveBeenCalledWith(`uploads/${tenantId}/new-file.pdf`, 30);
  });

  it('lists files with the uploader name attached', async () => {
    await controller.registerFile({ filename: 'a.csv', uploadHandle: handleFor(`uploads/${tenantId}/a.csv`) }, auth);
    await controller.registerFile({ filename: 'b.csv', uploadHandle: handleFor(`uploads/${tenantId}/b.csv`) }, auth);

    const result = await controller.getAllFiles(auth, {});
    expect(result.count).toBe(2);
    expect(result.rows.every((r: any) => r.createdBy?.name === 'Test User')).toBe(true);
  });

  it('returns false when deleting a file that does not exist', async () => {
    const deleted = await controller.delete(tenantId, '999999999', userId);
    expect(deleted).toBe(false);
  });

  it('deletes a file from the database and removes its blob from storage', async () => {
    const deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    const file = await controller.registerFile(
      { filename: 'to-delete.pdf', uploadHandle: handleFor(`uploads/${tenantId}/to-delete.pdf`) },
      auth,
    );

    const deleted = await controller.delete(tenantId, String(file.id), userId);

    expect(deleted).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(`uploads/${tenantId}/to-delete.pdf`);

    const row = await db.selectFrom('files').selectAll().where('id', '=', file.id).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('deletes multiple files and reports true if at least one succeeded', async () => {
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    const fileA = await controller.registerFile(
      { filename: 'a.pdf', uploadHandle: handleFor(`uploads/${tenantId}/a.pdf`) },
      auth,
    );
    const fileB = await controller.registerFile(
      { filename: 'b.pdf', uploadHandle: handleFor(`uploads/${tenantId}/b.pdf`) },
      auth,
    );

    const result = await controller.deleteMany(tenantId, [String(fileA.id), String(fileB.id), '999999999'], userId);

    expect(result).toBe(true);
    const remaining = await db.selectFrom('files').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(remaining).toHaveLength(0);
  });

  it('reports false from deleteMany when none of the ids exist', async () => {
    const result = await controller.deleteMany(tenantId, ['111111111', '222222222'], userId);
    expect(result).toBe(false);
  });

  it('links a file to an entity and filters getAllFiles by it', async () => {
    await controller.registerFile(
      {
        filename: 'linked.pdf',
        uploadHandle: handleFor(`uploads/${tenantId}/linked.pdf`),
        entityType: 'newsletter',
        entityId: '123',
      },
      auth,
    );
    await controller.registerFile(
      { filename: 'unlinked.pdf', uploadHandle: handleFor(`uploads/${tenantId}/unlinked.pdf`) },
      auth,
    );

    const scoped = await controller.getAllFiles(auth, { entityType: 'newsletter', entityId: '123' });
    expect(scoped.count).toBe(1);
    expect(scoped.rows[0]?.filename).toBe('linked.pdf');

    const all = await controller.getAllFiles(auth, {});
    expect(all.count).toBe(2);
  });

  it('refuses an upload that would exceed the plan storage quota and cleans up the blob', async () => {
    const deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    const GB = 1024 * 1024 * 1024;
    stubSize(2 * GB);

    // The default (Free) plan quota is 1 GB — a 2 GB upload blows past it.
    await expect(
      controller.registerFile(
        {
          filename: 'huge.zip',
          uploadHandle: handleFor(`uploads/${tenantId}/huge.zip`),
          sha256Hex: 'huge-hash',
        },
        auth,
      ),
    ).rejects.toThrow(/storage quota/i);

    // The rejected blob is deleted from storage, and nothing is recorded.
    expect(deleteSpy).toHaveBeenCalledWith(`uploads/${tenantId}/huge.zip`);
    const rows = await db.selectFrom('files').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(rows).toHaveLength(0);
  });

  // SECURITY REGRESSION (H2) — the quota used to trust a client-declared `sizeBytes`, and
  // the check was wrapped in `if (sizeBytes > 0)`, so declaring 0 skipped it entirely.
  // Size now comes from the blob itself, which the client cannot influence.
  it('enforces the quota from the blob size in storage, not a client-declared size', async () => {
    const deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    const GB = 1024 * 1024 * 1024;
    // Storage reports the truth: 2 GB against a 1 GB Free-plan quota.
    stubSize(2 * GB);

    await expect(
      controller.registerFile(
        // No size is accepted from the caller at all — this is the whole payload.
        { filename: 'sneaky.zip', uploadHandle: handleFor(`uploads/${tenantId}/sneaky.zip`) },
        auth,
      ),
    ).rejects.toThrow(/storage quota/i);

    expect(deleteSpy).toHaveBeenCalledWith(`uploads/${tenantId}/sneaky.zip`);
    const rows = await db.selectFrom('files').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(rows).toHaveLength(0);
  });

  it('records the size storage reports, so usage accounting cannot be understated', async () => {
    stubSize(4096);
    const file = await controller.registerFile(
      { filename: 'real.pdf', uploadHandle: handleFor(`uploads/${tenantId}/real.pdf`) },
      auth,
    );

    expect(Number(file.size_bytes)).toBe(4096);
  });

  // SECURITY REGRESSION (C1) — registerFile used to take `storageKey` straight from the
  // client. Because the download/delete routes scope the DB *row* by tenant but then
  // dereference whatever key that row carries, a forged key was a cross-tenant blob read
  // and delete. The key is now re-derived from a signed, tenant-bound handle.
  describe('upload handle (cross-tenant blob access)', () => {
    it('refuses a handle minted for another tenant', async () => {
      const otherTenantId = rand();
      const foreignHandle = signUploadHandle(`exports/${otherTenantId}/secrets.csv`, otherTenantId);

      await expect(
        controller.registerFile({ filename: 'secrets.csv', uploadHandle: foreignHandle }, auth),
      ).rejects.toThrow(/upload handle/i);

      const rows = await db.selectFrom('files').selectAll().where('tenant_id', '=', tenantId).execute();
      expect(rows).toHaveLength(0);
    });

    it('refuses a forged handle that was never signed', async () => {
      await expect(
        controller.registerFile({ filename: 'secrets.csv', uploadHandle: `exports/${rand()}/secrets.csv` }, auth),
      ).rejects.toThrow(/upload handle/i);
    });

    it('stores the key from the handle, ignoring any filename the client sends', async () => {
      const key = `uploads/${tenantId}/abc_real.pdf`;
      const file = await controller.registerFile(
        { filename: '../../../etc/passwd', uploadHandle: handleFor(key) },
        auth,
      );

      expect(file.storage_key).toBe(key);
      // Traversal is reduced to a single safe path component before it is stored.
      expect(file.filename).toBe('passwd');
    });
  });

  it('summarizes storage usage with quota and largest files, labeling entity-linked files', async () => {
    const campaignRow = await db
      .insertInto('campaigns')
      .values({
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const newsletter = await db
      .insertInto('newsletters')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignRow.id,
        name: 'Spring gala follow-up',
        subject: 'Spring gala follow-up',
        status: 'draft',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    stubSize(5000, 10);
    await controller.registerFile(
      {
        filename: 'gala-photos.zip',
        uploadHandle: handleFor(`uploads/${tenantId}/gala-photos.zip`),
        entityType: 'newsletter',
        entityId: String(newsletter.id),
      },
      auth,
    );
    await controller.registerFile(
      { filename: 'small.txt', uploadHandle: handleFor(`uploads/${tenantId}/small.txt`) },
      auth,
    );

    const summary = await controller.getUsageSummary(auth);
    expect(summary.usedBytes).toBe(5010);
    expect(summary.quotaBytes).toBeGreaterThan(0);
    expect(summary.largestFiles[0]?.filename).toBe('gala-photos.zip');
    expect(summary.largestFiles[0]?.attachedToLabel).toBe('"Spring gala follow-up" newsletter');

    await db.deleteFrom('newsletters').where('id', '=', newsletter.id).execute();
    await db.deleteFrom('campaigns').where('id', '=', campaignRow.id).execute();
  });
});
