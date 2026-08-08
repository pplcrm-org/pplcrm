import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ShiftFormComponent } from './shift-form';
import { ShiftsService } from '../services/shifts-service';
import { VolunteerService } from '../../../services/api/volunteer-service';
import { PersonsService } from '../../persons/services/persons-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';

const validPayload = {
  name: 'Weekend Canvass',
  slug: 'weekend-canvass',
  description: '',
  location_address: '',
  start_time: '2026-08-01T09:00',
  end_time: '2026-08-01T12:00',
  capacity: null as number | null,
  contact_email: '',
  contact_phone: '',
  is_private: false,
  send_reminder: true,
  send_signup_confirmation: true,
  send_volunteer_alert: true,
};

describe('ShiftFormComponent', () => {
  let component: ShiftFormComponent;
  let fixture: ComponentFixture<ShiftFormComponent>;
  let mockShiftsSvc: any;
  let mockVolunteerSvc: any;
  let mockPersonsSvc: any;
  let mockAlertSvc: any;
  let mockRouter: any;
  let mockConfirmDialogSvc: any;

  beforeEach(() => {
    mockShiftsSvc = {
      getById: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      triggerRefresh: vi.fn(),
      checkSlugUnique: vi.fn().mockResolvedValue({ unique: true }),
    };

    mockVolunteerSvc = {
      getShiftsForEvent: vi.fn().mockResolvedValue([]),
      signupVolunteer: vi.fn(),
      updateShift: vi.fn(),
      deleteShift: vi.fn(),
    };

    mockPersonsSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
    };

    mockAlertSvc = { showError: vi.fn(), showSuccess: vi.fn() };
    mockRouter = { navigate: vi.fn() };
    mockConfirmDialogSvc = { confirm: vi.fn().mockResolvedValue(true) };
  });

  async function createComponent(id?: string) {
    await TestBed.configureTestingModule({
      imports: [ShiftFormComponent],
      providers: [
        { provide: ShiftsService, useValue: mockShiftsSvc },
        { provide: VolunteerService, useValue: mockVolunteerSvc },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: {} },
        { provide: ConfirmDialogService, useValue: mockConfirmDialogSvc },
      ],
    })
      .overrideComponent(ShiftFormComponent, {
        set: { providers: [{ provide: VolunteerService, useValue: mockVolunteerSvc }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ShiftFormComponent);
    component = fixture.componentInstance;
    if (id) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
  }

  it('should initialize an empty form in new mode and load the volunteer list', async () => {
    mockPersonsSvc.getAll.mockResolvedValue({ rows: [{ id: 'v1', first_name: 'Vera' }], count: 1 });

    await createComponent();
    await fixture.whenStable();

    expect(component['isNew']()).toBe(true);
    expect(mockShiftsSvc.getById).not.toHaveBeenCalled();
    expect(mockPersonsSvc.getAll).toHaveBeenCalledWith({ limit: 1000, tags: ['volunteer'] });
    expect(component['allVolunteers']()).toEqual([{ id: 'v1', first_name: 'Vera' }]);
  });

  it('should load an existing volunteer event and its roster in edit mode', async () => {
    const mockEvent = {
      id: 'v-1',
      name: 'Weekend Canvass',
      slug: 'weekend-canvass',
      description: 'Door knocking',
      location_address: 'Central Park',
      start_time: '2026-08-01T09:00:00Z',
      end_time: '2026-08-01T12:00:00Z',
      capacity: 20,
      is_private: false,
    };
    mockShiftsSvc.getById.mockResolvedValue(mockEvent);
    mockVolunteerSvc.getShiftsForEvent.mockResolvedValue([{ id: 's1', person_id: 'p1', first_name: 'Jane' }]);

    await createComponent('v-1');
    await fixture.whenStable();
    await component['loadRoster']();

    expect(mockShiftsSvc.getById).toHaveBeenCalledWith('v-1');
    expect(component['payload']().name).toBe('Weekend Canvass');
    expect(component['payload']().capacity).toBe(20);
    expect(component['roster']()).toEqual([{ id: 's1', person_id: 'p1', first_name: 'Jane' }]);
  });

  it('should not save when the form is invalid', async () => {
    await createComponent();
    await fixture.whenStable();

    expect(component['form']().invalid()).toBe(true);

    await component['save']();

    expect(mockShiftsSvc.add).not.toHaveBeenCalled();
  });

  it('should block saving when the end time is before the start time', async () => {
    await createComponent();
    await fixture.whenStable();

    component['payload'].set({ ...validPayload, start_time: '2026-08-01T12:00', end_time: '2026-08-01T09:00' });

    await component['save']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(
      'The event cannot end before it starts, please check the dates and times again.',
    );
    expect(mockShiftsSvc.add).not.toHaveBeenCalled();
  });

  it('should block saving when the slug is already in use', async () => {
    await createComponent();
    await fixture.whenStable();

    component['payload'].set(validPayload);
    component['slugUnique'].set(false);

    await component['save']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(
      'This URL slug is already in use. Please choose a different one.',
    );
    expect(mockShiftsSvc.add).not.toHaveBeenCalled();
  });

  it('should add a new volunteer event and navigate to it on success', async () => {
    mockShiftsSvc.add.mockResolvedValue({ id: 'new-event-id' });

    await createComponent();
    await fixture.whenStable();

    component['payload'].set(validPayload);

    await component['save']();

    expect(mockShiftsSvc.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Weekend Canvass', slug: 'weekend-canvass' }),
    );
    expect(mockShiftsSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Event created successfully');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/events/shifts', 'new-event-id']);
  });

  it('should update an existing volunteer event and navigate back to it on success', async () => {
    mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass', slug: 'weekend-canvass' });
    mockShiftsSvc.update.mockResolvedValue(undefined);

    await createComponent('v-1');
    await fixture.whenStable();

    component['payload'].set({ ...validPayload, name: 'Weekend Canvass Updated' });

    await component['save']();

    expect(mockShiftsSvc.update).toHaveBeenCalledWith(
      'v-1',
      expect.objectContaining({ name: 'Weekend Canvass Updated' }),
    );
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Event updated successfully');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/events/shifts', 'v-1']);
  });

  describe('roster management', () => {
    it('should add a volunteer to the roster and reload it', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });
      mockVolunteerSvc.signupVolunteer.mockResolvedValue({ id: 's1' });
      mockVolunteerSvc.getShiftsForEvent.mockResolvedValue([{ id: 's1', first_name: 'Vera' }]);

      await createComponent('v-1');
      await fixture.whenStable();

      await component['addVolunteer']({ id: 'v1', first_name: 'Vera' });

      expect(mockVolunteerSvc.signupVolunteer).toHaveBeenCalledWith({
        event_id: 'v-1',
        person_id: 'v1',
        status: 'signed_up',
      });
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Vera added to roster');
      expect(component['roster']()).toEqual([{ id: 's1', first_name: 'Vera' }]);
    });

    it('should filter out volunteers already on the roster from search results', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });
      mockPersonsSvc.getAll.mockResolvedValue({
        rows: [
          { id: 'v1', first_name: 'Vera', last_name: 'Volunteer', email: 'vera@example.com' },
          { id: 'v2', first_name: 'Victor', last_name: 'Volunteer', email: 'victor@example.com' },
        ],
      });
      mockVolunteerSvc.getShiftsForEvent.mockResolvedValue([{ id: 's1', person_id: 'v1' }]);

      await createComponent('v-1');
      await fixture.whenStable();
      await component['loadVolunteers']();
      await component['loadRoster']();

      component['volunteerSearch'].set('vera');
      expect(component['volunteerSearchResults']()).toEqual([]);

      component['volunteerSearch'].set('victor');
      expect(component['volunteerSearchResults']()[0]?.id).toBe('v2');
    });

    it('should remove a volunteer after confirmation', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });
      mockVolunteerSvc.deleteShift.mockResolvedValue(true);

      await createComponent('v-1');
      await fixture.whenStable();

      await component['removeVolunteer']({ id: 's1' });

      expect(mockConfirmDialogSvc.confirm).toHaveBeenCalled();
      expect(mockVolunteerSvc.deleteShift).toHaveBeenCalledWith('s1');
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Volunteer removed');
    });

    it('should not remove a volunteer when the confirmation dialog is cancelled', async () => {
      mockConfirmDialogSvc.confirm.mockResolvedValue(false);

      await createComponent('v-1');
      await fixture.whenStable();

      await component['removeVolunteer']({ id: 's1' });

      expect(mockVolunteerSvc.deleteShift).not.toHaveBeenCalled();
    });

    it('should save shift details for a roster entry', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });
      mockVolunteerSvc.updateShift.mockResolvedValue(true);

      await createComponent('v-1');
      await fixture.whenStable();

      await component['saveShiftDetails']({ id: 's1', status: 'attended', hours_worked: '3', notes: 'Great job' });

      expect(mockVolunteerSvc.updateShift).toHaveBeenCalledWith('s1', {
        status: 'attended',
        hours_worked: 3,
        notes: 'Great job',
      });
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Shift details saved');
    });

    it('should save a typed zero hours as 0, not null', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });
      mockVolunteerSvc.updateShift.mockResolvedValue(true);

      await createComponent('v-1');
      await fixture.whenStable();

      await component['saveShiftDetails']({ id: 's1', status: 'attended', hours_worked: 0, notes: '' });

      expect(mockVolunteerSvc.updateShift).toHaveBeenCalledWith('s1', {
        status: 'attended',
        hours_worked: 0,
        notes: null,
      });
    });
  });

  describe('deleteEvent', () => {
    it('should delete the volunteer event and navigate back to the list on confirm', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });
      mockShiftsSvc.delete.mockResolvedValue(true);

      await createComponent('v-1');
      await fixture.whenStable();

      await component['deleteEvent']();

      expect(mockShiftsSvc.delete).toHaveBeenCalledWith('v-1');
      expect(mockShiftsSvc.triggerRefresh).toHaveBeenCalled();
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Event deleted');
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/forms']);
    });
  });

  describe('canDeactivate', () => {
    it('should allow navigation without prompting when nothing has changed', async () => {
      mockShiftsSvc.getById.mockResolvedValue({ id: 'v-1', name: 'Weekend Canvass' });

      await createComponent('v-1');
      await fixture.whenStable();

      const result = await component['canDeactivate']();

      expect(result).toBe(true);
      expect(mockConfirmDialogSvc.confirm).not.toHaveBeenCalled();
    });
  });

  describe('utility helpers', () => {
    it('should slugify event names', async () => {
      await createComponent();
      await fixture.whenStable();

      expect(component['slugify']('Weekend Canvass!')).toBe('weekend-canvass');
    });
  });
});
