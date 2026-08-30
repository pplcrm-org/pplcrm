import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { AuthService } from '../../../auth/auth-service';
import { UserService } from '../../../services/user.service';
import { TasksService } from '../services/tasks-service';
import { TasksList } from './tasks-list';

describe('TasksList', () => {
  let component: TasksList;
  let fixture: ComponentFixture<TasksList>;
  let mockTasksSvc: any;
  let mockRouter: any;
  let mockAuth: any;
  let mockUserService: any;
  let mockSettingsSvc: any;
  let mockAlerts: any;

  const rows = [
    {
      id: 't1',
      name: 'Call donor',
      status: 'todo',
      priority: 'high',
      assigned_to: 'u1',
      due_at: '2020-01-01T00:00:00.000Z', // deliberately in the past -> overdue bucket
      created_at: '2026-07-01T00:00:00.000Z',
      details: null,
    },
    {
      id: 't2',
      name: 'Print signs',
      status: 'waiting',
      priority: null,
      assigned_to: null,
      due_at: null,
      created_at: '2026-07-01T00:00:00.000Z',
      details: 'Waiting on the printer quote',
    },
    {
      id: 't3',
      name: 'Book the room',
      status: 'done',
      priority: null,
      assigned_to: 'u1',
      due_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
      details: null,
    },
  ];

  beforeEach(async () => {
    mockTasksSvc = {
      getAll: vi.fn().mockResolvedValue({ rows, count: rows.length }),
      getSummaryCounts: vi.fn().mockResolvedValue({ openTotal: 2, slaBreaches: 0, assignedToMe: 1, unassigned: 1 }),
      update: vi.fn().mockResolvedValue({}),
      triggerRefresh: vi.fn(),
      import: vi.fn(),
    };
    mockRouter = { navigate: vi.fn() };
    mockAuth = { getUser: vi.fn().mockReturnValue({ id: 'u1' }) };
    mockUserService = { getUsers: vi.fn().mockResolvedValue([{ id: 'u1', first_name: 'Amira', last_name: 'Hassan' }]) };
    mockSettingsSvc = {
      load: vi.fn().mockResolvedValue({}),
      getValue: vi.fn((_key: string, fallback: unknown) => fallback),
    };
    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [TasksList],
      providers: [
        { provide: TasksService, useValue: mockTasksSvc },
        { provide: Router, useValue: mockRouter },
        { provide: AuthService, useValue: mockAuth },
        { provide: UserService, useValue: mockUserService },
        { provide: SettingsService, useValue: mockSettingsSvc },
        { provide: AlertService, useValue: mockAlerts },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TasksList);
    component = fixture.componentInstance;
  });

  const runInit = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('should load tasks, users, and summary counts on init', async () => {
    await runInit();
    expect(mockTasksSvc.getAll).toHaveBeenCalled();
    expect(mockTasksSvc.getSummaryCounts).toHaveBeenCalled();
    expect(component['tasks']()).toHaveLength(3);
    expect(component['countSentence']()).toContain('2 open tasks');
  });

  it('says so when the server holds more tasks than the capped load returned', async () => {
    mockTasksSvc.getAll.mockResolvedValue({
      rows: [{ id: 't9', name: 'Only loaded task', status: 'todo' }],
      count: 4200,
    });
    await runInit();
    fixture.detectChanges();

    expect(component['serverTotal']()).toBe(4200);
    const text = String((fixture.nativeElement as HTMLElement).textContent);
    expect(text).toContain('Only the first 1 of 4200 tasks');
  });

  it('should compute All/Mine/Unassigned/Done tab counts', async () => {
    await runInit();
    expect(component['tabCounts']()).toEqual({ all: 3, mine: 2, unassigned: 1, done: 1 });
  });

  it('should filter rows by the active tab', async () => {
    await runInit();
    component['setTab']('done');
    expect(component['filtered']().map((t) => t.id)).toEqual(['t3']);

    component['setTab']('unassigned');
    expect(component['filtered']().map((t) => t.id)).toEqual(['t2']);
  });

  it('should group the active tab into due buckets', async () => {
    await runInit();
    const groups = component['groups']();
    const overdue = groups.find((g) => g.key === 'overdue');
    const none = groups.find((g) => g.key === 'none');
    expect(overdue?.rows.map((t) => t.id)).toEqual(['t1']);
    expect(none?.rows.map((t) => t.id).sort()).toEqual(['t2', 't3']);
  });

  it('should surface the waiting reason only for waiting tasks with details', async () => {
    await runInit();
    const waitingTask = component['tasks']().find((t) => t.id === 't2')!;
    const todoTask = component['tasks']().find((t) => t.id === 't1')!;
    expect(component['waitingReason'](waitingTask)).toBe('Waiting on the printer quote');
    expect(component['waitingReason'](todoTask)).toBeNull();
  });

  it('should toggle a task done and flash it, reverting on failure', async () => {
    await runInit();
    const task = component['tasks']().find((t) => t.id === 't1')!;

    await component['toggleDone'](task);
    expect(mockTasksSvc.update).toHaveBeenCalledWith('t1', { status: 'done' });
    expect(component['tasks']().find((t) => t.id === 't1')?.status).toBe('done');
    expect(component['isFlashed']('t1')).toBe(true);

    mockTasksSvc.update.mockRejectedValueOnce(new Error('nope'));
    await component['toggleDone'](task);
    expect(mockAlerts.showError).toHaveBeenCalled();
  });

  it('should assign an unassigned task to the current user via takeTask', async () => {
    await runInit();
    const task = component['tasks']().find((t) => t.id === 't2')!;

    await component['takeTask'](task);

    expect(mockTasksSvc.update).toHaveBeenCalledWith('t2', { assigned_to: 'u1' });
    expect(component['tasks']().find((t) => t.id === 't2')?.assigned_to).toBe('u1');
    expect(mockAlerts.showSuccess).toHaveBeenCalled();
  });
});
