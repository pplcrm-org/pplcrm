import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivityRouter } from './trpc.router';
import { ActivityController } from './controller';
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

describe('ActivityRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getFeed on the controller with auth and input', async () => {
    const mockFeed = [{ id: '1', activity: 'create' }];
    const spy = vi.spyOn(ActivityController.prototype, 'getFeed').mockResolvedValue(mockFeed as any);

    const caller = ActivityRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getFeed({ searchStr: 'foo' });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      { searchStr: 'foo' },
    );
    expect(result).toEqual(mockFeed);
  });

  it('should reject unauthenticated requests with UNAUTHORIZED', async () => {
    const caller = ActivityRouter.createCaller({} as any);
    await expect(caller.getFeed({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('should call getActivities on the controller with entity/entityId/pagination', async () => {
    const mockActivities = [{ id: '1', entity: 'persons', entity_id: '5' }];
    const spy = vi.spyOn(ActivityController.prototype, 'getActivities').mockResolvedValue(mockActivities as any);

    const caller = ActivityRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.getActivities({ entity: 'persons', entityId: '5', startRow: 0, endRow: 10 });

    expect(spy).toHaveBeenCalledWith('1', 'persons', '5', { startRow: 0, endRow: 10 });
    expect(result).toEqual(mockActivities);
  });

  it('should reject getActivities when entityId is empty', async () => {
    const caller = ActivityRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);

    await expect(caller.getActivities({ entity: 'persons', entityId: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  describe('getActivities pagination bounds', () => {
    // These two numbers reach Kysely's .offset()/.limit() directly. Validated as bare
    // `z.number()`, a negative or fractional value became a Postgres error ("LIMIT must not be
    // negative" / "invalid input syntax for type bigint") rather than a 400, and a span of ten
    // million became LIMIT 10000000.
    function authedCaller() {
      return ActivityRouter.createCaller({
        auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
      } as any);
    }

    it('rejects a negative startRow or endRow', async () => {
      await expect(
        authedCaller().getActivities({ entity: 'persons', entityId: '5', startRow: -1, endRow: 10 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        authedCaller().getActivities({ entity: 'persons', entityId: '5', startRow: 0, endRow: -10 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('rejects a fractional startRow or endRow', async () => {
      await expect(
        authedCaller().getActivities({ entity: 'persons', entityId: '5', startRow: 1.5, endRow: 10 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        authedCaller().getActivities({ entity: 'persons', entityId: '5', startRow: 0, endRow: 10.5 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('rejects a span wider than one page', async () => {
      await expect(
        authedCaller().getActivities({ entity: 'persons', entityId: '5', startRow: 0, endRow: 10_000_000 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('still accepts an ordinary page', async () => {
      const spy = vi.spyOn(ActivityController.prototype, 'getActivities').mockResolvedValue([] as any);
      await authedCaller().getActivities({ entity: 'persons', entityId: '5', startRow: 100, endRow: 125 });
      expect(spy).toHaveBeenCalledWith('1', 'persons', '5', { startRow: 100, endRow: 125 });
    });
  });

  it('should call exportCsv on the controller merging tenant_id into the input', async () => {
    const mockResponse = { status: 'processing' as const };
    const spy = vi.spyOn(ActivityController.prototype, 'exportCsv').mockResolvedValue(mockResponse as any);

    const caller = ActivityRouter.createCaller({
      auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
    } as any);
    const result = await caller.exportCsv({ fileName: 'export.csv' });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', fileName: 'export.csv' },
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
    );
    expect(result).toEqual(mockResponse);
  });
});
