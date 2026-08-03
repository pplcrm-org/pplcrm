import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Table } from '@tanstack/table-core';
import type { GridRow } from '../types';
import { GridStoreService } from './grid-store.service';

const KEY = 'pcdg:grid-store-restore-spec';

/**
 * Minimal stand-in for the TanStack table the store validates restored state against — only the
 * three members `GridStoreService` touches. The double-cast is unavoidable for a test double of
 * an interface this large.
 */
function fakeTable(columnIds: string[]): Table<GridRow> {
  const table = {
    getAllLeafColumns: () => columnIds.map((id) => ({ id })),
    getState: () => ({}),
    setOptions: (updater: (prev: { state?: Record<string, unknown> }) => unknown) => {
      void updater({ state: {} });
    },
  };
  return table as unknown as Table<GridRow>;
}

describe('GridStoreService state restore', () => {
  let store: GridStoreService;

  beforeEach(() => {
    localStorage.removeItem(KEY);
    TestBed.configureTestingModule({ providers: [GridStoreService] });
    store = TestBed.inject(GridStoreService);
  });

  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('drops saved sort, filter, visibility and order entries naming columns the grid no longer registers', () => {
    // A browser that saved state before the ward/district/precinct columns were removed still
    // holds entries for them. Restored verbatim, the stale sort reaches the backend as an
    // unknown ORDER BY column, the query fails, and the grid never loads.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        sorting: [
          { id: 'ward', desc: false },
          { id: 'city', desc: true },
        ],
        filters: { ward: 'w4', city: 'spring' },
        visibility: { ward: false, city: true },
        order: ['ward', 'city'],
      }),
    );

    store.attachTable(fakeTable(['city', 'electoral_area']));
    store.setPersistKey(KEY);
    store.loadState();

    expect(store.sorting()).toEqual([{ id: 'city', desc: true }]);
    expect(store.filterValues()).toEqual({ city: 'spring' });
    expect(store.colVisibility()['city']).toBe(true);
    expect('ward' in store.colVisibility()).toBe(false);
  });

  it('leaves the grid with its defaults when every saved sort entry is stale', () => {
    localStorage.setItem(KEY, JSON.stringify({ sorting: [{ id: 'ward', desc: false }] }));

    store.attachTable(fakeTable(['city']));
    store.setPersistKey(KEY);
    store.loadState();

    expect(store.sorting()).toEqual([]);
  });

  it('restores state naming known columns unchanged', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        sorting: [{ id: 'electoral_area', desc: false }],
        filters: { electoral_area: 'ward 4' },
        pageSize: 50,
      }),
    );

    store.attachTable(fakeTable(['city', 'electoral_area']));
    store.setPersistKey(KEY);
    store.loadState();

    expect(store.sorting()).toEqual([{ id: 'electoral_area', desc: false }]);
    expect(store.filterValues()).toEqual({ electoral_area: 'ward 4' });
    expect(store.pageSize()).toBe(50);
  });
});
