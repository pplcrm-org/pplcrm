import { Injectable, inject } from '@angular/core';
import { AbstractAPIService } from '@frontend/services/api/abstract-api.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { DataGrid } from '../datagrid';
import type { ColumnDef as ColDef } from '../grid-defaults';
import { GridStoreService } from '../services/grid-store.service';
import { DataGridUtilsService } from '../services/utils.service';
import type { GridRow } from '../types';
import type { Models } from '../../../../../../../../libs/common/src/lib/kysely.models';

@Injectable()
export class EditingController {
  private readonly store = inject(GridStoreService);
  private readonly alertSvc = inject(AlertService);
  private readonly utilsSvc = inject(DataGridUtilsService);
  private readonly gridSvc = inject(AbstractAPIService);

  private get grid(): DataGrid<keyof Models, unknown> {
    return this.store.grid as unknown as DataGrid<keyof Models, unknown>;
  }

  public coerceEditingValue(col: { cellDataType?: string }, raw: unknown): unknown {
    const t = String(col?.cellDataType || '').toLowerCase();
    if (t === 'number' || t === 'numeric') {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim());
      return isNaN(n) ? null : n;
    }
    if (t === 'date' || t === 'datetime' || t === 'dateonly') {
      const v = String(raw ?? '').trim();
      return v.length > 10 ? v.slice(0, 10) : v;
    }
    if (t === 'color' || t === 'colour') {
      const v = String(raw ?? '').trim();
      const pattern = /^#([0-9a-fA-F]{6})$/;
      return pattern.test(v) ? v.toLowerCase() : null;
    }
    return raw;
  }

  public async commitSingleCell(row: GridRow, col: ColDef, currentValue: unknown): Promise<boolean> {
    if (!col.field) return false;
    const id = this.grid.toId(row);
    if (!id) return false;
    const key = col.field;
    const prev = row[key];
    // If a valueSetter is provided on the col, let it handle assignment/normalization
    let changed = false;
    const before: Record<string, unknown> = { ...row };
    if (typeof col.valueSetter === 'function') {
      try {
        const didSet = col.valueSetter({ data: row, newValue: currentValue, value: prev, colDef: col });
        changed = !!didSet;
      } catch {
        // A throwing valueSetter is a failed edit, not "no change" — restore the
        // row and surface it instead of closing the editor as if it saved.
        Object.assign(row, { [key]: before[key] });
        this.alertSvc.showError('Update failed');
        return false;
      }
    } else {
      const equal = prev === currentValue || (prev == null && (currentValue == null || currentValue === ''));
      changed = !equal;
      if (changed) Object.assign(row, { [key]: currentValue });
    }
    if (!changed) return true;
    try {
      // On failure, only the local Object.assign revert below may run. The undo snapshot for
      // this edit is pushed AFTER a successful save (updateEditedRowInCaches), so a failed edit
      // has no snapshot of its own — calling undoMgr.undo() here pops the PREVIOUS successful
      // edit's snapshot and issues a server update reverting that unrelated change.
      if (this.shouldBlockEdit(row, key)) {
        this.alertSvc.showError('Editing this field is blocked');
        Object.assign(row, { [key]: before[key] });
        return false;
      }
      const payload = this.utilsSvc.createPayload(row, key);
      const edited = await this.gridSvc
        .update(id, payload)
        .then(() => true)
        .catch(() => false);
      if (!edited) {
        Object.assign(row, { [key]: before[key] });
        this.alertSvc.showError('Update failed');
        return false;
      }
      this.grid.updateEditedRowInCaches(id, col.field, currentValue, before[key]);
      this.grid.updateTableWindow(this.grid.startIndex(), this.grid.endIndex());
      this.alertSvc.showSuccess('Row updated');
      return true;
    } catch {
      Object.assign(row, { [key]: before[key] });
      this.alertSvc.showError('Update failed');
      return false;
    }
  }

  public shouldBlockEdit(row: GridRow, key: string): boolean {
    return !!(row && typeof row === 'object' && 'deletable' in row && row['deletable'] === false && key === 'name');
  }
}
