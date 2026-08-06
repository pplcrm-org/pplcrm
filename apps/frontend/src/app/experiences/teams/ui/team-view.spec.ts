import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { TeamsService } from '../services/teams-service';
import { TeamViewComponent } from './team-view';
import { UserService } from '../../../services/user.service';
import { TasksService } from '../../tasks/services/tasks-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { ActivityService } from '@experiences/activity/services/activity.service';

const mockTeamData = {
  id: 'team-1',
  name: 'Outreach Team',
  description: 'Community Outreach',
  team_captain_id: 'p1',
  team_lead_user_id: 'u1',
  volunteers: [
    { id: 'p1', first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
    { id: 'p2', first_name: 'Jane', last_name: 'Smith', email: '' },
  ],
  lists: [{ id: 'l1', name: 'Donors', is_dynamic: true, object: 'persons' }],
  createdby_id: 'u1',
  updatedby_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

const mockTasksResult = {
  rows: [
    { id: 't1', name: 'Call donors', priority: 'urgent', status: 'in_progress', due_at: '2026-02-01T00:00:00Z' },
    { id: 't2', name: 'Send letters', priority: 'high', status: 'done', due_at: null },
  ],
  count: 2,
};

let component: TeamViewComponent;
let fixture: ComponentFixture<TeamViewComponent>;
let mockTeamsSvc: any;
let mockTasksSvc: any;
let mockAlertSvc: any;
let mockActivatedRoute: any;
let mockUserService: any;
let mockDialogSvc: any;
let mockRouter: any;
let mockActivitySvc: any;

describe('TeamViewComponent', () => {
  beforeEach(async () => {
    mockTeamsSvc = {
      getById: vi.fn().mockResolvedValue(mockTeamData),
      delete: vi.fn().mockResolvedValue(true),
      triggerRefresh: vi.fn(),
    };

    mockTasksSvc = {
      getAll: vi.fn().mockResolvedValue(mockTasksResult),
    };

    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    };

    mockActivatedRoute = {
      snapshot: {
        pathFromRoot: [],
        paramMap: {
          get: vi.fn((key: string) => (key === 'id' ? 'team-1' : null)),
        },
      },
    };

    mockUserService = {
      getUsers: vi.fn().mockResolvedValue([{ id: 'u1', first_name: 'Admin', last_name: 'User' }]),
    };

    mockDialogSvc = {
      confirm: vi.fn().mockResolvedValue(true),
    };

    mockRouter = {
      navigate: vi.fn(),
      url: '/teams/team-1',
    };

    mockActivitySvc = {
      getActivities: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
    };

    await TestBed.configureTestingModule({
      imports: [TeamViewComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: mockRouter },
        { provide: TeamsService, useValue: mockTeamsSvc },
        { provide: TasksService, useValue: mockTasksSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: UserService, useValue: mockUserService },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
        { provide: ActivityService, useValue: mockActivitySvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'team-1');
    fixture.detectChanges();
  });

  it('should initialize and load the team and its tasks', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockTeamsSvc.getById).toHaveBeenCalledWith('team-1');
    expect(mockTasksSvc.getAll).toHaveBeenCalledWith({
      filterModel: { team_id: { value: 'team-1' } },
    });
    expect(component['team']()).toEqual(mockTeamData);
    expect(component['teamTasks']()).toEqual(mockTasksResult.rows);
    expect(component['_loading'].loaded()).toBe(true);
  });

  it('should surface an app-authored Error message when loading the team fails', async () => {
    mockTeamsSvc.getById.mockRejectedValueOnce(new Error('boom'));

    fixture.componentRef.setInput('id', 'team-2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('boom');
  });

  it('should show the generic fallback message when loading fails with an unexpected error type', async () => {
    mockTeamsSvc.getById.mockRejectedValueOnce(new TypeError('internal detail that must not leak'));

    fixture.componentRef.setInput('id', 'team-2');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Could not load the team. Please try again.');
  });

  it('should compute breadcrumbs using the team name once loaded', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['crumbs']()).toEqual([{ label: 'Teams', route: '/teams' }, { label: 'Outreach Team' }]);
  });

  it('should derive volunteers from the loaded team', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['volunteers']()).toEqual(mockTeamData.volunteers);
  });

  it('should build team tabs with live counts', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    const tabs = component['teamTabs']();
    expect(tabs.find((t) => t.id === 'volunteers')?.badge).toBe(2);
    expect(tabs.find((t) => t.id === 'lists')?.badge).toBe(1);
    expect(tabs.find((t) => t.id === 'tasks')?.badge).toBe(2);
  });

  it('should resolve the team captain name from the volunteers list', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['captainName']()).toBe('John Doe');
  });

  it('should return an em dash when there is no team captain', async () => {
    mockTeamsSvc.getById.mockResolvedValueOnce({ ...mockTeamData, team_captain_id: null });

    fixture.componentRef.setInput('id', 'team-3');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['captainName']()).toBe('—');
  });

  it('should resolve the team lead name from the loaded users', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['leadName']()).toBe('Admin User');
  });

  it('should return an em dash when there is no team lead', async () => {
    mockTeamsSvc.getById.mockResolvedValueOnce({ ...mockTeamData, team_lead_user_id: null });

    fixture.componentRef.setInput('id', 'team-4');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['leadName']()).toBe('—');
  });

  it('should count active tasks excluding done and archived ones', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['activeTasksCount']()).toBe(1);
  });

  it('should resolve the added-by/updated-by user name once users load', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['getUserName']('u1')).toBe('Admin');
    expect(component['getUserName'](null)).toBe('?');
    expect(component['getUserName']('unknown-user')).toBe('?');
  });

  it('should map created_at/updated_at strings to Date objects', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['getCreatedAt']()).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(component['getUpdatedAt']()).toEqual(new Date('2026-01-02T00:00:00Z'));
  });

  it('should return null for created/updated dates when there is no team loaded', () => {
    component['team'].set(null);

    expect(component['getCreatedAt']()).toBeNull();
    expect(component['getUpdatedAt']()).toBeNull();
  });

  it('should map task priority to a status-badge type', () => {
    expect(component['getPriorityType']('urgent')).toBe('error');
    expect(component['getPriorityType']('high')).toBe('warning');
    expect(component['getPriorityType']('medium')).toBe('info');
    expect(component['getPriorityType']('low')).toBe('ghost');
    expect(component['getPriorityType'](null)).toBe('ghost');
  });

  it('should map task status to a status-badge type', () => {
    expect(component['getStatusType']('done')).toBe('success');
    expect(component['getStatusType']('in_progress')).toBe('info');
    expect(component['getStatusType']('waiting')).toBe('error');
    expect(component['getStatusType']('archived')).toBe('neutral');
    expect(component['getStatusType']('todo')).toBe('ghost');
  });

  it('should navigate to the edit route relative to the current route', () => {
    component['editTeam']();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['edit'], { relativeTo: mockActivatedRoute });
  });

  describe('deleteTeam', () => {
    it('should do nothing when the confirmation dialog is cancelled', async () => {
      mockDialogSvc.confirm.mockResolvedValue(false);

      await component['deleteTeam']();

      expect(mockTeamsSvc.delete).not.toHaveBeenCalled();
    });

    it('should delete, refresh and navigate back to the list on confirm', async () => {
      mockDialogSvc.confirm.mockResolvedValue(true);

      await component['deleteTeam']();

      expect(mockTeamsSvc.delete).toHaveBeenCalledWith('team-1');
      expect(mockTeamsSvc.triggerRefresh).toHaveBeenCalled();
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Team deleted');
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/teams']);
    });

    it('should show the server error message when deletion fails', async () => {
      mockDialogSvc.confirm.mockResolvedValue(true);
      mockTeamsSvc.delete.mockRejectedValue(new Error('Server exploded'));

      await component['deleteTeam']();

      expect(mockAlertSvc.showError).toHaveBeenCalledWith('Server exploded');
    });

    it('should fall back to a generic error message when the error has no message', async () => {
      mockDialogSvc.confirm.mockResolvedValue(true);
      mockTeamsSvc.delete.mockRejectedValue({});

      await component['deleteTeam']();

      expect(mockAlertSvc.showError).toHaveBeenCalledWith('Unable to delete team');
    });

    it('should use the data.message from a tRPC-shaped error when present', async () => {
      mockDialogSvc.confirm.mockResolvedValue(true);
      mockTeamsSvc.delete.mockRejectedValue({ data: { message: 'Team has active shifts' } });

      await component['deleteTeam']();

      expect(mockAlertSvc.showError).toHaveBeenCalledWith('Team has active shifts');
    });
  });
});
