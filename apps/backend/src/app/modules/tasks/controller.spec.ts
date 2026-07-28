import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TasksController } from './controller';
import { NotificationsRepo } from '../notifications/repositories/notifications.repo';
import { TasksRepo } from './repositories/tasks.repo';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import { UserActivityRepo } from '../../lib/user-activity.repo';

describe('TasksController Notifications', () => {
  let controller: TasksController;

  beforeEach(() => {
    controller = new TasksController();
    vi.restoreAllMocks();
  });

  /**
   * The in-app push is gated on the assignee's `task_assigned_in_app` preference, so the
   * controller looks the assignee up before notifying. Stub that lookup (email: null keeps
   * the email branch out of these tests).
   *
   * The same stub also satisfies `assertAssigneeInTenant`, which runs first on every write
   * and would otherwise reach the real database with these fake non-numeric ids.
   */
  function stubAssigneeLookup(preferences: unknown): void {
    const qb: any = {
      leftJoin: vi.fn(() => qb),
      select: vi.fn(() => qb),
      where: vi.fn(() => qb),
      executeTakeFirst: vi.fn().mockResolvedValue({ email: null, first_name: null, profile_preferences: preferences }),
    };
    vi.spyOn(controller as any, 'getRepo').mockReturnValue({ db: { selectFrom: vi.fn(() => qb) } });
  }

  it('should push notification on addTask if assigned_to is present', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const payload = {
      name: 'Test Task',
      assigned_to: 'user-2',
    } as any;

    const mockTask = { id: 'task-1', name: 'Test Task' };
    const addSpy = vi.spyOn(controller, 'add').mockResolvedValue(mockTask as any);
    const pushSpy = vi.spyOn(NotificationsRepo.prototype, 'pushNotification').mockResolvedValue(null as any);
    stubAssigneeLookup(null); // no stored preferences — notifications default on

    const result = await controller.addTask(payload, auth);

    expect(addSpy).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      user_id: 'user-2',
      title: 'Task Assigned',
      message: 'You have been assigned the task: "Test Task"',
      type: 'task',
      link: '/tasks/task-1',
    });
    expect(result).toEqual(mockTask);
  });

  it('should push notification on updateTask if assignee changed', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const updatePayload = {
      assigned_to: 'user-3',
    } as any;

    const mockExistingTask = { id: 'task-1', name: 'Existing Task', assigned_to: 'user-2' };
    const mockUpdatedTask = { id: 'task-1', name: 'Existing Task', assigned_to: 'user-3' };

    const getSpy = vi.spyOn(controller, 'getOneById').mockResolvedValue(mockExistingTask as any);
    const updateSpy = vi.spyOn(controller, 'update').mockResolvedValue(mockUpdatedTask as any);
    const pushSpy = vi.spyOn(NotificationsRepo.prototype, 'pushNotification').mockResolvedValue(null as any);
    stubAssigneeLookup(null);

    const result = await controller.updateTask('task-1', updatePayload, auth);

    expect(getSpy).toHaveBeenCalledWith({ tenant_id: 'tenant-1', id: 'task-1' });
    expect(updateSpy).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      user_id: 'user-3',
      title: 'Task Assigned',
      message: 'You have been assigned the task: "Existing Task"',
      type: 'task',
      link: '/tasks/task-1',
    });
    expect(result).toEqual(mockUpdatedTask);
  });

  it('should NOT push notification when the assignee turned task_assigned_in_app off', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const payload = { name: 'Test Task', assigned_to: 'user-2' } as any;

    vi.spyOn(controller, 'add').mockResolvedValue({ id: 'task-1', name: 'Test Task' } as any);
    const pushSpy = vi.spyOn(NotificationsRepo.prototype, 'pushNotification').mockResolvedValue(null as any);
    stubAssigneeLookup({ notifications: { task_assigned_in_app: false } });

    await controller.addTask(payload, auth);

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('should NOT push notification on updateTask if assignee did not change', async () => {
    const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
    const updatePayload = {
      assigned_to: 'user-2',
    } as any;

    const mockExistingTask = { id: 'task-1', name: 'Existing Task', assigned_to: 'user-2' };
    const mockUpdatedTask = { id: 'task-1', name: 'Existing Task', assigned_to: 'user-2' };

    const _getSpy = vi.spyOn(controller, 'getOneById').mockResolvedValue(mockExistingTask as any);
    const _updateSpy = vi.spyOn(controller, 'update').mockResolvedValue(mockUpdatedTask as any);
    const pushSpy = vi.spyOn(NotificationsRepo.prototype, 'pushNotification');
    stubAssigneeLookup(null);

    await controller.updateTask('task-1', updatePayload, auth);

    expect(pushSpy).not.toHaveBeenCalled();
  });

  // tasks.assigned_to references authusers(id) without tenant_id, so Postgres alone will store a
  // cross-tenant assignee. The controller has to refuse one before the write.
  describe('cross-tenant assignee', () => {
    /** Same shape as stubAssigneeLookup, but the assignee is not a member of this tenant. */
    function stubNoSuchMember(): void {
      const qb: any = {
        leftJoin: vi.fn(() => qb),
        select: vi.fn(() => qb),
        where: vi.fn(() => qb),
        executeTakeFirst: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(controller as any, 'getRepo').mockReturnValue({ db: { selectFrom: vi.fn(() => qb) } });
    }

    it('addTask refuses an assignee outside the tenant, without writing', async () => {
      const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
      const addSpy = vi.spyOn(controller, 'add');
      stubNoSuchMember();

      await expect(controller.addTask({ name: 'T', assigned_to: 'outsider' } as any, auth)).rejects.toThrow(
        /not a member of this workspace/i,
      );
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('updateTask refuses an assignee outside the tenant, without writing', async () => {
      const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
      const updateSpy = vi.spyOn(controller, 'update');
      stubNoSuchMember();

      await expect(controller.updateTask('task-1', { assigned_to: 'outsider' } as any, auth)).rejects.toThrow(
        /not a member of this workspace/i,
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('allows clearing the assignee (null is "unassigned", not a member check)', async () => {
      const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;
      stubNoSuchMember();
      vi.spyOn(controller, 'getOneById').mockResolvedValue({ id: 'task-1', assigned_to: 'user-2' } as any);
      const updateSpy = vi.spyOn(controller, 'update').mockResolvedValue({ id: 'task-1' } as any);

      await controller.updateTask('task-1', { assigned_to: null } as any, auth);

      expect(updateSpy).toHaveBeenCalled();
    });
  });
});

describe('TasksController SLA breach counting', () => {
  let controller: TasksController;
  const auth = { tenant_id: 'tenant-1', user_id: 'user-1' } as any;

  beforeEach(() => {
    controller = new TasksController();
    vi.restoreAllMocks();
  });

  it('counts only open tasks whose working time exceeds the SLA target', async () => {
    vi.spyOn(SettingsRepo.prototype, 'getAllForTenant').mockResolvedValue([
      { key: 'sla.tasks_hours', value: 24 },
      { key: 'sla.working_days', value: '1,2,3,4,5' },
      { key: 'sla.working_hours_start', value: '09:00' },
      { key: 'sla.working_hours_end', value: '17:00' },
    ] as any);

    const now = new Date('2026-07-08T12:00:00Z'); // a Wednesday
    vi.useFakeTimers();
    vi.setSystemTime(now);

    vi.spyOn(TasksRepo.prototype, 'getOpenForSla').mockResolvedValue([
      // Created 5 working days ago — comfortably breaches a 24h target.
      { id: 't1', created_at: new Date('2026-07-01T12:00:00Z'), assigned_to: 'user-2' },
      // Created moments ago — well inside the target.
      { id: 't2', created_at: new Date('2026-07-08T11:55:00Z'), assigned_to: null },
    ]);

    const count = await controller.countSlaBreaches(auth);

    expect(count).toBe(1);
    vi.useRealTimers();
  });

  it('assembles the four count-sentence numbers via getSummaryCounts', async () => {
    vi.spyOn(SettingsRepo.prototype, 'getAllForTenant').mockResolvedValue([] as any);
    vi.spyOn(TasksRepo.prototype, 'getOpenForSla').mockResolvedValue([]);
    vi.spyOn(TasksRepo.prototype, 'countOpen').mockResolvedValue(12);
    vi.spyOn(TasksRepo.prototype, 'countOpenUnassigned').mockResolvedValue(3);
    vi.spyOn(TasksRepo.prototype, 'countOpenAssignedTo').mockResolvedValue(4);

    const result = await controller.getSummaryCounts(auth);

    expect(result).toEqual({ openTotal: 12, unassigned: 3, assignedToMe: 4, slaBreaches: 0 });
  });
});

describe('TasksController board reorder', () => {
  let controller: TasksController;
  const auth = { tenant_id: 't1', user_id: 'u1' } as any;

  beforeEach(() => {
    controller = new TasksController();
    vi.restoreAllMocks();
  });

  /**
   * A minimal fake Kysely transaction that records the update `set`/`where` calls and
   * returns the given rows from the ownership-verification select. jsdom-free, no DB.
   */
  function fakeTrx(existingRows: Array<{ id: string; status: string; name: string }>) {
    const selectWheres: Array<[string, unknown]> = [];
    const updateCalls: Array<{ set: any; wheres: Record<string, unknown> }> = [];
    const trx: any = {
      selectFrom: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        where: vi.fn((col: string, _op: string, val: unknown) => {
          selectWheres.push([col, val]);
          return trx.selectFrom.mock.results.at(-1)?.value;
        }),
        execute: vi.fn().mockResolvedValue(existingRows),
      })),
      updateTable: vi.fn(() => {
        const call = { set: undefined as any, wheres: {} as Record<string, unknown> };
        const qb: any = {
          set: vi.fn((v: any) => {
            call.set = v;
            return qb;
          }),
          where: vi.fn((col: string, _op: string, val: unknown) => {
            call.wheres[col] = val;
            return qb;
          }),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        updateCalls.push(call);
        return qb;
      }),
    };
    return { trx, selectWheres, updateCalls };
  }

  function stubTransaction(trx: any) {
    vi.spyOn(TasksRepo.prototype, 'transaction').mockReturnValue({
      execute: (cb: any) => cb(trx),
    } as any);
  }

  it('writes position = index per id in column order, tenant-scoped, and returns a count', async () => {
    const { trx, selectWheres, updateCalls } = fakeTrx([
      { id: '1', status: 'todo', name: 'A' },
      { id: '2', status: 'todo', name: 'B' },
    ]);
    stubTransaction(trx);
    const logSpy = vi.spyOn(UserActivityRepo.prototype, 'log').mockResolvedValue(undefined as any);

    const res = await controller.reorderTasks(auth, { columns: [{ status: 'todo', ids: ['2', '1'] }] });

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]?.set).toMatchObject({ position: 0, status: 'todo', updatedby_id: 'u1' });
    expect(updateCalls[0]?.wheres).toMatchObject({ tenant_id: 't1', id: '2' });
    expect(updateCalls[1]?.set).toMatchObject({ position: 1, status: 'todo' });
    expect(updateCalls[1]?.wheres.id).toBe('1');
    // The ownership check is tenant-scoped.
    expect(selectWheres).toContainEqual(['tenant_id', 't1']);
    // Same-column move: no status changed, so no activity is logged.
    expect(logSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, updated: 2 });
  });

  it('changes status without ever writing completed_at (parity with the single-task path) and logs the change', async () => {
    const { trx, updateCalls } = fakeTrx([{ id: '1', status: 'todo', name: 'A' }]);
    stubTransaction(trx);
    const logSpy = vi.spyOn(UserActivityRepo.prototype, 'log').mockResolvedValue(undefined as any);

    await controller.reorderTasks(auth, { columns: [{ status: 'done', ids: ['1'] }] });

    // completed_at parity: updateTask has no completed_at side effect and there is no
    // DB trigger, so the reorder write must not invent one.
    expect(updateCalls[0]?.set).toMatchObject({ position: 0, status: 'done' });
    expect('completed_at' in (updateCalls[0]?.set ?? {})).toBe(false);
    // The status transition is logged like the single-write path.
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'tasks',
        entity_id: '1',
        metadata: expect.objectContaining({ changes: { status: { from: 'todo', to: 'done' } } }),
      }),
      trx,
    );
  });

  it('rejects the whole drop when an id does not belong to the tenant', async () => {
    const { trx } = fakeTrx([{ id: '1', status: 'todo', name: 'A' }]); // '2' is foreign/unknown
    stubTransaction(trx);
    vi.spyOn(UserActivityRepo.prototype, 'log').mockResolvedValue(undefined as any);

    await expect(controller.reorderTasks(auth, { columns: [{ status: 'todo', ids: ['1', '2'] }] })).rejects.toThrow();
  });
});
