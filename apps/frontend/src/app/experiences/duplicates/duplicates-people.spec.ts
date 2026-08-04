import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { DuplicatesService } from './services/duplicates-service';
import { PeopleDuplicatesComponent } from './duplicates-people';

const person1 = {
  id: 'p1',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com',
  mobile: null,
  any_electoral_area: null,
  tags: [],
  created_at: '2024-01-01T00:00:00Z',
};

const person2 = {
  id: 'p2',
  first_name: 'Johnny',
  last_name: 'Doe',
  email: 'john@example.com',
  mobile: null,
  any_electoral_area: null,
  tags: [],
  created_at: '2024-02-01T00:00:00Z',
};

describe('PeopleDuplicatesComponent', () => {
  let component: PeopleDuplicatesComponent;
  let fixture: ComponentFixture<PeopleDuplicatesComponent>;
  let mockPersonsSvc: any;
  let mockAlertSvc: any;
  let mockDialogSvc: any;
  let mockDuplicatesSvc: any;

  beforeEach(async () => {
    mockPersonsSvc = {
      getPotentialDuplicates: vi.fn().mockResolvedValue({
        groups: [{ reason: 'Same email', group_key: 'gk1', persons: [person1, person2] }],
        total: 1,
      }),
      mergePersons: vi.fn().mockResolvedValue({ id: 'p1' }),
      mergeWarning: vi.fn().mockResolvedValue(null),
    };

    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    mockDialogSvc = {
      confirm: vi.fn().mockResolvedValue(true),
    };

    mockDuplicatesSvc = {
      getSweepInfo: vi.fn().mockResolvedValue({ lastSweepAt: null, queueCount: 1 }),
      countQueue: vi.fn().mockResolvedValue(1),
      dismissGroup: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [PeopleDuplicatesComponent],
      providers: [
        provideRouter([]),
        { provide: DuplicatesService, useValue: mockDuplicatesSvc },
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PeopleDuplicatesComponent);
    component = fixture.componentInstance;
  });

  it('should load duplicate groups on init and pre-select target/source by earliest created_at', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockPersonsSvc.getPotentialDuplicates).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
    expect(component.totalGroups()).toBe(1);
    expect(component.groups()).toHaveLength(1);

    const [group] = component.groups();
    expect(group?.reason).toBe('Same email');
    expect(group?.items).toEqual([person1, person2]);
    // person1 was created earlier, so it should be the pre-selected target (keep) and person2 the source (merge)
    expect(group?.selectedTargetId).toBe('p1');
    expect(group?.selectedSourceId).toBe('p2');
  });

  it('should show an alert and stop loading when fetching duplicates fails', async () => {
    mockPersonsSvc.getPotentialDuplicates.mockRejectedValue(new Error('network error'));

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Failed to fetch person duplicates');
    expect(component.isLoading()).toBe(false);
    expect(component.groups()).toEqual([]);
  });

  it('should update selected target/source roles and clear conflicting selection', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    // Selecting p2 as target should clear it from being the source
    component.selectRole(0, 'p2', 'target');

    const [group] = component.groups();
    expect(group?.selectedTargetId).toBe('p2');
    expect(group?.selectedSourceId).toBeUndefined();
  });

  it('should merge the selected pair, show success, and remove the resolved group', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    await component.mergeGroup(0);

    expect(mockDialogSvc.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Confirm Merge', variant: 'warning' }),
    );
    expect(mockPersonsSvc.mergePersons).toHaveBeenCalledWith('p1', 'p2');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Successfully merged into "John Doe"');
    expect(component.groups()).toEqual([]);
    expect(component.totalGroups()).toBe(0);
  });

  it('should not merge when the confirmation dialog is rejected', async () => {
    mockDialogSvc.confirm.mockResolvedValue(false);

    fixture.detectChanges();
    await fixture.whenStable();

    await component.mergeGroup(0);

    expect(mockPersonsSvc.mergePersons).not.toHaveBeenCalled();
    expect(component.groups()).toHaveLength(1);
  });

  it('should surface the merge failure message from the service', async () => {
    mockPersonsSvc.mergePersons.mockRejectedValue(new Error('Cannot merge: person is a team captain'));

    fixture.detectChanges();
    await fixture.whenStable();

    await component.mergeGroup(0);

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Cannot merge: person is a team captain');
    expect(component.groups()).toHaveLength(1);
  });

  it('should advance and reload on nextPage while respecting totalPages bounds', async () => {
    mockPersonsSvc.getPotentialDuplicates.mockResolvedValue({
      groups: [{ reason: 'Same email', group_key: 'gk1', persons: [person1, person2] }],
      total: 25,
    });

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.totalPages()).toBe(3);
    component.nextPage();
    await fixture.whenStable();

    expect(component.currentPage()).toBe(2);
    expect(mockPersonsSvc.getPotentialDuplicates).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 });

    component.prevPage();
    await fixture.whenStable();
    expect(component.currentPage()).toBe(1);
  });

  it('should resolve a display name for a given item id via getDisplayNameForId', () => {
    expect(component.getDisplayNameForId([person1, person2], 'p2')).toBe('Johnny Doe');
    expect(component.getDisplayNameForId([person1, person2], undefined)).toBe('');
  });
  // Merging two people who both hold a companion volunteer record revokes one person's access to
  // the canvassing and delivery apps. The dialog has to say so before the operator commits.
  describe('companion access warning', () => {
    it('adds the warning to the confirmation message for this pair', async () => {
      mockPersonsSvc.mergeWarning.mockResolvedValue('Merging takes away Johnny Doe’s companion access.');

      fixture.detectChanges();
      await fixture.whenStable();

      await component.mergeGroup(0);

      expect(mockPersonsSvc.mergeWarning).toHaveBeenCalledWith('p1', 'p2', {
        target: 'John Doe',
        source: 'Johnny Doe',
      });
      const [opts] = mockDialogSvc.confirm.mock.calls[0];
      expect(opts.message).toContain('permanently delete this duplicate person');
      expect(opts.message).toContain('Merging takes away Johnny Doe’s companion access.');
    });

    it('leaves the confirmation alone when this pair has no consequence to report', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      await component.mergeGroup(0);

      const [opts] = mockDialogSvc.confirm.mock.calls[0];
      expect(opts.message).toContain('permanently delete this duplicate person');
      expect(opts.message).not.toContain('companion');
    });
  });
});
