import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { TaskView } from './task-view';
import { AuthService } from '../../../auth/auth-service';
import { UserService } from '../../../services/user.service';
import { TasksService } from '@experiences/tasks/services/tasks-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { TeamsService } from '../../teams/services/teams-service';
import { ActivityService } from '@experiences/activity/services/activity.service';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TaskView', () => {
  let component: TaskView;
  let fixture: ComponentFixture<TaskView>;
  let mockAuth: any;
  let mockUserService: any;
  let mockTasks: any;
  let mockTeams: any;
  let mockDialogs: any;
  let mockAlert: any;

  beforeEach(async () => {
    mockAuth = {
      getUser: vi.fn().mockReturnValue({ id: 'u1' }),
    };

    mockUserService = {
      getUsers: vi.fn().mockResolvedValue([{ id: 'u1', first_name: 'User 1' }]),
      resolveAvatarUrl: vi.fn().mockReturnValue(null),
    };

    mockTasks = {
      getById: vi.fn().mockResolvedValue({
        id: 't1',
        name: 'Task 1',
        status: 'todo',
        priority: 'medium',
        assigned_to: 'u1',
        due_at: null,
        details: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(true),
      reorderSubtasks: vi.fn().mockResolvedValue({ ok: true }),
      triggerRefresh: vi.fn(),
      api: {
        tasks: {
          getComments: { query: vi.fn().mockResolvedValue([]) },
          getAttachments: { query: vi.fn().mockResolvedValue([]) },
          getSubtasks: { query: vi.fn().mockResolvedValue([]) },
        },
      },
    };

    mockTeams = {
      getAll: vi.fn().mockResolvedValue({ rows: [] }),
    };

    mockDialogs = {
      confirm: vi.fn().mockResolvedValue(true),
    };

    mockAlert = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    const mockRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('t1'),
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [TaskView],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuth },
        { provide: UserService, useValue: mockUserService },
        { provide: TasksService, useValue: mockTasks },
        { provide: TeamsService, useValue: mockTeams },
        { provide: ConfirmDialogService, useValue: mockDialogs },
        { provide: AlertService, useValue: mockAlert },
        { provide: ActivatedRoute, useValue: mockRoute },
        // The mounted <pc-record-activities> child fires a real tRPC call without this stub,
        // which intermittently escapes as an unhandled rejection and fails the whole run.
        { provide: ActivityService, useValue: { getActivities: vi.fn().mockResolvedValue({ rows: [] }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 't1');
    fixture.detectChanges();
  });

  it('should load task details on init', async () => {
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTasks.getById).toHaveBeenCalledWith('t1');
    expect(component['task']()).toBeDefined();
    expect(component['task']().id).toBe('t1');
  });

  it('should reload the task when the id input changes (record navigation reuses the component)', async () => {
    await new Promise((r) => setTimeout(r, 10));
    expect(mockTasks.getById).toHaveBeenCalledWith('t1');

    mockTasks.getById.mockResolvedValue({
      id: 't2',
      name: 'Task 2',
      status: 'todo',
      priority: 'low',
      assigned_to: null,
      due_at: null,
      details: null,
    });

    fixture.componentRef.setInput('id', 't2');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockTasks.getById).toHaveBeenCalledWith('t2');
    expect(component['task']().id).toBe('t2');
    // Children reload for the new id too, so mutations hit the displayed task.
    expect(mockTasks.api.tasks.getSubtasks.query).toHaveBeenCalledWith('t2');
  });

  it('should update task and trigger refresh', async () => {
    await new Promise((r) => setTimeout(r, 10));

    await component['update']({ name: 'Updated Task Name' });

    expect(mockTasks.update).toHaveBeenCalledWith('t1', { name: 'Updated Task Name' });
    expect(mockTasks.triggerRefresh).toHaveBeenCalled();
    expect(mockAlert.showSuccess).toHaveBeenCalledWith('Task updated successfully');
  });

  it('should reorder subtasks optimistically and persist the new order', async () => {
    await new Promise((r) => setTimeout(r, 10));

    component['subtasks'].set([
      { id: 's1', name: 'A', status: 'todo', position: 0 },
      { id: 's2', name: 'B', status: 'todo', position: 1 },
      { id: 's3', name: 'C', status: 'todo', position: 2 },
    ]);

    // Move the first subtask to the last slot.
    await component['onSubtaskDrop']({ previousIndex: 0, currentIndex: 2 } as any);

    expect(component['subtasks']().map((s: any) => s.id)).toEqual(['s2', 's3', 's1']);
    expect(mockTasks.reorderSubtasks).toHaveBeenCalledWith('t1', ['s2', 's3', 's1']);
  });

  it('should roll back the subtask order when persistence fails', async () => {
    await new Promise((r) => setTimeout(r, 10));

    const original = [
      { id: 's1', name: 'A', status: 'todo', position: 0 },
      { id: 's2', name: 'B', status: 'todo', position: 1 },
    ];
    component['subtasks'].set(original);
    mockTasks.reorderSubtasks.mockRejectedValueOnce(new Error('nope'));

    await component['onSubtaskDrop']({ previousIndex: 0, currentIndex: 1 } as any);

    expect(component['subtasks']().map((s: any) => s.id)).toEqual(['s1', 's2']);
    expect(mockAlert.showError).toHaveBeenCalled();
  });

  it('should no-op a subtask drop that lands in the same slot', async () => {
    await new Promise((r) => setTimeout(r, 10));

    component['subtasks'].set([{ id: 's1', name: 'A', status: 'todo', position: 0 }]);
    await component['onSubtaskDrop']({ previousIndex: 0, currentIndex: 0 } as any);

    expect(mockTasks.reorderSubtasks).not.toHaveBeenCalled();
  });

  it('should delete task and trigger refresh', async () => {
    await new Promise((r) => setTimeout(r, 10));

    const mockRouter = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true);

    await component['deleteTask']();

    expect(mockDialogs.confirm).toHaveBeenCalled();
    expect(mockTasks.delete).toHaveBeenCalledWith('t1');
    expect(mockTasks.triggerRefresh).toHaveBeenCalled();
    expect(mockAlert.showSuccess).toHaveBeenCalledWith('Task deleted successfully');
    expect(navigateSpy).toHaveBeenCalledWith(['/tasks']);
  });
});
