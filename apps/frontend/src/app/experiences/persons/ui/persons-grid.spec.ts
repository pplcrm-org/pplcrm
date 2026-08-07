import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { PersonsGrid } from './persons-grid';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { PersonsService } from '../services/persons-service';
import { HouseholdsService } from '../../households/services/households-service';
import { CompaniesService } from '../../companies/services/companies-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { DATA_GRID_CONFIG } from '@frontend/shared/components/datagrid/datagrid.tokens';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { AreaColumnsService } from '../../../services/area-columns.service';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

class MockPersonsService {
  deleteMany = vi.fn().mockResolvedValue(true);
  getAll = vi.fn().mockResolvedValue({ rows: [], count: 0 });
  count = vi.fn().mockResolvedValue(0);
  abort = vi.fn();
  refreshCount = signal(0);
  import = vi.fn();
}

/**
 * A provincial campaign in a city: its own seat map is ridings, and the workspace also holds the
 * municipal ward map. 'Riding' is this campaign's word for its own areas.
 */
const mockCampaignContext = {
  ensureLoaded: vi.fn().mockResolvedValue(undefined),
  activeCampaignId: () => 'c1',
  activeCampaign: () => ({ id: 'c1', name: 'Office' }),
  isArchivedContext: () => false,
  seatLabel: () => 'Riding',
  seatLabelPlural: () => 'Ridings',
  subdivisionLabel: () => 'Poll',
  subdivisionLabelPlural: () => 'Polls',
  activeSeatAreaNames: () => ['Milton'],
  seatTerritoryLabel: () => 'In your riding',
};

/** The two maps the workspace holds: the campaign's own riding map, and a ward map. */
const mockAreaColumns = {
  list: vi.fn().mockResolvedValue([
    { set_id: '1', field: 'area_set_1', label: 'Ridings', role: 'seat_area', is_seat_set: true },
    { set_id: '2', field: 'area_set_2', label: 'Wards', role: 'seat_area', is_seat_set: false },
  ]),
};

/**
 * Settle the two-step column build: the campaign context answers, then the boundary-map read does.
 * `whenStable` drains one continuation, so a second pass is what makes the per-map columns visible.
 */
async function settleColumns(fixture: ComponentFixture<PersonsGrid>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('PersonsGrid', () => {
  let component: PersonsGrid;
  let fixture: ComponentFixture<PersonsGrid>;

  let mockPersonsSvc: MockPersonsService;
  let mockDialogSvc: any;
  let mockAlertSvc: any;
  let mockTagOptionsSvc: any;

  beforeEach(async () => {
    mockPersonsSvc = new MockPersonsService();

    mockDialogSvc = {
      confirm: vi.fn(),
    };

    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    };

    mockTagOptionsSvc = {
      getTagNames: vi.fn().mockResolvedValue(['tag1', 'tag2']),
    };

    await TestBed.configureTestingModule({
      imports: [PersonsGrid],
      providers: [
        provideRouter([]),
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        {
          provide: DATA_GRID_CONFIG,
          useValue: {
            messages: {
              deleteConfirmTitle: 'Delete rows',
              deleteConfirmMessage: 'Confirm delete',
              deleteConfirmVariant: 'danger',
              deleteConfirmIcon: 'trash',
              deleteConfirmText: 'Delete',
              deleteCancelText: 'Cancel',
              deleteSuccess: 'Deleted successfully',
              deleteFailed: 'Delete failed',
            },
          },
        },
        { provide: AbstractAPIService, useValue: mockPersonsSvc },
        { provide: TagOptionsService, useValue: mockTagOptionsSvc },
        { provide: CampaignContextService, useValue: mockCampaignContext },
        { provide: AreaColumnsService, useValue: mockAreaColumns },
        // pc-grain-tabs injects Households/Companies services and calls count();
        // the count-sentence also calls countDistinctWards / countWithCompany.
        {
          provide: HouseholdsService,
          useValue: { count: () => Promise.resolve(0), countDistinctWards: () => Promise.resolve(0) },
        },
        {
          provide: CompaniesService,
          useValue: { count: () => Promise.resolve(0), countWithCompany: () => Promise.resolve(0) },
        },
      ],
    })
      .overrideComponent(PersonsGrid, {
        set: {
          providers: [{ provide: AbstractAPIService, useValue: mockPersonsSvc }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PersonsGrid);
    component = fixture.componentInstance;
  });

  it('should create and initialize columns', () => {
    expect(component).toBeTruthy();
    expect(component['col']).toBeDefined();
  });

  it('names the riding a person lives in, instead of answering yes or no', async () => {
    await settleColumns(fixture);
    const areaCol = component['col'].find((c) => c.field === 'electoral_area');
    // The area's own name, headed with the campaign's word for it. "Milton" says everything "Yes"
    // says and also answers the question for the people who live somewhere else.
    expect(areaCol?.headerName).toBe('Riding');
    expect(areaCol?.hide).toBe(false);
    // The yes/no column is still available, just no longer the only answer on screen.
    const seatCol = component['col'].find((c) => c.field === 'seat_status');
    expect(seatCol?.headerName).toBe('In your riding');
    expect(seatCol?.hide).toBe(true);
  });

  it('gives the ward map a column of its own, and the campaign map only one', async () => {
    await settleColumns(fixture);
    const fields = component['col'].map((c) => c.field);
    // The riding map IS the campaign's seat map, already shown as `electoral_area`.
    expect(fields).not.toContain('area_set_1');
    const wards = component['col'].find((c) => c.field === 'area_set_2');
    expect(wards?.headerName).toBe('Wards');
    // A ward elects a councillor, so it is shown rather than tucked into the column chooser.
    expect(wards?.hide).toBe(false);
  });

  it('hides the area column while the workspace holds no boundary map', async () => {
    mockAreaColumns.list.mockResolvedValueOnce([]);
    await settleColumns(fixture);
    const areaCol = component['col'].find((c) => c.field === 'electoral_area');
    expect(areaCol?.hide).toBe(true);
  });

  it('should stop deletion when first delete confirmation is rejected', async () => {
    const selected = [{ id: 'p1', first_name: 'John' }];
    mockDialogSvc.confirm.mockResolvedValue(false); // User clicks cancel

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true);
    expect(mockDialogSvc.confirm).toHaveBeenCalledTimes(1);
    expect(mockPersonsSvc.deleteMany).not.toHaveBeenCalled();
  });

  it('should execute deleteMany without force on successful initial confirmation', async () => {
    const selected = [{ id: 'p1', first_name: 'John' }];
    mockDialogSvc.confirm.mockResolvedValue(true); // User clicks confirm

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true);
    expect(mockDialogSvc.confirm).toHaveBeenCalledTimes(1);
    expect(mockPersonsSvc.deleteMany).toHaveBeenCalledWith(['p1'], undefined, true);
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Deleted successfully');
  });

  it('should show team captain warning on exception and retry with force if approved', async () => {
    const selected = [{ id: 'p1', first_name: 'Captain Jack' }];
    mockDialogSvc.confirm
      .mockResolvedValueOnce(true) // Initial confirm
      .mockResolvedValueOnce(true); // Captain warning confirm

    // Simulate TRPC failure for team captain
    const captainError = new Error(
      'One or more selected people are team captains. Deleting them will remove them as captain. Do you want to proceed?',
    );
    mockPersonsSvc.deleteMany
      .mockRejectedValueOnce(captainError) // First call fails
      .mockResolvedValueOnce(true); // Second forced call succeeds

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true);
    expect(mockDialogSvc.confirm).toHaveBeenCalledTimes(2);
    expect(mockPersonsSvc.deleteMany).toHaveBeenNthCalledWith(1, ['p1'], undefined, true);
    expect(mockPersonsSvc.deleteMany).toHaveBeenNthCalledWith(2, ['p1'], true, true);
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Deleted successfully');
  });

  it('should not retry deletion if team captain warning is rejected', async () => {
    const selected = [{ id: 'p1', first_name: 'Captain Jack' }];
    mockDialogSvc.confirm
      .mockResolvedValueOnce(true) // Initial confirm
      .mockResolvedValueOnce(false); // Captain warning reject

    const captainError = new Error(
      'One or more selected people are team captains. Deleting them will remove them as captain. Do you want to proceed?',
    );
    mockPersonsSvc.deleteMany.mockRejectedValueOnce(captainError);

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true);
    expect(mockDialogSvc.confirm).toHaveBeenCalledTimes(2);
    expect(mockPersonsSvc.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPersonsSvc.deleteMany).toHaveBeenCalledWith(['p1'], undefined, true);
    expect(mockAlertSvc.showSuccess).not.toHaveBeenCalled();
  });
});
