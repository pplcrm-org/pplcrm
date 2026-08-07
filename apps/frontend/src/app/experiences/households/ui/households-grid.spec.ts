import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HouseholdsGrid } from './households-grid';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { HouseholdsService } from '../services/households-service';
import { PersonsService } from '../../persons/services/persons-service';
import { CompaniesService } from '../../companies/services/companies-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { AreaColumnsService } from '../../../services/area-columns.service';
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
  /** The areas this campaign represents, deciding whether the territory column is shown at all. */
  activeSeatAreaNames: () => ['Ward 4'],
  /** Always the level's own word, plural once the seat is made of several areas. */
  seatTerritoryLabel: () => 'In your ward',
};

/**
 * The workspace's boundary maps, as the grid asks for them. Two here: the ward map the campaign
 * contests (already the `electoral_area` column, so it must not get a second one) and a polling
 * division map, which gets a column of its own. Every per-map column starts hidden.
 */
const mockAreaColumns = {
  list: vi.fn().mockResolvedValue([
    { set_id: '1', field: 'area_set_1', label: 'Wards', role: 'seat_area', is_seat_set: true },
    { set_id: '2', field: 'area_set_2', label: 'Polling divisions', role: 'subdivision', is_seat_set: false },
  ]),
};

/**
 * Settle the two-step column build: the campaign context answers, then the boundary-map read does.
 * `whenStable` drains one continuation, so a second pass is what makes the per-map columns and
 * `columnsReady` observable here.
 */
async function settleColumns(fixture: ComponentFixture<HouseholdsGrid>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await fixture.whenStable();
  fixture.detectChanges();
}

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
        { provide: AreaColumnsService, useValue: mockAreaColumns },
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

  it('heads the territory column with this level of government’s own word, not the area name', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const col = component['col'].find((c) => c.field === 'seat_status');
    expect(col?.headerName).toBe('In your ward');
    // Hidden by default: the District column beside it names the ward outright, which answers the
    // same question and also says which other ward a door outside yours is in.
    expect(col?.hide).toBe(true);
  });

  it('drops the territory column for an at-large office, which represents no single area', async () => {
    // A mayoral campaign runs city-wide. Every ward matters to it, so singling one out is wrong,
    // and an always-empty column in the chooser is worse than no column.
    mockCampaignContext.activeSeatAreaNames = () => [];
    try {
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component['col'].find((c) => c.field === 'seat_status')).toBeUndefined();
    } finally {
      mockCampaignContext.activeSeatAreaNames = () => ['Ward 4'];
    }
  });

  it('gives every boundary map its own column, except the one the campaign contests', async () => {
    await settleColumns(fixture);
    const fields = component['col'].map((c) => c.field);
    // The ward map IS the campaign's seat map, already shown as `electoral_area` under the word
    // "Ward" — a second column of the same area names would just repeat it.
    expect(fields).not.toContain('area_set_1');
    // The polling-division map is a different map, so it gets a column of its own, headed with the
    // map's own name and hidden by default, like every other per-map column.
    const polls = component['col'].find((c) => c.field === 'area_set_2');
    expect(polls?.headerName).toBe('Polling divisions');
    expect(polls?.hide).toBe(true);
  });

  it('shows only the District column once the workspace holds a boundary map', async () => {
    await settleColumns(fixture);
    // "District" lists every area a door falls in, so it is the one electoral column on screen.
    const anyCol = component['col'].find((c) => c.field === 'any_electoral_area');
    expect(anyCol?.headerName).toBe('District');
    expect(anyCol?.hide).toBe(false);
    // The campaign's own map repeats part of that same answer, so it waits in the column chooser.
    expect(component['col'].find((c) => c.field === 'electoral_area')?.hide).toBe(true);
  });

  it('hides the District column while the workspace holds no boundary map', async () => {
    mockAreaColumns.list.mockResolvedValueOnce([]);
    await settleColumns(fixture);
    // Nothing to fill it from, so every cell would be blank.
    expect(component['col'].find((c) => c.field === 'any_electoral_area')?.hide).toBe(true);
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
    await settleColumns(fixture);
    const areaCol = component['col'].find((c) => c.field === 'electoral_area');
    expect(areaCol?.headerName).toBe('Ward');
    expect(component['columnsReady']()).toBe(true);
  });

  it('still heads the electoral column from seatLabel() when the context load fails', async () => {
    // The fallback word lives in CampaignContextService (seatLabelFor resolves "District" via the
    // 'other' spec) — the grid holds no fallback string of its own, so even a failed load reads
    // whatever seatLabel() answers.
    mockCampaignContext.ensureLoaded.mockRejectedValueOnce(new Error('offline'));
    await settleColumns(fixture);
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
    await settleColumns(fixture);

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
