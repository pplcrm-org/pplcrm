import { TRPCError } from '@trpc/server';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TagsRouter } from './trpc.router';
import { TagsController } from './controller';
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

const auth = { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null };

describe('TagsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getAllWithCounts (via crud getAll) with tenant_id and options', async () => {
    const mockResult = { rows: [{ id: '1', name: 'donor' }], count: 1 };
    const spy = vi.spyOn(TagsController.prototype, 'getAllWithCounts').mockResolvedValue(mockResult as any);

    const caller = TagsRouter.createCaller({ auth } as any);
    const result = await caller.getAll({});

    expect(spy).toHaveBeenCalledWith('1', {});
    expect(result).toEqual(mockResult);
  });

  it('should call getOneById via getById with a valid numeric id', async () => {
    const mockTag = { id: '2', name: 'volunteer' };
    const spy = vi.spyOn(TagsController.prototype, 'getOneById').mockResolvedValue(mockTag as any);

    const caller = TagsRouter.createCaller({ auth } as any);
    const result = await caller.getById('2');

    expect(spy).toHaveBeenCalledWith({ tenant_id: '1', id: '2' });
    expect(result).toEqual(mockTag);
  });

  it('should reject getById with a non-numeric id', async () => {
    const caller = TagsRouter.createCaller({ auth } as any);
    await expect(caller.getById('bad-id')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call addTag (the overridden add) on the controller', async () => {
    const mockCreated = { id: '3', name: 'donor' };
    const spy = vi.spyOn(TagsController.prototype, 'addTag').mockResolvedValue(mockCreated as any);

    const caller = TagsRouter.createCaller({ auth } as any);
    const payload = { name: 'Donor' };
    const result = await caller.add(payload);

    expect(spy).toHaveBeenCalledWith({ ...payload, type: 'tag' }, auth);
    expect(result).toEqual(mockCreated);
  });

  it('should reject add when the tag name is empty', async () => {
    const caller = TagsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should reject add when the tag color is not a valid hex code', async () => {
    const caller = TagsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: 'Donor', color: 'red' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should surface CONFLICT when addTag reports a duplicate name', async () => {
    vi.spyOn(TagsController.prototype, 'addTag').mockRejectedValue(
      new TRPCError({ code: 'CONFLICT', message: 'A tag with this name already exists.' }),
    );

    const caller = TagsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: 'Donor' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('should call update on the controller', async () => {
    const mockUpdated = { id: '2', name: 'renamed' };
    const spy = vi.spyOn(TagsController.prototype, 'update').mockResolvedValue(mockUpdated as any);

    const caller = TagsRouter.createCaller({ auth } as any);
    const result = await caller.update({ id: '2', data: { name: 'Renamed' } });

    expect(spy).toHaveBeenCalledWith({
      tenant_id: '1',
      id: '2',
      row: { name: 'Renamed', updatedby_id: '1' },
    });
    expect(result).toEqual(mockUpdated);
  });

  it('should call delete on the controller', async () => {
    const spy = vi.spyOn(TagsController.prototype, 'delete').mockResolvedValue(true as any);

    const caller = TagsRouter.createCaller({ auth } as any);
    const result = await caller.delete('2');

    expect(spy).toHaveBeenCalledWith('1', '2', '1');
    expect(result).toBe(true);
  });

  it('should call findByName on the controller with the search term and default type', async () => {
    const mockMatches = [{ name: 'donor' }];
    const spy = vi.spyOn(TagsController.prototype, 'findByName').mockResolvedValue(mockMatches as any);

    const caller = TagsRouter.createCaller({ auth } as any);
    const result = await caller.findByName({ name: 'don' });

    expect(spy).toHaveBeenCalledWith({ name: 'don', type: 'tag' }, auth);
    expect(result).toEqual(mockMatches);
  });

  it('should reject findByName when the search term is too long', async () => {
    const caller = TagsRouter.createCaller({ auth } as any);
    await expect(caller.findByName({ name: 'a'.repeat(101) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should reject unauthenticated requests with UNAUTHORIZED', async () => {
    const caller = TagsRouter.createCaller({} as any);
    await expect(caller.getAll({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
