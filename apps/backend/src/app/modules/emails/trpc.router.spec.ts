import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmailsRouter } from './trpc.router';
import { EmailsController } from './controller';
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

describe('EmailsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getFolders on the controller', async () => {
    const mockFolders = [{ id: '1', name: 'Inbox' }];
    const spy = vi.spyOn(EmailsController.prototype, 'getFolders').mockResolvedValue(mockFolders as any);

    const caller = EmailsRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getFolders();

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual(mockFolders);
  });

  it('should call getEmailBody on the controller with valid numeric ID', async () => {
    const mockBody = { html: '<p>Hello</p>' };
    const spy = vi.spyOn(EmailsController.prototype, 'getEmailBody').mockResolvedValue(mockBody as any);

    const caller = EmailsRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getEmailBody('1');

    // tenant_id, email_id, then the caller identity (user_id + role) for campaign isolation —
    // role comes from the authProcedure middleware's user lookup (mocked to 'owner' above).
    expect(spy).toHaveBeenCalledWith('1', '1', '1', 'owner');
    expect(result).toEqual(mockBody);
  });

  it('should throw validation error for invalid ID format', async () => {
    const caller = EmailsRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.getEmailBody('e1')).rejects.toThrow();
  });

  it('should call setEmailReadStatus on the controller', async () => {
    const spy = vi
      .spyOn(EmailsController.prototype, 'setEmailReadStatus')
      .mockResolvedValue({ success: true, email_id: '1', is_read: true } as any);

    const caller = EmailsRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.setEmailReadStatus({ id: '1', isRead: true });

    expect(spy).toHaveBeenCalledWith('1', '1', '1', true);
    expect(result).toEqual({ success: true, email_id: '1', is_read: true });
  });
});
