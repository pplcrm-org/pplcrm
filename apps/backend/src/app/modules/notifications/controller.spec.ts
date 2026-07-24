import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsController } from './controller';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(() => {
    controller = new NotificationsController();
    vi.restoreAllMocks();
  });

  it('should call getLatestForUser with correct parameters', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const mockNotifs = [{ id: '1', title: 'Test' }];
    const spy = vi.spyOn((controller as any).repo, 'getLatestForUser').mockResolvedValue(mockNotifs as any);

    const result = await controller.getLatest(auth);

    expect(spy).toHaveBeenCalledWith('tenant-1', 'user-1', undefined, undefined);
    expect(result).toEqual(mockNotifs);
  });

  it('should forward limit and offset to getLatestForUser when provided', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const mockNotifs = [{ id: '1', title: 'Test' }];
    const spy = vi.spyOn((controller as any).repo, 'getLatestForUser').mockResolvedValue(mockNotifs as any);

    const result = await controller.getLatest(auth, 10, 5);

    expect(spy).toHaveBeenCalledWith('tenant-1', 'user-1', 10, 5);
    expect(result).toEqual(mockNotifs);
  });

  it('should call getUnreadCount with correct parameters', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const spy = vi.spyOn((controller as any).repo, 'getUnreadCount').mockResolvedValue(5);

    const result = await controller.getUnreadCount(auth);

    expect(spy).toHaveBeenCalledWith('tenant-1', 'user-1');
    expect(result).toBe(5);
  });

  it('should call markAllRead with correct parameters', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const spy = vi.spyOn((controller as any).repo, 'markAllRead').mockResolvedValue(null as any);

    await controller.markAllAsRead(auth);

    expect(spy).toHaveBeenCalledWith('tenant-1', 'user-1');
  });

  it('markRead scopes by user_id (not just the enumerable global id) and returns only the id', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const repoSpy = vi.spyOn((controller as any).repo, 'markRead').mockResolvedValue(undefined as any);
    // Guard the old vulnerable path: markRead must NOT fall back to BaseController.update, which
    // scopes only tenant_id + id and leaks the full row via returningAll.
    const updateSpy = vi.spyOn(controller, 'update');

    const result = await controller.markRead('99', auth);

    // The caller's own user_id is threaded through, so one user can never mark-read — or, via a
    // returning-all update, read — another user's notification (ids are a global bigserial).
    expect(repoSpy).toHaveBeenCalledWith('tenant-1', 'user-1', '99');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ id: '99' });
  });

  it('markRead threads a second user through unchanged (no cross-user reach)', async () => {
    const repoSpy = vi.spyOn((controller as any).repo, 'markRead').mockResolvedValue(undefined as any);

    await controller.markRead('42', { tenant_id: 'tenant-1', user_id: 'user-2' } as any);

    // user-2's request updates only rows scoped to user-2 — never user-1's notification #42.
    expect(repoSpy).toHaveBeenCalledWith('tenant-1', 'user-2', '42');
  });
});
