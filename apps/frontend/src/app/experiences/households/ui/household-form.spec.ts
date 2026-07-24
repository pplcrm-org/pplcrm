import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Loader } from '@googlemaps/js-api-loader';
import { HouseholdsService } from '../services/households-service';
import { PersonsService } from '../../persons/services/persons-service';
import { TagsService } from '../../tags/services/tags-service';
import { HouseholdForm } from './household-form';
import type { AddressType } from '../../../../../../../libs/common/src/lib/kysely.models';

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

let component: HouseholdForm;
let fixture: ComponentFixture<HouseholdForm>;
let mockHouseholdsSvc: any;
let mockPersonsSvc: any;
let mockTagsSvc: any;
let mockAlertSvc: any;
let mockActivatedRoute: any;
let mockLoader: any;

const setupTestBed = async (mode: 'new' | 'edit') => {
  mockHouseholdsSvc = {
    getById: vi.fn().mockResolvedValue(mockHouseholdData),
    getTags: vi.fn().mockResolvedValue(['donor', 'volunteer']),
    getPeopleCount: vi.fn().mockResolvedValue(3),
    add: vi.fn().mockResolvedValue({ id: '456' }),
    update: vi.fn().mockResolvedValue(true),
    attachTag: vi.fn().mockResolvedValue(true),
    detachTag: vi.fn().mockResolvedValue(true),
    triggerRefresh: vi.fn(),
  };

  mockPersonsSvc = {
    getPeopleInHousehold: vi.fn().mockResolvedValue([]),
  };

  mockTagsSvc = {
    getAllWithCounts: vi.fn().mockResolvedValue([]),
    findByName: vi.fn().mockResolvedValue([]),
  };

  mockAlertSvc = {
    showSuccess: vi.fn(),
    showError: vi.fn(),
  };

  mockActivatedRoute = {
    snapshot: {
      paramMap: {
        get: vi.fn((key: string) => (key === 'id' && mode === 'edit' ? '123' : null)),
      },
    },
  };

  mockLoader = {
    importLibrary: vi.fn().mockResolvedValue(true),
  };

  await TestBed.configureTestingModule({
    imports: [HouseholdForm],
    providers: [
      provideRouter([]),
      { provide: HouseholdsService, useValue: mockHouseholdsSvc },
      { provide: PersonsService, useValue: mockPersonsSvc },
      { provide: TagsService, useValue: mockTagsSvc },
      { provide: AlertService, useValue: mockAlertSvc },
      { provide: ActivatedRoute, useValue: mockActivatedRoute },
      { provide: Loader, useValue: mockLoader },
    ],
  }).compileComponents();

  fixture = TestBed.createComponent(HouseholdForm);
  component = fixture.componentInstance;

  // Set component inputs
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('id', mode === 'edit' ? '123' : null);
};

// ngOnInit kicks off async work without returning a promise, so trigger it
// through change detection (inside the zone) and wait for stability.
const runInit = async (): Promise<void> => {
  fixture.detectChanges();
  await fixture.whenStable();
};

describe('HouseholdForm', () => {
  // Loader mock handles loading. No google.maps.places.Autocomplete mock needed.

  describe('new mode', () => {
    beforeEach(async () => {
      await setupTestBed('new');
    });

    it('should initialize with empty form payload and not call service getById', async () => {
      await runInit();
      fixture.detectChanges();

      expect(component).toBeTruthy();
      expect(component['id']()).toBeNull();
      expect(mockHouseholdsSvc.getById).not.toHaveBeenCalled();
      expect(component['payload']().city).toBe('');
      expect(component['form']().dirty()).toBe(false);
      expect(component['addressString']()).toBe('');
    });

    it('should call householdsSvc.add when saving new household', async () => {
      await runInit();
      fixture.detectChanges();

      component['payload'].update((prev) => ({
        ...prev,
        city: 'Vancouver',
        street1: 'Georgia St',
      }));

      // Trigger save
      void component['save']();

      // Wait for tRPC mock response
      await mockHouseholdsSvc.add.mock.results[0].value;
      fixture.detectChanges();

      expect(mockHouseholdsSvc.add).toHaveBeenCalledWith({
        home_phone: '',
        street_num: '',
        street1: 'Georgia St',
        street2: '',
        apt: '',
        city: 'Vancouver',
        state: '',
        zip: '',
        country: '',
        notes: '',
        formatted_address: null,
        type: null,
        lat: null,
        lng: null,
      });
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Household added successfully.');
      expect(mockHouseholdsSvc.triggerRefresh).toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    beforeEach(async () => {
      await setupTestBed('edit');
    });

    it('should load household details and tags on init', async () => {
      await runInit();
      fixture.detectChanges();

      expect(component).toBeTruthy();
      expect(component['id']()).toBe('123');
      expect(mockHouseholdsSvc.getById).toHaveBeenCalledWith('123');
      expect(mockHouseholdsSvc.getTags).toHaveBeenCalledWith('123', 'tag');

      const payload = component['payload']();
      expect(payload.city).toBe('Mountain View');
      expect(payload.street1).toBe('Amphitheatre Pkwy');
      expect(payload.notes).toBe('Google HQ');
      expect(component['tags']()).toEqual(expect.arrayContaining(['donor', 'volunteer']));
      expect(component['addressString']()).toBe('1600 Amphitheatre Pkwy, Mountain View, CA');
    });

    it('should dynamically update addressString when address components are modified', async () => {
      await runInit();
      fixture.detectChanges();

      expect(component['addressString']()).toBe('1600 Amphitheatre Pkwy, Mountain View, CA');

      // Clear formatted address and set custom components
      component['payload'].update((prev) => ({
        ...prev,
        formatted_address: '',
        apt: '4B',
        street_num: '123',
        street1: 'Main St',
        street2: 'Floor 2',
        city: 'Toronto',
        state: 'ON',
        zip: 'M5V 2N2',
        country: 'Canada',
      }));
      fixture.detectChanges();

      expect(component['addressString']()).toBe('Apt 4B 123 Main St Floor 2, Toronto, ON, M5V 2N2, Canada');
    });

    it('should update address details on handleAddressChange', async () => {
      await runInit();
      fixture.detectChanges();

      const mockAddress: AddressType = {
        street_num: '100',
        street1: 'Robson St',
        city: 'Vancouver',
        state: 'BC',
        country: 'CA',
        lat: 49.282,
        lng: -123.12,
        formatted_address: '100 Robson St, Vancouver, BC, Canada',
        type: 'street_address',
      };

      component.handleAddressChange(mockAddress);
      fixture.detectChanges();

      const payload = component['payload']();
      expect(payload.street_num).toBe('100');
      expect(payload.street1).toBe('Robson St');
      expect(payload.city).toBe('Vancouver');
      expect(payload.state).toBe('BC');
      expect(payload.country).toBe('CA');
      expect(payload.lat).toBe(49.282);
      expect(payload.lng).toBe(-123.12);
      expect(component['addressVerified']).toBe(true);
      expect(component['form']().dirty()).toBe(true);
    });

    it('should call householdsSvc.update when saving updated household', async () => {
      await runInit();
      fixture.detectChanges();

      // Modify payload values
      component['payload'].update((prev) => ({
        ...prev,
        notes: 'Updated Google HQ Note',
      }));

      // Trigger save
      void component['save']();

      // Wait for tRPC mock response
      await mockHouseholdsSvc.update.mock.results[0].value;
      fixture.detectChanges();

      expect(mockHouseholdsSvc.update).toHaveBeenCalledWith('123', {
        home_phone: '555-555-5555',
        street_num: '1600',
        street1: 'Amphitheatre Pkwy',
        street2: '',
        apt: 'Suite 100',
        city: 'Mountain View',
        state: 'CA',
        zip: '94043',
        country: 'US',
        notes: 'Updated Google HQ Note',
        formatted_address: '1600 Amphitheatre Pkwy, Mountain View, CA',
        type: 'street_address',
        lat: 37.422,
        lng: -122.084,
      });
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Household updated successfully.');
      expect(mockHouseholdsSvc.triggerRefresh).toHaveBeenCalled();
    });

    it('should call householdsSvc attachTag and detachTag when tag interactions occur', async () => {
      await runInit();
      fixture.detectChanges();

      void component['tagAdded']('new-tag');
      expect(mockHouseholdsSvc.attachTag).toHaveBeenCalledWith('123', 'new-tag', 'tag');

      void component['tagRemoved']('old-tag');
      expect(mockHouseholdsSvc.detachTag).toHaveBeenCalledWith('123', 'old-tag', 'tag');
    });
  });
});
