import { Injectable } from '@angular/core';
import type { getAllOptionsType } from '../../../../../../../../libs/common/src';

@Injectable({ providedIn: 'root' })
export class DataGridDataService {
  computeTotalPages(totalCountAll: number, pageSize: number): number {
    const size = pageSize || 1;
    return Math.max(1, Math.ceil((totalCountAll || 0) / size));
  }

  /**
   * Assemble the server-side fetch options for one grid request.
   *
   * `startRow`/`endRow` are optional: the queued full export omits them, because the backend's
   * export job builds its own streaming query and ignores paging entirely. It used to send
   * `endRow: 10_000_000` to mean "everything", which the server took literally as `LIMIT
   * 10000000`; the shared schema now refuses a span wider than one page.
   */
  buildGetAllOptions(args: {
    searchStr: string;
    startRow?: number;
    endRow?: number;
    tags: string[];
    issues?: string[];
    filterModel: Record<string, unknown>;
    sortState: Array<{ id: string; desc?: boolean }>;
    sortCol: string | null;
    sortDir: 'asc' | 'desc' | null;
    includeArchived?: boolean;
    advancedFilterModel?: NonNullable<getAllOptionsType>['advancedFilterModel'];
    listId?: string | null;
  }): Partial<getAllOptionsType> {
    const {
      searchStr,
      startRow,
      endRow,
      tags,
      issues,
      filterModel,
      sortState,
      sortCol,
      sortDir,
      includeArchived,
      advancedFilterModel,
      listId,
    } = args;
    return {
      searchStr,
      startRow,
      endRow,
      tags,
      issues,
      filterModel,
      includeArchived,
      advancedFilterModel,
      listId: listId ?? undefined,
      sortModel:
        sortState && sortState.length
          ? sortState.map((s) => ({ colId: s.id, sort: s.desc ? 'desc' : 'asc' }))
          : sortCol && sortDir
            ? [{ colId: sortCol, sort: sortDir }]
            : [],
    } satisfies Partial<getAllOptionsType>;
  }
}
