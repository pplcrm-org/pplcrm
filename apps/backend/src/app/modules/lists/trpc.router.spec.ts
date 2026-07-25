import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ListsRouter } from './trpc.router';
import { ListsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

function mockAuthDb() {
  const mockQB: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    // Single shared row for every mocked read: authusers (role/verified), sessions, and the
    // plan-gate's tenants read (subscription_plan) all resolve from it.
    executeTakeFirst: vi.fn().mockResolvedValue({ role: 'owner', verified: true, subscription_plan: 'movement' }),
  };
  vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
    selectFrom: vi.fn().mockReturnValue(mockQB),
  } as any);
}

const auth = { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner' };

describe('ListsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  // Both read paths go through getAllForContext, which materializes the
  // built-in lists (§8) for the context being read before delegating.
  it('should route getAll through getAllForContext', async () => {
    const mockLists = { rows: [{ id: '1', name: 'VIPs' }], count: 1 };
    const spy = vi.spyOn(ListsController.prototype, 'getAllForContext').mockResolvedValue(mockLists as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getAll();

    expect(spy).toHaveBeenCalledWith(auth, undefined);
    expect(result).toEqual(mockLists);
  });

  it('should call getAllWithCounts with tenant_id and options', async () => {
    const mockResult = { rows: [], count: 0 };
    const spy = vi.spyOn(ListsController.prototype, 'getAllWithCounts').mockResolvedValue(mockResult as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getAllWithCounts({ searchStr: 'vip' });

    expect(spy).toHaveBeenCalledWith('1', { searchStr: 'vip' });
    expect(result).toEqual(mockResult);
  });

  it('should call getById with a valid numeric id', async () => {
    const mockList = { id: '5', name: 'Board Members' };
    const spy = vi.spyOn(ListsController.prototype, 'getOneById').mockResolvedValue(mockList as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getById('5');

    expect(spy).toHaveBeenCalledWith({ tenant_id: '1', id: '5' });
    expect(result).toEqual(mockList);
  });

  it('should reject getById with a non-numeric id', async () => {
    const caller = ListsRouter.createCaller({ auth } as any);
    await expect(caller.getById('not-an-id')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call addList on the controller with the parsed payload', async () => {
    const mockList = { id: '9', name: 'New List' };
    const spy = vi.spyOn(ListsController.prototype, 'addList').mockResolvedValue(mockList as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const payload = { name: 'New List', object: 'people' as const };
    const result = await caller.add(payload);

    expect(spy).toHaveBeenCalledWith(payload, auth);
    expect(result).toEqual(mockList);
  });

  it('should reject add when name is empty', async () => {
    const caller = ListsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: '', object: 'people' as const })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call updateList with id, data, and auth', async () => {
    const mockUpdated = { id: '5', name: 'Renamed' };
    const spy = vi.spyOn(ListsController.prototype, 'updateList').mockResolvedValue(mockUpdated as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.update({ id: '5', data: { name: 'Renamed' } });

    expect(spy).toHaveBeenCalledWith('5', { name: 'Renamed' }, auth);
    expect(result).toEqual(mockUpdated);
  });

  it('should call delete on the controller', async () => {
    const spy = vi.spyOn(ListsController.prototype, 'delete').mockResolvedValue(true as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.delete('5');

    expect(spy).toHaveBeenCalledWith('1', '5', '1');
    expect(result).toBe(true);
  });

  it('should reject deleteMany with an empty array', async () => {
    const caller = ListsRouter.createCaller({ auth } as any);
    await expect(caller.deleteMany([])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call deleteMany on the controller with the ids', async () => {
    const spy = vi.spyOn(ListsController.prototype, 'deleteMany').mockResolvedValue(true as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.deleteMany(['5', '6']);

    expect(spy).toHaveBeenCalledWith('1', ['5', '6']);
    expect(result).toBe(true);
  });

  it('should call getCount on the controller', async () => {
    const spy = vi.spyOn(ListsController.prototype, 'getCount').mockResolvedValue(3 as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.count();

    expect(spy).toHaveBeenCalledWith('1');
    expect(result).toBe(3);
  });

  it('should call getHouseholdsByListId for getMembersHouseholds', async () => {
    const mockRows = [{ id: '1' }];
    const spy = vi.spyOn(ListsController.prototype, 'getHouseholdsByListId').mockReturnValue(mockRows as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getMembersHouseholds('5');

    expect(spy).toHaveBeenCalledWith(auth, '5');
    expect(result).toEqual(mockRows);
  });

  it('should call getPersonsByListId for getMembersPersons', async () => {
    const mockRows = [{ id: '2' }];
    const spy = vi.spyOn(ListsController.prototype, 'getPersonsByListId').mockReturnValue(mockRows as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getMembersPersons('5');

    expect(spy).toHaveBeenCalledWith(auth, '5');
    expect(result).toEqual(mockRows);
  });

  it('should call refreshList on the controller', async () => {
    const mockList = { id: '5', status: 'refreshing' };
    const spy = vi.spyOn(ListsController.prototype, 'refreshList').mockResolvedValue(mockList as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.refresh('5');

    expect(spy).toHaveBeenCalledWith(auth, '5');
    expect(result).toEqual(mockList);
  });

  it('should call getListStats on the controller', async () => {
    const mockStats = { totalNewsletters: 2 };
    const spy = vi.spyOn(ListsController.prototype, 'getListStats').mockResolvedValue(mockStats as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getListStats('5');

    expect(spy).toHaveBeenCalledWith(auth, '5');
    expect(result).toEqual(mockStats);
  });

  it('should call getMemberCount on the controller', async () => {
    const spy = vi.spyOn(ListsController.prototype, 'getMemberCount').mockResolvedValue(42 as any);

    const caller = ListsRouter.createCaller({ auth } as any);
    const result = await caller.getMemberCount('5');

    expect(spy).toHaveBeenCalledWith(auth, '5');
    expect(result).toBe(42);
  });

  it('should reject unauthenticated requests with UNAUTHORIZED', async () => {
    const caller = ListsRouter.createCaller({} as any);
    await expect(caller.getAll()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
