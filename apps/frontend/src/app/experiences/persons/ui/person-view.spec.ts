import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { PersonView } from './person-view';
import { UserService } from '../../../services/user.service';
import { PersonsService } from '../services/persons-service';
import { HouseholdsService } from '../../households/services/households-service';
import { VolunteerService } from '../../../services/api/volunteer-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityService } from '@experiences/activity/services/activity.service';
import { DonationsService } from '../../../services/api/donations-service';
import { TagsService } from '@experiences/tags/services/tags-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { DeliveriesRequestsService } from '@experiences/deliveries/services/deliveries-requests-service';
import { AuthService } from '../../../auth/auth-service';
import { signal } from '@angular/core';

describe('PersonView', () => {
  let component: PersonView;
  let fixture: ComponentFixture<PersonView>;

  let mockAlertSvc: any;
  let mockUserService: any;
  let mockHouseholdsSvc: any;
  let mockPersonsSvc: any;
  let mockVolunteerSvc: any;
  let mockRoute: any;
  let mockRouter: any;
  let mockActivitySvc: any;
  let mockDonationsSvc: any;
  let mockTagsSvc: any;
  let mockCampaignContext: any;
  let mockDeliveriesSvc: any;

  beforeEach(async () => {
    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showInfo: vi.fn(),
    };

    mockUserService = {
      getUsers: vi.fn().mockResolvedValue([{ id: 'u1', first_name: 'Admin' }]),
    };

    mockHouseholdsSvc = {
      getById: vi.fn().mockResolvedValue({ street_num: '123', street1: 'Main St', city: 'City', state: 'NY' }),
    };

    mockActivitySvc = {
      getActivities: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
    };

    mockDonationsSvc = {
      getStats: vi.fn().mockResolvedValue({ cumulativeAmount: 100, limitAmount: 500, remainingAmount: 400 }),
      getHistory: vi.fn().mockResolvedValue([{ id: 'd1', amount: 50 }]),
      getPersonPledges: vi.fn().mockResolvedValue([]),
      getPortalLinkStatus: vi
        .fn()
        .mockResolvedValue({ live_count: 0, last_created_at: null, last_used_at: null, expires_at: null }),
    };

    mockTagsSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
      refreshCount: signal(0),
    };

    mockCampaignContext = {
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

    mockDeliveriesSvc = {
      getSignStatus: vi.fn().mockResolvedValue({ request: null, open_in_other_campaign: null }),
      add: vi.fn().mockResolvedValue({ id: 'dr1' }),
      setStatus: vi.fn().mockResolvedValue({ updated: 1 }),
    };

    mockPersonsSvc = {
      getById: vi.fn().mockResolvedValue({
        id: 'p1',
        first_name: 'John',
        middle_names: 'A',
        last_name: 'Doe',
        company_name: 'Acme Corp',
        linkedin: 'https://linkedin.com/in/johndoe',
      }),
      getTags: vi.fn().mockImplementation((id, type) => {
        if (type === 'tag') return Promise.resolve(['volunteer', 'donor']);
        return Promise.resolve(['environment']);
      }),
      getActivity: vi.fn().mockResolvedValue({
        emails: [{ id: 'e1', subject: 'Hello', from_email: 'john@example.com', to_email: 'admin@pplcrm.com' }],
        newsletters: [{ id: 'ne1', event_type: 'open', newsletter_subject: 'Newsletter #1' }],
      }),
    };

    mockVolunteerSvc = {
      getVolunteerStats: vi.fn().mockResolvedValue({ shifts_count: 5, total_hours: 15.5 }),
      getHistoryForPerson: vi.fn().mockResolvedValue([{ id: 's1', event_name: 'Cleanup', status: 'attended' }]),
    };

    mockRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn((key: string) => (key === 'id' ? 'p1' : null)),
        },
        queryParams: {},
      },
    };

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    await TestBed.configureTestingModule({
      imports: [PersonView],
      providers: [
        provideRouter([]),
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: UserService, useValue: mockUserService },
        { provide: HouseholdsService, useValue: mockHouseholdsSvc },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: VolunteerService, useValue: mockVolunteerSvc },
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: ActivityService, useValue: mockActivitySvc },
        { provide: DonationsService, useValue: mockDonationsSvc },
        { provide: TagsService, useValue: mockTagsSvc },
        { provide: CampaignContextService, useValue: mockCampaignContext },
        { provide: DeliveriesRequestsService, useValue: mockDeliveriesSvc },
        // The donor-portal panel on the Donations tab reads the demo-mode flag off the auth user.
        { provide: AuthService, useValue: { getUserSignal: () => signal(null) } },
      ],
    }).compileComponents();

    mockRouter = TestBed.inject(Router);
    vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);

    fixture = TestBed.createComponent(PersonView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'p1');
    fixture.detectChanges();
  });

  it('should load all details and activities on init', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['id']()).toBe('p1');
    expect(mockPersonsSvc.getById).toHaveBeenCalledWith('p1');
    expect(mockPersonsSvc.getTags).toHaveBeenCalledWith('p1', 'tag');
    expect(mockPersonsSvc.getTags).toHaveBeenCalledWith('p1', 'issue');
    expect(mockPersonsSvc.getActivity).toHaveBeenCalledWith('p1');
    expect(mockVolunteerSvc.getHistoryForPerson).toHaveBeenCalledWith('p1');

    expect(component['fullName']()).toBe('John A Doe');
    expect(component['initials']()).toBe('JD');
    expect(component['tags']()).toContain('volunteer');
    expect(component['issues']()).toContain('environment');
    expect(component['activityData']().emails).toHaveLength(1);
    expect(component['activityData']().newsletters).toHaveLength(1);
  });

  it('should copy text to clipboard and show success alert', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    component['copyToClipboard']('john@example.com', 'Email');
    await new Promise((r) => setTimeout(r, 10));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('john@example.com');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Email copied to clipboard');
  });

  it('derives donation method from the stored method column and receipt from REAL receipt coverage', () => {
    // The method column is the truth the /donations grid and the donor portal already show;
    // this tab must agree. Legacy rows without a method fall back to the session-id inference.
    expect(component['donationMethod']({ method: 'card', stripe_session_id: 'cs_1', pledge_id: 'pl_1' })).toBe(
      'Card · monthly',
    );
    expect(component['donationMethod']({ method: 'card', pledge_id: null })).toBe('Card');
    expect(component['donationMethod']({ method: 'cash', stripe_session_id: 'cs_1', pledge_id: null })).toBe('Cash');
    expect(component['donationMethod']({ method: 'bank_transfer', pledge_id: null })).toBe('Bank transfer');
    expect(component['donationMethod']({ stripe_session_id: 'cs_1', pledge_id: null })).toBe('Card');
    expect(component['donationMethod']({ stripe_session_id: null, pledge_id: null })).toBe('Manual');

    // A succeeded gift is NOT "Receipted" until a receipt actually covers it.
    expect(component['donationReceipt']({ status: 'succeeded', receipt_status: 'none' })).toEqual({
      label: 'No receipt',
      type: 'neutral',
    });
    expect(
      component['donationReceipt']({
        status: 'succeeded',
        receipt_status: 'receipted',
        receipt_number: 'R-2026-00007',
      }),
    ).toEqual({ label: 'R-2026-00007', type: 'success' });
    expect(component['donationReceipt']({ status: 'succeeded', receipt_status: 'cancelled' })).toEqual({
      label: 'Receipt cancelled',
      type: 'warning',
    });
    expect(component['donationReceipt']({ status: 'refunded', receipt_status: 'none' })).toEqual({
      label: 'Refunded',
      type: 'error',
    });
  });

  it('shows a Monthly donor chip when the person has an active pledge', async () => {
    mockDonationsSvc.getPersonPledges.mockResolvedValue([{ status: 'active' }]);
    fixture = TestBed.createComponent(PersonView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'p1');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 20));

    expect(component['hasActivePledge']()).toBe(true);
    expect(component['statusChip']()).toBe('Monthly donor');
  });

  it('derives the Volunteer chip from volunteer_status, not a tag (§15)', async () => {
    mockDonationsSvc.getHistory.mockResolvedValue([]);
    mockDonationsSvc.getPersonPledges.mockResolvedValue([]);
    fixture = TestBed.createComponent(PersonView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'p1');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 20));

    component['person'].set({ volunteer_status: 'active' });
    expect(component['statusChip']()).toBe('Volunteer');
    component['person'].set({ volunteer_status: 'former' });
    expect(component['statusChip']()).toBe('Former volunteer');
    component['person'].set({ volunteer_status: null, staff_status: 'active' });
    expect(component['statusChip']()).toBe('Staff');
  });

  it('shows the Giving band with the portal panel on the overview for a donor', async () => {
    // Default fixture has one donation, so the person IS a donor: the band renders on the
    // overview (no tab click needed) and the portal panel lives there — exactly once.
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 10));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent, 'expected the Giving band heading on the overview').toContain('Giving');
    expect(host.textContent, 'expected the total-given stat').toContain('Total given');
    const panels = host.querySelectorAll('pc-donor-portal-panel');
    expect(panels.length, 'expected the donor-portal panel exactly once (in the band)').toBe(1);
    expect(mockDonationsSvc.getPortalLinkStatus).toHaveBeenCalledWith('p1');
  });

  it('keeps the portal panel in the Donations tab for a person with no giving', async () => {
    mockDonationsSvc.getHistory.mockResolvedValue([]);
    mockDonationsSvc.getPersonPledges.mockResolvedValue([]);
    fixture = TestBed.createComponent(PersonView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'p1');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 20));

    expect(component['isDonor']()).toBe(false);
    component['activeTab'].set('donations');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 10));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const panels = host.querySelectorAll('pc-donor-portal-panel');
    expect(panels.length, 'expected the panel exactly once (in the tab, no band)').toBe(1);
  });

  it('maps the preferred contact channel to a human label', () => {
    component['person'].set({ preferred_contact: 'mobile' });
    expect(component['preferredContactLabel']()).toBe('Mobile phone');
    component['person'].set({ preferred_contact: null });
    expect(component['preferredContactLabel']()).toBeNull();
  });
});
