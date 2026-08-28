import { inject, Injectable } from '@angular/core';
import type { DataGrid } from '../datagrid';
import { AbstractAPIService } from '@frontend/services/api/abstract-api.service';
import { DataGridDataService } from '../services/data.service';
import { GridStoreService } from '../services/grid-store.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { Models } from '../../../../../../../../libs/common/src/lib/kysely.models';
import type { getAllOptionsType } from '../../../../../../../../libs/common/src';

@Injectable()
export class FetchController {
  private readonly gridSvc = inject(AbstractAPIService);
  private readonly dataSvc = inject(DataGridDataService);
  private readonly store = inject(GridStoreService);
  private readonly alertSvc = inject(AlertService);

  /** Monotonic sequence for loadPage calls — search/filter/sort/pagination fetches can
   *  resolve out of order, and a stale response must never repaint newer rows. */
  private loadSeq = 0;

  private get grid(): DataGrid<keyof Models, unknown> {
    return this.store.grid as unknown as DataGrid<keyof Models, unknown>;
  }

  async loadPage(index: number, append?: boolean): Promise<void> {
    const requestId = ++this.loadSeq;
    // The gate flips its `loaded` signal (which the grid reads as hasLoaded) when
    // this fetch completes — via the disposer below. No separate bookkeeping here.
    const end = this.grid._loading.begin();
    try {
      const pageSize = this.store.pageSize();
      const startRow = index * pageSize;
      const endRow = startRow + pageSize;
      const options = this.dataSvc.buildGetAllOptions({
        searchStr: this.grid.searchTerm(),
        startRow,
        endRow,
        tags: this.grid.selectedTags(),
        issues: this.grid.selectedIssues(),
        filterModel: this.grid.buildFilterModel(),
        sortState: this.store.sorting() as unknown as Array<{ id: string; desc?: boolean }>,
        sortCol: this.grid.sortCol(),
        sortDir: this.grid.sortDir(),
        includeArchived: this.grid.archiveMode(),
        advancedFilterModel: this.grid.externalAdvancedFilterModel() || this.grid.advFilter.buildModel(),
        listId: this.grid.activeListId(),
      });
      const data = this.grid.archiveMode()
        ? await this.gridSvc.getAllArchived(options)
        : await this.gridSvc.getAll(options);
      if (requestId !== this.loadSeq) return; // stale response — a newer request owns the grid state
      const incoming = data.rows ?? [];
      if (append && this.store.rows().length > 0) {
        const next = [...this.store.rows(), ...incoming];
        this.store.rows.set(next);
        this.grid.updateTableWindow(this.grid.startIndex(), this.grid.endIndex());
      } else {
        this.store.rows.set(incoming);
        this.grid.updateTableWindow(this.grid.startIndex(), this.grid.endIndex());
      }
      this.grid.totalCountAll.set(data.count ?? this.store.rows().length);
      this.store.pageIndex.set(index);
    } catch {
      // A stale failure must not toast over the newer request that superseded it.
      if (requestId === this.loadSeq) {
        this.alertSvc.showError(this.grid.config.messages.loadFailed);
      }
    } finally {
      end();
    }
  }

  async selectAllMatching(): Promise<{ ids: string[]; count: number }> {
    // Same filter/sort set as loadPage — built by the same helper so the two can never drift
    // again (this method once omitted filterModel, so "select all matching" and record
    // navigation acted on rows the user had filtered out). Only the page window is omitted:
    // the backend then serves its default limit (MAX_PAGE_SIZE), which is this feature's
    // documented cap. Sort is included so the record-navigation order matches the grid.
    const options: getAllOptionsType = this.dataSvc.buildGetAllOptions({
      searchStr: this.grid.searchTerm(),
      tags: this.grid.selectedTags(),
      issues: this.grid.selectedIssues(),
      filterModel: this.grid.buildFilterModel(),
      sortState: this.store.sorting() as unknown as Array<{ id: string; desc?: boolean }>,
      sortCol: this.grid.sortCol(),
      sortDir: this.grid.sortDir(),
      includeArchived: this.grid.archiveMode(),
      advancedFilterModel: this.grid.externalAdvancedFilterModel() || this.grid.advFilter.buildModel(),
      listId: this.grid.activeListId() ?? undefined,
    });
    const { rows } = this.grid.archiveMode()
      ? await this.gridSvc.getAllArchived(options)
      : await this.gridSvc.getAll(options);
    const rowCanSelect = this.grid.rowCanSelect();
    const filteredRows = rowCanSelect ? (rows ?? []).filter(rowCanSelect) : (rows ?? []);
    const ids = filteredRows.map((r) => this.grid.toId(r)).filter(Boolean);
    return { ids, count: filteredRows.length };
  }
}
