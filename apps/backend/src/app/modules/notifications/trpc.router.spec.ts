import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NotificationsRouter } from './trpc.router';
import { NotificationsController } from './controller';
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

describe('NotificationsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call markAllAsRead on the controller and return undefined (no BigInt value)', async () => {
    const spy = vi.spyOn(NotificationsController.prototype, 'markAllAsRead').mockResolvedValue(undefined as any);

    const caller = NotificationsRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    const result = await caller.markAllRead();

    expect(spy).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(typeof result).not.toBe('bigint');
  });

  describe('getLatest pagination bounds', () => {
    // `limit` and `offset` go straight into NotificationsRepo.getLatestForUser's .limit()/.offset().
    // Validated as bare `z.number()`, a negative or fractional value became a Postgres error
    // rather than a 400, and an arbitrarily large limit read the user's whole history.
    function authedCaller() {
      return NotificationsRouter.createCaller({
        auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
      } as any);
    }

    it('rejects a negative limit or offset', async () => {
      await expect(authedCaller().getLatest({ limit: -1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(authedCaller().getLatest({ offset: -5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('rejects a fractional limit or offset', async () => {
      await expect(authedCaller().getLatest({ limit: 2.5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(authedCaller().getLatest({ offset: 1.1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('rejects a limit above one page', async () => {
      await expect(authedCaller().getLatest({ limit: 10_000_000 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('still accepts the page the notification bell asks for', async () => {
      const spy = vi.spyOn(NotificationsController.prototype, 'getLatest').mockResolvedValue([] as any);
      await authedCaller().getLatest({ limit: 5, offset: 0 });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: '1' }), 5, 0);
    });
  });

  it('should verify getUnreadCount resolves to a number, not a BigInt', async () => {
    const spy = vi.spyOn(NotificationsController.prototype, 'getUnreadCount').mockResolvedValue(5);

    const caller = NotificationsRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    const result = await caller.getUnreadCount();

    expect(spy).toHaveBeenCalled();
    expect(result).toBe(5);
    expect(typeof result).toBe('number');
    expect(typeof result).not.toBe('bigint');
  });
});
