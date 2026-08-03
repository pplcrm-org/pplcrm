import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { PersonForm } from './person-form';
import { UserService } from '../../../services/user.service';
import { PersonsService } from '../services/persons-service';
import { HouseholdsService } from '../../households/services/households-service';
import { TeamsService } from '../../teams/services/teams-service';
import { CompaniesService } from '../../companies/services/companies-service';
import { TagsService } from '../../tags/services/tags-service';
import { CampaignsService } from '../../campaigns/services/campaigns-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PersonForm', () => {
  let component: PersonForm;
  let fixture: ComponentFixture<PersonForm>;

  let mockAlertSvc: any;
  let mockUserService: any;
  let mockConfirmDlg: any;
  let mockHouseholdsSvc: any;
  let mockPersonsSvc: any;
  let mockTeamsSvc: any;
  let mockCampaignsSvc: any;
  let mockRoute: any;
  let mockRouter: any;

  beforeEach(async () => {
    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showInfo: vi.fn(),
    };

    mockUserService = {
      getUsers: vi.fn().mockResolvedValue([{ id: 'u1', first_name: 'Admin' }]),
    };

    mockConfirmDlg = {
      confirm: vi.fn().mockResolvedValue(true),
    };

    mockHouseholdsSvc = {
      getById: vi.fn().mockResolvedValue({ street_num: '123', street1: 'Main St', city: 'City', state: 'NY' }),
      getAll: vi.fn().mockResolvedValue({ rows: [] }),
    };

    mockPersonsSvc = {
      getById: vi.fn().mockResolvedValue({ id: 'p1', first_name: 'John', middle_names: 'A', last_name: 'Doe' }),
      getTags: vi.fn().mockResolvedValue(['volunteer']),
      add: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      triggerRefresh: vi.fn(),
      attachTag: vi.fn().mockResolvedValue(undefined),
      detachTag: vi.fn().mockResolvedValue(undefined),
      removeHousehold: vi.fn().mockResolvedValue(undefined),
    };

    mockTeamsSvc = {
      getTeamsForVolunteer: vi.fn().mockResolvedValue([{ id: 't1', name: 'Security', is_captain: false }]),
    };

    const mockCompaniesSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
    };

    const mockTagsSvc = {
      findByName: vi.fn().mockResolvedValue([]),
      getAll: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
      getAllWithCounts: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
    };

    mockCampaignsSvc = {
      upsertPersonFact: vi.fn().mockResolvedValue(undefined),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    const mockCampaignContext = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      activeCampaignId: () => 'c1',
      activeCampaign: () => ({ id: 'c1', name: 'Office' }),
      isArchivedContext: () => false,
      // Jurisdiction vocabulary resolved from the active campaign's declared office. Components
      // read these to name electoral areas in the campaign's own word.
      seatLabel: () => 'Ward',
      seatLabelPlural: () => 'Wards',
      subdivisionLabel: () => 'Poll',
      subdivisionLabelPlural: () => 'Polls',
    };

    mockRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('p1'),
        },
      },
    };

    await TestBed.configureTestingModule({
      imports: [PersonForm],
      providers: [
        provideRouter([]),
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: UserService, useValue: mockUserService },
        { provide: ConfirmDialogService, useValue: mockConfirmDlg },
        { provide: HouseholdsService, useValue: mockHouseholdsSvc },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: TeamsService, useValue: mockTeamsSvc },
        { provide: CompaniesService, useValue: mockCompaniesSvc },
        { provide: TagsService, useValue: mockTagsSvc },
        { provide: CampaignsService, useValue: mockCampaignsSvc },
        { provide: CampaignContextService, useValue: mockCampaignContext },
        { provide: ActivatedRoute, useValue: mockRoute },
      ],
    }).compileComponents();

    mockRouter = TestBed.inject(Router);
    vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);
    vi.spyOn(mockRouter, 'navigateByUrl').mockResolvedValue(true as any);

    fixture = TestBed.createComponent(PersonForm);
    component = fixture.componentInstance;
  });

  it('should create and load data on init in edit mode', async () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('id', 'p1');
    void component.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    expect(component['id']()).toBe('p1');
    expect(mockPersonsSvc.getById).toHaveBeenCalledWith('p1');
    expect(mockPersonsSvc.getTags).toHaveBeenCalledWith('p1', 'tag');
    expect(component['person']()?.first_name).toBe('John');
    expect(component['tags']()).toContain('volunteer');
    expect(component['payload']().first_name).toBe('John');
  });

  it('should format name properly', async () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('id', 'p1');
    void component.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    // Test computed value
    expect(component['formName']()).toBe('John A Doe');
    expect(component['formInitials']()).toBe('JA');
  });

  it('should save updates when in edit mode', async () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('id', 'p1');
    void component.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    component['payload'].set({
      ...component['payload'](),
      first_name: 'Johnny',
      assigned_to: '',
      company_id: '',
    });
    await component.save();

    expect(mockPersonsSvc.update).toHaveBeenCalled();
    const updateCallArg = mockPersonsSvc.update.mock.calls[0][1];
    expect(updateCallArg.first_name).toBe('Johnny');
    expect(updateCallArg.assigned_to).toBeNull();
    expect(updateCallArg.company_id).toBeNull();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith(expect.stringContaining('Saved'));
  });

  it('should add new person when in new mode', async () => {
    mockRoute.snapshot.paramMap.get.mockReturnValue(null);
    const fixtureNew = TestBed.createComponent(PersonForm);
    const componentNew = fixtureNew.componentInstance;
    fixtureNew.componentRef.setInput('mode', 'new');
    fixtureNew.componentRef.setInput('id', null);

    void componentNew.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    componentNew['payload'].set({
      ...componentNew['payload'](),
      first_name: 'Jane',
      last_name: 'Smith',
    });
    await componentNew.save();

    expect(mockPersonsSvc.add).toHaveBeenCalled();
    const addCallArg = mockPersonsSvc.add.mock.calls[0][0];
    expect(addCallArg.first_name).toBe('Jane');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith(expect.stringContaining('Added'));
  });

  it('should apply campaign standing after adding a new person', async () => {
    mockRoute.snapshot.paramMap.get.mockReturnValue(null);
    mockPersonsSvc.add.mockResolvedValueOnce({ id: 'new1', first_name: 'Jane', last_name: 'Smith' });
    const fixtureNew = TestBed.createComponent(PersonForm);
    const componentNew = fixtureNew.componentInstance;
    fixtureNew.componentRef.setInput('mode', 'new');
    fixtureNew.componentRef.setInput('id', null);

    void componentNew.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    componentNew['payload'].set({
      ...componentNew['payload'](),
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@example.com',
    });
    componentNew['draftSupport'].set('strong');
    componentNew['draftVoting'].set('will_vote');
    componentNew['draftSubscribe'].set(true);
    componentNew['draftDnc'].set(true);

    await componentNew.save();
    await new Promise((r) => setTimeout(r, 10));

    // do_not_contact rides along in the add payload (it is a plain person field).
    expect(mockPersonsSvc.add.mock.calls[0][0].do_not_contact).toBe(true);
    // Campaign-scoped facts + subscription are applied once the id exists.
    expect(mockCampaignsSvc.upsertPersonFact).toHaveBeenCalledWith(
      expect.objectContaining({
        person_id: 'new1',
        campaign_id: 'c1',
        support_level: 'strong',
        voting_status: 'will_vote',
      }),
    );
    expect(mockCampaignsSvc.setSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ person_id: 'new1', campaign_id: 'c1', status: 'subscribed' }),
    );
  });

  it('should not touch campaign services when no standing is set on add', async () => {
    mockRoute.snapshot.paramMap.get.mockReturnValue(null);
    mockPersonsSvc.add.mockResolvedValueOnce({ id: 'new2', first_name: 'Ann' });
    const fixtureNew = TestBed.createComponent(PersonForm);
    const componentNew = fixtureNew.componentInstance;
    fixtureNew.componentRef.setInput('mode', 'new');
    fixtureNew.componentRef.setInput('id', null);

    void componentNew.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    componentNew['payload'].set({ ...componentNew['payload'](), first_name: 'Ann' });
    await componentNew.save();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCampaignsSvc.upsertPersonFact).not.toHaveBeenCalled();
    expect(mockCampaignsSvc.setSubscription).not.toHaveBeenCalled();
  });

  it('should remove household address with confirmation', async () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('id', 'p1');
    void component.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    await component['removeAddress']();

    expect(mockConfirmDlg.confirm).toHaveBeenCalled();
    expect(mockPersonsSvc.removeHousehold).toHaveBeenCalledWith('p1');
    expect(component['addressString']()).toBeNull();
  });

  it('should detach a tag without any team cascade (volunteer is a status now, §15)', async () => {
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('id', 'p1');
    void component.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));

    await component['tagRemoved']('volunteer');

    expect(mockPersonsSvc.detachTag).toHaveBeenCalledWith('p1', 'volunteer', 'tag');
  });

  it('should assign new pending household if in new mode', async () => {
    mockRoute.snapshot.paramMap.get.mockReturnValue(null);
    const fixtureNew = TestBed.createComponent(PersonForm);
    const componentNew = fixtureNew.componentInstance;
    fixtureNew.componentRef.setInput('mode', 'new');
    fixtureNew.componentRef.setInput('id', null);

    void componentNew.ngOnInit();
    await new Promise((r) => setTimeout(r, 10));
    await componentNew['assignToHousehold']('h1');

    expect(componentNew['pendingHouseholdId']()).toBe('h1');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith(
      'Household selected. It will be saved when you add the person',
    );
    expect(mockPersonsSvc.update).not.toHaveBeenCalled();
  });
});
