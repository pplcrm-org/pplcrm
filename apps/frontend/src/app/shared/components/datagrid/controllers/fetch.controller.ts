import { inject, Injectable } from '@angular/core';
import type { DataGrid } from '../datagrid';
import { AbstractAPIService } from '@frontend/services/api/abstract-api.service';
import { DataGridDataService } from '../services/data.service';
import { GridStoreService } from '../services/grid-store.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { Models } from '../../../../../../../../libs/common/src/lib/kysely.models';
import type { getAllOptionsType } from '../../../../../../../../libs/common/src';

/** What "select all matching" actually holds, stated so the UI can never overclaim. */
export interface MatchingSelection {
  /** The ids held — every bulk action and the record-nav walk operate on exactly these. */
  ids: string[];
  /** The true matched total on the server; exceeds ids.length when the answer was capped. */
  matched: number;
  /** True when ids are only the first server-capped window of the matching set. */
  capped: boolean;
}

@Injectable()
export class FetchController {
  private readonly gridSvc = inject(AbstractAPIService);
  private readonly dataSvc = inject(DataGridDataService);
  private readonly store = inject(GridStoreService);
  private readonly alertSvc = inject(AlertService);

  /** Monotonic sequence for loadPage calls — search/filter/sort/pagination fetches can
   *  resolve out of order, and a stale response must never repaint newer rows. */
  private loadSeq = 0;

  /**
   * The last matching-selection answer, keyed by the exact options that produced it. Exists for
   * the record-nav handoff: every record OPEN asks for the filtered id set, and without this each
   * open refetched it from the server. Cleared whenever loadPage repaints the grid (same filters
   * or not — the data may have changed), so the cache never outlives the rows on screen.
   */
  private matchingCache: { key: string; value: MatchingSelection } | null = null;

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
      this.matchingCache = null; // fresh rows on screen; a held id set may no longer match them
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

  /**
   * The full filtered id set — what "select all matching" holds and record navigation walks.
   *
   * Entities with an ids-only endpoint (persons, households — the two that reach six figures)
   * answer with just ids: the same filters and sort as loadPage, ~50 bytes per match instead of a
   * full row, capped server-side at MAX_SELECT_ALL_IDS with `capped` saying so. Everything else
   * falls back to one full-row page (the backend's MAX_PAGE_SIZE default), and the cap is derived
   * by comparing the rows received against the response's true count — so either way `matched` is
   * the server's total and `capped` is honest, and the caller must SAY "first N of M" when it is
   * set instead of claiming all M.
   */
  async selectAllMatching(): Promise<MatchingSelection> {
    const options = this.buildMatchingOptions();
    const result = await this.fetchMatching(options);
    this.matchingCache = { key: JSON.stringify(options), value: result };
    return result;
  }

  /**
   * Cache-first variant for the record-nav handoff. Reuses the last answer while the grid's rows
   * and options are unchanged — opening ten records from one page costs one fetch, not ten.
   */
  async matchingSelectionForNav(): Promise<MatchingSelection> {
    const options = this.buildMatchingOptions();
    const key = JSON.stringify(options);
    if (this.matchingCache?.key === key) return this.matchingCache.value;
    const result = await this.fetchMatching(options);
    this.matchingCache = { key, value: result };
    return result;
  }

  /** Same filter/sort set as loadPage — built by the same helper so the two can never drift
   *  again (this method once omitted filterModel, so "select all matching" and record
   *  navigation acted on rows the user had filtered out). Only the page window is omitted. */
  private buildMatchingOptions(): getAllOptionsType {
    return this.dataSvc.buildGetAllOptions({
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
  }

  private async fetchMatching(options: getAllOptionsType): Promise<MatchingSelection> {
    // The ids-only endpoint serves the live (non-archived) grid; archived grids are small and
    // take the fallback. Server-side exclusions (the placeholder household) match what
    // rowCanSelect filters out of full rows, so the two paths select the same records.
    if (!this.grid.archiveMode()) {
      const viaIds = await this.gridSvc.getMatchingIds(options);
      if (viaIds) return { ids: viaIds.ids, matched: viaIds.count, capped: viaIds.capped };
    }

    const { rows, count } = this.grid.archiveMode()
      ? await this.gridSvc.getAllArchived(options)
      : await this.gridSvc.getAll(options);
    const received = rows ?? [];
    const rowCanSelect = this.grid.rowCanSelect();
    const filteredRows = rowCanSelect ? received.filter(rowCanSelect) : received;
    const ids = filteredRows.map((r) => this.grid.toId(r)).filter(Boolean);
    const matched = count ?? ids.length;
    // Capped when the server held back matches — judged on rows RECEIVED, not rows kept, so a
    // client-side rowCanSelect exclusion is never misreported as a truncated answer.
    return { ids, matched, capped: received.length < matched };
  }
}
