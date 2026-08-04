import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataGrid } from '../datagrid';
import { AbstractAPIService } from '../../../../services/api/abstract-api.service';
import { DATA_GRID_CONFIG, DEFAULT_DATA_GRID_CONFIG } from '../datagrid.tokens';
import { TagOptionsService } from '../services/tag-options.service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import type { ColumnDef } from '../grid-defaults';

class MockGridSvc {
  refreshCount = signal(0);
  getAll = vi.fn().mockResolvedValue({ rows: [], count: 0 });
  getAllArchived = vi.fn().mockResolvedValue({ rows: [], count: 0 });
  abort = vi.fn();
  detachTag = vi.fn().mockResolvedValue(undefined);
  update = vi.fn().mockResolvedValue(undefined);
  delete = vi.fn().mockResolvedValue(true);
  deleteMany = vi.fn().mockResolvedValue(true);
  queueExport = vi.fn().mockResolvedValue({});
  mergePersons = vi.fn().mockResolvedValue(undefined);
  // Entity services may describe what a specific merge costs; the grid only asks and shows it.
  mergeWarning = vi.fn().mockResolvedValue(null);
}

describe('DataGrid', () => {
  let fixture: ComponentFixture<DataGrid<'persons', unknown>>;
  let component: DataGrid<'persons', unknown>;
  let mockGridSvc: MockGridSvc;

  const nameColDef: ColumnDef = { field: 'name', headerName: 'Name' };
  const amountColDef: ColumnDef = {
    field: 'amount',
    headerName: 'Amount',
    valueGetter: (p) => Number((p.data?.['amount'] as number) ?? 0) * 2,
  };
  const colDefs: ColumnDef[] = [nameColDef, amountColDef];

  beforeEach(async () => {
    mockGridSvc = new MockGridSvc();

    await TestBed.configureTestingModule({
      imports: [DataGrid],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: {} },
        // useValue (not useClass) so the component AND its FetchController —
        // which injects AbstractAPIService independently — share this exact
        // instance, letting tests assert on its spies.
        { provide: AbstractAPIService, useValue: mockGridSvc },
        { provide: DATA_GRID_CONFIG, useValue: DEFAULT_DATA_GRID_CONFIG },
        { provide: TagOptionsService, useValue: { getTagNames: vi.fn().mockResolvedValue([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent<DataGrid<'persons', unknown>>(DataGrid);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('colDefs', colDefs);
  });

  async function init() {
    fixture.detectChanges();
    await fixture.whenStable();
    // ngOnInit kicks off a fire-and-forget async IIFE (tag options, optional
    // lists fetch, table build, first page load) that whenStable() does not
    // track; flush its microtask/timer chain manually before asserting.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
  }

  describe('callCellRenderer memoization (SECURITY-REVIEW 3.1)', () => {
    it('runs the renderer once per (row, value) and re-runs only when the value changes', () => {
      const renderer = vi.fn((p: { value: unknown }) => `<span>${String(p.value)}</span>`);
      const col = { field: 'name', headerName: 'Name', cellRenderer: renderer } as unknown as ColumnDef;
      const row: Record<string, unknown> = { name: 'Alice' };

      const call = () =>
        (component as unknown as { callCellRenderer: (r: unknown, c: unknown) => unknown }).callCellRenderer(row, col);

      const first = call();
      const second = call();
      expect(renderer).toHaveBeenCalledTimes(1); // second call served from cache
      expect(second).toBe(first); // same SafeHtml reference

      row['name'] = 'Bob'; // value changed -> cache invalidated
      call();
      expect(renderer).toHaveBeenCalledTimes(2);
    });
  });

  describe('initial load', () => {
    it('prepends the selection column to the configured column defs', async () => {
      mockGridSvc.getAll.mockResolvedValue({ rows: [], count: 0 });
      await init();

      const cols = (component as unknown as { colDefsWithEdit: ColumnDef[] }).colDefsWithEdit;
      expect(cols).toHaveLength(3);
      expect(cols[1].field).toBe('name');
      expect(cols[2].field).toBe('amount');
    });

    it('loads the first page and exposes the returned rows and total count', async () => {
      mockGridSvc.getAll.mockResolvedValue({
        rows: [
          { id: '1', name: 'Alice', amount: 10 },
          { id: '2', name: 'Bob', amount: 20 },
        ],
        count: 2,
      });

      await init();

      expect(mockGridSvc.getAll).toHaveBeenCalled();
      expect(component.rows()).toHaveLength(2);
      expect(component.totalCountAll()).toBe(2);
    });

    it('shows the load-failed alert and does not throw when the fetch rejects', async () => {
      mockGridSvc.getAll.mockRejectedValue(new Error('network down'));

      await expect(init()).resolves.toBeUndefined();
      expect(component.rows()).toEqual([]);
    });
  });

  describe('empty state first-load gating', () => {
    const isEmptyState = () => (component as unknown as { isEmptyState: () => boolean }).isEmptyState();

    it('does not show the empty state while the first fetch is still pending', async () => {
      let resolveFetch!: (value: { rows: unknown[]; count: number }) => void;
      mockGridSvc.getAll.mockReturnValue(
        new Promise<{ rows: unknown[]; count: number }>((resolve) => {
          resolveFetch = resolve;
        }),
      );

      await init();

      expect(isEmptyState()).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain('Nothing here yet');

      resolveFetch({ rows: [], count: 0 });
      await init();

      expect(isEmptyState()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('Nothing here yet');
    });

    it('shows no empty state once rows have loaded', async () => {
      mockGridSvc.getAll.mockResolvedValue({ rows: [{ id: '1', name: 'Alice', amount: 10 }], count: 1 });

      await init();

      expect(isEmptyState()).toBe(false);
      expect(fixture.nativeElement.textContent).not.toContain('Nothing here yet');
    });
  });

  describe('toId', () => {
    it('stringifies the id field of a row', async () => {
      await init();
      expect(component.toId({ id: 5 })).toBe('5');
    });

    it('returns an empty string for rows without an id', async () => {
      await init();
      expect(component.toId({})).toBe('');
      expect(component.toId(null)).toBe('');
    });
  });

  describe('getCellValue', () => {
    it('reads the field directly when no valueGetter is configured', async () => {
      await init();
      const value = (component as unknown as { getCellValue: (r: unknown, c: ColumnDef) => unknown }).getCellValue(
        { name: 'Alice' },
        nameColDef,
      );
      expect(value).toBe('Alice');
    });

    it('uses the valueGetter when one is configured', async () => {
      await init();
      const value = (component as unknown as { getCellValue: (r: unknown, c: ColumnDef) => unknown }).getCellValue(
        { amount: 21 },
        amountColDef,
      );
      expect(value).toBe(42);
    });
  });

  describe('pagination', () => {
    it('computes total pages, canNext and canPrev from the total count and page size', async () => {
      mockGridSvc.getAll.mockResolvedValue({ rows: [], count: 52 });
      await init();

      expect(component.totalCountAll()).toBe(52);
      expect((component as unknown as { totalPages: () => number }).totalPages()).toBe(3);
      expect((component as unknown as { canNext: () => boolean }).canNext()).toBe(true);
      expect((component as unknown as { canPrev: () => boolean }).canPrev()).toBe(false);
    });
  });

  describe('tag filter chips', () => {
    it('adds a chip when a tag filter is toggled on, and removes it via removeFilterChip', async () => {
      await init();

      component.toggleTagFilter('donor', true);
      await fixture.whenStable();

      expect(component.selectedTags()).toContain('donor');
      // OR-ed tags collapse into a single combined chip keyed 'tags' (label names the members).
      const chips = (
        component as unknown as { filterChips: () => { kind: string; key: string; label: string }[] }
      ).filterChips();
      expect(chips).toContainEqual(
        expect.objectContaining({ kind: 'tag', key: 'tags', label: expect.stringContaining('donor') }),
      );

      const chip = chips.find((c) => c.kind === 'tag' && c.key === 'tags');
      if (!chip) throw new Error('expected a combined tag chip to be present');
      (component as unknown as { removeFilterChip: (c: unknown) => void }).removeFilterChip(chip);
      await fixture.whenStable();

      expect(component.selectedTags()).not.toContain('donor');
    });

    it('clearAllFilters resets tag, issue, list and column filters together', async () => {
      await init();

      component.toggleTagFilter('donor', true);
      component.store.filterValues.set({ name: { op: 'contains', value: 'a' } });
      await fixture.whenStable();

      (component as unknown as { clearAllFilters: () => void }).clearAllFilters();
      await fixture.whenStable();

      expect(component.selectedTags()).toEqual([]);
      expect(component.store.filterValues()).toEqual({});
    });
  });

  describe('count sentence (match-your-filters clause)', () => {
    it('prefixes "N match your filters" once a fetch has run and a filter is active', async () => {
      mockGridSvc.getAll.mockResolvedValue({ rows: [{ id: '1' }, { id: '2' }], count: 2 });
      fixture.componentRef.setInput('grainLayout', true);
      fixture.componentRef.setInput('totalSentence', '4 people total');
      await init();

      // A fetch has completed — hasLoaded must be true even though the fast mock
      // never let the (gated) isLoading() signal flip true. This is the regression
      // guard: if the count is gated on isLoading() again, the prefix disappears.
      expect((component as unknown as { hasLoaded: () => boolean }).hasLoaded()).toBe(true);
      expect(component.totalCountAll()).toBe(2);

      // Unfiltered → just the grand-total sentence, no prefix.
      expect(component.countSentence()).toBe('4 people total');

      // Filter active → the same clause the export label already showed.
      component.toggleTagFilter('friend', true);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.anyFilterActive()).toBe(true);
      expect(component.countSentence()).toBe('2 match your filters · 4 people total');
    });
  });

  describe('isColFiltered', () => {
    it('reports true only for fields with an active filter value', async () => {
      await init();
      component.store.filterValues.set({ name: 'foo' });

      expect(component.isColFiltered('name')).toBe(true);
      expect(component.isColFiltered('amount')).toBe(false);
    });
  });

  describe('selection', () => {
    it('tracks single vs. multi selection state via the selected id set', async () => {
      await init();

      component.store.selectedIdSet.set(new Set(['1']));
      expect(component.hasSingleSelection()).toBe(true);

      component.store.selectedIdSet.set(new Set(['1', '2']));
      expect(component.hasSingleSelection()).toBe(false);
      expect(component.getCountRowSelected()).toBe(2);
    });

    it('clearAllSelection resets the select-all-across-pages state', async () => {
      await init();

      component.allSelected.set(true);
      component.allSelectedCount.set(10);

      component.clearAllSelection();

      expect(component.allSelected()).toBe(false);
      expect(component.allSelectedCount()).toBe(0);
    });
  });

  describe('server-side fetch options (FetchController integration)', () => {
    const loadPage = (index: number, append?: boolean) =>
      (component as unknown as { loadPage: (i: number, a?: boolean) => Promise<void> }).loadPage(index, append);

    const lastGetAllOptions = () =>
      mockGridSvc.getAll.mock.calls[mockGridSvc.getAll.mock.calls.length - 1]?.[0] as Record<string, unknown>;

    it('turning the page re-fetches with the next row window', async () => {
      mockGridSvc.getAll.mockResolvedValue({ rows: [{ id: '1', name: 'Alice' }], count: 52 });
      await init();

      await (component as unknown as { nextPage: () => Promise<void> }).nextPage();

      expect(lastGetAllOptions()).toMatchObject({ startRow: 25, endRow: 50 });
      expect((component as unknown as { pageIndex: () => number }).pageIndex()).toBe(1);
    });

    it('sorting is forwarded to the server as a sortModel on the next fetch', async () => {
      await init();

      component.store.sorting.set([{ id: 'name', desc: true }]);
      await loadPage(0);

      expect(lastGetAllOptions()).toMatchObject({ sortModel: [{ colId: 'name', sort: 'desc' }] });
    });

    it('append mode concatenates the incoming page instead of replacing it', async () => {
      mockGridSvc.getAll.mockResolvedValue({
        rows: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
        count: 52,
      });
      await init();
      expect(component.rows()).toHaveLength(2);

      mockGridSvc.getAll.mockResolvedValue({
        rows: [
          { id: '3', name: 'Cara' },
          { id: '4', name: 'Dan' },
        ],
        count: 52,
      });
      await loadPage(1, true);

      expect(component.rows().map((r) => r['id'])).toEqual(['1', '2', '3', '4']);
    });

    it('archive mode routes the fetch to getAllArchived', async () => {
      await init();
      mockGridSvc.getAllArchived.mockResolvedValue({ rows: [{ id: '9', name: 'Old' }], count: 1 });

      component.archiveMode.set(true);
      await loadPage(0);

      expect(mockGridSvc.getAllArchived).toHaveBeenCalled();
      const options = mockGridSvc.getAllArchived.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(options).toMatchObject({ includeArchived: true });
      expect(component.rows().map((r) => r['id'])).toEqual(['9']);
    });
  });
  // The bulk Merge action is the second way two people get merged (the Duplicates pair card is
  // the first). Merging two people who both hold a companion volunteer record revokes one
  // person's access to the canvassing and delivery apps, so the confirmation has to say so.
  describe('bulk merge confirmation', () => {
    async function runMerge(): Promise<Record<string, unknown>> {
      await init();
      vi.spyOn(component, 'getSelectedRows').mockReturnValue([
        { id: 'p1', name: 'John Doe' },
        { id: 'p2', name: 'Johnny Doe' },
      ] as never);

      const dialogs = TestBed.inject(ConfirmDialogService);
      vi.spyOn(dialogs, 'choose').mockResolvedValue({
        target: { id: 'p1', name: 'John Doe' },
        source: { id: 'p2', name: 'Johnny Doe' },
      } as never);
      const confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValue(false);

      await (component as unknown as { confirmMerge: () => Promise<void> }).confirmMerge();

      const [opts] = confirm.mock.calls[0] as [Record<string, unknown>];
      return opts;
    }

    it('adds what the service says this pair will cost', async () => {
      mockGridSvc.mergeWarning.mockResolvedValue('Merging takes away Johnny Doe’s companion access.');

      const opts = await runMerge();

      expect(mockGridSvc.mergeWarning).toHaveBeenCalledWith('p1', 'p2', {
        target: 'John Doe',
        source: 'Johnny Doe',
      });
      expect(String(opts['message'])).toContain('Merging takes away Johnny Doe’s companion access.');
    });

    it('leaves the confirmation alone when this pair has no consequence to report', async () => {
      const opts = await runMerge();

      expect(String(opts['message'])).toContain('permanently delete "Johnny Doe"');
      expect(String(opts['message'])).not.toContain('companion');
    });
  });
});
