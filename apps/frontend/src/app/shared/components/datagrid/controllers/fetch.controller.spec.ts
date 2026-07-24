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
  let mockApi: { getAll: ReturnType<typeof vi.fn>; getAllArchived: ReturnType<typeof vi.fn> };

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
      updateTableWindow: vi.fn(),
      startIndex: () => 0,
      endIndex: () => 25,
      totalCountAll,
      config: { messages: { loadFailed: 'Load failed' } },
    };

    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };
    mockApi = { getAll: vi.fn(), getAllArchived: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        FetchController,
        {
          provide: GridStoreService,
          useValue: { grid: fakeGrid, rows, pageIndex, pageSize: () => 25, sorting: () => [] },
        },
        { provide: DataGridDataService, useValue: { buildGetAllOptions: vi.fn((o: unknown) => o) } },
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
});
