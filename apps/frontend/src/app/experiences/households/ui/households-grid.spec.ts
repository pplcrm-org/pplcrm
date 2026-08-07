import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HouseholdsGrid } from './households-grid';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { HouseholdsService } from '../services/households-service';
import { PersonsService } from '../../persons/services/persons-service';
import { CompaniesService } from '../../companies/services/companies-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { DATA_GRID_CONFIG } from '@frontend/shared/components/datagrid/datagrid.tokens';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

class MockHouseholdsService {
  deleteMany = vi.fn().mockResolvedValue(true);
  getAll = vi.fn().mockResolvedValue({ rows: [], count: 0 });
  count = vi.fn().mockResolvedValue(0);
  countDistinctAreas = vi.fn().mockResolvedValue(0);
  abort = vi.fn();
  refreshCount = signal(0);
}

/**
 * The grid names its electoral column with the active campaign's own word, so it needs the
 * campaign context. 'Ward' here stands for a municipal campaign; a federal one would say 'Riding'.
 */
const mockCampaignContext = {
  ensureLoaded: vi.fn().mockResolvedValue(undefined),
  activeCampaignId: () => 'c1',
  activeCampaign: () => ({ id: 'c1', name: 'Office' }),
  isArchivedContext: () => false,
  seatLabel: () => 'Ward',
  seatLabelPlural: () => 'Wards',
  subdivisionLabel: () => 'Poll',
  subdivisionLabelPlural: () => 'Polls',
  /** The seat this campaign contests, which decides whether the "in your seat" column is shown. */
  activeSeatName: () => 'Ward 4',
};

describe('HouseholdsGrid', () => {
  let component: HouseholdsGrid;
  let fixture: ComponentFixture<HouseholdsGrid>;

  let mockPersonsSvc: any;
  let mockDialogSvc: any;
  let mockAlertSvc: any;
  let mockHouseholdsSvc: any;
  let mockTagOptionsSvc: any;

  beforeEach(async () => {
    mockPersonsSvc = {
      getByHouseholdId: vi.fn().mockResolvedValue([{ id: 'person1' }, { id: 'person2' }]),
      removeHousehold: vi.fn().mockResolvedValue(true),
      deleteMany: vi.fn().mockResolvedValue(true),
      // pc-grain-tabs calls count() on all three grain services
      count: vi.fn().mockResolvedValue(0),
    };

    mockDialogSvc = {
      choose: vi.fn(),
    };

    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    };

    mockHouseholdsSvc = new MockHouseholdsService();

    mockTagOptionsSvc = {
      getTagNames: vi.fn().mockResolvedValue(['tag1', 'tag2']),
    };

    await TestBed.configureTestingModule({
      imports: [HouseholdsGrid],
      providers: [
        provideRouter([]),
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: HouseholdsService, useValue: mockHouseholdsSvc },
        {
          provide: CompaniesService,
          useValue: { count: () => Promise.resolve(0), countWithCompany: () => Promise.resolve(0) },
        },
        {
          provide: DATA_GRID_CONFIG,
          useValue: { messages: { loadFailed: 'Failed to load', noDeletePermission: 'No permission' } },
        },
        { provide: AbstractAPIService, useValue: mockHouseholdsSvc },
        { provide: TagOptionsService, useValue: mockTagOptionsSvc },
        { provide: CampaignContextService, useValue: mockCampaignContext },
      ],
    })
      .overrideComponent(HouseholdsGrid, {
        set: {
          providers: [{ provide: AbstractAPIService, useValue: mockHouseholdsSvc }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HouseholdsGrid);
    component = fixture.componentInstance;
  });

  it('should create and initialize columns', () => {
    expect(component).toBeTruthy();
    expect(component['col']).toBeDefined();
  });

  it('replaces the three fixed geography columns with the electoral-area pair', () => {
    const fields = component['col'].map((c) => c.field);
    expect(fields).toContain('electoral_area');
    expect(fields).toContain('any_electoral_area');
    // The old columns each held one answer, so a household in a riding and a ward lost one.
    expect(fields).not.toContain('district');
    expect(fields).not.toContain('precinct');
    expect(fields).not.toContain('ward');
  });

  it('offers an "in my seat" column headed with the seat the campaign contests', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const col = component['col'].find((c) => c.field === 'seat_status');
    expect(col?.headerName).toBe('In Ward 4');
    expect(col?.hide).toBe(false);
  });

  it('hides the "in my seat" column for an at-large office, which contests no single area', async () => {
    // A mayoral campaign runs city-wide. Every ward matters to it, so singling one out is wrong.
    mockCampaignContext.activeSeatName = () => null;
    try {
      fixture.detectChanges();
      await fixture.whenStable();
      const col = component['col'].find((c) => c.field === 'seat_status');
      expect(col?.hide).toBe(true);
    } finally {
      mockCampaignContext.activeSeatName = () => 'Ward 4';
    }
  });

  it('keeps "outside the map" distinct from "not looked yet"', () => {
    // Both show no area. Reporting a Vancouver address and an ungeocoded one the same way would
    // hide that one answer is final and the other is still coming.
    expect(component['formatSeatStatus']('in')).toBe('Yes');
    expect(component['formatSeatStatus']('other')).toBe('No — another area');
    expect(component['formatSeatStatus']('outside')).toBe('No — outside the map');
    expect(component['formatSeatStatus'](null)).toBe('');
    expect(component['formatSeatStatus']('unknown')).toBe('');
  });

  it('heads the electoral column with the active campaign’s own word', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const areaCol = component['col'].find((c) => c.field === 'electoral_area');
    expect(areaCol?.headerName).toBe('Ward');
    expect(component['columnsReady']()).toBe(true);
  });

  it('still heads the electoral column from seatLabel() when the context load fails', async () => {
    // The fallback word lives in CampaignContextService (seatLabelFor resolves "District" via the
    // 'other' spec) — the grid holds no fallback string of its own, so even a failed load reads
    // whatever seatLabel() answers.
    mockCampaignContext.ensureLoaded.mockRejectedValueOnce(new Error('offline'));
    fixture.detectChanges();
    await fixture.whenStable();
    const areaCol = component['col'].find((c) => c.field === 'electoral_area');
    expect(areaCol?.headerName).toBe('Ward');
    expect(component['columnsReady']()).toBe(true);
  });

  it('should return false (fallback to default) when selected households have no people', async () => {
    const selected = [{ id: '4080', persons_count: 0, is_placeholder: false }];
    const result = await component['confirmDelete'](selected);
    expect(result).toBe(false);
    expect(mockDialogSvc.choose).not.toHaveBeenCalled();
    expect(mockHouseholdsSvc.deleteMany).not.toHaveBeenCalled();
  });

  it('should block deletion and show an error when the placeholder household is selected', async () => {
    const selected = [{ id: '9999', persons_count: 3, is_placeholder: true }];
    const result = await component['confirmDelete'](selected);
    expect(result).toBe(true); // Handled — blocked
    expect(mockAlertSvc.showError).toHaveBeenCalledWith(expect.stringContaining('placeholder'));
    expect(mockDialogSvc.choose).not.toHaveBeenCalled();
    expect(mockHouseholdsSvc.deleteMany).not.toHaveBeenCalled();
  });

  it('should prompt user when selected households have people', async () => {
    const selected = [{ id: '4081', persons_count: '2', is_placeholder: false }];
    mockDialogSvc.choose.mockResolvedValue(null); // User cancels

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true); // Handled
    expect(mockPersonsSvc.getByHouseholdId).toHaveBeenCalledWith('4081', { columns: ['id'] });
    expect(mockDialogSvc.choose).toHaveBeenCalled();
    expect(mockHouseholdsSvc.deleteMany).not.toHaveBeenCalled();
  });

  it('should detach people and delete households when user chooses keep-people', async () => {
    const selected = [{ id: '4081', persons_count: 2, is_placeholder: false }];
    mockDialogSvc.choose.mockResolvedValue('keep-people');

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true);
    expect(mockPersonsSvc.removeHousehold).toHaveBeenCalledWith('person1');
    expect(mockPersonsSvc.removeHousehold).toHaveBeenCalledWith('person2');
    expect(mockHouseholdsSvc.deleteMany).toHaveBeenCalledWith(['4081']);
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Households deleted successfully.');
  });

  it('should delete people and delete households when user chooses delete-people', async () => {
    const selected = [{ id: '4081', persons_count: 2, is_placeholder: false }];
    mockDialogSvc.choose.mockResolvedValue('delete-people');

    const result = await component['confirmDelete'](selected);

    expect(result).toBe(true);
    expect(mockPersonsSvc.deleteMany).toHaveBeenCalledWith(['person1', 'person2']);
    expect(mockHouseholdsSvc.deleteMany).toHaveBeenCalledWith(['4081']);
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Households deleted successfully.');
  });

  it('should prevent selection of placeholder households via rowCanSelectFn', () => {
    expect(component.rowCanSelectFn({ is_placeholder: true })).toBe(false);
    expect(component.rowCanSelectFn({ is_placeholder: false })).toBe(true);
  });

  it('should render the Household door as "People with no addresses" for placeholder households', () => {
    const doorCol = component['col'].find((c) => c.field === 'household');
    expect(doorCol).toBeDefined();
    expect(doorCol?.valueGetter).toBeDefined();

    const placeholder = doorCol?.valueGetter?.({ data: { is_placeholder: true } } as any);
    expect(placeholder).toBe('People with no addresses');

    const regular = doorCol?.valueGetter?.({
      data: { is_placeholder: false, street_num: '123', street1: 'Main St' },
    } as any);
    expect(regular).toBe('123 Main St');
  });

  it('should prevent inline editing for placeholder households', async () => {
    // The grid is created only after the campaign context answers, because its column headings
    // carry the campaign's own word for an electoral area and the grid copies its column
    // definitions once. So this waits for that load before reaching for the grid.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const cityCol = component['col'].find((c) => c.field === 'city');
    expect(cityCol).toBeDefined();

    const grid = component['grid']();
    expect(grid).toBeDefined();

    // With a placeholder household, editing should be disabled
    const placeholderCfg = grid!.editableCfg({ is_placeholder: true }, cityCol);
    expect(placeholderCfg.isEditable()).toBe(false);

    // With a regular household, editing should be enabled
    const regularCfg = grid!.editableCfg({ is_placeholder: false }, cityCol);
    expect(regularCfg.isEditable()).toBe(true);
  });
});
