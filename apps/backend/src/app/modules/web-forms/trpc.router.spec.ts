import { TRPCError } from '@trpc/server';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WebFormsRouter } from './trpc.router';
import { WebFormsController } from './controller';
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

const auth = { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null };
const validUuid = '123e4567-e89b-12d3-a456-426614174000';

describe('WebFormsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getAllWithCounts with tenant_id and options', async () => {
    const mockResult = { rows: [], count: 0 };
    const spy = vi.spyOn(WebFormsController.prototype, 'getAllWithCounts').mockResolvedValue(mockResult as any);

    const caller = WebFormsRouter.createCaller({ auth } as any);
    const result = await caller.getAllWithCounts({ searchStr: 'x' });

    expect(spy).toHaveBeenCalledWith('1', { searchStr: 'x' });
    expect(result).toEqual(mockResult);
  });

  it('should call getOneById via getById with a valid uuid', async () => {
    const mockForm = { id: validUuid, name: 'Signup Form' };
    const spy = vi.spyOn(WebFormsController.prototype, 'getOneById').mockResolvedValue(mockForm as any);

    const caller = WebFormsRouter.createCaller({ auth } as any);
    const result = await caller.getById(validUuid);

    expect(spy).toHaveBeenCalledWith({ tenant_id: '1', id: validUuid });
    expect(result).toEqual(mockForm);
  });

  it('should reject getById with a non-uuid id', async () => {
    const caller = WebFormsRouter.createCaller({ auth } as any);
    await expect(caller.getById('not-a-uuid')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call addForm on the controller with the payload and auth', async () => {
    const mockCreated = { id: validUuid, name: 'Signup Form' };
    const spy = vi.spyOn(WebFormsController.prototype, 'addForm').mockResolvedValue(mockCreated as any);

    const caller = WebFormsRouter.createCaller({ auth } as any);
    const payload = { name: 'Signup Form' };
    const result = await caller.add(payload);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Signup Form' }), auth);
    expect(result).toEqual(mockCreated);
  });

  it('should reject addForm when name is empty', async () => {
    const caller = WebFormsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call updateForm on the controller', async () => {
    const mockUpdated = { id: validUuid, name: 'Renamed Form' };
    const spy = vi.spyOn(WebFormsController.prototype, 'updateForm').mockResolvedValue(mockUpdated as any);

    const caller = WebFormsRouter.createCaller({ auth } as any);
    const result = await caller.update({ id: validUuid, data: { name: 'Renamed Form' } });

    expect(spy).toHaveBeenCalledWith(validUuid, { name: 'Renamed Form' }, auth);
    expect(result).toEqual(mockUpdated);
  });

  it('should surface NOT_FOUND when updateForm targets a missing form', async () => {
    vi.spyOn(WebFormsController.prototype, 'updateForm').mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Web form not found.' }),
    );

    const caller = WebFormsRouter.createCaller({ auth } as any);
    await expect(caller.update({ id: validUuid, data: { name: 'X' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('should call delete on the controller', async () => {
    const spy = vi.spyOn(WebFormsController.prototype, 'delete').mockResolvedValue(true as any);

    const caller = WebFormsRouter.createCaller({ auth } as any);
    const result = await caller.delete(validUuid);

    expect(spy).toHaveBeenCalledWith('1', validUuid, '1');
    expect(result).toBe(true);
  });

  it('should call getSubmissionsCount with formId and tenant_id', async () => {
    const spy = vi.spyOn(WebFormsController.prototype, 'getSubmissionsCount').mockResolvedValue(7 as any);

    const caller = WebFormsRouter.createCaller({ auth } as any);
    const result = await caller.getSubmissionsCount(validUuid);

    expect(spy).toHaveBeenCalledWith(validUuid, '1');
    expect(result).toBe(7);
  });

  it('should call confirmSubscription without requiring auth (public procedure)', async () => {
    const spy = vi
      .spyOn(WebFormsController.prototype, 'confirmSubscription')
      .mockResolvedValue({ success: true } as any);

    const caller = WebFormsRouter.createCaller({} as any);
    const result = await caller.confirmSubscription({ token: 'sometoken' });

    expect(spy).toHaveBeenCalledWith('sometoken');
    expect(result).toEqual({ success: true });
  });

  it('should reject unauthenticated requests to protected procedures with UNAUTHORIZED', async () => {
    const caller = WebFormsRouter.createCaller({} as any);
    await expect(caller.getAllWithCounts({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
