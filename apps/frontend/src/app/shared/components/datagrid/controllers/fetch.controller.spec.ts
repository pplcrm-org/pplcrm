import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AbstractAPIService } from '@frontend/services/api/abstract-api.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetchController } from './fetch.controller';
import { DataGridDataService } from '../services/data.service';
import { GridStoreService } from '../services/grid-store.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('FetchController', () => {
  let controller: FetchController;
  let rows: ReturnType<typeof signal<any[]>>;
  let pageIndex: ReturnType<typeof signal<number>>;
  let totalCountAll: ReturnType<typeof signal<number>>;
  let fakeGrid: any;
  let mockAlerts: { showSuccess: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn> };
  let mockApi: {
    getAll: ReturnType<typeof vi.fn>;
    getAllArchived: ReturnType<typeof vi.fn>;
    getMatchingIds: ReturnType<typeof vi.fn>;
  };
  let mockDataSvc: { buildGetAllOptions: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    rows = signal<any[]>([]);
    pageIndex = signal(0);
    totalCountAll = signal(0);

    fakeGrid = {
      _loading: { begin: () => () => undefined },
      searchTerm: () => '',
      selectedTags: () => [],
      selectedIssues: () => [],
      buildFilterModel: () => ({}),
      sortCol: () => undefined,
      sortDir: () => undefined,
      archiveMode: () => false,
      externalAdvancedFilterModel: () => null,
      advFilter: { buildModel: () => null },
      activeListId: () => null,
      toId: (r: any) => String(r?.id ?? ''),
      rowCanSelect: () => null,
      updateTableWindow: vi.fn(),
      startIndex: () => 0,
      endIndex: () => 25,
      totalCountAll,
      config: { messages: { loadFailed: 'Load failed' } },
    };

    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };
    // getMatchingIds resolves null by default — the "entity has no ids-only endpoint" case, which
    // exercises the full-row fallback the pre-endpoint tests below were written against.
    mockApi = { getAll: vi.fn(), getAllArchived: vi.fn(), getMatchingIds: vi.fn().mockResolvedValue(null) };
    mockDataSvc = { buildGetAllOptions: vi.fn((o: unknown) => o) };

    TestBed.configureTestingModule({
      providers: [
        FetchController,
        {
          provide: GridStoreService,
          useValue: { grid: fakeGrid, rows, pageIndex, pageSize: () => 25, sorting: () => [] },
        },
        { provide: DataGridDataService, useValue: mockDataSvc },
        { provide: AlertService, useValue: mockAlerts },
        { provide: AbstractAPIService, useValue: mockApi },
      ],
    });

    controller = TestBed.inject(FetchController);
  });

  it('applies an in-order response: rows, count, and page index land', async () => {
    mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }, { id: '2' }], count: 2 });

    await controller.loadPage(1);

    expect(rows()).toEqual([{ id: '1' }, { id: '2' }]);
    expect(totalCountAll()).toBe(2);
    expect(pageIndex()).toBe(1);
  });

  it('discards a stale response that resolves after a newer request', async () => {
    const slow = deferred<{ rows: any[]; count: number }>();
    const fast = deferred<{ rows: any[]; count: number }>();
    mockApi.getAll.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const first = controller.loadPage(0);
    const second = controller.loadPage(2);

    // The newer request lands first...
    fast.resolve({ rows: [{ id: 'new' }], count: 1 });
    await second;
    expect(rows()).toEqual([{ id: 'new' }]);
    expect(pageIndex()).toBe(2);

    // ...then the stale one resolves and must not overwrite any grid state.
    slow.resolve({ rows: [{ id: 'stale' }], count: 99 });
    await first;

    expect(rows()).toEqual([{ id: 'new' }]);
    expect(totalCountAll()).toBe(1);
    expect(pageIndex()).toBe(2);
  });

  it('suppresses the failure toast when a superseded request rejects', async () => {
    const slow = deferred<{ rows: any[]; count: number }>();
    mockApi.getAll.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ rows: [{ id: 'new' }], count: 1 });

    const first = controller.loadPage(0);
    await controller.loadPage(1);

    slow.reject(new Error('network'));
    await first;

    expect(mockAlerts.showError).not.toHaveBeenCalled();
    expect(rows()).toEqual([{ id: 'new' }]);
  });

  it('still toasts when the current (non-superseded) request fails', async () => {
    mockApi.getAll.mockRejectedValue(new Error('boom'));

    await controller.loadPage(0);

    expect(mockAlerts.showError).toHaveBeenCalledWith('Load failed');
  });

  describe('selectAllMatching', () => {
    it('sends the SAME filter set as a page load — column filter model included', async () => {
      // Regression guard: this call once omitted filterModel, so "select all matching" (and the
      // record-navigation context it feeds) acted on rows the user had filtered out.
      fakeGrid.searchTerm = () => 'smith';
      fakeGrid.selectedTags = () => ['donor'];
      fakeGrid.buildFilterModel = () => ({ status: { filter: 'active' } });
      mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }], count: 1 });

      await controller.selectAllMatching();

      expect(mockDataSvc.buildGetAllOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          searchStr: 'smith',
          tags: ['donor'],
          filterModel: { status: { filter: 'active' } },
        }),
      );
    });

    it('sends no page window (the backend default limit is this feature`s documented cap)', async () => {
      mockApi.getAll.mockResolvedValue({ rows: [], count: 0 });

      await controller.selectAllMatching();

      const sent = mockApi.getAll.mock.calls[0][0];
      expect(sent.startRow).toBeUndefined();
      expect(sent.endRow).toBeUndefined();
      expect(sent.limit).toBeUndefined();
    });

    it('maps returned rows to ids, honouring rowCanSelect, and reports the server`s matched total', async () => {
      fakeGrid.toId = (r: any) => String(r.id);
      fakeGrid.rowCanSelect = () => (r: any) => r.id !== '2';
      mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }, { id: '2' }, { id: '3' }], count: 3 });

      // capped is false: all 3 matching rows were RECEIVED; one was excluded client-side, which
      // is a selection rule, not a truncated answer.
      await expect(controller.selectAllMatching()).resolves.toEqual({ ids: ['1', '3'], matched: 3, capped: false });
    });

    it('prefers the ids-only endpoint when the entity has one, and never fetches full rows then', async () => {
      mockApi.getMatchingIds.mockResolvedValue({ ids: ['7', '8'], count: 2, capped: false });

      await expect(controller.selectAllMatching()).resolves.toEqual({ ids: ['7', '8'], matched: 2, capped: false });
      expect(mockApi.getAll).not.toHaveBeenCalled();
    });

    it('passes a server-capped ids answer through as capped, with the true matched total', async () => {
      mockApi.getMatchingIds.mockResolvedValue({ ids: ['1', '2'], count: 50_000, capped: true });

      await expect(controller.selectAllMatching()).resolves.toEqual({
        ids: ['1', '2'],
        matched: 50_000,
        capped: true,
      });
    });

    it('reports the fallback path as capped when the server held back matches', async () => {
      // Two rows received under a count of 10: the old code returned count 2 and the banner said
      // "All 2 selected" under a 10-row header — this is the honesty half of that fix.
      mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }, { id: '2' }], count: 10 });

      await expect(controller.selectAllMatching()).resolves.toEqual({ ids: ['1', '2'], matched: 10, capped: true });
    });

    it('skips the ids-only endpoint in archive mode (archived grids take the full-row fallback)', async () => {
      fakeGrid.archiveMode = () => true;
      mockApi.getAllArchived.mockResolvedValue({ rows: [{ id: '9' }], count: 1 });

      await expect(controller.selectAllMatching()).resolves.toEqual({ ids: ['9'], matched: 1, capped: false });
      expect(mockApi.getMatchingIds).not.toHaveBeenCalled();
    });
  });

  describe('matchingSelectionForNav', () => {
    it('reuses the last answer while the grid is unchanged — one fetch for many record opens', async () => {
      mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }], count: 1 });

      const first = await controller.matchingSelectionForNav();
      const second = await controller.matchingSelectionForNav();

      expect(second).toEqual(first);
      expect(mockApi.getAll).toHaveBeenCalledTimes(1);
    });

    it('refetches after a page load repaints the rows (the held ids may no longer match them)', async () => {
      mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }], count: 1 });

      await controller.matchingSelectionForNav();
      await controller.loadPage(0);
      await controller.matchingSelectionForNav();

      // One nav fetch + the page load + the post-load nav refetch.
      expect(mockApi.getAll).toHaveBeenCalledTimes(3);
    });

    it('refetches when the filter set changes (the cache key is the built options)', async () => {
      mockApi.getAll.mockResolvedValue({ rows: [{ id: '1' }], count: 1 });

      await controller.matchingSelectionForNav();
      fakeGrid.searchTerm = () => 'smith';
      await controller.matchingSelectionForNav();

      expect(mockApi.getAll).toHaveBeenCalledTimes(2);
    });
  });
});
