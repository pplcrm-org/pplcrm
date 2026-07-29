import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityController } from './controller';
import { ExportsRepo } from '../exports/repositories/exports.repo';

vi.mock('../../lib/mail/transactional-mail.service', () => ({
  TransactionalEmailService: class {
    sendMail = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('ActivityController', () => {
  let controller: ActivityController;

  beforeEach(() => {
    controller = new ActivityController();
    vi.restoreAllMocks();
  });

  it('should call getFeed and retrieve logs from repository', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const options = { startRow: 0, endRow: 25 };
    const mockFeedResult = {
      rows: [{ id: '1', activity: 'create', entity: 'person', first_name: 'Dana', last_name: '' }],
      count: 1,
    };

    const spy = vi.spyOn((controller as any).repo, 'getAllWithUser').mockResolvedValue(mockFeedResult as any);

    const result = await controller.getFeed(auth, options);

    expect(spy).toHaveBeenCalledWith('tenant-1', options);
    expect(result).toEqual(mockFeedResult);
  });

  it('should log a user-authored interaction against a record via repo.log', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const spy = vi.spyOn((controller as any).repo, 'log').mockResolvedValue(undefined);

    await controller.logInteraction(auth, {
      entity: 'persons',
      entityId: 'p-42',
      type: 'call',
      note: '  left a voicemail  ',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        activity: 'call',
        entity: 'persons',
        entity_id: 'p-42',
        metadata: expect.objectContaining({ note: 'left a voicemail', occurred_at: expect.any(String) }),
      }),
    );
  });

  it('should store a null note when none is provided', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const spy = vi.spyOn((controller as any).repo, 'log').mockResolvedValue(undefined);

    await controller.logInteraction(auth, { entity: 'households', entityId: 'h-1', type: 'door_knock' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ activity: 'door_knock', metadata: expect.objectContaining({ note: null }) }),
    );
  });

  it('should delete activities older than the flat 90-day retention window for every tenant', async () => {
    const mockTenants = [{ id: '1' }, { id: '2' }];

    const selectMock = {
      select: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(mockTenants),
    };

    const deleteMock = {
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };

    const dbSpySelect = vi.spyOn((controller as any).repo.db, 'selectFrom').mockReturnValue(selectMock as any);
    const dbSpyDelete = vi.spyOn((controller as any).repo.db, 'deleteFrom').mockReturnValue(deleteMock as any);

    await controller.deleteOldActivities();

    expect(dbSpySelect).toHaveBeenCalledWith('tenants');
    expect(dbSpyDelete).toHaveBeenCalledWith('user_activity');
    expect(deleteMock.where).toHaveBeenCalledTimes(4); // 2 where conditions (tenant_id, created_at) * 2 tenants
  });

  it('should queue activity export as a background job and return processing status', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1', name: 'Dana' } as any;
    const input = {
      tenant_id: 'tenant-1',
      options: { userId: 'user-1' },
    };

    const mockExportRecord = { id: 'export-123', created_at: new Date(), updated_at: new Date() };
    const spyCreate = vi.spyOn(ExportsRepo.prototype, 'create').mockResolvedValue(mockExportRecord as any);

    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ execute: mockExecute });
    const spyInsertInto = vi.spyOn((controller as any).repo.db, 'insertInto').mockReturnValue({
      values: mockValues,
    } as any);

    const result = await controller.exportCsv(input, auth);

    expect(spyCreate).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      entity: 'user_activity',
      file_name: expect.any(String),
      columns: expect.any(Array),
    });

    expect(spyInsertInto).toHaveBeenCalledWith('background_jobs');
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        queue: 'default',
        status: 'pending',
        payload: expect.any(String),
      }),
    );

    expect(result).toEqual({ status: 'processing' });
  });
});
