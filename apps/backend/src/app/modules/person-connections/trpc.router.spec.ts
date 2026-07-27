import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PersonConnectionsRouter } from './trpc.router';
import { PersonConnectionsController } from './controller';
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
  return PersonConnectionsRouter.createCaller({
    auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
  } as any);
}

describe('PersonConnectionsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getForPerson on the controller with a valid numeric id', async () => {
    const mockConnections = [{ id: '1', relation_type: 'colleague' }];
    const spy = vi
      .spyOn(PersonConnectionsController.prototype, 'getForPerson')
      .mockResolvedValue(mockConnections as any);

    const result = await caller().getForPerson('2');

    expect(spy).toHaveBeenCalledWith('2', {
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toEqual(mockConnections);
  });

  it('should reject getForPerson with a non-numeric id', async () => {
    await expect(caller().getForPerson('abc')).rejects.toThrow();
  });

  it('should call countForPerson on the controller', async () => {
    const spy = vi.spyOn(PersonConnectionsController.prototype, 'countForPerson').mockResolvedValue(3 as any);

    const result = await caller().countForPerson('2');

    expect(spy).toHaveBeenCalledWith('2', {
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toBe(3);
  });

  it('should call addConnection on the controller with valid input', async () => {
    const mockConnection = { id: '1', relation_type: 'colleague' };
    const spy = vi
      .spyOn(PersonConnectionsController.prototype, 'addConnection')
      .mockResolvedValue(mockConnection as any);

    const result = await caller().add({
      person_id: '1',
      data: { to_person_id: '2', relation_type: 'colleague' },
    });

    expect(spy).toHaveBeenCalledWith(
      '1',
      { to_person_id: '2', relation_type: 'colleague', is_mutual: false },
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
    );
    expect(result).toEqual(mockConnection);
  });

  it('should reject add with an invalid relation_type', async () => {
    await expect(
      caller().add({ person_id: '1', data: { to_person_id: '2', relation_type: 'not-a-real-type' } as any }),
    ).rejects.toThrow();
  });

  it('should reject add with a non-numeric person_id', async () => {
    await expect(
      caller().add({ person_id: 'abc', data: { to_person_id: '2', relation_type: 'colleague' } }),
    ).rejects.toThrow();
  });

  it('should call removeConnection on the controller', async () => {
    const spy = vi.spyOn(PersonConnectionsController.prototype, 'removeConnection').mockResolvedValue({
      success: true,
    } as any);

    const result = await caller().remove('5');

    expect(spy).toHaveBeenCalledWith('5', {
      tenant_id: '1',
      user_id: '1',
      session_id: 's1',
      role: 'owner',
      campaign_id: null,
    });
    expect(result).toEqual({ success: true });
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

    await expect(
      caller().add({ person_id: '1', data: { to_person_id: '2', relation_type: 'colleague' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
