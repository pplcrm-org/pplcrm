import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TeamsRouter } from './trpc.router';
import { TeamsController } from './controller';
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

function caller() {
  return TeamsRouter.createCaller({
    auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any,
  } as any);
}

describe('TeamsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getAllTeams on the controller with the tenant id and options', async () => {
    const mockResult = { rows: [{ id: '1', name: 'Team A' }], count: 1 };
    const spy = vi.spyOn(TeamsController.prototype, 'getAllTeams').mockResolvedValue(mockResult as any);

    const result = await caller().getAll({ startRow: 0, endRow: 10 });

    expect(spy).toHaveBeenCalledWith('1', { startRow: 0, endRow: 10 });
    expect(result).toEqual(mockResult);
  });

  it('should call getById on the controller with valid numeric ID', async () => {
    const mockTeam = { id: '1', name: 'Team A' };
    const spy = vi.spyOn(TeamsController.prototype, 'getById').mockResolvedValue(mockTeam as any);

    const result = await caller().getById('1');

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '1',
    );
    expect(result).toEqual(mockTeam);
  });

  it('should throw a validation error for a non-numeric team id', async () => {
    await expect(caller().getById('not-a-number')).rejects.toThrow();
  });

  it('should call addTeam on the controller with valid input', async () => {
    const mockTeam = { id: '1', name: 'New Team' };
    const spy = vi.spyOn(TeamsController.prototype, 'addTeam').mockResolvedValue(mockTeam as any);

    const result = await caller().add({ name: 'New Team' });

    expect(spy).toHaveBeenCalled();
    expect(result).toEqual(mockTeam);
  });

  it('should reject add with an empty team name', async () => {
    await expect(caller().add({ name: '' })).rejects.toThrow();
  });

  it('should call updateTeam on the controller with id and data', async () => {
    const mockTeam = { id: '1', name: 'Updated Team' };
    const spy = vi.spyOn(TeamsController.prototype, 'updateTeam').mockResolvedValue(mockTeam as any);

    const result = await caller().update({ id: '1', data: { name: 'Updated Team' } });

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '1',
      {
        name: 'Updated Team',
      },
    );
    expect(result).toEqual(mockTeam);
  });

  it('should call deleteTeam on the controller for delete', async () => {
    const spy = vi.spyOn(TeamsController.prototype, 'deleteTeam').mockResolvedValue(true as any);

    const result = await caller().delete('1');

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '1',
    );
    expect(result).toBe(true);
  });

  it('should call getTeamsForVolunteer on the controller', async () => {
    const mockTeams = [{ id: '1', name: 'Team A', is_captain: false }];
    const spy = vi.spyOn(TeamsController.prototype, 'getTeamsForVolunteer').mockResolvedValue(mockTeams as any);

    const result = await caller().getForVolunteer('2');

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '2',
    );
    expect(result).toEqual(mockTeams);
  });

  it('should call getAssignedLists on the controller', async () => {
    const mockLists = [{ id: '1', name: 'List A' }];
    const spy = vi.spyOn(TeamsController.prototype, 'getAssignedLists').mockResolvedValue(mockLists as any);

    const result = await caller().getAssignedLists('1');

    expect(spy).toHaveBeenCalledWith(
      { tenant_id: '1', user_id: '1', session_id: 's1', role: 'owner', campaign_id: null },
      '1',
    );
    expect(result).toEqual(mockLists);
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

    await expect(caller().add({ name: 'Viewer Team' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
