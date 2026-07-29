import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { PersonsService } from '../../persons/services/persons-service';
import { TeamsService } from '../services/teams-service';
import { TeamFormComponent } from './team-form';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';

describe('TeamFormComponent', () => {
  let component: TeamFormComponent;
  let fixture: ComponentFixture<TeamFormComponent>;
  let mockTeamsSvc: any;
  let mockPersonsSvc: any;
  let mockAlertSvc: any;
  let mockRouter: any;
  let mockActivatedRoute: any;
  let mockConfirmDialogSvc: any;

  beforeEach(async () => {
    mockTeamsSvc = {
      getById: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      triggerRefresh: vi.fn(),
    };

    mockPersonsSvc = {
      getAll: vi.fn().mockResolvedValue({
        rows: [
          { id: '1', first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
          { id: '2', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' },
        ],
        count: 2,
      }),
    };

    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    mockActivatedRoute = {
      snapshot: {
        data: { mode: 'edit' },
        paramMap: {
          get: vi.fn().mockReturnValue('team-123'),
        },
      },
    };

    mockConfirmDialogSvc = {
      confirm: vi.fn().mockResolvedValue(true),
    };
  });

  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [TeamFormComponent],
      providers: [
        { provide: TeamsService, useValue: mockTeamsSvc },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: ConfirmDialogService, useValue: mockConfirmDialogSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamFormComponent);
    component = fixture.componentInstance;
  }

  it('should initialize and load a team in edit mode', async () => {
    const mockTeam = {
      id: 'team-123',
      name: 'Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '1',
      volunteers: [{ id: '1', first_name: 'John', last_name: 'Doe', email: 'john@example.com' }],
    };
    mockTeamsSvc.getById.mockResolvedValue(mockTeam);

    await createComponent();
    fixture.componentRef.setInput('id', 'team-123');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['isNew']()).toBe(false);
    expect(mockTeamsSvc.getById).toHaveBeenCalledWith('team-123');
    expect(component['payload']()).toEqual({
      name: 'Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '1',
      team_lead_user_id: '',
      volunteer_ids: ['1'],
      list_ids: [],
    });
    expect(component['selectedVolunteerIds']()).toEqual(['1']);
  });

  it('should reflect a freshly picked volunteer in the selection immediately', async () => {
    const mockTeam = {
      id: 'team-123',
      name: 'Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '1',
      volunteers: [],
    };
    mockTeamsSvc.getById.mockResolvedValue(mockTeam);

    await createComponent();
    fixture.componentRef.setInput('id', 'team-123');
    fixture.detectChanges();
    await fixture.whenStable();

    // Picking a volunteer must show up in the picker's selection without a save
    // round-trip — the old right-hand pane read from the server response instead.
    component['onVolunteersChange'](['2']);

    expect(component['selectedVolunteerIds']()).toEqual(['2']);
    expect(component['payload']().volunteer_ids).toEqual(['2']);
  });

  it('should flag a captain who is not on the roster and add them on request', async () => {
    const mockTeam = {
      id: 'team-123',
      name: 'Outreach Team',
      description: '',
      team_captain_id: '1',
      volunteers: [],
    };
    mockTeamsSvc.getById.mockResolvedValue(mockTeam);

    await createComponent();
    fixture.componentRef.setInput('id', 'team-123');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['captainMissingFromTeam']()?.id).toBe('1');

    component['addCaptainToTeam']();

    expect(component['selectedVolunteerIds']()).toEqual(['1']);
    expect(component['captainMissingFromTeam']()).toBeNull();
  });

  it('should initialize empty form in new mode', async () => {
    mockActivatedRoute.snapshot.data.mode = 'new';

    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['isNew']()).toBe(true);
    expect(mockTeamsSvc.getById).not.toHaveBeenCalled();
    expect(component['payload']()).toEqual({
      name: '',
      description: '',
      team_captain_id: '',
      team_lead_user_id: '',
      volunteer_ids: [],
      list_ids: [],
    });
  });

  it('should validate form and prevent saving if invalid', async () => {
    mockActivatedRoute.snapshot.data.mode = 'new';
    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['form']().invalid()).toBe(true);

    await component['save']();
    expect(mockTeamsSvc.add).not.toHaveBeenCalled();
  });

  it('should call add and navigate on successful save in new mode', async () => {
    mockActivatedRoute.snapshot.data.mode = 'new';
    mockTeamsSvc.add.mockResolvedValue({ id: 'new-team-id' });

    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    component['payload'].set({
      name: 'New Team',
      description: 'Brand new focus',
      team_captain_id: '2',
      team_lead_user_id: '',
      volunteer_ids: ['1', '2'],
      list_ids: [],
    });

    await component['save']();

    expect(mockTeamsSvc.add).toHaveBeenCalledWith({
      name: 'New Team',
      description: 'Brand new focus',
      team_captain_id: '2',
      team_lead_user_id: undefined,
      volunteer_ids: ['1', '2'],
      list_ids: [],
    });
    expect(mockTeamsSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/teams']);
  });

  it('should call update and show success alert on successful save in edit mode', async () => {
    const mockTeam = {
      id: 'team-123',
      name: 'Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '1',
      volunteers: [],
    };
    mockTeamsSvc.getById.mockResolvedValue(mockTeam);
    mockTeamsSvc.update.mockResolvedValue({
      ...mockTeam,
      name: 'Updated Outreach Team',
    });

    await createComponent();
    fixture.componentRef.setInput('id', 'team-123');
    fixture.detectChanges();
    await fixture.whenStable();

    component['payload'].set({
      name: 'Updated Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '1',
      team_lead_user_id: '',
      volunteer_ids: [],
      list_ids: [],
    });

    await component['save']();

    expect(mockTeamsSvc.update).toHaveBeenCalledWith('team-123', {
      name: 'Updated Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '1',
      team_lead_user_id: null,
      volunteer_ids: [],
      list_ids: [],
    });
    expect(mockTeamsSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Team updated');
  });

  it('should trigger deletion, refresh, and navigate back on deleteTeam', async () => {
    const mockTeam = {
      id: 'team-123',
      name: 'Outreach Team',
      description: 'Community Outreach',
      team_captain_id: '',
      volunteers: [],
    };
    mockTeamsSvc.getById.mockResolvedValue(mockTeam);
    mockTeamsSvc.delete.mockResolvedValue(true);
    mockConfirmDialogSvc.confirm.mockResolvedValue(true);

    await createComponent();
    fixture.componentRef.setInput('id', 'team-123');
    fixture.detectChanges();
    await fixture.whenStable();

    await component['deleteTeam']();

    expect(mockConfirmDialogSvc.confirm).toHaveBeenCalled();
    expect(mockTeamsSvc.delete).toHaveBeenCalledWith('team-123');
    expect(mockTeamsSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Team deleted');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/teams']);
  });

  it('should clean up invalid captain/volunteers when people options change', async () => {
    mockActivatedRoute.snapshot.data.mode = 'new';
    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    // Set valid selections
    component['payload'].set({
      name: 'Team with options',
      description: '',
      team_captain_id: '1',
      team_lead_user_id: '',
      volunteer_ids: ['1', '2'],
      list_ids: [],
    });

    // Verify selections are correct initially
    expect(component['payload']().team_captain_id).toBe('1');
    expect(component['payload']().volunteer_ids).toEqual(['1', '2']);

    // Change people options: remove 1, keep only 2
    component['signalPeople'].set([{ id: '2', label: 'Jane Smith', email: 'jane@example.com' }]);

    fixture.detectChanges();

    // The effect should trigger and update the payload to clean invalid choices
    expect(component['payload']().team_captain_id).toBe('');
    expect(component['payload']().volunteer_ids).toEqual(['2']);
  });
});
