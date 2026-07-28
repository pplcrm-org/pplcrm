import { TRPCError } from '@trpc/server';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { WorkflowsRouter } from './trpc.router';
import { WorkflowsController } from './controller';
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

describe('WorkflowsRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthDb();
  });

  it('should call getAllWithCounts (via crud getAll) with tenant_id and options', async () => {
    const mockResult = { rows: [{ id: '1', name: 'Welcome Series' }], count: 1 };
    const spy = vi.spyOn(WorkflowsController.prototype, 'getAllWithCounts').mockResolvedValue(mockResult as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.getAll({});

    expect(spy).toHaveBeenCalledWith('1', {});
    expect(result).toEqual(mockResult);
  });

  it('should call getOneById via getById with a valid numeric id', async () => {
    const mockWorkflow = { id: '2', name: 'Welcome Series' };
    const spy = vi.spyOn(WorkflowsController.prototype, 'getOneById').mockResolvedValue(mockWorkflow as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.getById('2');

    expect(spy).toHaveBeenCalledWith({ tenant_id: '1', id: '2' });
    expect(result).toEqual(mockWorkflow);
  });

  it('should reject getById with a non-numeric id', async () => {
    const caller = WorkflowsRouter.createCaller({ auth } as any);
    await expect(caller.getById('bad-id')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call add on the controller with tenant/creator metadata attached', async () => {
    const mockCreated = { id: '3', name: 'New Workflow' };
    const spy = vi.spyOn(WorkflowsController.prototype, 'add').mockResolvedValue(mockCreated as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.add({ name: 'New Workflow' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Workflow',
        tenant_id: '1',
        createdby_id: '1',
        updatedby_id: '1',
      }),
    );
    expect(result).toEqual(mockCreated);
  });

  it('should reject add when the name is empty', async () => {
    const caller = WorkflowsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should reject add when trigger_type is not a recognized value', async () => {
    const caller = WorkflowsRouter.createCaller({ auth } as any);
    await expect(caller.add({ name: 'Bad Trigger', trigger_type: 'not_a_trigger' as any })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should call update on the controller', async () => {
    const mockUpdated = { id: '2', name: 'Renamed Workflow' };
    const spy = vi.spyOn(WorkflowsController.prototype, 'update').mockResolvedValue(mockUpdated as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.update({ id: '2', data: { name: 'Renamed Workflow' } });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: '1',
        id: '2',
        row: expect.objectContaining({ name: 'Renamed Workflow', updatedby_id: '1' }),
      }),
    );
    expect(result).toEqual(mockUpdated);
  });

  it('should call delete on the controller', async () => {
    const spy = vi.spyOn(WorkflowsController.prototype, 'delete').mockResolvedValue(true as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.delete('2');

    expect(spy).toHaveBeenCalledWith('1', '2', '1');
    expect(result).toBe(true);
  });

  it('should call getSteps with tenant_id and workflowId', async () => {
    const mockSteps = [{ id: '1', step_number: 1 }];
    const spy = vi.spyOn(WorkflowsController.prototype, 'getSteps').mockResolvedValue(mockSteps as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.getSteps('2');

    expect(spy).toHaveBeenCalledWith('1', '2');
    expect(result).toEqual(mockSteps);
  });

  it('should call saveSteps with tenant_id, workflowId, steps, and user_id', async () => {
    const spy = vi.spyOn(WorkflowsController.prototype, 'saveSteps').mockResolvedValue({ success: true } as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const steps = [{ kind: 'send_email' as const, delay_days: 1, subject: 'Step 1' }];
    const result = await caller.saveSteps({ workflowId: '2', steps });

    expect(spy).toHaveBeenCalledWith(
      '1',
      '2',
      [expect.objectContaining({ kind: 'send_email', delay_days: 1, delay_unit: 'days', subject: 'Step 1' })],
      '1',
    );
    expect(result).toEqual({ success: true });
  });

  it('should reject saveSteps when a step has a negative delay', async () => {
    const caller = WorkflowsRouter.createCaller({ auth } as any);
    await expect(
      caller.saveSteps({ workflowId: '2', steps: [{ kind: 'wait' as const, delay_days: -1 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('should call getEnrollments with tenant_id, workflowId, and options', async () => {
    const mockEnrollments = [{ id: '1', person_id: '5' }];
    const spy = vi.spyOn(WorkflowsController.prototype, 'getEnrollments').mockResolvedValue(mockEnrollments as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.getEnrollments({ workflowId: '2' });

    expect(spy).toHaveBeenCalledWith('1', '2', undefined);
    expect(result).toEqual(mockEnrollments);
  });

  it('should call enrollPerson with tenant_id, personId, workflowId, and user_id', async () => {
    const mockEnrollment = { id: '9', status: 'active' };
    const spy = vi.spyOn(WorkflowsController.prototype, 'enrollPerson').mockResolvedValue(mockEnrollment as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.enrollPerson({ workflowId: '2', personId: '5' });

    expect(spy).toHaveBeenCalledWith('1', '5', '2', '1');
    expect(result).toEqual(mockEnrollment);
  });

  it('should surface BAD_REQUEST when enrollPerson reports the workflow has no steps', async () => {
    vi.spyOn(WorkflowsController.prototype, 'enrollPerson').mockRejectedValue(
      new TRPCError({ code: 'BAD_REQUEST', message: 'This workflow does not have any steps yet.' }),
    );

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    await expect(caller.enrollPerson({ workflowId: '2', personId: '5' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('should call cancelEnrollment with tenant_id, enrollmentId, and user_id', async () => {
    const spy = vi.spyOn(WorkflowsController.prototype, 'cancelEnrollment').mockResolvedValue({ success: true } as any);

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    const result = await caller.cancelEnrollment({ enrollmentId: '9' });

    expect(spy).toHaveBeenCalledWith('1', '9', '1');
    expect(result).toEqual({ success: true });
  });

  it('should surface NOT_FOUND when cancelEnrollment targets a missing enrollment', async () => {
    vi.spyOn(WorkflowsController.prototype, 'cancelEnrollment').mockRejectedValue(
      new TRPCError({ code: 'NOT_FOUND', message: 'Enrollment not found.' }),
    );

    const caller = WorkflowsRouter.createCaller({ auth } as any);
    await expect(caller.cancelEnrollment({ enrollmentId: '999999' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('should reject unauthenticated requests with UNAUTHORIZED', async () => {
    const caller = WorkflowsRouter.createCaller({} as any);
    await expect(caller.getAll({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
