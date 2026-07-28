import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DashboardRouter } from './trpc.router';
import { DashboardController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

function mockAuthDb() {
  const mockQB: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue({ role: 'owner', verified: true }),
  };
  vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
    selectFrom: vi.fn().mockReturnValue(mockQB),
  } as any);
}

describe('DashboardRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getStats on the controller with auth', async () => {
    const mockStats = { avgFirstResponseHours: 1, totalOpenCount: 3 };
    const spy = vi.spyOn(DashboardController.prototype, 'getStats').mockResolvedValue(mockStats as any);

    const caller = DashboardRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getStats();

    expect(spy).toHaveBeenCalledWith({
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toEqual(mockStats);
  });

  it('should reject unauthenticated requests with UNAUTHORIZED', async () => {
    const caller = DashboardRouter.createCaller({} as any);
    await expect(caller.getStats()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('should call getBreachedEmails with page/limit', async () => {
    const mockResult = { items: [], totalCount: 0, hasMore: false };
    const spy = vi.spyOn(DashboardController.prototype, 'getBreachedEmails').mockResolvedValue(mockResult as any);

    const caller = DashboardRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getBreachedEmails({ page: 1, limit: 20 });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      { page: 1, limit: 20 },
    );
    expect(result).toEqual(mockResult);
  });

  it('should reject getBreachedEmails when page is less than 1', async () => {
    const caller = DashboardRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.getBreachedEmails({ page: 0, limit: 20 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call getBreachedTasks with page/limit', async () => {
    const mockResult = { items: [], totalCount: 0, hasMore: false };
    const spy = vi.spyOn(DashboardController.prototype, 'getBreachedTasks').mockResolvedValue(mockResult as any);

    const caller = DashboardRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getBreachedTasks({ page: 2, limit: 5 });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      { page: 2, limit: 5 },
    );
    expect(result).toEqual(mockResult);
  });

  it('should reject getBreachedTasks when limit is less than 1', async () => {
    const caller = DashboardRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.getBreachedTasks({ page: 1, limit: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
