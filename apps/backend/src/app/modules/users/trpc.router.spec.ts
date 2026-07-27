import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UsersRouter } from './trpc.router';
import { AuthController } from '../auth/controller';
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
  return UsersRouter.createCaller({
    auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
  } as any);
}

describe('UsersRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getUsersList on the AuthController for getUsers', async () => {
    const mockUsers = [{ id: '1', email: 'a@example.com' }];
    const spy = vi.spyOn(AuthController.prototype, 'getUsersList').mockResolvedValue(mockUsers as any);

    const result = await caller().getUsers();

    expect(spy).toHaveBeenCalledWith({
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toEqual(mockUsers);
  });

  it('should call getUserById on the AuthController for getProfileById with a valid id', async () => {
    const mockUser = { id: '2', email: 'b@example.com' };
    const spy = vi.spyOn(AuthController.prototype, 'getUserById').mockResolvedValue(mockUser as any);

    const result = await caller().getProfileById('2');

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '2',
    );
    expect(result).toEqual(mockUser);
  });

  it('should reject getProfileById with a non-numeric id', async () => {
    await expect(caller().getProfileById('abc')).rejects.toThrow();
  });

  it('should call updateUser on the AuthController for updateUserProfile', async () => {
    const mockUpdated = { id: '2', first_name: 'Updated' };
    const spy = vi.spyOn(AuthController.prototype, 'updateUser').mockResolvedValue(mockUpdated as any);

    const result = await caller().updateUserProfile({ id: '2', data: { first_name: 'Updated' } });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '2',
      {
        first_name: 'Updated',
      },
    );
    expect(result).toEqual(mockUpdated);
  });

  it('should reject updateUserProfile with an invalid email', async () => {
    await expect(caller().updateUserProfile({ id: '2', data: { email: 'not-an-email' } })).rejects.toThrow();
  });

  it('should reject a mutation from a viewer role', async () => {
    const mockQB: any = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ role: 'viewer', verified: true }),
    };
    vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
      selectFrom: vi.fn().mockReturnValue(mockQB),
    } as any);

    await expect(caller().updateUserProfile({ id: '2', data: { first_name: 'X' } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
