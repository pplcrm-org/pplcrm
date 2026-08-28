import { TestBed } from '@angular/core/testing';
import { AbstractAPIService } from '@frontend/services/api/abstract-api.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditingController } from './editing.controller';
import type { ColumnDef } from '../grid-defaults';
import { GridStoreService } from '../services/grid-store.service';
import { DataGridUtilsService } from '../services/utils.service';

describe('EditingController', () => {
  let controller: EditingController;
  let fakeGrid: {
    toId: (r: any) => string;
    undoMgr: { undo: ReturnType<typeof vi.fn> };
    updateEditedRowInCaches: ReturnType<typeof vi.fn>;
    updateTableWindow: ReturnType<typeof vi.fn>;
    startIndex: () => number;
    endIndex: () => number;
  };
  let mockAlerts: { showSuccess: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn> };
  let mockApi: { update: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeGrid = {
      toId: (r: any) => String(r?.id ?? ''),
      undoMgr: { undo: vi.fn() },
      updateEditedRowInCaches: vi.fn(),
      updateTableWindow: vi.fn(),
      startIndex: () => 0,
      endIndex: () => 25,
    };
    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };
    mockApi = { update: vi.fn().mockResolvedValue(undefined) };

    TestBed.configureTestingModule({
      providers: [
        EditingController,
        { provide: GridStoreService, useValue: { grid: fakeGrid } },
        { provide: AlertService, useValue: mockAlerts },
        {
          provide: DataGridUtilsService,
          useValue: { createPayload: vi.fn((row: any, key: string) => ({ [key]: row[key] })) },
        },
        { provide: AbstractAPIService, useValue: mockApi },
      ],
    });

    controller = TestBed.inject(EditingController);
  });

  describe('coerceEditingValue', () => {
    it('parses and trims numeric strings, rejecting non-numbers as null', () => {
      const col = { cellDataType: 'number' };
      expect(controller.coerceEditingValue(col, '12.5')).toBe(12.5);
      expect(controller.coerceEditingValue(col, ' 7 ')).toBe(7);
      expect(controller.coerceEditingValue(col, 42)).toBe(42);
      expect(controller.coerceEditingValue(col, 'abc')).toBeNull();
      expect(controller.coerceEditingValue(col, '')).toBeNull();
      expect(controller.coerceEditingValue(col, null)).toBeNull();
    });

    it('truncates ISO datetimes to the date part and keeps date-only strings', () => {
      const col = { cellDataType: 'date' };
      expect(controller.coerceEditingValue(col, '2024-01-02T10:00:00Z')).toBe('2024-01-02');
      expect(controller.coerceEditingValue(col, '2024-01-02')).toBe('2024-01-02');
      expect(controller.coerceEditingValue({ cellDataType: 'datetime' }, '2024-01-02T10:00:00Z')).toBe('2024-01-02');
    });

    it('accepts only 6-digit hex colors and lowercases them', () => {
      const col = { cellDataType: 'color' };
      expect(controller.coerceEditingValue(col, '#AABBCC')).toBe('#aabbcc');
      expect(controller.coerceEditingValue(col, '#abc')).toBeNull(); // shorthand not allowed
      expect(controller.coerceEditingValue(col, 'red')).toBeNull();
      expect(controller.coerceEditingValue(col, '')).toBeNull();
    });

    it('passes values through untouched for unknown or missing cell types', () => {
      expect(controller.coerceEditingValue({}, 'anything')).toBe('anything');
      expect(controller.coerceEditingValue({ cellDataType: 'text' }, '  spaced  ')).toBe('  spaced  ');
    });
  });

  describe('shouldBlockEdit', () => {
    it('blocks renaming a non-deletable row only', () => {
      expect(controller.shouldBlockEdit({ deletable: false }, 'name')).toBe(true);
      expect(controller.shouldBlockEdit({ deletable: false }, 'description')).toBe(false);
      expect(controller.shouldBlockEdit({ deletable: true }, 'name')).toBe(false);
      expect(controller.shouldBlockEdit({}, 'name')).toBe(false);
    });
  });

  describe('commitSingleCell', () => {
    const nameCol: ColumnDef = { field: 'name', headerName: 'Name' };

    it('bails out without an update when the column has no field or the row has no id', async () => {
      await expect(controller.commitSingleCell({ id: '1' }, { headerName: 'X' } as ColumnDef, 'v')).resolves.toBe(
        false,
      );
      await expect(controller.commitSingleCell({ name: 'a' }, nameCol, 'v')).resolves.toBe(false);
      expect(mockApi.update).not.toHaveBeenCalled();
    });

    it('treats an unchanged value as success without calling the API', async () => {
      await expect(controller.commitSingleCell({ id: '1', name: 'Alice' }, nameCol, 'Alice')).resolves.toBe(true);
      // null → '' is also "unchanged": clearing an already-empty cell is a no-op.
      await expect(controller.commitSingleCell({ id: '1', name: null }, nameCol, '')).resolves.toBe(true);
      expect(mockApi.update).not.toHaveBeenCalled();
      expect(mockAlerts.showSuccess).not.toHaveBeenCalled();
    });

    it('persists a change, updates the caches and window, and toasts success', async () => {
      const row: Record<string, unknown> = { id: '1', name: 'Alice' };

      await expect(controller.commitSingleCell(row, nameCol, 'Bob')).resolves.toBe(true);

      expect(row['name']).toBe('Bob');
      expect(mockApi.update).toHaveBeenCalledWith('1', { name: 'Bob' });
      expect(fakeGrid.updateEditedRowInCaches).toHaveBeenCalledWith('1', 'name', 'Bob', 'Alice');
      expect(fakeGrid.updateTableWindow).toHaveBeenCalledWith(0, 25);
      expect(mockAlerts.showSuccess).toHaveBeenCalledWith('Row updated');
    });

    it('reverts the row locally and toasts when the update fails server-side — WITHOUT touching the undo stack', async () => {
      mockApi.update.mockRejectedValue(new Error('boom'));
      const row: Record<string, unknown> = { id: '1', name: 'Alice' };

      await expect(controller.commitSingleCell(row, nameCol, 'Bob')).resolves.toBe(false);

      expect(row['name']).toBe('Alice'); // optimistic write rolled back
      // Regression guard: the failed edit pushed no undo snapshot (snapshots are pushed after a
      // successful save), so calling undo() here would pop the PREVIOUS successful edit's
      // snapshot and send a server update reverting that unrelated change — silent data loss.
      expect(fakeGrid.undoMgr.undo).not.toHaveBeenCalled();
      expect(mockAlerts.showError).toHaveBeenCalledWith('Update failed');
      expect(fakeGrid.updateEditedRowInCaches).not.toHaveBeenCalled();
      expect(mockAlerts.showSuccess).not.toHaveBeenCalled();
    });

    it('blocks renaming a non-deletable row before any API call, without touching the undo stack', async () => {
      const row: Record<string, unknown> = { id: '1', name: 'System tag', deletable: false };

      await expect(controller.commitSingleCell(row, nameCol, 'Renamed')).resolves.toBe(false);

      expect(row['name']).toBe('System tag');
      expect(fakeGrid.undoMgr.undo).not.toHaveBeenCalled(); // same regression guard as above
      expect(mockAlerts.showError).toHaveBeenCalledWith('Editing this field is blocked');
      expect(mockApi.update).not.toHaveBeenCalled();
    });

    it('delegates change detection to a valueSetter and skips the API when it declines', async () => {
      const valueSetter = vi.fn().mockReturnValue(false);
      const col: ColumnDef = { field: 'name', headerName: 'Name', valueSetter };

      await expect(controller.commitSingleCell({ id: '1', name: 'Alice' }, col, 'Bob')).resolves.toBe(true);

      expect(valueSetter).toHaveBeenCalledWith(expect.objectContaining({ newValue: 'Bob', value: 'Alice' }));
      expect(mockApi.update).not.toHaveBeenCalled();
    });

    it('persists when the valueSetter accepts the change', async () => {
      const col: ColumnDef = {
        field: 'name',
        headerName: 'Name',
        valueSetter: (p) => {
          (p.data as Record<string, unknown>)['name'] = String(p.newValue).toUpperCase();
          return true;
        },
      };
      const row: Record<string, unknown> = { id: '1', name: 'Alice' };

      await expect(controller.commitSingleCell(row, col, 'Bob')).resolves.toBe(true);

      expect(row['name']).toBe('BOB');
      expect(mockApi.update).toHaveBeenCalledWith('1', { name: 'BOB' });
    });

    it('treats a throwing valueSetter as a failed edit: restores the row, toasts, returns false', async () => {
      const col: ColumnDef = {
        field: 'name',
        headerName: 'Name',
        valueSetter: (p) => {
          (p.data as Record<string, unknown>)['name'] = 'partial write';
          throw new Error('setter exploded');
        },
      };
      const row: Record<string, unknown> = { id: '1', name: 'Alice' };

      await expect(controller.commitSingleCell(row, col, 'Bob')).resolves.toBe(false);

      expect(row['name']).toBe('Alice'); // partial mutation rolled back
      expect(mockAlerts.showError).toHaveBeenCalledWith('Update failed');
      expect(mockApi.update).not.toHaveBeenCalled();
    });
  });
});
