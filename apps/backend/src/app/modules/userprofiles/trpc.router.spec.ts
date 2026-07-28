import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UserProfilesRouter } from './trpc.router';
import { UserProfilesController } from './controller';
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

function caller() {
  return UserProfilesRouter.createCaller({
    auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
  } as any);
}

describe('UserProfilesRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getOneById on the controller for the caller’s own profile', async () => {
    const mockProfile = { id: '1', last_name: 'Smith' };
    const spy = vi.spyOn(UserProfilesController.prototype, 'getOneById').mockResolvedValue(mockProfile as any);

    // The caller is user_id '1', so this is their own profile.
    const result = await caller().getById('1');

    expect(spy).toHaveBeenCalledWith({ tenant_id: '1', id: '1' });
    expect(result).toEqual(mockProfile);
  });

  // SECURITY REGRESSION (M14) — this returned any tenant user's full profile row,
  // including their stored `preferences`, to any authenticated caller (viewers included).
  it('should refuse to return another user’s profile', async () => {
    const spy = vi.spyOn(UserProfilesController.prototype, 'getOneById').mockResolvedValue({} as any);

    await expect(caller().getById('2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('should reject a non-numeric profile id', async () => {
    await expect(caller().getById('not-a-number')).rejects.toThrow();
  });

  it('should reject an unauthenticated caller', async () => {
    vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const anonCaller = UserProfilesRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(anonCaller.getById('2')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
