import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ListsGridComponent } from './lists-grid';
import { ListsRefreshService } from '@experiences/lists/services/lists-refresh.service';
import { ListsService } from '@experiences/lists/services/lists-service';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { DATA_GRID_CONFIG } from '@frontend/shared/components/datagrid/datagrid.tokens';
import { describe, it, expect, vi, beforeEach } from 'vitest';

class MockApiService {
  refreshCount = signal(0);
  getAll = vi.fn().mockResolvedValue({ rows: [], totalCount: 0 });
  abort = vi.fn();
}

/**
 * The Definition column renders a stored rule set as a sentence, and a rule on the single-valued
 * electoral field is named with the active campaign's own word, so the grid needs the context.
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
};

describe('ListsGridComponent', () => {
  let component: ListsGridComponent;
  let fixture: ComponentFixture<ListsGridComponent>;

  let mockRefreshSvc: any;
  let mockApiSvc: any;
  let mockTagOptionsSvc: any;
  let refreshCount: ReturnType<typeof signal<number>>;

  beforeEach(async () => {
    refreshCount = signal(0);

    mockRefreshSvc = {
      refreshCount,
    };

    mockApiSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      refreshCount: signal(0),
    };
    // The component also injects the concrete ListsService for its counts sentence
    // (ngOnInit → loadCounts → getAll). Without this mock the real service fires a live
    // tRPC query whose rejection can escape the test as a flaky unhandled error.
    const mockListsSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      refreshCount: signal(0),
    };

    mockTagOptionsSvc = {
      getTagNames: vi.fn().mockResolvedValue(['tag1', 'tag2']),
    };

    await TestBed.configureTestingModule({
      imports: [ListsGridComponent],
      providers: [
        provideRouter([]),

        { provide: ConfirmDialogService, useValue: { confirm: vi.fn() } },
        { provide: DATA_GRID_CONFIG, useValue: { messages: { loadFailed: 'Failed to load' } } },
        { provide: ListsRefreshService, useValue: mockRefreshSvc },
        { provide: ListsService, useValue: mockListsSvc },
        { provide: AbstractAPIService, useValue: mockApiSvc },
        { provide: TagOptionsService, useValue: mockTagOptionsSvc },
        { provide: CampaignContextService, useValue: mockCampaignContext },
      ],
    })
      .overrideComponent(ListsGridComponent, {
        set: { providers: [{ provide: AbstractAPIService, useClass: MockApiService }] },
      }) // Override component provider
      .compileComponents();

    fixture = TestBed.createComponent(ListsGridComponent);
    component = fixture.componentInstance;
  });

  it('should create and initialize columns', () => {
    expect(component).toBeTruthy();
    expect(component['col']).toBeDefined();
    // Spec table: List · Type · Of · Definition · Members · Last used in · Updated.
    expect(component['col'].length).toBe(7);
  });

  it('renders the Type chip as Smart / Static', () => {
    const typeCol = component['col'].find((c) => c.field === 'is_dynamic');
    const renderer = typeCol?.cellRenderer as (params: any) => string;
    expect(renderer).toBeDefined();
    expect(renderer({ data: { is_dynamic: true }, value: true })).toContain('Smart');
    expect(renderer({ data: { is_dynamic: false }, value: false })).toContain('Static');
  });

  it('shows the Members count as a number for both smart and static lists', () => {
    const membersCol = component['col'].find((c) => c.field === 'list_size');
    const formatter = membersCol?.valueFormatter as (params: any) => any;
    expect(formatter).toBeDefined();

    // Smart lists persist members after refresh — show the real count, not N/A.
    expect(formatter({ data: { is_dynamic: true }, value: 10 })).toBe('10');
    // Static list
    expect(formatter({ data: { is_dynamic: false }, value: 42 })).toBe('42');
    expect(formatter({ data: {}, value: null })).toBe('0');
  });

  it('should call refresh when refreshCount signal increments', async () => {
    fixture.detectChanges();
    const grid = component['grid']();
    expect(grid).toBeDefined();

    const refreshSpy = vi.spyOn(grid!, 'refresh').mockResolvedValue();

    // Simulate a refresh trigger via the signal
    refreshCount.update((n) => n + 1);
    // Effect runs asynchronously; flush microtasks
    await fixture.whenStable();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it('should not call refresh on initial render (refreshCount === 0)', async () => {
    fixture.detectChanges();
    const grid = component['grid']();
    expect(grid).toBeDefined();

    const refreshSpy = vi.spyOn(grid!, 'refresh').mockResolvedValue();

    // No trigger — refreshCount stays 0
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
