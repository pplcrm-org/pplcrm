import { Injectable } from '@angular/core';
import type { ConfirmDialogService } from '@frontend/services/shared-dialog.service';
import type { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { loadingGate } from '@uxcommon/loading-gate';

import { DataGridConfig, deleteConfirmMessageFor, deleteSuccessMessageFor } from '../datagrid.tokens';
import type { GridRow } from '../types';

@Injectable({ providedIn: 'root' })
export class DataGridActionsService {
  public async confirmDeleteAndRun(ctx: DeleteCtx): Promise<void> {
    const { messages } = ctx.config;

    const selectedCount = ctx.getSelectedRows()?.length ?? 0;

    const ok = await ctx.dialogs.confirm({
      title: messages.deleteConfirmTitle,
      message: deleteConfirmMessageFor(messages, selectedCount),
      variant: messages.deleteConfirmVariant,
      icon: messages.deleteConfirmIcon,
      confirmText: messages.deleteConfirmText,
      cancelText: messages.deleteCancelText,
      allowBackdropClose: false,
    });
    if (!ok) return;

    const rows = ctx.getSelectedRows();
    if (!rows.length) {
      ctx.alertSvc.showError(messages.deleteNoneSelected);
      return;
    }

    const isNonDeletable = (row: Record<string, unknown>) => {
      if (!('deletable' in row)) return false;
      const value = (row as { deletable?: unknown }).deletable;
      if (typeof value === 'boolean') return value === false;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'false' || normalized === '0';
      }
      if (typeof value === 'number') return value === 0;
      return false;
    };

    const deletableRows = rows.filter((row) => !isNonDeletable(row as Record<string, unknown>));
    const containsNonDeletable = deletableRows.length !== rows.length;
    if (containsNonDeletable) {
      ctx.alertSvc.showError(messages.deleteSystemValues);
      return;
    }
    if (!deletableRows.length) {
      return;
    }

    const end = ctx._loading.begin();
    try {
      const ids = deletableRows.map((r) => r.id);
      const ok2 = await ctx.gridSvc.deleteMany(ids);
      if (!ok2) {
        ctx.alertSvc.showError(messages.deleteFailed);
        return;
      }
      ctx.alertSvc.showSuccess(deleteSuccessMessageFor(messages, ids.length));
    } finally {
      end();
    }
  }

  public async doExportCsv(deps: {
    dialogs: ConfirmDialogService;
    alertSvc: AlertService;
    config: DataGridConfig;
    getRowsForExport?: () => GridRow[];
    requestFullExport?: () => Promise<{ csv: string; fileName?: string; rowCount?: number }>;
    queueFullExport?: () => Promise<void>;
    logInstantExport?: (rowCount: number) => void;
    displayedCount?: number;
    totalCount?: number;
  }) {
    const { messages } = deps.config;

    const displayedCount = deps.displayedCount ?? 0;
    const totalCount = deps.totalCount ?? displayedCount;
    const hasAllRowsVisible = totalCount <= displayedCount;

    let exportAllData = false;
    if (!hasAllRowsVisible) {
      const parts: string[] = [];
      if (totalCount > 0 && displayedCount > 0) {
        parts.push(`Only ${displayedCount} of ${totalCount} rows are currently displayed.`);
      }
      parts.push(messages.exportMessage);
      parts.push(messages.exportNavigateWarning);
      // choose(), not confirm(): confirm() collapses its cancel button and a dismissal (Esc /
      // the X) into the same `false`, so closing the dialog still downloaded the displayed
      // rows. choose() returns null on dismissal — dismissing now downloads nothing.
      const choice = await deps.dialogs.choose<'all' | 'displayed'>({
        title: messages.exportTitle,
        message: parts.filter(Boolean).join('\n\n'),
        variant: 'info',
        icon: messages.exportIcon,
        choices: [
          { label: messages.exportConfirmText, value: 'all' },
          { label: messages.exportCancelText, value: 'displayed' },
        ],
      });
      if (choice === null) return;
      exportAllData = choice === 'all';
    }

    // --- "All rows" path: queue background job, return immediately ---
    if (exportAllData) {
      if (deps.queueFullExport) {
        try {
          await deps.queueFullExport();
          deps.alertSvc.showSuccess('Export queued! Visit the Exports page to download when ready.');
        } catch {
          deps.alertSvc.showError(messages.exportFailed);
        }
        return;
      }
      // fallback: no queue callback, fall through to synchronous path
    }

    // --- "Displayed rows" path: synchronous, in-memory, direct download ---
    if (!deps.getRowsForExport) return;

    try {
      const rows = deps.getRowsForExport();
      if (!rows.length) {
        deps.alertSvc.showInfo('No rows to export.');
        return;
      }
      const rowCount = rows.length;
      const headers = Object.keys(rows[0]!);
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = [headers.join(',')].concat(rows.map((r) => headers.map((h) => escape(r[h])).join(','))).join('\n');

      const fileName = messages.exportFileName || 'export.csv';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      deps.logInstantExport?.(rowCount);
      deps.alertSvc.showSuccess(`${messages.exportReady} (${rowCount} rows)`);
    } catch {
      deps.alertSvc.showError(messages.exportFailed);
    }
  }
}

type DeleteCtx = {
  _loading: loadingGate;
  alertSvc: AlertService;
  config: DataGridConfig;
  dialogs: ConfirmDialogService;
  gridSvc: { deleteMany: (ids: string[]) => Promise<boolean> };

  getSelectedRows: () => (Partial<GridRow> & { id: string })[];
};
