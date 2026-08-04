import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExportsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

vi.mock('../../lib/storage.service', () => ({
  TransactionalEmailService: class {
    sendMail = vi.fn().mockResolvedValue(undefined);
  },
  StorageService: class {
    delete = vi.fn().mockResolvedValue(undefined);
    upload = vi.fn().mockResolvedValue(undefined);
    uploadStream = vi.fn().mockResolvedValue(undefined);
    download = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('ExportsController & Recovery', () => {
  const controller = new ExportsController();
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  let tenantId: string;
  let userId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();

    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: 'Exports Test Tenant',
      })
      .execute();

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
  });

  afterEach(async () => {
    // Clean up
    await db.deleteFrom('rate_limits').where('key', '=', `queueExport:${tenantId}`).execute();
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('data_exports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('should queue and delete exports correctly', async () => {
    const auth = { tenant_id: tenantId, user_id: userId, name: 'Test User' } as any;

    // Queue export
    const queueRes = await controller.queueExport(
      {
        entity: 'persons',
        options: {},
      },
      auth,
    );

    expect(queueRes.id).toBeDefined();

    // Check data_exports has been created
    const record = await controller.getById(queueRes.id, auth);
    expect(record).toBeDefined();
    expect(record.status).toBe('pending');

    // Check background job has been queued
    const job = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    expect(job).toBeDefined();

    // Delete export
    const delRes = await controller.deleteExport(queueRes.id, auth);
    expect(delRes.success).toBe(true);

    // Verify record is deleted
    await expect(controller.getById(queueRes.id, auth)).rejects.toThrow();

    // Verify background job is deleted
    const jobAfterDelete = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    expect(jobAfterDelete).toBeUndefined();
  });

  describe('who may export the workspace user list', () => {
    // Entity `users` reads `authusers` — every colleague's address, role, verification and
    // deactivation state. Every other route to that roster (invite, list users, change a role) is
    // already admin/owner-only, and no data grid in the Angular app sets exportEntity: 'users',
    // so nothing shipped asks for it.
    it('refuses a non-privileged member', async () => {
      const auth = { tenant_id: tenantId, user_id: userId, role: 'user' } as any;

      await expect(controller.queueExport({ entity: 'users', options: {} }, auth)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      const queued = await db
        .selectFrom('data_exports')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      expect(queued, 'a refused export must not leave a data_exports row behind').toBeUndefined();
    });

    it('allows an admin', async () => {
      const auth = { tenant_id: tenantId, user_id: userId, role: 'admin' } as any;

      const res = await controller.queueExport({ entity: 'users', options: {} }, auth);
      expect(res.status).toBe('pending');
    });

    it('still allows a non-privileged member to export ordinary records', async () => {
      const auth = { tenant_id: tenantId, user_id: userId, role: 'user' } as any;

      const res = await controller.queueExport({ entity: 'persons', options: {} }, auth);
      expect(res.status).toBe('pending');
    });
  });

  describe('what the list says about a colleague’s export', () => {
    // The Exports tab lists the whole workspace, but the download route and the delete mutation
    // both go through canAccessExport. The list used to report downloadable purely from whether
    // the file existed, so the page offered a button that answered 403.
    async function completedExportOwnedBy(ownerId: string): Promise<string> {
      const auth = { tenant_id: tenantId, user_id: ownerId, role: 'user' } as any;
      const res = await controller.queueExport({ entity: 'persons', options: {} }, auth);
      await controller.getRepo().updateStatus(res.id, tenantId, 'completed', {
        rowCount: 5,
        storageKey: `exports/${res.id}.csv`,
      });
      return res.id;
    }

    it('withholds the download from a colleague and marks the row as someone else’s', async () => {
      const exportId = await completedExportOwnedBy(userId);
      const colleague = { tenant_id: tenantId, user_id: rand(), role: 'user' } as any;

      const row = (await controller.list(colleague)).find((r) => r.id === exportId);

      expect(row).toBeDefined();
      expect(row?.downloadable, 'the download route would answer 403 for this caller').toBe(false);
      expect(row?.ownedByOther).toBe(true);
    });

    it('offers the download to the member who requested it', async () => {
      const exportId = await completedExportOwnedBy(userId);
      const owner = { tenant_id: tenantId, user_id: userId, role: 'user' } as any;

      const row = (await controller.list(owner)).find((r) => r.id === exportId);

      expect(row?.downloadable).toBe(true);
      expect(row?.ownedByOther).toBe(false);
    });

    it('offers the download to an admin who did not request it', async () => {
      const exportId = await completedExportOwnedBy(userId);
      const admin = { tenant_id: tenantId, user_id: rand(), role: 'admin' } as any;

      const row = (await controller.list(admin)).find((r) => r.id === exportId);

      expect(row?.downloadable).toBe(true);
      expect(row?.ownedByOther).toBe(false);
    });

    it('still reports a stored-file-less export of your own as not downloadable', async () => {
      const auth = { tenant_id: tenantId, user_id: userId, role: 'user' } as any;
      const res = await controller.logInstantExport({ entity: 'persons', fileName: 'p.csv', rowCount: 3 }, auth);

      const row = (await controller.list(auth)).find((r) => r.id === res.id);

      expect(row?.downloadable, 'nothing was stored server-side for an instant export').toBe(false);
      expect(row?.ownedByOther).toBe(false);
    });
  });

  describe('who may delete an export', () => {
    async function queueAsOwnerMember(): Promise<string> {
      const auth = { tenant_id: tenantId, user_id: userId, role: 'user' } as any;
      const res = await controller.queueExport({ entity: 'persons', options: {} }, auth);
      return res.id;
    }

    it('refuses a colleague who did not create it', async () => {
      const exportId = await queueAsOwnerMember();
      const colleague = { tenant_id: tenantId, user_id: rand(), role: 'user' } as any;

      await expect(controller.deleteExport(exportId, colleague)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows an admin who did not create it', async () => {
      const exportId = await queueAsOwnerMember();
      const admin = { tenant_id: tenantId, user_id: rand(), role: 'admin' } as any;

      await expect(controller.deleteExport(exportId, admin)).resolves.toEqual({ success: true });
    });
  });
});
