//tsco: ignore

import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Tags } from '@experiences/tags/ui/tags';
import { AbstractAPIService } from '@frontend/services/api/abstract-api.service';
import { SearchService } from '@frontend/services/api/search-service';
import { ConfirmDialogService } from '@frontend/services/shared-dialog.service';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';
import {
  type Cell,
  type Header,
  type HeaderGroup,
  type Row,
  type SortingState,
  type Table,
  ColumnDef as TSColumnDef,
  type Updater,
} from '@tanstack/table-core';
import {
  QueryBuilderGroupNode,
  QueueExportInputType,
  cloneQueryBuilderNode,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';
// Virtualizer handled via controller
// Context available for future slices/controllers (not yet used here)
// import { GridContextService } from './state/grid-context.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { DateFormatService } from '../../services/date-format.service';
import { injectHelpDoor } from '../../help-doors';

import { ListsService } from '@experiences/lists/services/lists-service';
import { TagsService } from '@experiences/tags/services/tags-service';
import { QueryBuilderComponent, QueryBuilderField } from '../query-builder/query-builder';
import { PinningController } from './controllers/pinning.controller';
import { DATA_GRID_CONFIG, DEFAULT_DATA_GRID_CONFIG, type DataGridConfig } from './datagrid.tokens';
import { type ColumnDef as ColDef, SELECTION_COLUMN } from './grid-defaults';
import type { GridRow, HeaderRef } from './types';
import { DataGridActionsService } from './services/actions.service';
import { DataGridColumnsService } from './services/columns.service';
import { DataGridDataService } from './services/data.service';
import { DataGridFiltersService, type SelectEditorOptions } from './services/filters.service';
import { GridAdvancedFilterService } from './services/grid-advanced-filter.service';
import { GridTagFilterService } from './services/grid-tag-filter.service';
import { DataGridNavService } from './services/nav.service';
import { DataGridSelectionService } from './services/selection.service';
import { DataGridTableService } from './services/table.service';
import { TagOptionsService } from './services/tag-options.service';
import { DataGridUtilsService } from './services/utils.service';
import { DataGridFilterPanelComponent } from './ui/datagrid-filter-panel';
import { DataGridToolbarComponent } from './ui/datagrid-toolbar';
import { DataGridFilterDropdownComponent } from './ui/datagrid-filter-dropdown';
import { MultiselectFilterComponent } from './ui/multiselect-filter';
import { SingleselectFilterComponent, type SingleSelectOption } from './ui/singleselect-filter';

interface MergeableService {
  merge?(target: string, source: string): Promise<unknown>;
  mergePersons?(target: string, source: string): Promise<unknown>;
  mergeCompanies?(target: string, source: string): Promise<unknown>;
  mergeHouseholds?(target: string, source: string): Promise<unknown>;
}

/** One removable chip in the active-filters row above the grid. */
export interface GridFilterChip {
  kind: 'narrow' | 'tag' | 'issue' | 'list' | 'column' | 'advanced' | 'search';
  key: string;
  label: string;
}
// Header and inline filters rendered inline in template now
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { EditingController } from './controllers/editing.controller';
import { FetchController } from './controllers/fetch.controller';
import { KeyboardController } from './controllers/keyboard.controller';
import { ReorderController } from './controllers/reorder.controller';
import { ResizingController } from './controllers/resizing.controller';
import { EditableCellDirective } from './directives/editable-cell.directive';
import { HeaderResizeDirective } from './directives/header-resize.directive';
import { GridStoreService } from './services/grid-store.service';
import { UndoManager } from './undo-redo-mgr';
import { RecordNavigationService } from '@frontend/services/record-navigation.service';

@Component({
  selector: 'pc-datagrid',
  imports: [
    Icon,
    EmptyState,
    DataGridToolbarComponent,
    DataGridFilterPanelComponent,
    Tags,
    EditableCellDirective,
    HeaderResizeDirective,
    QueryBuilderComponent,
    GridHeaderComponent,
    DataGridFilterDropdownComponent,
    MultiselectFilterComponent,
    SingleselectFilterComponent,
    ModalShell,
  ],
  templateUrl: './datagrid.html',
  styleUrl: './datagrid.css',
  providers: [
    GridStoreService,
    PinningController,
    ResizingController,
    ReorderController,
    KeyboardController,
    EditingController,
    FetchController,
  ],
})
export class DataGrid<T extends keyof Models, U> implements OnInit, AfterViewInit, OnDestroy {
  public readonly config = inject<DataGridConfig>(DATA_GRID_CONFIG, { optional: true }) ?? DEFAULT_DATA_GRID_CONFIG;
  protected readonly dialogs = inject(ConfirmDialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly searchSvc = inject(SearchService);

  // Header resize handled by ResizingController

  //private readonly themeSvc = inject(ThemeService);
  public readonly _loading = createLoadingGate();

  // Persistence
  private _persistKey = 'pcdg';
  // selection width tracked in store
  // Selection resize handled by ResizingController
  // dragColId handled in ReorderController
  // Infinite append state handled by controller
  private readonly gridTable = viewChild<ElementRef<HTMLTableElement>>('gridTable');

  // Sticky pin offsets
  // header widths tracked by PinningController

  // Other State
  private lastRowHovered: string | undefined;
  private oldFilterText = '';
  // pin offsets tracked by PinningController

  // Optional cache placeholder removed (unused in current implementation)
  private readonly scrollerRef = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private tsColumns: TSColumnDef<GridRow, unknown>[] = [];
  private tsTable: Table<GridRow> | undefined;
  private readonly pctrl = inject(PinningController);
  private updateHeaderWidths = () => {
    const table = this.gridTable()?.nativeElement;
    if (!table) return;
    requestAnimationFrame(() => {
      if (!this.pctrl) return;
      this.pctrl.measureHeaderWidths(table);
      const minMap = this.computeHeaderMinWidths(table);
      if (Object.keys(minMap).length > 0) {
        this.headerMinWidths.set(minMap);
        this.enforceWidthMinimums(minMap);
      }
    });
  };
  // Virtualizer disabled for paginated grid

  // Injected Services
  public readonly alertSvc = inject(AlertService);
  private readonly dateFormatSvc = inject(DateFormatService);
  private readonly columnsSvc = inject(DataGridColumnsService);
  private readonly dataSvc = inject(DataGridDataService);
  private readonly filtersSvc = inject(DataGridFiltersService);
  private readonly selSvc = inject(DataGridSelectionService);
  private readonly tableSvc = inject(DataGridTableService);
  private readonly actionsSvc = inject(DataGridActionsService);
  private readonly navSvc = inject(DataGridNavService);
  private readonly utilsSvc = inject(DataGridUtilsService);
  public readonly store = inject(GridStoreService);
  private readonly rctrl = inject(ResizingController);
  private readonly kctrl = inject(KeyboardController);
  private readonly editingCtrl = inject(EditingController);
  private readonly fetchCtrl = inject(FetchController);
  private readonly reorder = inject(ReorderController);
  private readonly recordNav = inject(RecordNavigationService);
  public readonly searchTerm = this.searchSvc.searchSignal;
  private readonly hasEditableColumns = signal(false);
  // A "door" column (e.g. the People Name cell) opens the record on click and
  // replaces the hover open-icon; when present the selection column narrows to 36px.
  protected readonly hasDoorColumn = signal(false);
  private readonly headerMinWidths = signal<Record<string, number>>({});
  private readonly dgListsSvc = inject(ListsService, { optional: true });
  public readonly flashedCells = signal<Set<string>>(new Set());
  protected readonly countRowSelected = computed(() =>
    this.allSelected() ? this.allSelectedCount() : this.selectedIdSet().size,
  );

  private readonly selectionColumnWidthPx = 72;
  private readonly headerAutoSizeBufferPx = 8;

  /** Fields that should elastically absorb leftover width when visible, highest priority first. */
  private static readonly GROW_TEXT_FIELDS = ['description', 'notes'] as const;

  /**
   * Under {@link fitColumns}, exactly one visible column stretches to fill the leftover width so
   * short columns stay content-sized and the row still spans full width. Preference: a visible
   * description/notes column, else a column the grid flagged with `flex: true`, else the last
   * visible column. Returns `null` when content-fit sizing is off (legacy proportional stretch).
   */
  protected growColumnId(): string | null {
    if (!this.fitColumns()) return null;
    const headers = this.leafHeaders();
    if (!headers.length) return null;
    const textCol = headers.find((h) => DataGrid.GROW_TEXT_FIELDS.includes(h.column.id as never));
    if (textCol) return textCol.column.id;
    const flagged = headers.find((h) => this.getColDefById(h.column.id)?.flex === true);
    if (flagged) return flagged.column.id;
    return headers[headers.length - 1]?.column.id ?? null;
  }

  /**
   * The fixed width to pin a header/cell to, or `null` to leave it elastic (`width:auto`). The
   * single {@link growColumnId} returns `null` so it soaks up the table's leftover width.
   */
  protected fixedWidthPx(colId: string | null | undefined): number | null {
    if (colId && this.growColumnId() === colId) return null;
    return this.columnWidthPx(colId);
  }

  protected columnWidthPx(colId: string | null | undefined): number {
    if (!colId) return this.columnMinWidthPx(colId);
    return this.getColWidth(colId) ?? this.columnMinWidthPx(colId);
  }

  protected columnMinWidthPx(colId: string | null | undefined): number {
    if (!colId) return 40;
    const colDef = this.getColDefById(colId);
    const typeFloor = this.typeMinWidthPx(colDef);
    const configuredMin = colDef?.minWidth;
    if (typeof configuredMin === 'number' && configuredMin > 0) {
      return Math.max(configuredMin, typeFloor);
    }
    const minMap = this.headerMinWidths();
    const measured = minMap[colId];
    if (typeof measured === 'number' && measured > 0) {
      return Math.max(40, Math.ceil(measured), typeFloor);
    }
    return Math.max(40, typeFloor);
  }

  /**
   * A presentation floor for column kinds whose content reads badly when squeezed: tag/issue
   * chips wrap a letter per line, and free text collapses to "[…". Keeps them legible even when
   * a column has no explicit width and its header is short.
   */
  private typeMinWidthPx(colDef: ColDef | undefined): number {
    if (!colDef) return 0;
    if (colDef.tagColumn) return 120;
    if (colDef.field === 'notes' || colDef.field === 'description') return 200;
    return 0;
  }

  private clampColumnWidth(id: string, px: number): number {
    const base = Math.max(40, Math.floor(px));
    return Math.max(this.columnMinWidthPx(id), base);
  }

  // Computed derivations
  // Page size selection (persisted via GridStoreService)
  protected readonly pageSize = this.store?.pageSize ?? signal(25);
  protected readonly pageSizeChoices = computed(() => {
    const base = [25, 50, 100];
    const current = this.pageSize();
    return base.includes(current) ? base : [current, ...base];
  });
  protected readonly totalPages = computed(() => this.dataSvc.computeTotalPages(this.totalCountAll(), this.pageSize()));
  protected readonly canNext = computed(() => this.pageIndex() + 1 < this.totalPages());
  protected readonly canPrev = computed(() => this.pageIndex() > 0);
  protected readonly displayedCount = computed(() => this.rows().length);
  protected readonly isEmptyState = computed(
    () => this.hasLoaded() && !this.isLoading() && this.totalCountAll() === 0 && !this.hasActiveFilters(),
  );

  public readonly hasActiveFilters = computed(
    () =>
      this.selectedTags().length > 0 ||
      this.selectedIssues().length > 0 ||
      Object.keys(this.filterValues())?.length > 0 ||
      this.hasActiveAdvancedFilters(),
  );

  /** True when anything — including the list filter — is narrowing the results. */
  public readonly anyFilterActive = computed(
    () =>
      this.hasActiveFilters() ||
      this.selectedListId() !== null ||
      this.selectedNarrowType() !== null ||
      this.searchTerm().trim() !== '',
  );

  /** Every active filter as a named, individually removable chip. */
  protected readonly filterChips = computed<GridFilterChip[]>(() => {
    const chips: GridFilterChip[] = [];

    // An active search is filter truth too — surface it as a removable chip (§2), so it lives
    // in one place whether it arrived from the navbar search or the command palette hand-off.
    const search = this.searchTerm().trim();
    if (search) {
      chips.push({ kind: 'search', key: 'search', label: `Search: "${search}"` });
    }

    const narrow = this.selectedNarrowType();
    if (narrow !== null) {
      const option = this.narrowTypeOptions().find((o) => o.value === narrow);
      chips.push({ kind: 'narrow', key: narrow, label: `Type: ${option?.label ?? narrow}` });
    } else {
      // Tags chosen via a narrow-type preset are represented by the narrow chip alone.
      // Selected tags combine with OR and land as a single removable chip (§2).
      const tags = this.selectedTags();
      if (tags.length) {
        chips.push({ kind: 'tag', key: 'tags', label: `Tags: any of ${tags.join(', ')}` });
      }
    }

    // Selected issues combine with OR and land as a single removable chip (§2).
    const issues = this.selectedIssues();
    if (issues.length) {
      chips.push({ kind: 'issue', key: 'issues', label: `Issues: any of ${issues.join(', ')}` });
    }

    const listId = this.selectedListId();
    if (listId !== null) {
      const list = this.availableLists().find((l) => String(l['id'] ?? '') === String(listId));
      chips.push({ kind: 'list', key: String(listId), label: `List: ${String(list?.['name'] ?? 'selected')}` });
    }

    for (const [field, value] of Object.entries(this.filterValues())) {
      const text = this.describeFilterValue(value);
      if (!text) continue;
      chips.push({ kind: 'column', key: field, label: `${this.columnLabelFor(field)}: ${text}` });
    }

    if (this.hasActiveAdvancedFilters()) {
      chips.push({ kind: 'advanced', key: 'advanced', label: 'Advanced query' });
    }

    return chips;
  });

  protected removeFilterChip(chip: GridFilterChip): void {
    switch (chip.kind) {
      case 'narrow':
        this.selectNarrowType(null);
        break;
      case 'tag':
        // One chip represents all OR-ed tags — clear them together.
        this.clearTagsFilter();
        break;
      case 'issue':
        this.clearIssuesFilter();
        break;
      case 'list':
        this.clearListFilter();
        break;
      case 'column':
        this.clearHeaderFilter(chip.key);
        break;
      case 'advanced':
        this.clearAdvancedFilter();
        break;
      case 'search':
        this.searchSvc.clearSearch();
        break;
      default: {
        const _exhaustive: never = chip.kind;
        void _exhaustive;
      }
    }
  }

  /** Reset every filter domain at once, then reload from the first page. */
  protected clearAllFilters(): void {
    this.selectedNarrowType.set(null);
    this.selectedTags.set([]);
    this.selectedIssues.set([]);
    this.selectedListId.set(null);
    this.filterValues.set({});
    this.panelFilters.set({});
    this.searchSvc.clearSearch();
    this.store?.requestPersist();
    if (this.hasActiveAdvancedFilters()) {
      // clearAdvancedFilter triggers its own refresh.
      this.clearAdvancedFilter();
    } else {
      void this.loadPage(0);
    }
  }

  /** Human-readable value text for a column-filter chip, from the stored `{op,value}` /
   * array / plain-string shapes. Returns '' when the filter carries nothing to show. */
  private describeFilterValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '';
    if (typeof value === 'object' && 'value' in value) {
      const rec = value as { op?: unknown; value?: unknown };
      const op = String(rec.op ?? 'contains');
      if (op === 'isEmpty') return 'is empty';
      if (op === 'isNotEmpty') return 'is not empty';
      const v = rec.value;
      if (Array.isArray(v)) return v.length ? v.join(', ') : '';
      const s = v == null ? '' : String(v);
      return s;
    }
    return String(value);
  }

  // ── "+ Add filter" quick pill — a single field → operator → value entry that lands as one
  //    removable column chip. Reuses the same `filterValues` model the column/panel filters use
  //    (so removal, persistence, and the server filterModel all flow through the existing path);
  //    it does NOT fork a parallel filter representation.
  public readonly addFilterField = signal<string>('');
  public readonly addFilterOp = signal<string>('contains');
  public readonly addFilterValue = signal<string>('');
  public readonly addFilterOperators: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'does not contain' },
    { value: 'equals', label: 'equals' },
    { value: 'notEquals', label: 'does not equal' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' },
    { value: 'isEmpty', label: 'is empty' },
    { value: 'isNotEmpty', label: 'is not empty' },
  ];

  /** Fields offered in the Add-filter pill — every real column except the tag/issue columns
   * (those have their own dashed pills) and non-data columns. */
  public readonly addFilterFields = computed<Array<{ field: string; label: string }>>(() =>
    this.colDefs().flatMap((c) =>
      c.field && c.field !== 'actions' && c.field !== 'tags' && c.field !== 'issues' && c.tagColumn !== true
        ? [{ field: c.field, label: c.headerName || c.field }]
        : [],
    ),
  );

  /** Whether the currently-selected operator needs a value (isEmpty/isNotEmpty do not). */
  public readonly addFilterNeedsValue = computed(() => {
    const op = this.addFilterOp();
    return op !== 'isEmpty' && op !== 'isNotEmpty';
  });

  /** Commit the Add-filter pill selection as a column chip, then reload from page 1. */
  public applyAddFilter(): void {
    const field = this.addFilterField();
    if (!field) return;
    const op = this.addFilterOp();
    const needsValue = op !== 'isEmpty' && op !== 'isNotEmpty';
    const value = this.addFilterValue().trim();
    if (needsValue && !value) return;
    const next = { ...this.filterValues() };
    next[field] = { op, value: needsValue ? value : '' };
    this.filterValues.set(next);
    this.addFilterField.set('');
    this.addFilterOp.set('contains');
    this.addFilterValue.set('');
    void this.loadPage(0);
    this.store?.requestPersist();
  }

  /** Saved-list options for the dashed "Lists" pill (mirrors the toolbar's mapping). */
  public readonly listOptions = computed<SingleSelectOption[]>(() =>
    this.availableLists().map((l) => ({ value: String(l['id'] ?? ''), label: String(l['name'] ?? '') })),
  );

  public isColFiltered(field: string): boolean {
    const fv = this.filterValues();
    const val = fv[field];
    if (Array.isArray(val)) {
      return val.length > 0;
    }
    return val !== undefined && val !== null && val !== '';
  }
  // "The first load has finished" comes straight from the loading gate's ungated
  // `loaded` signal — set when a fetch completes (so totalCountAll is already in
  // place), even for a sub-300ms fetch that never trips the delayed spinner.
  public readonly hasLoaded = this._loading.loaded;

  /** Placeholder rows for the first-load skeleton (mirrors pc-table's default of 5). */
  protected readonly skeletonRowList = Array.from({ length: 5 }, (_, i) => i);
  public readonly gridSvc = inject<AbstractAPIService<T, U>>(AbstractAPIService);
  protected readonly hasSelection = computed(() =>
    this.allSelected() ? this.allSelectedCount() > 0 : this.selectedIdSet().size > 0,
  );
  public readonly hasSingleSelection = computed(() =>
    this.allSelected() ? this.allSelectedCount() === 1 : this.selectedIdSet().size === 1,
  );

  // Entity noun for selection/bulk-bar copy (e.g. "person"/"people"); defaults to row/rows.
  public readonly entityNoun = this.config.messages.entityNoun ?? 'row';
  public readonly entityNounPlural = this.config.messages.entityNounPlural ?? 'rows';
  public nounFor(n: number): string {
    return n === 1 ? this.entityNoun : this.entityNounPlural;
  }

  /**
   * The no-data empty state's copy and create action, derived from the same entityNoun the
   * toolbar's create button uses so the two can never disagree ("New person" in both places).
   * Falls back to generic wording when a grid config sets no noun.
   */
  public readonly hasEntityNoun = this.entityNoun !== 'row';
  public readonly emptyStateTitle = computed(() =>
    this.hasEntityNoun ? `No ${this.entityNounPlural} yet` : 'Nothing here yet',
  );
  public readonly emptyStateHint = computed(() =>
    this.hasEntityNoun
      ? `Your ${this.entityNounPlural} will appear here once you add the first one.`
      : 'Records will appear here once you add the first one.',
  );
  public readonly addLabel = computed(() => (this.hasEntityNoun ? `New ${this.entityNoun}` : 'New'));

  // Bulk "Add tag" — an inline field in the bulk action bar (§2).
  public readonly bulkTagOpen = signal(false);
  public readonly bulkTagValue = signal('');
  public openBulkTag(): void {
    this.bulkTagValue.set('');
    this.bulkTagOpen.set(true);
  }
  public cancelBulkTag(): void {
    this.bulkTagOpen.set(false);
    this.bulkTagValue.set('');
  }
  public async applyBulkTag(): Promise<void> {
    const tag = this.bulkTagValue().trim();
    if (!tag) return;
    const ids = this.getSelectedRows()
      .map((r) => String((r as { id?: unknown }).id ?? ''))
      .filter(Boolean);
    if (!ids.length) return;
    try {
      for (const id of ids) {
        await this.gridSvc.attachTag(id, tag, 'tag');
      }
      // Toast repeats the scale (§2 / §7.5).
      this.alertSvc.showSuccess(`Added ${tag} to ${ids.length} ${this.nounFor(ids.length)}.`);
      this.cancelBulkTag();
      void this.dgTagOptionsSvc.invalidate('tag');
      await this.loadPage(this.pageIndex());
    } catch (err) {
      console.error('Bulk tag failed', err);
      this.alertSvc.showError(`Could not add "${tag}" to all selected ${this.entityNounPlural}.`);
    }
  }

  // Display range helpers (1-based)
  protected readonly displayStartIndex = computed(() => {
    const total = this.totalCountAll();
    if (!total) return 0;
    return this.pageIndex() * this.pageSize() + 1;
  });
  protected readonly displayEndIndex = computed(() => {
    const total = this.totalCountAll();
    if (!total) return 0;
    const end = (this.pageIndex() + 1) * this.pageSize();
    return Math.min(end, total);
  });

  // Pager tooltips: enabled states name the action, disabled states name the
  // unmet condition (§2 pagination honesty / §7.2 acceptance checklist).
  protected readonly firstPageTitle = 'First page';
  protected readonly prevPageTitle = 'Previous page';
  protected readonly nextPageTitle = 'Next page';
  protected readonly lastPageTitle = 'Last page';
  protected readonly onFirstPageTitle = "You're on the first page";
  protected readonly onLastPageTitle = "You're on the last page";

  // Hidden columns list for header menu as a computed
  protected readonly hiddenColumns = computed(() => {
    const v = this.colVisibility();
    return this.colDefsWithEdit.map((c) => c.field as string).filter((f) => !!f && v[f] === false) as string[];
  });
  protected readonly selectedOnPageCount = computed(() => {
    if (this.allSelected()) return 0;
    const set = this.selectedIdSet();
    let cnt = 0;
    for (const r of this.rows()) {
      const id = this.toId(r);
      if (id && set.has(id)) cnt++;
    }
    return cnt;
  });
  public readonly rowNavigatesToDetail = computed(() => !this.disableView() && !this.hasEditableColumns());
  protected readonly isPageFullySelected = computed(() =>
    this.selSvc.isPageFullySelected(this.allSelected(), this.displayedCount(), this.selectedOnPageCount()),
  );

  // State & UI Signals
  // Removed isRowSelected in favor of hasSelection computed
  protected readonly router = inject(Router);
  public readonly undoMgr = new UndoManager();

  private readonly sectionHelp = injectHelpDoor();
  /** Explicit article id wins; otherwise the section's guide, resolved from the URL. */
  protected readonly helpDoor = computed<string>(() => this.helpArticle() ?? this.sectionHelp());

  // Select-all-across-results state
  protected readonly allSelected = this.store?.allSelected ?? signal(false);
  protected readonly allSelectedCount = this.store?.allSelectedCount ?? signal(0);
  protected readonly allSelectedIdSet = this.store?.allSelectedIdSet ?? signal(new Set());
  protected readonly allSelectedIds = this.store?.allSelectedIds ?? signal([]);
  public archiveMode = signal(false);
  protected colDefsWithEdit: ColDef[] = [SELECTION_COLUMN];
  protected colVisibility = this.store?.colVisibility ?? signal({});
  public readonly colWidths = this.store?.colWidths ?? signal({});

  // Inline edit state
  protected editingCell = signal<{ id: string; field: string } | null>(null);
  protected editingValue = signal<unknown>('');
  protected tagSearch = signal('');
  protected filterValues = this.store?.filterValues ?? signal({});
  protected isLoading = this._loading.visible;
  public readonly isRefreshing = signal(false);
  protected pageIndex = this.store?.pageIndex ?? signal(0);
  protected panelFilters = this.store?.panelFilters ?? signal({});
  protected rowHeight = 36;

  // Table state (TanStack-like minimal state)
  public readonly rows = this.store?.rows ?? signal<GridRow[]>([]);
  protected selectedIdSet = this.store?.selectedIdSet ?? signal(new Set());
  protected selectionStickyWidth = this.store?.selectionStickyWidth ?? signal(48);
  protected showFilterPanel = signal(false);
  protected showFilters = signal(false);
  public sortCol = signal<string | null>(null);
  public sortDir = signal<'asc' | 'desc' | null>(null);
  protected sorting = signal<SortingState>([]);
  protected suppressHeaderDrag = false;
  public totalCountAll = signal(0);
  // viewport handled by controller

  public readonly importCSV = output<string>();
  /** Fires after a delete flow completes and the grid has refreshed, so pages can re-query header counts. */
  public readonly rowsDeleted = output<void>();
  public readonly showArchiveIcon = input<boolean>(false);
  public readonly archiveIcon = input<PcIconNameType>('archive-box');
  public readonly archiveTip = input<string>('See archived tasks');
  public readonly labelForFn = (f: string) => this.panelLabelFor(f);
  public readonly optionsForFn = (f: string) => this.panelOptionsFor(f);
  // Header handlers now called directly by pc-dg-header via injection
  // header resize handled by pcHeaderResize directive

  // Inline filters row injects DataGrid directly; no adapters needed

  // Row/cell adapters used by directives/templates
  public readonly toIdFn = (row: unknown) => this.toId(row);
  public readonly inputTypeForFn = (col: ColDef) => this.inputTypeFor(col);
  public readonly createPayloadFn = (row: GridRow, key: string) => this.utilsSvc.createPayload(row, key);
  public readonly updateEditedRowInCachesFn = (id: string, f: string | undefined, v: unknown, prev?: unknown) =>
    this.updateEditedRowInCaches(id, f, v, prev);
  public readonly updateTableWindowFn = (s: number, e: number) => this.updateTableWindow(s, e);
  // Expose a simple persist method for header/directives
  public requestPersist() {
    this.store?.requestPersist();
  }
  public readonly coerceFn = (c: ColDef, raw: unknown) => this.coerceEditingValue(c, raw);

  public readonly editableCfg = (row: GridRow, col: ColDef) => ({
    row,
    col,
    toId: this.toIdFn,
    coerce: this.coerceFn,
    value: () => {
      const current = this.editingValue();
      return Array.isArray(current) ? [...current] : current;
    },
    setEditingCell: (v: { id: string; field: string } | null) => this.editingCell.set(v),
    setEditingValue: (v: unknown) => this.editingValue.set(v),
    getCellValue: (r: GridRow, c: ColDef) => this.getCellValue(r, c),
    getEditingDisplayValue: (r: GridRow, c: ColDef) => this.getEditingDisplayValue(r, c),
    createPayload: this.createPayloadFn,
    applyEdit: (id: string, data: Partial<GridRow>) =>
      this.gridSvc
        .update(id, data as unknown as U)
        .then(() => true)
        .catch(() => false),
    updateEditedRow: this.updateEditedRowInCachesFn,
    updateWindow: this.updateTableWindowFn,
    startIndex: () => this.startIndex(),
    endIndex: () => this.endIndex(),
    showSuccess: (m: string) => this.alertSvc.showSuccess(m),
    showError: (m: string) => this.alertSvc.showError(m),
    undo: () => this.undoMgr.undo(),
    customCommit: this.isTagColumn(col)
      ? async () => {
          await this.commitTagColumn(row, col);
        }
      : undefined,
    isEditable: () => this.isCellEditable(row, col),
    isEditingCell: () => {
      const ec = this.editingCell();
      return ec !== null && ec.id === this.toIdFn(row) && ec.field === col.field;
    },
  });

  // Inputs & Outputs
  public addRoute = input<string | null>(null);
  public viewRoute = input<string | null>(null);
  public allowFilter = input<boolean>(true);
  public colDefs = input<ColDef[]>([]);
  public disableDelete = input<boolean>(true);
  public disableMerge = input<boolean>(true);
  public disableExport = input<boolean>(false);
  public confirmDeleteOverride = input<
    ((selected: (Partial<RowOf<T>> & { id: string })[]) => Promise<boolean | void>) | null
  >(null);
  public disableImport = input<boolean>(false);
  public disableRefresh = input<boolean>(false);
  public disableView = input<boolean>(true);
  public enableSelection = input<boolean>(true);
  public rowCanSelect = input<(row: GridRow) => boolean>(() => true);
  public limitToTags = input<string[]>([]);
  public limitToIssues = input<string[]>([]);
  public narrowTypeOptions = input<Array<{ label: string; value: string | null; tags: string[]; count?: number }>>([]);
  public plusIcon = input<PcIconNameType>('plus');

  public showToolbar = input<boolean>(true);
  /** Per-column sort/filter/hide dropdown in the header. Off for read-only "reference table" grids. */
  public showColumnMenus = input<boolean>(true);
  /** Toolbar Columns picker (desktop dropdown and the phone "Columns…" row). Off for grids
   * whose column set is deliberately fixed (e.g. Donations). */
  public showColumnsButton = input<boolean>(true);
  /** Advanced-query-builder entry points (desktop and mobile). Off keeps the simple filter
   * panel and chip-row filters while dropping the rule builder. */
  public showQueryBuilder = input<boolean>(true);
  public isCellEditableOverride = input<((row: GridRow, col: ColDef) => boolean) | null>(null);

  public readonly externalAdvancedFilterModel = input<QueryBuilderGroupNode | null>(null);
  public listId = input<string | null>(null);
  public title = input<string | null>(null);
  public description = input<string | null>(null);
  public showDescription = input<boolean>(false);

  /**
   * Help Center article behind the header's ⓘ. Left unset it resolves from the route,
   * so every grid page offers its own guide for free; pass '' to suppress the door.
   */
  public helpArticle = input<string | null>(null);

  /**
   * Grain-specific total sentence rendered under the title (spec §5), e.g.
   * "5,012 people total" / "1,890 households across 8 wards" / "611 people in 214 companies".
   * When filters are active the header prefixes it: "43 match your filters · {sentence}".
   */
  public totalSentence = input<string | null>(null);

  /**
   * Grain-tab layout (People/Households/Companies grids, spec §5 + owner screenshot):
   * no in-grid title/ⓘ (redundant with the sidebar + breadcrumb) — the grain tabs and
   * toolbar share one band, and the count sentence renders below the filter row.
   */
  public grainLayout = input<boolean>(false);

  /**
   * Content-fit column sizing. When true, columns render at their content/configured width
   * instead of the browser stretching every column to fill the table, and a blank trailing
   * cell absorbs the leftover width so short columns stay tight and the row still spans full
   * width. Off by default so existing grids keep their proportional-stretch layout.
   */
  public fitColumns = input<boolean>(false);

  private readonly countFormatter = new Intl.NumberFormat();

  /** The "43 match your filters · 5,012 people total" sentence, rendered below the filter row in grain layout. */
  public readonly countSentence = computed<string | null>(() => {
    const count = this.hasLoaded() ? this.totalCountAll() : null;
    const sentence = this.totalSentence();
    if (count !== null && this.anyFilterActive()) {
      const matched =
        count === 1 ? '1 matches your filters' : `${this.countFormatter.format(count)} match your filters`;
      return sentence ? `${matched} · ${sentence}` : matched;
    }
    if (sentence) return sentence;
    if (count === null) return null;
    return count === 1 ? '1 total' : `${this.countFormatter.format(count)} total`;
  });

  protected readonly dgTagOptionsSvc = inject(TagOptionsService);

  // ── Tag / Issue filter — delegated to GridTagFilterService ───────────────
  private readonly tagFilter = new GridTagFilterService();

  // Proxy aliases — same public names the toolbar template accesses via grid.*
  public readonly allAvailableTags = this.tagFilter.allAvailableTags;
  public readonly selectedTags = this.tagFilter.selectedTags;
  public readonly tagSearchQuery = this.tagFilter.tagSearchQuery;
  public readonly allAvailableIssues = this.tagFilter.allAvailableIssues;
  public readonly selectedIssues = this.tagFilter.selectedIssues;
  public readonly issueSearchQuery = this.tagFilter.issueSearchQuery;
  public readonly filteredAvailableTags = this.tagFilter.filteredAvailableTags;
  public readonly filteredAvailableIssues = this.tagFilter.filteredAvailableIssues;

  // showTagFilter / showIssueFilter must stay here — they depend on the colDefs input signal
  public readonly showTagFilter = computed(() => {
    const defs = this.colDefs();
    return defs.some((col) => col.field === 'tags' || col.tagColumn === true);
  });

  public readonly showIssueFilter = computed(() => {
    const defs = this.colDefs();
    return defs.some((col) => col.field === 'issues' || col.field === 'issue');
  });

  public readonly showNarrowTypeFilter = computed(() => this.narrowTypeOptions().length > 0);
  public readonly selectedNarrowType = signal<string | null>(null);
  public readonly displayTitle = computed(() => {
    const selected = this.selectedNarrowType();
    if (selected !== null) {
      const option = this.narrowTypeOptions().find((o) => o.value === selected);
      if (option) return option.label;
    }
    return this.title() ?? null;
  });

  public selectNarrowType(value: string | null): void {
    // Already on this view — nothing to fetch.
    if (this.selectedNarrowType() === value) return;
    this.selectedNarrowType.set(value);
    const option = this.narrowTypeOptions().find((o) => o.value === value);
    const tags = option?.tags ?? [];
    this.tagFilter.selectedTags.set([...tags]);
    // A view is a server-side tag filter, so fetch page 1 of the new set — but via
    // the normal loading gate, not doRefresh()'s forced 1s spinner (that's for the
    // manual Refresh button). Feels like filtering, not a hard reload.
    void this.loadPage(0);
  }

  public toggleTagFilter(tag: string, checked: boolean) {
    this.selectedNarrowType.set(null);
    this.tagFilter.toggleTagFilter(tag, checked);
  }
  public clearTagsFilter() {
    this.selectedNarrowType.set(null);
    this.tagFilter.clearTagsFilter();
  }
  public selectAllTags() {
    this.tagFilter.selectAllTags();
  }
  public clearAllTagsVisible() {
    this.tagFilter.clearAllTagsVisible();
  }
  public toggleIssueFilter(issue: string, checked: boolean) {
    this.tagFilter.toggleIssueFilter(issue, checked);
  }
  public clearIssuesFilter() {
    this.tagFilter.clearIssuesFilter();
  }
  public selectAllIssues() {
    this.tagFilter.selectAllIssues();
  }
  public clearAllIssuesVisible() {
    this.tagFilter.clearAllIssuesVisible();
  }

  public selectedListId = signal<string | null>(null);
  public availableLists = signal<GridRow[]>([]);
  public activeListId = computed(() => this.listId() || this.selectedListId());
  public readonly showListFilter = computed(() => {
    const entity = this.config.messages.exportEntity;
    return (entity === 'persons' || entity === 'households') && !!this.dgListsSvc;
  });

  public selectListFilter(id: string) {
    this.selectedListId.set(id);
    void this.loadPage(0);
  }

  public clearListFilter() {
    this.selectedListId.set(null);
    void this.loadPage(0);
  }

  // ── Advanced Filter Builder — delegated to GridAdvancedFilterService ──────
  public readonly advFilter = new GridAdvancedFilterService();
  protected readonly tagsSvc = inject(TagsService, { optional: true });

  // Proxy aliases — same public names used by the toolbar and datagrid.html
  public readonly showAdvancedFilterBuilder = this.advFilter.showAdvancedFilterBuilder;
  public readonly advFilterRoot = this.advFilter.advFilterRoot;
  public readonly hasActiveAdvancedFilters = this.advFilter.hasActiveAdvancedFilters;

  protected readonly advancedFilterFields = computed<QueryBuilderField[]>(() => {
    return this.colDefsWithEdit
      .filter((c) => c.field && c.field !== 'actions' && c.field !== SELECTION_COLUMN.field)
      .map((c) => {
        const fieldName = c.field ?? '';
        const isTagCol = fieldName === 'tags' || fieldName === 'issues' || c.tagColumn === true;
        const operators = [
          { value: 'contains', label: 'contains' },
          { value: 'notContains', label: 'does not contain' },
          { value: 'equals', label: 'equals' },
          { value: 'notEquals', label: 'does not equal' },
          { value: 'startsWith', label: 'starts with' },
          { value: 'endsWith', label: 'ends with' },
          { value: 'isEmpty', label: 'is empty' },
          { value: 'isNotEmpty', label: 'is not empty' },
        ];
        return {
          name: fieldName,
          label: c.headerName || fieldName,
          operators,
          inputType: isTagCol ? ('autocomplete' as const) : ('text' as const),
        };
      });
  });

  public openAdvancedFilterBuilder() {
    this.advFilter.openAdvancedFilterBuilder(() => this.colDefsWithEdit);
  }
  public switchToAdvancedFilter() {
    this.advFilter.switchToAdvancedFilter(
      () => this.showFilterPanel.set(false),
      () => this.colDefsWithEdit,
    );
  }
  public applyAdvancedFilter() {
    this.advFilter.apply(() => void this.doRefresh());
  }
  public clearAdvancedFilter() {
    this.advFilter.clear(() => void this.doRefresh());
  }
  public onAdvancedFilterChanged() {
    this.advFilterRoot.update((root) => cloneQueryBuilderNode(root) as QueryBuilderGroupNode);
  }

  private _squelch = false;
  private _initialized = false;
  private _lastPageSize: number | null = null;

  constructor() {
    if (this.store) {
      this.store.grid = this;
    }

    // Navbar crumbs for grid pages come from the route's `data.breadcrumb` via
    // BreadcrumbDefaultsService — the grid no longer publishes its own. (Publishing
    // here broke on route-reuse: detached grids never ran their clear-on-destroy.)

    effect(() => {
      const count = this.gridSvc.refreshCount();
      if (count > 0) {
        untracked(() => {
          void this.refresh();
        });
      }
    });

    // Clear the tag search box whenever a different cell enters edit mode
    effect(() => {
      this.editingCell();
      this.tagSearch.set('');
    });

    // Prevents being stuck on an out-of-range page after filters change.
    effect(() => {
      if (this._squelch) return;
      const total = this.totalPages();
      const page = this.pageIndex();
      if (total > 0 && page >= total) {
        this._squelch = true;
        queueMicrotask(() => {
          // 2. Wrap the async call in an IIFE
          void (async () => {
            void (await this.loadPage(Math.max(0, total - 1)));
            this._squelch = false;
          })();
        });
      }
    });

    // React to global search (SSRM: trigger server-side filter)
    effect(() => {
      const quickFilterText = this.searchTerm();

      // Keep track of the old filter text to avoid unnecessary roundtrip
      if (quickFilterText !== this.oldFilterText) {
        this.oldFilterText = quickFilterText;
        void this.loadPage(0);
      }
    });
    // When page size changes, go back to first page (after init)
    effect(() => {
      const size = this.pageSize();
      if (!this._initialized) {
        this._lastPageSize = size;
        return;
      }
      if (this._lastPageSize === size) return;
      this._lastPageSize = size;
      void this.loadPage(0);
    });
    // Keep table data + selection + sorting synced when rows or sort change
    effect(() => {
      const rows = this.rows();
      // touch sort signals so effect re-runs when they change
      this.sortCol();
      this.sortDir();
      this.tableSvc.setTableData(
        this.tsTable,
        rows,
        this.buildRowSelectionForCurrentData(),
        this.sortCol(),
        this.sortDir(),
      );
    });

    // React to limitToTags input signal changes
    effect(() => {
      // Fallback to an empty array if the input is undefined or null
      const tags = this.limitToTags() || [];

      untracked(() => {
        this.tagFilter.selectedTags.set([...tags]);
        if (this._initialized) {
          void this.doRefresh();
        }
      });
    });

    // React to limitToIssues input signal changes
    effect(() => {
      // Fallback to an empty array if the input is undefined or null
      const issues = this.limitToIssues() || [];

      untracked(() => {
        this.tagFilter.selectedIssues.set([...issues]);
        if (this._initialized) {
          void this.doRefresh();
        }
      });
    });

    effect(() => {
      this.externalAdvancedFilterModel();
      untracked(() => {
        if (this._initialized) {
          void this.doRefresh();
        }
      });
    });

    effect(() => {
      this.listId();
      untracked(() => {
        if (this._initialized) {
          void this.doRefresh();
        }
      });
    });
    // Virtualizer count sync handled by controller
    // Pin offsets recompute centralized in PinningController
  }

  public getCountRowSelected() {
    return this.countRowSelected();
  }

  public getDefinition(): getAllOptionsType {
    return {
      searchStr: this.searchSvc.getFilterText(),
      sortModel: this.sorting().map((s) => ({ colId: s.id, sort: s.desc ? 'desc' : 'asc' })),
      filterModel: this.buildFilterModel(),
      tags: this.tagFilter.selectedTags(),
      issues: this.tagFilter.selectedIssues(),
    } as getAllOptionsType;
  }

  public ngAfterViewInit() {
    if (!this.store) {
      return;
    }
    // Virtualizer disabled for paged grid; no attach
    const el = this.scrollerRef()?.nativeElement;
    void el; // reserved for future use
    // Attach controllers to the table once
    this.pctrl.attachTable(this.tsTable);
    this.pctrl.init({
      getColWidth: (id) => this.getColWidth(id),
      getSelectionWidth: () => this.selectionStickyWidth(),
      getPinState: () => {
        const pin = this.tsTable?.getState().columnPinning;
        return { left: pin?.left ?? [], right: pin?.right ?? [] };
      },
    });
    // Measure header widths initially and on resize
    this.updateHeaderWidths();
    window.addEventListener('resize', this.updateHeaderWidths);
  }

  public ngOnDestroy(): void {
    if (!this.store) {
      return;
    }
    // Abort any inflight requests and release refs
    this.gridSvc.abort();
    this.tsTable = undefined;
    window.removeEventListener('resize', this.updateHeaderWidths);
  }

  public ngOnInit() {
    if (!this.store) {
      return;
    }

    void (async () => {
      this.undoMgr.initialize(this);

      await this.tagFilter.init({
        limitToTags: this.limitToTags(),
        limitToIssues: this.limitToIssues(),
        tagOptionsSvc: this.dgTagOptionsSvc,
        doRefresh: () => {
          void this.doRefresh();
        },
      });

      if (this.showListFilter() && this.dgListsSvc) {
        try {
          const listsResult: unknown = await this.dgListsSvc.getAll();
          const entity = this.config.messages.exportEntity;
          const expectedObject = entity === 'persons' ? 'people' : 'households';
          const listRows: unknown[] = Array.isArray(listsResult)
            ? listsResult
            : isRecord(listsResult) && Array.isArray(listsResult['rows'])
              ? listsResult['rows']
              : [];
          const filtered = listRows.filter((l): l is GridRow => isRecord(l) && l['object'] === expectedObject);
          this.availableLists.set(filtered);
        } catch (err) {
          console.error('Failed to load lists for filter:', err);
        }
      }

      this.selectionStickyWidth.set(this.selectionColumnWidthPx);

      // Initialize persistence key
      const urlKey = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
      this._persistKey = `pcdg:${urlKey}`;

      // Attempt to read saved column order before table creation
      let savedColumnOrder: string[] | undefined;
      try {
        const raw = localStorage.getItem(this._persistKey);
        if (raw) {
          const data = JSON.parse(raw || '{}') as { order?: string[] };
          if (Array.isArray(data?.order)) savedColumnOrder = data.order;
        }
      } catch {}

      // Note: allowFilter input retained for API compatibility (filter UI uses signals)
      const selectionCols = this.enableSelection() ? [SELECTION_COLUMN] : [];
      this.colDefsWithEdit = [...selectionCols, ...this.colDefs()];
      this.hasEditableColumns.set(this.colDefsWithEdit.some((col) => !!col?.editable));
      this.hasDoorColumn.set(this.colDefsWithEdit.some((col) => !!col?.doorColumn));

      // Initialize column visibility defaults
      const vis: Record<string, boolean> = {};
      for (const c of this.colDefsWithEdit) if (c.field) vis[c.field] = c.hide !== true;
      this.colVisibility.set(vis);

      // Build TanStack columns
      this.tsColumns = this.tableSvc.buildTsColumns(this.colDefsWithEdit);
      this.tsTable = this.tableSvc.createGridTable({
        rows: this.rows(),
        columns: this.tsColumns,
        getRowId: (row: GridRow) => this.toId(row),
        state: {
          sorting: this.sorting(),
          columnVisibility: this.colVisibility(),
          rowSelection: this.buildRowSelectionForCurrentData(),
          columnPinning: { left: [], right: [] },
          columnSizing: {},
          columnOrder: savedColumnOrder || [],
        },
        onStateChange: () => this.syncSignalsFromTable(),
        onSortingChange: (updater: Updater<SortingState>) => {
          const next = typeof updater === 'function' ? updater(this.tsTable?.getState().sorting ?? []) : updater;
          this.sorting.set(next);
          const first = next?.[0];
          this.sortCol.set(first?.id ?? null);
          this.sortDir.set(first?.desc ? 'desc' : first ? 'asc' : null);
          void this.loadPage(0);
          this.store.requestPersist();
        },
        onRowSelectionChange: (updater: Updater<Record<string, boolean>>) => {
          const current = this.tsTable?.getState().rowSelection ?? {};
          const next = typeof updater === 'function' ? updater(current) : updater;
          const set = new Set(this.selectedIdSet());
          const canSelectFn = this.rowCanSelect();
          for (const row of this.rows()) {
            const id = this.toId(row);
            if (!id) continue;
            if (canSelectFn && !canSelectFn(row)) {
              set.delete(id);
              continue;
            }
            if (next[id]) set.add(id);
            else set.delete(id);
          }
          this.selectedIdSet.set(set);
        },
        onColumnSizingChange: (updater: Updater<Record<string, number>>) => {
          const current = this.tsTable?.getState().columnSizing ?? {};
          const next = typeof updater === 'function' ? updater(current) : updater;
          this.colWidths.set({ ...next });
          this.tsTable?.setOptions((prev) => ({ ...prev, state: { ...prev.state, columnSizing: next } }));
          this.store.requestPersist();
        },
      });

      // Attach to store for syncing & persistence
      try {
        this.store.attachTable(this.tsTable);
        this.store.setPersistKey(this._persistKey);
        this.store.setGetRowId((row: GridRow) => this.toId(row));
      } catch {}

      // Load persisted state and apply to table before first load
      if (this.config.pageSize && this.config.pageSize > 0) this.store.pageSize.set(this.config.pageSize);
      this.store.loadState();
      // A door column replaces the open-icon, so the selection column only needs
      // to fit the checkbox (36px); without one it also holds the open-icon (72px).
      this.selectionStickyWidth.set(this.hasDoorColumn() ? 36 : this.selectionColumnWidthPx);

      await this.loadPage(0);
      this._initialized = true;
    })();
  }

  public triggerFilterChanged() {
    void this.loadPage(0);
  }

  protected add() {
    this.navSvc.navigateIfValid(this.router, this.route, this.addRoute());
  }
  public doAdd() {
    this.add();
  }

  protected cloneSelected() {
    if (!this.hasSingleSelection()) return;
    const selectedId = Array.from(this.selectedIdSet())[0];
    const selectedRow = this.rows().find((r) => this.toId(r) === selectedId);
    if (!selectedRow) return;

    void this.router.navigate([this.addRoute()], { relativeTo: this.route, state: { cloneData: selectedRow } });
  }

  public doClone() {
    this.cloneSelected();
  }

  protected applyPanelFilters() {
    const raw = this.panelFilters();
    const cleaned: Record<string, { op: string; value: string }> = {};
    for (const [k, v] of Object.entries(raw)) {
      const op = v?.op ?? 'contains';
      const sv = String(v?.value ?? '').trim();
      if (op === 'isEmpty' || op === 'isNotEmpty') {
        cleaned[k] = { op, value: '' };
      } else if (sv) {
        cleaned[k] = { op, value: sv };
      }
    }
    this.filterValues.set(cleaned);
    this.showFilterPanel.set(false);
    void this.loadPage(0);
  }

  public ariaSortHeader(h: Header<GridRow, unknown>): 'ascending' | 'descending' | 'none' {
    const s = typeof h?.column?.getIsSorted === 'function' ? h.column.getIsSorted() : undefined;
    if (s === 'asc') return 'ascending';
    if (s === 'desc') return 'descending';
    return 'none';
  }

  // Auto-size column based on header and currently visible cells
  public autoSizeColumn(h: Header<GridRow, unknown>) {
    const id = this.getFieldFromHeader(h);
    if (!id) return;
    const table = this.gridTable()?.nativeElement;
    if (!table) return;
    const px = this.columnsSvc.computeAutoSizeWidth(table, id);
    if (px > 0) this.setColWidth(id, px);
    this.store?.requestPersist();
  }

  // Virtualizer padding not used in paginated mode

  // Build a compact filter model from current UI filter values
  public buildFilterModel(): Record<string, unknown> {
    return this.filtersSvc.buildFilterModel(this.filterValues());
  }

  protected readonly sanitizer = inject(DomSanitizer);

  // Memoized sanitized cell HTML. callCellRenderer runs inside a template binding, so
  // it re-fires on every change-detection pass for every visible cell; without this it
  // would re-run the renderer AND DOMPurify O(rows × cols) times per CD cycle. Keyed by
  // the (stable) ColDef then the row data object — both WeakMap keys, so entries are
  // evicted automatically when a column or row is garbage-collected — and invalidated
  // when the cell's value changes.
  private readonly cellHtmlCache = new WeakMap<object, WeakMap<object, { value: unknown; html: SafeHtml }>>();
  private readonly emptyCellHtml: SafeHtml = this.sanitizer.bypassSecurityTrustHtml('');

  protected callCellRenderer(row: GridRow, col: ColDef): SafeHtml {
    const fn = col.cellRenderer;
    if (typeof fn !== 'function') {
      // Empty string is still valid SafeHtml
      return this.emptyCellHtml;
    }

    const value = this.hasValueFormatter(col) ? this.callValueFormatter(row, col) : this.getCellValue(row, col);

    let byRow = this.cellHtmlCache.get(col);
    if (!byRow) {
      byRow = new WeakMap<object, { value: unknown; html: SafeHtml }>();
      this.cellHtmlCache.set(col, byRow);
    }
    const cached = byRow.get(row);
    if (cached && Object.is(cached.value, value)) {
      return cached.html;
    }

    const raw = fn({ data: row, value, colDef: col });

    // Renderer strings may interpolate row data, so they are never trusted as-is:
    // DOMPurify strips script/event-handler payloads while keeping the markup
    // (class/style/img) renderers legitimately produce. SafeHtml is returned as-is.
    const html: SafeHtml =
      typeof raw === 'string' ? this.sanitizer.bypassSecurityTrustHtml(DOMPurify.sanitize(raw)) : (raw as SafeHtml);

    byRow.set(row, { value, html });
    return html;
  }

  protected callValueFormatter(row: GridRow, col: ColDef): unknown {
    const fn = col.valueFormatter;
    if (typeof fn === 'function') {
      return fn({ data: row, value: this.getCellValue(row, col), colDef: col });
    }
    return this.getCellValue(row, col);
  }

  /** Muted second line under a door cell (e.g. "3 people" under a household address). */
  protected callDoorSubtitle(row: GridRow, col: ColDef): string | null {
    const fn = col.doorSubtitle;
    if (typeof fn !== 'function') return null;
    return fn({ data: row, value: this.getCellValue(row, col), colDef: col });
  }

  // canNext/canPrev are computed
  protected cancelEdit() {
    this.editingCell.set(null);
  }

  public clearAllSelection() {
    this.allSelected.set(false);
    this.allSelectedIds.set([]);
    this.allSelectedIdSet.set(new Set());
    this.allSelectedCount.set(0);
  }

  public clearHeaderFilter(field: string) {
    const next = { ...this.filterValues() };
    delete next[field];
    this.filterValues.set(next);
    void this.loadPage(0);
    this.store?.requestPersist();
  }

  protected clearPanelFilters() {
    this.panelFilters.set({});
  }

  public clearSort(h: Header<GridRow, unknown>) {
    if (typeof h?.column?.clearSorting === 'function') {
      h.column.clearSorting();
      return;
    }
    // Fallback: remove from sorting state
    const id = this.getFieldFromHeader(h);
    if (!id) return;
    const next = this.sorting().filter((s) => s.id !== id);
    this.sorting.set(next);
    this.tsTable?.setOptions((prev) => ({ ...prev, state: { ...prev.state, sorting: next } }));
    void this.loadPage(0);
  }

  protected closePanel() {
    this.showFilterPanel.set(false);
  }

  public columnLabelFor(id: string): string {
    const c = this.colDefsWithEdit.find((x) => x.field === id);
    return c?.headerName || id;
  }

  protected async commitEdit(row: GridRow, col: ColDef) {
    if (!col.field) return;

    if (this.isTagColumn(col)) {
      await this.commitTagColumn(row, col);
      return;
    }

    const value = this.editingValue();
    if (this.editingCtrl) {
      await this.editingCtrl.commitSingleCell(row, col, this.coerceEditingValue(col, value));
    }
    this.editingCell.set(null);
  }

  private getRowDisplayName(row: unknown): string {
    if (!isRecord(row)) return 'Unnamed Record';
    if (row['first_name'] !== undefined || row['last_name'] !== undefined) {
      const parts = [row['first_name'], row['last_name']].filter(Boolean);
      return parts.length ? parts.join(' ') : 'Unnamed Person';
    }
    if (row['street1'] !== undefined || row['street_num'] !== undefined) {
      const parts = [row['street_num'], row['street1'], row['apt'], row['city']].filter(Boolean);
      return parts.length ? parts.join(' ') : 'Unnamed Household';
    }
    if (row['name']) return String(row['name']);
    if (row['display_name']) return String(row['display_name']);
    if (row['id']) return `Record #${String(row['id'])}`;
    return 'Unnamed Record';
  }

  protected async confirmMerge() {
    const svc = this.gridSvc as unknown as MergeableService;
    const mergeFn = svc.merge || svc.mergePersons || svc.mergeCompanies || svc.mergeHouseholds;

    if (!mergeFn) {
      this.alertSvc.showError('Merging is not supported for this data grid.');
      return;
    }

    const selectedRows = this.getSelectedRows();
    if (selectedRows.length !== 2) {
      this.alertSvc.showError('Please select exactly 2 rows to merge.');
      return;
    }

    const [row1, row2] = selectedRows;
    if (!row1 || !row2) return;
    const name1 = this.getRowDisplayName(row1);
    const name2 = this.getRowDisplayName(row2);

    const primaryChoice = await this.dialogs.choose({
      title: 'Select Primary Record',
      message:
        'Choose which record you want to keep as the primary record. The other record will be merged into this one and permanently deleted.',
      variant: 'info',
      choices: [
        {
          label: `${name1} (Keep this, merge the other into this)`,
          value: { target: row1, source: row2 },
        },
        {
          label: `${name2} (Keep this, merge the other into this)`,
          value: { target: row2, source: row1 },
        },
      ],
    });

    if (!primaryChoice) return;

    const targetName = this.getRowDisplayName(primaryChoice.target);
    const sourceName = this.getRowDisplayName(primaryChoice.source);

    const confirmed = await this.dialogs.confirm({
      title: 'Confirm Merge',
      message: `Are you sure you want to merge "${sourceName}" into "${targetName}"? This action will permanently delete "${sourceName}" and cannot be undone.`,
      variant: 'warning',
      confirmText: 'Merge',
      cancelText: 'Cancel',
    });

    if (!confirmed) return;

    const end = this._loading.begin();
    try {
      if (typeof svc.merge === 'function') {
        await svc.merge(primaryChoice.target.id, primaryChoice.source.id);
      } else if (typeof svc.mergePersons === 'function') {
        await svc.mergePersons(primaryChoice.target.id, primaryChoice.source.id);
      } else if (typeof svc.mergeCompanies === 'function') {
        await svc.mergeCompanies(primaryChoice.target.id, primaryChoice.source.id);
      } else if (typeof svc.mergeHouseholds === 'function') {
        await svc.mergeHouseholds(primaryChoice.target.id, primaryChoice.source.id);
      } else {
        throw new Error('No merge service method available');
      }

      this.alertSvc.showSuccess(`Successfully merged into "${targetName}"`);
      this.clearAllSelection();
      await this.refresh();
    } catch (err) {
      console.error(err);
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Merge failed');
    } finally {
      end();
    }
  }

  protected async confirmDelete(selectedRows?: (Partial<RowOf<T>> & { id: string })[]): Promise<boolean | void> {
    if (this.disableDelete()) {
      this.alertSvc.showError(this.config.messages.noDeletePermission);
      return true;
    }

    const overrideFn = this.confirmDeleteOverride();
    if (overrideFn) {
      const selected = selectedRows || this.getSelectedRows();
      const handled = await overrideFn(selected);
      if (handled !== false) {
        this.clearAllSelection();
        await this.refresh();
        this.rowsDeleted.emit();
        return true;
      }
    }

    await this.actionsSvc.confirmDeleteAndRun({
      _loading: this._loading,
      dialogs: this.dialogs,
      alertSvc: this.alertSvc,
      getSelectedRows: () => selectedRows || this.getSelectedRows(),
      gridSvc: this.gridSvc,
      config: this.config,
    });

    // Always clear our select-all cache after a delete attempt
    this.clearAllSelection();
    await this.refresh();
    this.rowsDeleted.emit();
    return true;
  }
  public doConfirmDelete() {
    void this.confirmDelete();
  }

  public doConfirmMerge() {
    void this.confirmMerge();
  }
  protected async confirmExport(): Promise<void> {
    await this.actionsSvc.doExportCsv({
      dialogs: this.dialogs,
      alertSvc: this.alertSvc,
      config: this.config,
      displayedCount: this.displayedCount(),
      totalCount: this.totalCountAll(),
      getRowsForExport: () => this.rows().map((r) => ({ ...r })),
      queueFullExport: () => this.queueFullExport(),
      logInstantExport: (rowCount) => this.logInstantExport(rowCount),
    });
  }
  public doConfirmExport() {
    void this.confirmExport();
  }

  protected cyclePin(h: Header<GridRow, unknown>) {
    const current = this.pinState(h);
    const next = current === 'left' ? 'right' : current === 'right' ? false : 'left';
    const pin = h?.column?.pin;
    if (typeof pin === 'function') pin.call(h.column, next);
    this.store?.requestPersist();
  }

  public doImportCSV() {
    // Emit a simple signal so consumers can open their import UI
    this.importCSV.emit('open');
  }

  public endIndex(): number {
    return this.rows().length;
  }

  // exportToCSV removed (legacy path)
  public filter() {
    // Open right-side filter panel and seed with current filters
    const current = this.filterValues();
    this.panelFilters.set(this.filtersSvc.preparePanelFilters(current));
    this.showFilterPanel.set(true);
  }

  // Helpers for template-safe access to dynamic fields/formatters/renderers
  protected getCellValue(row: GridRow, col: ColDef): unknown {
    const field = col.field ?? '';
    // Prefer valueGetter when provided
    const vget = col.valueGetter;
    if (typeof vget === 'function') {
      try {
        return vget({ data: row, colDef: col, value: field ? row[field] : undefined });
      } catch {
        // fall through to field lookup
      }
    }
    return field ? row[field] : undefined;
  }

  protected getEditingDisplayValue(row: GridRow, col: ColDef): unknown {
    return this.getCellValue(row, col);
  }

  public getColDefById(id: string): ColDef | undefined {
    return this.colDefsWithEdit.find((c) => c.field === id);
  }

  public getColWidth(id: string): number | null {
    const min = this.columnMinWidthPx(id);
    // A user-resized width always wins (persisted in colWidths, mirrored into columnSizing).
    const stored = this.colWidths()[id];
    if (typeof stored === 'number' && stored > 0) return Math.max(stored, min);
    // An explicit per-column preferred width comes next.
    const colDef = this.getColDefById(id);
    if (typeof colDef?.width === 'number' && colDef.width > 0) return Math.max(colDef.width, min);
    // On content-fit grids, unsized columns fall to their content/min width and the grow column
    // soaks up the slack — so short columns stay tight instead of stretching to fill.
    if (this.fitColumns()) return min;
    // Legacy grids keep TanStack's default column size so existing layouts don't shift.
    const size = this.tsTable?.getColumn?.(id)?.getSize?.();
    if (typeof size === 'number' && size > 0) return Math.max(size, min);
    return min;
  }

  // displayedCount is computed
  protected getFieldFromHeader(h: Header<GridRow, unknown>): string | null {
    const id = h?.column?.id;
    return typeof id === 'string' ? id : null;
  }

  protected getFilterArray(field: string): string[] {
    return this.filtersSvc.getFilterArray(this.filterValues(), field);
  }

  // Helper to derive filter select options from a column definition
  public getFilterOptionsForCol(col: ColDef): string[] | null {
    return this.filtersSvc.getFilterOptionsForCol(col);
  }

  protected selectEditorOptions(col: ColDef): SelectEditorOptions | null {
    return this.filtersSvc.getSelectEditorOptions(col);
  }

  protected async onSelectChange(row: GridRow, col: ColDef, newValue: unknown) {
    const resolvedValue = Array.isArray(newValue) ? newValue[0] : newValue;
    // Update the editing value first so commitEdit reads the correct value
    this.editingValue.set(resolvedValue);
    await this.commitEdit(row, col);
  }

  /** Current editing value normalized for a text `[value]` binding (`null`/`undefined` → empty string). */
  protected editingValueText(): string {
    const v = this.editingValue();
    return v == null ? '' : String(v);
  }

  /**
   * Whether a single-select editor option matches the current editing value.
   * String comparison mirrors how the native `<option [value]>` stringifies values in the DOM.
   */
  protected isEditorOptionSelected(value: unknown): boolean {
    const raw = this.editingValue();
    const current = Array.isArray(raw) ? raw[0] : raw;
    return String(current ?? '') === String(value ?? '');
  }

  /** Whether a multi-select editor option is part of the current editing value array. */
  protected isEditorOptionMultiSelected(value: unknown): boolean {
    const raw = this.editingValue();
    if (!Array.isArray(raw)) return false;
    return raw.some((entry) => String(entry ?? '') === String(value ?? ''));
  }

  /** Multi-select editor change: editing value = the string values of all selected options. */
  protected onMultiSelectEditorChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.editingValue.set(Array.from(target.selectedOptions).map((opt) => opt.value));
  }

  protected tagsAsStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const tags: string[] = [];
    for (const entry of value) {
      const normalized = entry == null ? '' : String(entry).trim();
      if (normalized) tags.push(normalized);
    }
    return tags;
  }

  protected async handleTagRemoved(row: GridRow, col: ColDef, tagName: string) {
    if (!col?.field || !this.isTagColumn(col)) return;
    const trimmed = typeof tagName === 'string' ? tagName.trim() : '';
    if (!trimmed) return;

    const current = this.getCellValue(row, col);
    const previous = this.utilsSvc.normalizeTagSelection(current);
    if (!previous.includes(trimmed)) return;

    const next = previous.filter((tag) => tag !== trimmed);
    await this.persistTagSelection(row, col, next, {
      successMessage: `Removed tag "${trimmed}"`,
    });
  }

  protected isTagColumn(col: ColDef): boolean {
    if (!col) return false;
    if (col.tagColumn) return true;
    const field = (col.field ?? '').toLowerCase();
    return field === 'tags' || field === 'issues';
  }

  protected async commitTagColumn(row: GridRow, col: ColDef) {
    try {
      const next = this.utilsSvc.normalizeTagSelection(this.editingValue());
      await this.persistTagSelection(row, col, next);
    } finally {
      this.editingCell.set(null);
    }
  }

  protected tagEditorChoices(col: ColDef): string[] {
    const opts = this.selectEditorOptions(col);
    return (opts?.choices.map((c) => c.value).filter(Boolean) ?? []).sort();
  }

  protected filteredTagChoices(col: ColDef): string[] {
    const q = this.tagSearch().trim().toLowerCase();
    const all = this.tagEditorChoices(col);
    return q ? all.filter((t) => t.toLowerCase().includes(q)) : all;
  }

  protected isTagChecked(tag: string): boolean {
    const v = this.editingValue();
    return Array.isArray(v) && v.includes(tag);
  }

  protected toggleTagInEditor(tag: string, checked: boolean) {
    const raw = this.editingValue();
    const current: string[] = Array.isArray(raw) ? raw.map((t) => String(t)) : [];
    if (checked && !current.includes(tag)) {
      this.editingValue.set([...current, tag]);
    } else if (!checked) {
      this.editingValue.set(current.filter((t) => t !== tag));
    }
  }

  protected async persistTagSelection(
    row: GridRow,
    col: ColDef,
    desired: string[],
    opts?: { successMessage?: string },
  ) {
    const field = col.field;
    if (!field) return;

    const id = this.toId(row);
    if (!id) return;

    const previous = this.utilsSvc.normalizeTagSelection(this.getCellValue(row, col));
    const next = this.utilsSvc.normalizeTagSelection(desired);

    const diff = this.diffTagSelection(previous, next);
    if (!diff.hasChanges) return;
    const applyTags = (tags: string[], prevTags?: string[]) => {
      const safe = Array.isArray(tags) ? [...tags] : [];
      row[field] = safe;
      this.updateEditedRowInCachesFn(id, field, safe, prevTags);
      this.updateTableWindowFn(this.startIndex(), this.endIndex());
    };

    applyTags(next, previous);

    try {
      const removedTeamNames = await this.applyTagDiff(id, diff, col);
      const finalTags = await this.refreshTagsFromServer(id, next, col);
      applyTags(finalTags, previous);
      this.notifyTagSuccess(opts?.successMessage, removedTeamNames, diff);
    } catch {
      applyTags(previous, previous);
      const errorMsg = this.tagTypeFor(col) === 'issue' ? 'Failed to update issues' : 'Failed to update tags';
      this.alertSvc.showError(errorMsg);
    }
  }

  /** Resolve whether a column edits tags or issues from its renderer params. */
  protected tagTypeFor(col?: ColDef): 'tag' | 'issue' {
    const params: unknown = col?.cellRendererParams;
    return isRecord(params) && params['tagType'] === 'issue' ? 'issue' : 'tag';
  }

  private diffTagSelection(previous: string[], next: string[]): TagDiff {
    const toAdd = next.filter((tag) => !previous.includes(tag));
    const toRemove = previous.filter((tag) => !next.includes(tag));
    return {
      toAdd,
      toRemove,
      hasChanges: toAdd.length > 0 || toRemove.length > 0,
    };
  }

  private async applyTagDiff(id: string, diff: TagDiff, col?: ColDef): Promise<string[]> {
    const removedTeamNames: string[] = [];
    const type = this.tagTypeFor(col);

    for (const tag of diff.toRemove) {
      const detachResult = await this.gridSvc.detachTag(id, tag, type);
      if (detachResult === false) {
        throw new Error('Tag removal was rejected');
      }
      const teams = isRecord(detachResult) ? detachResult['removed_teams'] : undefined;
      if (Array.isArray(teams)) {
        for (const team of teams) {
          const name = isRecord(team) && typeof team['name'] === 'string' ? team['name'] : '';
          removedTeamNames.push(name || 'Unnamed team');
        }
      }
    }

    for (const tag of diff.toAdd) {
      await this.gridSvc.attachTag(id, tag, type);
    }

    // Bust the cache so the next tag/issue dropdown open re-fetches fresh names
    if (diff.toAdd.length > 0 || diff.toRemove.length > 0) {
      void this.dgTagOptionsSvc.invalidate(type);
    }

    return removedTeamNames;
  }

  private async refreshTagsFromServer(id: string, fallback: string[], col?: ColDef): Promise<string[]> {
    try {
      const type = this.tagTypeFor(col);
      const refreshed = await this.gridSvc.getTags(id, type);
      if (Array.isArray(refreshed)) {
        return [...refreshed];
      }
    } catch {
      // ignore refresh errors; fall back to optimistic state
    }
    return fallback;
  }

  private notifyTagSuccess(successMessage: string | undefined, removedTeamNames: string[], diff: TagDiff) {
    const hasRemovedTeams = removedTeamNames.length > 0;
    const message = successMessage ?? this.buildTagSuccessMessage(diff);
    if (!message && !hasRemovedTeams) return;

    if (message) {
      if (hasRemovedTeams) {
        this.alertSvc.showSuccess(`${message}; removed from teams: ${removedTeamNames.join(', ')}`);
      } else {
        this.alertSvc.showSuccess(message);
      }
      return;
    }

    this.alertSvc.showSuccess(`Removed from teams: ${removedTeamNames.join(', ')}`);
  }

  private buildTagSuccessMessage(diff: TagDiff): string | undefined {
    const additions = diff.toAdd;
    const removals = diff.toRemove;
    if (!additions.length && !removals.length) return undefined;

    if (additions.length && !removals.length) {
      return additions.length === 1 ? `Added tag "${additions[0]}"` : `Added ${additions.length} tags`;
    }

    if (removals.length && !additions.length) {
      return removals.length === 1 ? `Removed tag "${removals[0]}"` : `Removed ${removals.length} tags`;
    }

    const parts: string[] = [];
    if (additions.length) {
      parts.push(additions.length === 1 ? `added "${additions[0]}"` : `added ${additions.length} tags`);
    }
    if (removals.length) {
      parts.push(removals.length === 1 ? `removed "${removals[0]}"` : `removed ${removals.length} tags`);
    }
    return `Tags updated (${parts.join('; ')})`;
  }

  protected multiSelectHeight(options: SelectEditorOptions | null): string | null {
    if (!options?.multiple) return null;
    const rows = options.size && options.size > 0 ? Math.floor(options.size) : 5;
    const rowHeightRem = 1.6;
    const paddingRem = 0.75;
    return `${rows * rowHeightRem + paddingRem}rem`;
  }

  protected getTextEditorConfig(col: ColDef): { textarea: boolean; rows: number } {
    const params = this.resolveEditorParams(col);
    const multilineFlag = Boolean(params?.['textarea'] ?? params?.['multiline']);
    const rowsRaw = params?.['rows'] ?? params?.['textareaRows'] ?? params?.['lines'];
    const rowsNum = Number(rowsRaw);
    const rows = Number.isFinite(rowsNum) && rowsNum > 0 ? Math.floor(rowsNum) : 5;
    return { textarea: multilineFlag, rows: multilineFlag ? rows : 1 };
  }

  public getFilterValue(field: string): string {
    return this.filtersSvc.getFilterValue(this.filterValues(), field);
  }

  public getSelectedRows(): (Partial<RowOf<T>> & { id: string })[] {
    const currentRows = this.rows();
    const rowById = new Map<string, GridRow>();
    for (const row of currentRows) {
      const id = this.toId(row);
      if (id) rowById.set(id, row);
    }

    const toRow = (id: string): GridRow & { id: string } => {
      const fromPage = rowById.get(id);
      if (fromPage) {
        return { ...fromPage, id };
      }
      return { id };
    };

    if (this.allSelected()) {
      const ids = this.allSelectedIds();
      return ids.map((id) => toRow(id)) as unknown as (Partial<RowOf<T>> & { id: string })[];
    }
    const ids = this.selectedIdSet();
    return Array.from(ids).map((id) => toRow(id)) as unknown as (Partial<RowOf<T>> & { id: string })[];
  }

  protected handleCellClick(row: GridRow, col: ColDef, event?: Event) {
    if (col.isCellInteractive && !col.isCellInteractive(row)) return;
    // The door cell (e.g. Name) opens the record, routing through view() so the
    // filtered record-navigation context (prev/next, "N of M") is captured.
    if (col.doorColumn) {
      const id = this.toId(row);
      if (id) this.openEdit(id);
      return;
    }
    if (typeof col.onCellClicked === 'function') {
      col.onCellClicked({ data: row, colDef: col, event });
    }
  }

  protected handleCellDblClick(row: GridRow, col: ColDef) {
    if (col.isCellInteractive && !col.isCellInteractive(row)) return;
    if (this.isCellEditable(row, col)) {
      this.startEdit(row, col);
      return;
    }
    if (typeof col.onCellDoubleClicked === 'function') {
      col.onCellDoubleClicked({ data: row, colDef: col });
    } else {
      this.openEditOnDoubleClick(row);
    }
  }

  protected hasCellRenderer(col: ColDef): boolean {
    return !!col.cellRenderer;
  }

  /** Resolves a column's optional `cellClass` (static string or per-row function) for the cell `<td>`. */
  protected cellClassFor(col: ColDef, row: GridRow): string {
    const cc = col.cellClass;
    if (!cc) return '';
    return (typeof cc === 'function' ? cc({ data: row, colDef: col }) : cc) ?? '';
  }

  protected hasValueFormatter(col: ColDef): boolean {
    return typeof col.valueFormatter === 'function';
  }

  // headerClick removed; using explicit header API bindings instead

  protected headerGroups(): HeaderGroup<GridRow>[] {
    return this.tsTable?.getHeaderGroups() ?? [];
  }

  protected hideAllCols() {
    const v = { ...this.colVisibility() };
    for (const c of this.colDefsWithEdit) if (c.field && !c.noHide) v[c.field] = false;
    this.colVisibility.set(v);
    if (this.tsTable) this.tsTable.setOptions((prev) => ({ ...prev, state: { ...prev.state, columnVisibility: v } }));
  }
  public hideAllColsPublic() {
    this.hideAllCols();
  }

  public hideColumn(h: Header<GridRow, unknown>) {
    const id = this.getFieldFromHeader(h);
    if (!id) return;
    this.toggleCol(id, false);
    if (typeof h?.column?.toggleVisibility === 'function') h.column.toggleVisibility(false);
  }

  // Inline filter row helpers for multi-select label
  public inlineFilterLabel(field: string): string {
    return this.filtersSvc.inlineFilterLabel(this.filterValues(), field);
  }

  protected inputTypeFor(col: ColDef): 'text' | 'number' | 'date' | 'color' {
    const t = String(col?.cellDataType || '').toLowerCase();
    if (t === 'number' || t === 'numeric') return 'number';
    if (t === 'date' || t === 'datetime' || t === 'dateonly') return 'date';
    if (t === 'color' || t === 'colour') return 'color';
    return 'text';
  }

  /**
   * Renders a raw cell value, applying the tenant's configured date format to date-typed columns that
   * don't define their own valueFormatter. Non-date columns are returned unchanged.
   */
  protected formatGridCell(col: ColDef, value: unknown): unknown {
    if (this.inputTypeFor(col) === 'date') {
      const formatted =
        typeof value === 'string' || typeof value === 'number' || value instanceof Date || value == null
          ? this.dateFormatSvc.format(value)
          : '';
      return formatted || value;
    }
    return value;
  }

  // Toolbar helpers
  public canUndo() {
    return !!this.undoMgr.canUndo();
  }
  public canRedo() {
    return !!this.undoMgr.canRedo();
  }
  public undo() {
    void this.undoMgr.undo();
  }
  public redo() {
    void this.undoMgr.redo();
  }
  public showFiltersState() {
    return this.showFilterPanel() || this.showFilters();
  }
  public archiveModeState() {
    return this.archiveMode();
  }
  public hasSelectionState() {
    return this.hasSelection();
  }
  public getColDefsForToolbar() {
    // Identity columns (noHide) are omitted from the visibility toggle list.
    return this.colDefsWithEdit.filter((c) => !c.noHide);
  }
  public getColVisibilityMap() {
    return this.colVisibility();
  }

  protected isColVisible(c: ColDef): boolean {
    const v = this.colVisibility();
    if (!c.field) return true;
    return v[c.field] !== false;
  }

  // Inline edit helpers
  protected isEditable(col: ColDef): boolean {
    return !!col?.editable;
  }

  public isCellEditable(row: GridRow, col: ColDef): boolean {
    const override = this.isCellEditableOverride();
    if (override) {
      return override(row, col);
    }
    if (!this.isEditable(col)) return false;
    const canSelectFn = this.rowCanSelect();
    if (canSelectFn && !canSelectFn(row)) return false;
    return true;
  }

  protected isCellPointerInteractive(row: GridRow, col: ColDef | undefined): boolean {
    if (!col) return false;
    if (col.isCellInteractive && !col.isCellInteractive(row)) return false;
    if (this.isCellEditable(row, col)) return false;
    if (typeof col.onCellDoubleClicked === 'function') return true;
    if (typeof col.onCellClicked === 'function') return true;
    return !this.disableView();
  }

  protected isPointerInteractive(col: ColDef | undefined): boolean {
    if (!col) return false;
    if (this.isEditable(col)) return false;
    if (typeof col.onCellDoubleClicked === 'function') return true;
    if (typeof col.onCellClicked === 'function') return true;
    return !this.disableView();
  }

  public isOptionChecked(field: string, option: string): boolean {
    return this.getFilterArray(field).includes(option);
  }

  // isPageFullySelected is computed
  protected isRowChecked(id: string): boolean {
    return this.allSelected() ? this.allSelectedIdSet().has(id) : this.selectedIdSet().has(id);
  }

  // Theme no-op (unused)

  // Sorting
  protected isSortable(col: ColDef): boolean {
    return !!col.field; // simple toggle; extend as needed
  }

  // TanStack helpers
  protected leafHeaders(): Header<GridRow, unknown>[] {
    // Flat headers correspond to leaf columns
    return this.tsTable?.getFlatHeaders().filter((h) => h.column.getIsVisible()) ?? [];
  }

  public leftOffsetPx(colId: string): number {
    return this.pctrl?.leftOffsetPx(colId) ?? 0;
  }

  // merge action removed

  // Button-driven next page: replace current data
  protected async nextPage() {
    if (!this.canNext()) return;
    await this.loadPage(this.pageIndex() + 1, false);
  }

  // First/Last page navigation
  protected async firstPage() {
    if (!this.canPrev()) return;
    await this.loadPage(0, false);
  }
  protected async lastPage() {
    const last = Math.max(0, this.totalPages() - 1);
    if (this.pageIndex() >= last) return;
    await this.loadPage(last, false);
  }

  // Keyboard navigation between cells
  protected onCellKeydown(ev: KeyboardEvent) {
    // Ignore key handling when an input/select inside the cell is focused
    const tag = (ev.target as HTMLElement)?.tagName?.toLowerCase?.() || '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    this.kctrl?.handleCellKeydown(ev, {
      getColDefById: (id) => this.getColDefById(id),
      isEditable: (col) => this.isEditable(col),
      startEdit: (row, col) => this.startEdit(row, col),
      rows: () => this.rows(),
    });
  }

  protected onCellMouseOver(row: GridRow) {
    this.lastRowHovered = this.toId(row) || undefined;
  }

  // Handle filter input changes
  protected onFilterInput(field: string, value: unknown) {
    const next = { ...this.filterValues() };
    if (value === undefined || value === null || String(value).trim() === '') delete next[field];
    else next[field] = value;
    this.filterValues.set(next);
    void this.loadPage(0);
  }

  public onHeaderCheckbox(checked: boolean) {
    if (this.allSelected()) this.allSelected.set(false);
    this.tsTable?.toggleAllRowsSelected(checked);
  }

  public onHeaderDragOver(_h: Header<GridRow, unknown>, ev: DragEvent) {
    this.reorder?.onDragOver(ev);
  }

  // Column reordering (drag-and-drop)
  public onHeaderDragStart(h: Header<GridRow, unknown>, ev: DragEvent) {
    this.reorder?.configure({
      suppressHeaderDrag: () => this.suppressHeaderDrag,
      requestPersist: () => this.store?.requestPersist(),
    });
    this.reorder?.onDragStart(h, ev);
  }

  public onHeaderDrop(h: Header<GridRow, unknown>, ev: DragEvent) {
    this.reorder?.onDrop(h, ev, this.tsTable);
  }

  public onHeaderFilterInput(field: string, value: unknown) {
    const v = String(value ?? '').trim();
    const next = { ...this.filterValues() };
    if (!v) delete next[field];
    else next[field] = { op: 'contains', value: v };
    this.filterValues.set(next);
    void this.loadPage(0);
    this.store?.requestPersist();
  }

  // header resize is handled via HeaderResizeDirective

  protected onPanelOpChange(field: string, op: string) {
    const next = { ...this.panelFilters() };
    const prev = next[field] || { op: 'contains', value: '' };
    next[field] = { ...prev, op };
    this.panelFilters.set(next);
  }

  protected onPanelValueChange(field: string, value: unknown) {
    const next = { ...this.panelFilters() };
    const prev = next[field] || { op: 'contains', value: '' };
    next[field] = { ...prev, value };
    this.panelFilters.set(next);
  }

  protected onRowCheckboxChange(row: Row<GridRow>, checked: boolean) {
    if (this.allSelected()) {
      const id = this.toId(row.original);
      if (!id) return;
      const canSelectFn = this.rowCanSelect();
      if (canSelectFn && !canSelectFn(row.original)) {
        return;
      }
      const current = this.allSelectedIdSet();
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      this.allSelectedIdSet.set(next);
      return;
    }
    if (typeof row?.toggleSelected === 'function') {
      const canSelectFn = this.rowCanSelect();
      if (canSelectFn && !canSelectFn(row.original)) {
        return;
      }
      row.toggleSelected(checked);
    }
  }

  // Virtualization helpers
  protected onScroll(event: Event) {
    // No infinite scroll or virtualization-driven paging; ignore scroll.
    // Keep handler to allow future enhancements.
    void event;
  }

  // Prevent drag-reorder when grabbing selection resizer
  public onSelectionResizeDragStart(ev: DragEvent) {
    try {
      ev.preventDefault();
    } catch {}
    ev.stopPropagation();
  }

  // Selection column resize
  public onSelectionResizeMouseDown(ev: MouseEvent) {
    ev.stopPropagation();
    const startW = this.selectionStickyWidth();
    this.rctrl?.beginSelectionResize(
      ev.clientX,
      startW,
      (w) => {
        this.selectionStickyWidth.set(w);
      },
      () => this.store?.requestPersist(),
    );
  }

  public onSelectionResizeTouchStart(ev: TouchEvent) {
    ev.stopPropagation();
    const x = ev.touches?.[0]?.clientX ?? 0;
    const startW = this.selectionStickyWidth();
    this.rctrl?.beginSelectionResizeTouch(
      x,
      startW,
      (w) => {
        this.selectionStickyWidth.set(w);
      },
      () => this.store?.requestPersist(),
    );
  }

  public onToggleFilterOption(field: string, option: string, checked: boolean) {
    const current = this.getFilterArray(field);
    let nextArr: string[] = current.slice();
    if (checked && !nextArr.includes(option)) nextArr.push(option);
    if (!checked) nextArr = nextArr.filter((o) => o !== option);
    const next = { ...this.filterValues() };
    if (nextArr.length === 0) delete next[field];
    else next[field] = { op: 'in', value: nextArr };
    this.filterValues.set(next);
    void this.loadPage(0);
    this.store?.requestPersist();
  }

  protected openEdit(id: string) {
    return this.view(id);
  }

  public openEditOnDoubleClick(row: GridRow) {
    this.openEdit(this.toId(row));
  }

  // Filter panel actions
  protected panelFields(): string[] {
    return this.colDefsWithEdit.flatMap((c) => (c.field ? [c.field] : []));
  }

  protected panelLabelFor(field: string): string {
    const col = this.colDefsWithEdit.find((c) => c.field === field);
    return col?.headerName || field;
  }

  protected panelOptionsFor(field: string): string[] | null {
    const col = this.colDefsWithEdit.find((c) => c.field === field);
    if (!col) return null;
    return this.getFilterOptionsForCol(col);
  }

  public pinLeft(h: Header<GridRow, unknown>) {
    const pin = h?.column?.pin;
    if (typeof pin === 'function') pin.call(h.column, 'left');
    this.store?.requestPersist();
  }

  public pinRight(h: Header<GridRow, unknown>) {
    const pin = h?.column?.pin;
    if (typeof pin === 'function') pin.call(h.column, 'right');
    this.store?.requestPersist();
  }

  // Column pinning helpers
  public pinState(h: Header<GridRow, unknown> | Cell<GridRow, unknown>): 'left' | 'right' | false {
    const fn = h?.column?.getIsPinned;
    return typeof fn === 'function' ? fn.call(h.column) : false;
  }

  protected async prevPage() {
    if (!this.canPrev()) return;
    await this.loadPage(this.pageIndex() - 1);
  }

  public async refresh(): Promise<void> {
    await this.loadPage(this.pageIndex());
  }
  public async doRefresh() {
    if (this.isRefreshing()) return;
    this.isRefreshing.set(true);
    const start = Date.now();
    try {
      await this.refresh();
    } finally {
      const elapsed = Date.now() - start;
      const minSpin = 1000; // spin at least once (1 second minimum)
      if (elapsed < minSpin) {
        await new Promise((resolve) => setTimeout(resolve, minSpin - elapsed));
      }
      this.isRefreshing.set(false);
    }
  }

  protected resetAllWidths() {
    this.colWidths.set({});
    const sizing: Record<string, number> = {};
    this.tsTable?.setOptions((prev) => ({ ...prev, state: { ...prev.state, columnSizing: sizing } }));
    this.store?.requestPersist();
  }

  // Resolve row background using DaisyUI tokens for zebra striping
  protected rowBgForIndex(i: number): string {
    return i % 2 === 1 ? 'var(--fallback-b2, oklch(var(--b2)))' : 'var(--fallback-b1, oklch(var(--b1)))';
  }
  public resetAllWidthsPublic() {
    this.resetAllWidths();
  }

  // Build header resize config for directive
  protected headerResizeConfig(h: Header<GridRow, unknown>) {
    return {
      header: h,
      getColWidth: (id: string) => this.getColWidth(id),
      setWidth: (col: HeaderRef['column'], id: string, w: number) => {
        const width = this.clampColumnWidth(id, w);
        try {
          if (typeof col?.setSize === 'function') col.setSize(width);
        } catch {}
        this.setColWidth(id, width);
      },
      requestPersist: () => this.store?.requestPersist(),
      selectionWidth: () => this.selectionStickyWidth(),
      setSuppressHeaderDrag: (v: boolean) => {
        this.suppressHeaderDrag = !!v;
      },
    } as const;
  }

  protected onPageSizeChange(val: string | number) {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    const size = isNaN(n) || n <= 0 ? 25 : n;
    if (size === this.pageSize()) return;
    this.pageSize.set(size);
    // loadPage(0) is triggered by effect on pageSize
  }

  public resetColWidth(h: Header<GridRow, unknown>) {
    const id = this.getFieldFromHeader(h);
    if (!id) return;
    const sizing = { ...(this.tsTable?.getState().columnSizing ?? {}) };
    if (id in sizing) delete sizing[id];
    this.colWidths.update((m) => {
      const next = { ...(m || {}) };
      delete next[id];
      return next;
    });
    this.tsTable?.setOptions((prev) => ({ ...prev, state: { ...prev.state, columnSizing: sizing } }));
  }

  public rightOffsetPx(colId: string): number {
    return this.pctrl?.rightOffsetPx(colId) ?? 0;
  }

  protected async selectAllMatching() {
    try {
      if (!this.fetchCtrl) return;
      const { ids, count } = await this.fetchCtrl.selectAllMatching();
      this.allSelectedIds.set(ids);
      this.allSelectedIdSet.set(new Set(ids));
      this.allSelectedCount.set(count);
      this.allSelected.set(ids.length > 0);
      this.alertSvc.showInfo(`Selected ${this.allSelectedCount()} row(s)`);
    } catch {
      this.alertSvc.showError('Failed to select all rows');
    }
  }

  // reapplySelectionToVisible removed (selection handled via signals)

  protected sendAbort() {
    this.gridSvc.abort();
  }

  protected setColWidth(id: string, px: number) {
    const next = { ...this.colWidths() };
    const width = this.clampColumnWidth(id, px);
    next[id] = width;
    this.colWidths.set(next);
    if (this.tsTable) {
      try {
        this.tsTable.setOptions((prev) => {
          const prevState = prev?.state ?? {};
          const sizing = { ...(prevState.columnSizing || {}) };
          sizing[id] = width;
          return { ...prev, state: { ...prevState, columnSizing: sizing } };
        });
      } catch {}
    }
    try {
      this.store?.requestPersist();
    } catch {}
    // After width change, recompute sticky offsets
    this.updateHeaderWidths();
  }

  private computeHeaderMinWidths(table: HTMLTableElement): Record<string, number> {
    const map: Record<string, number> = {};
    const headers = table.querySelectorAll('thead th[data-col-id]');
    headers.forEach((node) => {
      const el = node as HTMLElement;
      const id = (el.dataset?.['colId'] ?? el.getAttribute('data-col-id')) || '';
      if (!id) return;
      const width = this.measureHeaderPreferredWidth(el);
      if (width > 0) map[id] = width;
    });
    return map;
  }

  private measureHeaderPreferredWidth(headerEl: HTMLElement): number {
    const doc = headerEl.ownerDocument;
    if (!doc) return 0;
    const content = headerEl.querySelector<HTMLElement>('[data-header-content]');
    if (!content) {
      const rect = headerEl.getBoundingClientRect();
      return Math.max(0, Math.ceil(rect.width));
    }
    const clone = content.cloneNode(true) as HTMLElement;
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.flex = '0 0 auto';
    clone.style.whiteSpace = 'nowrap';
    clone.style.width = 'auto';
    clone.style.height = 'auto';
    clone.style.maxWidth = 'unset';
    clone.style.left = '-9999px';
    clone.style.top = '0';
    const labelClone = clone.querySelector<HTMLElement>('[data-header-label]');
    if (labelClone) {
      labelClone.style.flex = '0 0 auto';
      labelClone.style.whiteSpace = 'nowrap';
    }
    doc.body.appendChild(clone);
    const contentWidth = clone.getBoundingClientRect().width;
    clone.remove();
    if (contentWidth <= 0) return 0;
    const view = doc.defaultView;
    const style = view ? view.getComputedStyle(headerEl) : null;
    const paddingLeft = style ? parseFloat(style.paddingLeft || '0') : 0;
    const paddingRight = style ? parseFloat(style.paddingRight || '0') : 0;
    const borderLeft = style ? parseFloat(style.borderLeftWidth || '0') : 0;
    const borderRight = style ? parseFloat(style.borderRightWidth || '0') : 0;
    const total = contentWidth + paddingLeft + paddingRight + borderLeft + borderRight + this.headerAutoSizeBufferPx;
    return Math.max(0, Math.ceil(total));
  }

  private enforceWidthMinimums(mins: Record<string, number>) {
    for (const [id, min] of Object.entries(mins)) {
      const current = this.colWidths()[id];
      if (typeof current === 'number' && current > 0 && current < min) {
        this.setColWidth(id, min);
      }
    }
  }

  // Column visibility bulk actions
  protected showAllCols() {
    const v = { ...this.colVisibility() };
    for (const c of this.colDefsWithEdit) if (c.field) v[c.field] = true;
    this.colVisibility.set(v);
    if (this.tsTable) this.tsTable.setOptions((prev) => ({ ...prev, state: { ...prev.state, columnVisibility: v } }));
  }
  public showAllColsPublic() {
    this.showAllCols();
  }

  public showColumnById(id: string) {
    this.toggleCol(id, true);
    const col = this.tsTable?.getColumn?.(id);
    if (col?.toggleVisibility) col.toggleVisibility(true);
  }

  // Header menu actions
  public sortAsc(h: Header<GridRow, unknown>) {
    const isSorted = typeof h?.column?.getIsSorted === 'function' ? h.column.getIsSorted() : undefined;
    if (isSorted !== 'asc') {
      const fn = h?.column?.toggleSorting;
      if (typeof fn === 'function') fn.call(h.column, false, false);
    }
  }

  public sortDesc(h: Header<GridRow, unknown>) {
    const isSorted = typeof h?.column?.getIsSorted === 'function' ? h.column.getIsSorted() : undefined;
    if (isSorted !== 'desc') {
      const fn = h?.column?.toggleSorting;
      if (typeof fn === 'function') fn.call(h.column, true, false);
    }
  }

  public sortIndicatorForHeader(h: Header<GridRow, unknown>): PcIconNameType {
    const s = typeof h?.column?.getIsSorted === 'function' ? h.column.getIsSorted() : undefined;
    if (s === 'asc') return 'chevron-up';
    if (s === 'desc') return 'chevron-down';
    return 'none';
  }

  protected startEdit(row: GridRow, col: ColDef) {
    if (!this.isCellEditable(row, col) || !col.field) return;
    const id = this.toId(row);
    if (!id) return;
    this.editingCell.set({ id, field: col.field });
    const value = this.getEditingDisplayValue(row, col);
    this.editingValue.set(Array.isArray(value) ? [...value] : value);
  }

  public startIndex(): number {
    return 0;
  }

  // Row selection helpers (TanStack-driven)
  public tableAllPageSelected(): boolean {
    const rows = this.rows();
    if (!rows.length) return false;
    const canSelectFn = this.rowCanSelect();
    const ids = this.selectedIdSet();
    let selectableCount = 0;
    let selectedSelectableCount = 0;
    for (const r of rows) {
      const id = this.toId(r);
      if (!id) continue;
      if (canSelectFn && !canSelectFn(r)) {
        continue;
      }
      selectableCount++;
      if (ids.has(id)) {
        selectedSelectableCount++;
      }
    }
    return selectableCount > 0 && selectedSelectableCount === selectableCount;
  }

  public tableSomePageSelected(): boolean {
    if (this.tableAllPageSelected()) return false;
    const rows = this.rows();
    const canSelectFn = this.rowCanSelect();
    const ids = this.selectedIdSet();
    for (const r of rows) {
      const id = this.toId(r);
      if (!id) continue;
      if (canSelectFn && !canSelectFn(r)) {
        continue;
      }
      if (ids.has(id)) {
        return true;
      }
    }
    return false;
  }

  public toId(row: unknown): string {
    const id = isRecord(row) ? row['id'] : undefined;
    return id == null ? '' : String(id);
  }

  protected toggleArchiveMode() {
    this.archiveMode.set(!this.archiveMode());
    // Clear any prior selection context when switching datasets
    this.clearAllSelection();
    // Reload first page
    void this.loadPage(0);
  }
  public toggleArchiveModePublic() {
    this.toggleArchiveMode();
  }

  protected toggleCol(field: string, checked: boolean) {
    // Identity columns (noHide) can never be hidden.
    if (!checked && this.colDefsWithEdit.some((c) => c.field === field && c.noHide)) return;
    const v = { ...this.colVisibility() };
    v[field] = checked;
    this.colVisibility.set(v);
    if (this.tsTable) {
      this.tsTable.setOptions((prev) => ({
        ...prev,
        state: { ...prev.state, columnVisibility: v },
      }));
    }
    this.store?.requestPersist();
  }
  public toggleColPublic(field: string, checked: boolean) {
    this.toggleCol(field, checked);
  }

  public toggleHeaderSort(h: Header<GridRow, unknown>, ev?: MouseEvent) {
    const fn = h?.column?.toggleSorting;
    if (typeof fn === 'function') fn.call(h.column, undefined, !!ev?.shiftKey);
  }

  protected togglePageChecked(checked: boolean) {
    if (this.allSelected()) this.allSelected.set(false);
    const nextSet = this.selSvc.togglePageSelectionSet(this.selectedIdSet(), this.rows(), checked);
    this.selectedIdSet.set(nextSet);
  }

  protected toggleRowChecked(id: string, checked: boolean) {
    if (this.allSelected()) {
      const current = this.allSelectedIdSet();
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      this.allSelectedIdSet.set(next);
    } else {
      const set = new Set(this.selectedIdSet());
      if (checked) set.add(id);
      else set.delete(id);
      this.selectedIdSet.set(set);
    }
  }

  // topPadHeight not used without virtualizer

  // Pagination
  // totalPages is computed
  public unpin(h: Header<GridRow, unknown>) {
    const pin = h?.column?.pin;
    if (typeof pin === 'function') pin.call(h.column, false);
    this.store?.requestPersist();
  }

  // visibleCount not used without virtualizer

  protected visibleTableRows(): Row<GridRow>[] {
    return this.tsTable?.getRowModel().rows ?? [];
  }

  // Build TanStack rowSelection snapshot for current data from our global selected set
  private buildRowSelectionForCurrentData(): Record<string, boolean> {
    const ids = this.selectedIdSet();
    const map: Record<string, boolean> = {};
    for (const r of this.rows()) {
      const id = this.toId(r);
      if (id && ids.has(id)) map[id] = true;
    }
    return map;
  }

  private coerceEditingValue(col: ColDef, raw: unknown): unknown {
    const editorCfg = this.selectEditorOptions(col);
    let val = raw;
    if (editorCfg && !editorCfg.multiple && Array.isArray(raw)) {
      val = raw[0];
    }
    const t = this.inputTypeFor(col);
    if (t === 'number') {
      const n = typeof val === 'number' ? val : parseFloat(String(val ?? '').trim());
      return isNaN(n) ? null : n;
    }
    if (t === 'date') {
      const v = String(val ?? '').trim();
      // normalize to YYYY-MM-DD if possible
      return v.length > 10 ? v.slice(0, 10) : v;
    }
    if (t === 'color') {
      const v = String(val ?? '').trim();
      const pattern = /^#([0-9a-fA-F]{6})$/;
      return pattern.test(v) ? v.toLowerCase() : null;
    }
    return val;
  }

  private resolveEditorParams(col: ColDef): Record<string, unknown> | null {
    const cep: unknown = col?.cellEditorParams;
    if (!cep) return null;
    try {
      const resolved: unknown = typeof cep === 'function' ? cep() : cep;
      return isRecord(resolved) ? resolved : null;
    } catch {
      return null;
    }
  }

  // selection resize handled by ResizingController

  private async loadPage(index: number, append = false) {
    if (!this.fetchCtrl) return;
    await this.fetchCtrl.loadPage(index, append);
  }

  private async queueFullExport(): Promise<void> {
    // No paging fields at all. The background export job (lib/jobs/handlers/export.handlers.ts)
    // builds and streams its own query and never reads startRow/endRow, so sending a huge span
    // here bought nothing — it just meant the request carried `endRow: 10_000_000`, which any
    // repository that derived a LIMIT from the span would have honoured literally.
    const options = this.dataSvc.buildGetAllOptions({
      searchStr: this.searchSvc.getFilterText(),
      tags: this.selectedTags(),
      issues: this.selectedIssues(),
      filterModel: this.buildFilterModel(),
      sortState: this.sorting(),
      sortCol: this.sortCol(),
      sortDir: this.sortDir(),
      includeArchived: this.archiveMode(),
      advancedFilterModel: this.externalAdvancedFilterModel() || this.advFilter.buildModel(),
      listId: this.activeListId(),
    });
    await this.gridSvc.queueExport({
      entity: (this.config.messages.exportEntity ||
        this.config.messages.exportFileName.replace('.csv', '').replace(/-/g, '_')) as QueueExportInputType['entity'],
      options,
      columns: this.visibleColumnFields(),
      fileName: this.config.messages.exportFileName,
    });
  }

  /** Records a direct browser-download export in Exports history so it's consistently listed
   * alongside queued exports — see pplcrm-datagrid. Fire-and-forget: never blocks or fails the
   * download the user already has. */
  private logInstantExport(rowCount: number): void {
    void this.gridSvc
      .logInstantExport({
        entity: (this.config.messages.exportEntity ||
          this.config.messages.exportFileName.replace('.csv', '').replace(/-/g, '_')) as QueueExportInputType['entity'],
        fileName: this.config.messages.exportFileName,
        rowCount,
      })
      .catch(() => {
        // Best-effort logging only — the user already has their file.
      });
  }

  private visibleColumnFields(): string[] {
    const visibility = this.colVisibility();
    return this.colDefsWithEdit
      .map((col) => (typeof col.field === 'string' ? col.field : null))
      .filter((field): field is string => !!field && visibility[field] !== false);
  }

  // Persistence handled by GridStoreService

  // header resize handled by ResizingController

  // onCellValueChanged handled by EditingController

  // saveState removed (consolidated into GridStoreService)

  // shouldBlockEdit handled by EditingController

  private syncSignalsFromTable() {
    const st = this.tsTable?.getState();
    if (st?.sorting) this.sorting.set(st.sorting);
    if (st?.columnVisibility) this.colVisibility.set(st.columnVisibility);
    // Notify pin-state change so controller effect recomputes offsets
    this.pctrl?.notifyPinStateChanged();
    this.store?.requestPersist();
  }

  public triggerCellFlash(rowId: string, field: string): void {
    const key = `${rowId}:${field}`;
    this.flashedCells.update((s) => {
      const n = new Set(s);
      n.add(key);
      return n;
    });
    setTimeout(() => {
      this.flashedCells.update((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }, 1300);
  }

  public updateEditedRowInCaches(id: string, field: string | undefined, value: unknown, prevValue?: unknown) {
    if (!field) return;
    if (this.store) {
      const targetRow = this.rows().find((r) => String(this.toId(r)) === id);
      const prev = prevValue !== undefined ? prevValue : targetRow ? targetRow[field] : undefined;
      this.store.recordSnapshotBeforeCommit(id, field, prev, value);
    }
    // Update visible rows array
    this.rows.update((curr) => curr.map((r) => (this.toId(r) === id ? { ...r, [field]: value } : r)));
    // Trigger green flash on the updated cell
    this.triggerCellFlash(id, field);
  }

  // pin offsets handled by PinningController

  // Update table data with current visible window
  public updateTableWindow(start: number, end: number) {
    this.tableSvc.updateTableWindow(
      this.tsTable,
      this.rows(),
      start,
      end,
      this.buildRowSelectionForCurrentData(),
      this.sortCol(),
      this.sortDir(),
    );
  }

  private view(id?: string) {
    const targetId = id || this.lastRowHovered;
    if (!targetId || this.disableView()) return;

    const vr = this.viewRoute();
    if (vr) {
      this.captureRecordNavContext(vr);
      if (vr.startsWith('/')) {
        void this.router.navigate([vr, targetId]);
      } else {
        void this.router.navigate([vr, targetId], { relativeTo: this.route });
      }
    } else {
      this.captureRecordNavContext(this.currentListPath());
      void this.navSvc.viewIfAllowed({
        id: targetId,
        lastRowHovered: this.lastRowHovered,
        disableView: this.disableView(),
        navigate: (path) => this.navSvc.navigateIfValid(this.router, this.route, path),
      });
    }
  }

  /** The grid's own list route, stripped of query/fragment (e.g. "/teams") - used as the record-nav entity key when no explicit viewRoute is set. */
  private currentListPath(): string {
    const [pathAndQuery] = this.router.url.split('#');
    const [path] = (pathAndQuery ?? this.router.url).split('?');
    return path ?? this.router.url;
  }

  /** Hands the currently filtered id set to the detail page so it can walk "N of M filtered" with J/K. */
  private captureRecordNavContext(entityKey: string): void {
    this.fetchCtrl
      .selectAllMatching()
      .then(({ ids, count }) => this.recordNav.setContext(entityKey, ids, count))
      .catch(() => void 0);
  }
}

type RowOf<K extends keyof Models> = Models[K];
type TagDiff = {
  toAdd: string[];
  toRemove: string[];
  hasChanges: boolean;
};

/** Narrow an unknown value to a property-indexable record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
