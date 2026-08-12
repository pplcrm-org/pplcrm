import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Loader } from '@googlemaps/js-api-loader';
import { HouseholdsService } from '../services/households-service';
import { HouseholdView } from './household-view';
import { UserService } from '../../../services/user.service';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { ActivityService } from '@experiences/activity/services/activity.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { DeliveriesRequestsService } from '@experiences/deliveries/services/deliveries-requests-service';

const mockHouseholdData = {
  id: '123',
  street_num: '1600',
  street1: 'Amphitheatre Pkwy',
  street2: '',
  apt: 'Suite 100',
  city: 'Mountain View',
  state: 'CA',
  zip: '94043',
  country: 'US',
  home_phone: '555-555-5555',
  notes: 'Google HQ',
  formatted_address: '1600 Amphitheatre Pkwy, Mountain View, CA',
  lat: 37.422,
  lng: -122.084,
  type: 'street_address',
  created_at: '2026-05-20T12:00:00Z',
  updated_at: '2026-05-20T13:00:00Z',
};

let component: HouseholdView;
let fixture: ComponentFixture<HouseholdView>;
let mockHouseholdsSvc: any;
let mockAlertSvc: any;
let mockActivatedRoute: any;
let mockLoader: any;
let mockUserService: any;
let mockPersonsSvc: any;
let mockActivitySvc: any;
let mockCampaignContext: any;
let mockDeliveriesSvc: any;

describe('HouseholdView', () => {
  beforeEach(async () => {
    mockUserService = {
      getUsers: vi.fn().mockResolvedValue([{ id: 'u1', first_name: 'Admin' }]),
    };

    mockHouseholdsSvc = {
      getById: vi.fn().mockResolvedValue(mockHouseholdData),
      getPeopleCount: vi.fn().mockResolvedValue(3),
      getLastCanvass: vi.fn().mockResolvedValue(null),
    };

    mockPersonsSvc = {
      getByHouseholdId: vi.fn().mockResolvedValue([]),
      getPeopleInHousehold: vi.fn().mockResolvedValue([]),
    };

    mockActivitySvc = {
      getActivities: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
    };

    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
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

    mockActivatedRoute = {
      snapshot: {
        paramMap: {
          get: vi.fn((key: string) => (key === 'id' ? '123' : null)),
        },
      },
    };

    mockLoader = {
      importLibrary: vi.fn().mockImplementation((name: string) => {
        if (name === 'marker') {
          return Promise.resolve({
            AdvancedMarkerElement: vi.fn().mockImplementation(() => ({})),
          });
        }
        return Promise.resolve({
          Map: vi.fn().mockImplementation(() => ({})),
        });
      }),
    };

    // Mock global google maps namespace
    global.google = {
      maps: {
        Map: vi.fn().mockImplementation(() => ({})),
        Marker: vi.fn().mockImplementation(() => ({})),
        marker: {
          AdvancedMarkerElement: vi.fn().mockImplementation(() => ({})),
        },
      },
    } as any;

    await TestBed.configureTestingModule({
      imports: [HouseholdView],
      providers: [
        provideRouter([]),
        { provide: HouseholdsService, useValue: mockHouseholdsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: Loader, useValue: mockLoader },
        { provide: UserService, useValue: mockUserService },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: ActivityService, useValue: mockActivitySvc },
        { provide: CampaignContextService, useValue: mockCampaignContext },
        { provide: DeliveriesRequestsService, useValue: mockDeliveriesSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdView);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', '123');
    fixture.detectChanges();
  });

  it('should initialize and load household details, people count, and last canvass', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component['id']()).toBe('123');
    expect(mockHouseholdsSvc.getById).toHaveBeenCalledWith('123');
    expect(mockHouseholdsSvc.getPeopleCount).toHaveBeenCalledWith('123');
    expect(mockHouseholdsSvc.getLastCanvass).toHaveBeenCalledWith('123');

    expect(component['household']()).toEqual(mockHouseholdData);
    expect(component['peopleCount']()).toBe(3);
    expect(component['addressString']()).toBe('1600 Amphitheatre Pkwy, Mountain View, CA');
  });

  it('adds a "Canvassed" segment to the subtitle only when a knock exists', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    // No canvass mocked → subtitle has no "Canvassed" segment.
    expect(component['subtitle']()).not.toContain('Canvassed');

    component['lastCanvass'].set({
      knocked_at: new Date('2026-05-02T12:00:00Z'),
      canvasser_name: 'Dana',
      outcome: 'home',
    });
    expect(component['subtitle']()).toContain('Canvassed');
    // The endpoint's outcome and canvasser fields render too — they used to be discarded.
    expect(component['subtitle']()).toContain('home, by Dana');

    // "conversation" reads as "spoke" in the subtitle.
    component['lastCanvass'].set({
      knocked_at: new Date('2026-05-02T12:00:00Z'),
      canvasser_name: null,
      outcome: 'conversation',
    });
    expect(component['subtitle']()).toContain('spoke');
    expect(component['subtitle']()).not.toContain('by ');
  });

  it('should format addressString from individual fields when formatted_address is empty', async () => {
    await fixture.whenStable();
    fixture.detectChanges();

    component['household'].set({
      ...mockHouseholdData,
      formatted_address: '',
      apt: '2B',
      street_num: '10',
      street1: 'Pine St',
      street2: '',
      city: 'Seattle',
      state: 'WA',
      zip: '98101',
      country: 'USA',
    });
    fixture.detectChanges();

    expect(component['addressString']()).toBe('Apt 2B 10 Pine St, Seattle, WA, 98101, USA');
  });
});
