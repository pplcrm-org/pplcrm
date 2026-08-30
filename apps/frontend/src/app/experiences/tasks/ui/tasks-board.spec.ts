import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { AuthService } from '../../../auth/auth-service';
import { UserService } from '../../../services/user.service';
import { TasksService } from '../services/tasks-service';
import { TasksBoard } from './tasks-board';

describe('TasksBoard', () => {
  let component: TasksBoard;
  let fixture: ComponentFixture<TasksBoard>;
  let mockTasksSvc: any;
  let mockRouter: any;
  let mockAuth: any;
  let mockUserService: any;
  let mockSettingsSvc: any;
  let mockAlerts: any;

  const baseRow = {
    id: 't1',
    name: 'Task 1',
    status: 'todo',
    priority: 'medium',
    assigned_to: null,
    due_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    details: null,
    team_name: null,
  };

  beforeEach(async () => {
    mockTasksSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [baseRow], count: 1 }),
      getSummaryCounts: vi.fn().mockResolvedValue({ openTotal: 1, slaBreaches: 0, assignedToMe: 0, unassigned: 1 }),
      update: vi.fn().mockResolvedValue({}),
      reorder: vi.fn().mockResolvedValue({ ok: true }),
      triggerRefresh: vi.fn(),
    };

    mockRouter = { navigate: vi.fn() };
    mockAuth = { getUser: vi.fn().mockReturnValue({ id: 'u1', first_name: 'Amira', last_name: 'Hassan' }) };
    mockUserService = { getUsers: vi.fn().mockResolvedValue([]) };
    mockSettingsSvc = {
      load: vi.fn().mockResolvedValue({}),
      getValue: vi.fn((_key: string, fallback: unknown) => fallback),
    };
    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [TasksBoard],
      providers: [
        { provide: TasksService, useValue: mockTasksSvc },
        { provide: Router, useValue: mockRouter },
        { provide: AuthService, useValue: mockAuth },
        { provide: UserService, useValue: mockUserService },
        { provide: SettingsService, useValue: mockSettingsSvc },
        { provide: AlertService, useValue: mockAlerts },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TasksBoard);
    component = fixture.componentInstance;
  });

  // ngOnInit kicks off async work without returning a promise, so trigger it
  // through change detection (inside the zone) and wait for stability.
  const runInit = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('should load tasks and summary counts on init', async () => {
    await runInit();
    expect(mockTasksSvc.getAll).toHaveBeenCalled();
    expect(mockTasksSvc.getSummaryCounts).toHaveBeenCalled();
    expect(component['tasks']()).toHaveLength(1);
    expect(component['tasks']()[0]?.id).toBe('t1');
    expect(component['countSentence']()).toContain('1 open task');
    expect(component['countSentence']()).toContain('waiting for an owner');
  });

  it('says so when the server holds more tasks than the capped load returned', async () => {
    mockTasksSvc.getAll.mockResolvedValue({ rows: [baseRow], count: 4200 });
    await runInit();
    fixture.detectChanges();

    expect(component['serverTotal']()).toBe(4200);
    const text = String((fixture.nativeElement as HTMLElement).textContent);
    expect(text).toContain('Only the first 1 of 4200 tasks');
  });

  it('should move a card one column via moveCard and flash it', async () => {
    await runInit();
    const task = component['tasks']()[0]!;

    await component['moveCard'](task, 1);

    expect(mockTasksSvc.update).toHaveBeenCalledWith('t1', { status: 'in_progress' });
    expect(mockTasksSvc.triggerRefresh).toHaveBeenCalled();
    expect(component['tasks']()[0]?.status).toBe('in_progress');
    expect(component['isFlashed']('t1')).toBe(true);
  });

  it('should dim and refuse the ‹ move at the first column', async () => {
    await runInit();
    const task = component['tasks']()[0]!; // status: todo, the first column

    expect(component['canMove'](task.status, -1)).toBe(false);
    await component['moveCard'](task, -1);
    expect(mockTasksSvc.update).not.toHaveBeenCalled();
  });

  it('should assign an unassigned task to the current user via takeTask', async () => {
    await runInit();
    const task = component['tasks']()[0]!;

    await component['takeTask'](task);

    expect(mockTasksSvc.update).toHaveBeenCalledWith('t1', { assigned_to: 'u1' });
    expect(component['tasks']()[0]?.assigned_to).toBe('u1');
    expect(mockAlerts.showSuccess).toHaveBeenCalled();
  });

  it('should revert the status and toast an error when the move fails', async () => {
    mockTasksSvc.update.mockRejectedValueOnce(new Error('nope'));
    await runInit();
    const task = component['tasks']()[0]!;

    await component['moveCard'](task, 1);

    expect(component['tasks']()[0]?.status).toBe('todo');
    expect(mockAlerts.showError).toHaveBeenCalled();
  });

  // ── Drag-and-drop (Phase C) ────────────────────────────────────────────────
  // jsdom has no layout, so we hand-build fake CdkDragDrop objects. A shared
  // container object reference means "same column"; distinct references mean a
  // cross-column move.
  const mkCard = (over: Partial<Record<string, unknown>>): any => ({
    id: 'x',
    name: 'X',
    status: 'todo',
    priority: null,
    assigned_to: null,
    due_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    details: null,
    team_name: null,
    position: 0,
    ...over,
  });

  it('grouped orders each column by position, then created_at', () => {
    component['tasks'].set([
      mkCard({ id: 'a', status: 'todo', position: 2, created_at: '2026-07-01T00:00:00.000Z' }),
      mkCard({ id: 'b', status: 'todo', position: 0, created_at: '2026-07-02T00:00:00.000Z' }),
      mkCard({ id: 'c', status: 'todo', position: 0, created_at: '2026-07-01T00:00:00.000Z' }),
    ]);

    expect(component['cardsFor']('todo').map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('onCardDrop reorders within a column and persists that one column', async () => {
    const t1 = mkCard({ id: 't1', status: 'todo', position: 0 });
    const t2 = mkCard({ id: 't2', status: 'todo', position: 1 });
    component['tasks'].set([t1, t2]);

    const container = { id: 'board-col-todo' };
    // Drag t1 (index 0) to the bottom (index 1) of the same column.
    await component['onCardDrop'](
      { previousContainer: container, container, previousIndex: 0, currentIndex: 1, item: { data: t1 } } as any,
      'todo',
    );

    expect(mockTasksSvc.reorder).toHaveBeenCalledWith([{ status: 'todo', ids: ['t2', 't1'] }]);
    expect(component['cardsFor']('todo').map((t) => t.id)).toEqual(['t2', 't1']);
    expect(component['isFlashed']('t1')).toBe(true);
  });

  it('onCardDrop across columns changes status and persists both affected columns', async () => {
    const t1 = mkCard({ id: 't1', status: 'todo', position: 0 });
    const t3 = mkCard({ id: 't3', status: 'todo', position: 1 });
    const t2 = mkCard({ id: 't2', status: 'in_progress', position: 0 });
    component['tasks'].set([t1, t3, t2]);

    const from = { id: 'board-col-todo' };
    const to = { id: 'board-col-in_progress' };
    // Drag t1 from To do into In progress at the top (index 0).
    await component['onCardDrop'](
      { previousContainer: from, container: to, previousIndex: 0, currentIndex: 0, item: { data: t1 } } as any,
      'in_progress',
    );

    expect(mockTasksSvc.reorder).toHaveBeenCalledWith([
      { status: 'in_progress', ids: ['t1', 't2'] },
      { status: 'todo', ids: ['t3'] },
    ]);
    // t1 now lives in the In progress column.
    expect(component['tasks']().find((t) => t.id === 't1')?.status).toBe('in_progress');
    expect(component['cardsFor']('in_progress').map((t) => t.id)).toEqual(['t1', 't2']);
    expect(component['cardsFor']('todo').map((t) => t.id)).toEqual(['t3']);
  });

  it('onCardDrop rolls back to the snapshot and toasts on service failure', async () => {
    mockTasksSvc.reorder.mockRejectedValueOnce(new Error('nope'));
    const t1 = mkCard({ id: 't1', status: 'todo', position: 0 });
    const t2 = mkCard({ id: 't2', status: 'todo', position: 1 });
    component['tasks'].set([t1, t2]);

    const container = { id: 'board-col-todo' };
    await component['onCardDrop'](
      { previousContainer: container, container, previousIndex: 0, currentIndex: 1, item: { data: t1 } } as any,
      'todo',
    );

    // Reverted to original order/positions.
    expect(component['cardsFor']('todo').map((t) => t.id)).toEqual(['t1', 't2']);
    expect(mockAlerts.showError).toHaveBeenCalled();
  });

  it('onCardDrop is a no-op when a card is dropped in its original slot', async () => {
    const t1 = mkCard({ id: 't1', status: 'todo', position: 0 });
    component['tasks'].set([t1]);

    const container = { id: 'board-col-todo' };
    await component['onCardDrop'](
      { previousContainer: container, container, previousIndex: 0, currentIndex: 0, item: { data: t1 } } as any,
      'todo',
    );

    expect(mockTasksSvc.reorder).not.toHaveBeenCalled();
  });
});
