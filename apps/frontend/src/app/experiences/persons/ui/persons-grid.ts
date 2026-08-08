import { Component, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { BoundaryAreaColumnType } from '@common';
import { DataGrid } from '@frontend/shared/components/datagrid/datagrid';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { DataGridUtilsService } from '@frontend/shared/components/datagrid/services/utils.service';
import { GrainTabs } from '@frontend/shared/components/grain-tabs/grain-tabs';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';
import {
  SUPPORT_LEVEL_LABELS,
  UpdatePersonsObj,
  UpdatePersonsType,
  VOTING_STATUS_LABELS,
} from '../../../../../../../libs/common/src';

import type { CellParams, ColumnDef as ColDef } from '@frontend/shared/components/datagrid/grid-defaults';
import { SECONDARY_CELL_CLASS } from '@frontend/shared/components/datagrid/grid-defaults';

import {
  DATA_GRID_CONFIG,
  DEFAULT_DATA_GRID_CONFIG,
  deleteConfirmMessageFor,
  deleteSuccessMessageFor,
  provideDataGridConfig,
} from '@frontend/shared/components/datagrid/datagrid.tokens';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { AreaColumnsService } from '../../../services/area-columns.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { seatStatusShortLabelFor } from '../../households/services/household-areas';
import { DATA_TYPE, PersonsService } from '../services/persons-service';

@Component({
  selector: 'pc-persons-grid',
  imports: [DataGrid, GrainTabs, Icon, ModalShell],
  templateUrl: './persons-grid.html',
  host: { class: 'block h-full' },
  providers: [
    { provide: AbstractAPIService, useExisting: PersonsService },
    provideDataGridConfig({
      messages: {
        exportEntity: 'persons',
        exportFileName: 'persons-export.csv',
        entityNoun: 'person',
        entityNounPlural: 'people',
      },
    }),
  ],
})
export class PersonsGrid implements OnInit {
  private readonly utils = inject(DataGridUtilsService);
  private readonly tagOptionsSvc = inject(TagOptionsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly alertSvc = inject(AlertService);
  public readonly _loading = createLoadingGate();
  private readonly config = inject(DATA_GRID_CONFIG, { optional: true }) ?? DEFAULT_DATA_GRID_CONFIG;
  private readonly personsService = inject(PersonsService);
  private readonly campaignCtx = inject(CampaignContextService);
  private readonly areaColumnsSvc = inject(AreaColumnsService);

  private readonly grid = viewChild<DataGrid<DATA_TYPE, UpdatePersonsType>>('grid');
  private readonly grainTabs = viewChild(GrainTabs);
  private readonly confirmAddressEditDlg = viewChild.required<ModalShell>('confirmAddressEdit');

  public readonly onConfirmDeleteBind = (selected: any[]) => this.confirmDelete(selected);

  /** Deletes change the header counts — re-query the total sentence and grain-tab totals. */
  protected onRowsDeleted(): void {
    void this.loadTotalCount();
    this.grainTabs()?.reloadCounts();
  }

  public inline = input<boolean>(false);

  /**
   * Flipped once the campaign context and the workspace's boundary maps have answered, which is
   * when the column list is final. The grid copies its column definitions once when it is created,
   * so it must not be created before then. Matches the households grid.
   */
  protected readonly columnsReady = signal(false);

  private addressChangeModalId: string | null = null;
  private tagOptionValues: string[] = [];
  private issueOptionValues: string[] = [];

  protected col: ColDef[] = [
    {
      // Combined identity column: the door that opens the record. Non-editable and
      // non-hidable; first/last name remain separately editable to its right.
      field: 'name',
      headerName: 'Name',
      editable: false,
      doorColumn: true,
      noHide: true,
      width: 220,
      minWidth: 160,
      valueGetter: (params: CellParams) => {
        const data = params?.data as Record<string, unknown> | undefined;
        if (!data) return '';
        return [data['first_name'], data['last_name']]
          .filter((p) => typeof p === 'string' && p.trim().length)
          .join(' ')
          .trim();
      },
    },
    { field: 'first_name', headerName: 'First Name', editable: true, hide: true },
    { field: 'last_name', headerName: 'Last Name', editable: true, hide: true },
    {
      field: 'address',
      headerName: 'Address',
      editable: false,
      // Not a grow column — a narrow address just wraps to a second line, which reads fine.
      width: 240,
      minWidth: 160,
      onCellClicked: this.onAddressCellClicked.bind(this),
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
      isCellInteractive: (row: any) => !row.household_is_placeholder,
      valueGetter: (params: any) => {
        const data = params?.data;
        if (!data) return '';
        const parts: string[] = [];
        const streetParts = [data.apt ? `Apt ${data.apt}` : null, data.street_num, data.street1, data.street2].filter(
          Boolean,
        );
        // Keep the grid cell compact: street + city only. State/zip/country live on the
        // person and household views, not in this at-a-glance column.
        if (streetParts.length) parts.push(streetParts.join(' ').trim());
        if (data.city) parts.push(String(data.city).trim());
        // §2: empty address renders as "—" (the grid cell falls back on ''); an
        // unassigned household is surfaced as a guided empty state on the person view, not here.
        return parts.join(', ').trim();
      },
    },
    // Email grows to fill leftover width when no notes/description column is visible (address
    // is intentionally a fixed, wrapping column). Notes/description still win when shown.
    { field: 'email', headerName: 'Email', editable: true, flex: true, width: 220, minWidth: 180 },
    { field: 'mobile', headerName: 'Mobile', editable: true, width: 140 },
    {
      // Campaign-scoped facts for the ACTIVE context (§15); blank = Unknown.
      // Edited on the person page, not inline — they live in campaign_person_facts, not on persons.
      field: 'support_level',
      headerName: 'Support (context)',
      editable: false,
      width: 150,
      valueFormatter: (params: CellParams) =>
        SUPPORT_LEVEL_LABELS[params.value as keyof typeof SUPPORT_LEVEL_LABELS] ?? '',
    },
    {
      field: 'voting_status',
      headerName: 'Voting (context)',
      editable: false,
      hide: true,
      width: 150,
      valueFormatter: (params: CellParams) =>
        VOTING_STATUS_LABELS[params.value as keyof typeof VOTING_STATUS_LABELS] ?? '',
    },
    { field: 'company_name', headerName: 'Company', editable: false, hide: true },
    // Where this person lives on the campaign's OWN map, read off their household. Hidden by
    // default: the District column below already names this area along with every other boundary
    // the door falls in. Headed with the campaign's own word for its areas by applyAreaLabels, and
    // available from the column chooser whenever one level alone is what you want to sort by.
    {
      // Placeholder only: applyAreaLabels always overwrites it before the grid is created, and
      // seatLabel() always resolves ("District" via the 'other' spec at worst).
      field: 'electoral_area',
      headerName: 'Electoral area',
      editable: false,
      hide: true,
      minWidth: 140,
    },
    // Every area the person's household is in, from every map, joined into one cell — the "District"
    // column, and the one electoral column shown by default. It is also what a `contains` filter
    // searches. `applyAreaColumns` unhides it once the workspace holds a boundary map to fill it.
    {
      field: 'any_electoral_area',
      headerName: 'All boundaries',
      editable: false,
      hide: true,
      minWidth: 220,
    },
    // Whether this person's household is in the campaign's own territory. Comes from the household,
    // so a person with no address, or one not yet placed on the map, reads as blank rather than
    // "no". Hidden by default: the District column above names the riding outright, and a second
    // column repeating "Yes / No — another area" only restates it. Still available in the column
    // chooser, where it is the fastest way to sort your own doors to the top.
    {
      field: 'seat_status',
      headerName: 'In your seat',
      editable: false,
      hide: true,
      minWidth: 150,
      valueFormatter: (params: CellParams) => seatStatusShortLabelFor(params.value as string | null | undefined),
    },
    {
      field: 'home_phone',
      headerName: 'Home phone',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'tags',
      hide: true,
      headerName: 'Tags',
      editable: true,
      tagColumn: true,
      cellDataType: 'object',
      cellRendererParams: {
        type: 'persons',
        obj: UpdatePersonsObj,
        service: this.personsService,
        tagType: 'tag',
      },
      cellEditorParams: () => ({ values: this.tagOptionValues, multiple: true }),
      equals: (tagsA: unknown, tagsB: unknown) =>
        this.utils.tagArrayEquals(this.utils.normalizeTagSelection(tagsA), this.utils.normalizeTagSelection(tagsB)) ===
        0,
      valueFormatter: (params: CellParams) => this.utils.tagsToString(this.utils.normalizeTagSelection(params.value)),
      comparator: (tagsA: unknown, tagsB: unknown) =>
        this.utils.tagArrayEquals(this.utils.normalizeTagSelection(tagsA), this.utils.normalizeTagSelection(tagsB)),
    },
    {
      field: 'issues',
      hide: true,
      headerName: 'Issues',
      editable: true,
      tagColumn: true,
      cellDataType: 'object',
      cellRendererParams: {
        type: 'persons',
        obj: UpdatePersonsObj,
        service: this.personsService,
        tagType: 'issue',
      },
      cellEditorParams: () => ({ values: this.issueOptionValues, multiple: true }),
      equals: (tagsA: unknown, tagsB: unknown) =>
        this.utils.tagArrayEquals(this.utils.normalizeTagSelection(tagsA), this.utils.normalizeTagSelection(tagsB)) ===
        0,
      valueFormatter: (params: CellParams) => this.utils.tagsToString(this.utils.normalizeTagSelection(params.value)),
      comparator: (tagsA: unknown, tagsB: unknown) =>
        this.utils.tagArrayEquals(this.utils.normalizeTagSelection(tagsA), this.utils.normalizeTagSelection(tagsB)),
    },
    {
      field: 'street_num',
      headerName: 'Street Number',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'apt',
      headerName: 'Apt',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'street1',
      headerName: 'Street 1',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'street2',
      headerName: 'Street 2',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'city',
      headerName: 'City',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'state',
      headerName: 'State/Province',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'zip',
      headerName: 'Zip/Province',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'country',
      headerName: 'Country',
      editable: false,
      hide: true,
      onCellDoubleClicked: this.confirmOpenEditOnDoubleClick.bind(this),
    },
    {
      field: 'notes',
      headerName: 'Notes',
      editable: true,
      cellEditorParams: { textarea: true, rows: 5 },
    },
  ];

  public listId = input<string | null>(null);

  /** Grain total sentence for the header (spec §5): "{n} people total". */
  protected readonly totalSentence = signal<string | null>(null);

  /** Pre-filter the grid from a door link — Tags admin's PEOPLE count (`?tag=`, spec §9.1) and
   * Issues admin's PEOPLE INTERESTED count (`?issue=`, spec §9.2) both land here. Read once on
   * arrival; the grid's own filter chips take over from there (§2 disclosure-over-suppression —
   * the chip shows what's filtering, not a hidden query param). */
  protected readonly initialTagFilter = signal<string[]>([]);
  protected readonly initialIssueFilter = signal<string[]>([]);

  public ngOnInit() {
    // Mute every column except the bold "Name" door, so the door reads as the way in.
    for (const c of this.col) if (!c.doorColumn) c.cellClass = SECONDARY_CELL_CLASS;

    const params = this.route.snapshot.queryParamMap;
    const tag = params.get('tag');
    const issue = params.get('issue');
    if (tag) this.initialTagFilter.set([tag]);
    if (issue) this.initialIssueFilter.set([issue]);

    void this.initializeComponent();
  }

  /**
   * The four answers, spelled out, matching the households grid word for word.
   *
   * "Outside the map" and blank must stay different: the first means the address was tested against
   * every area and fell in none, the second that nothing has looked yet — no address, no
   * coordinates, or no match pass since the map was added.
   */
  /**
   * Head the three electoral columns in the campaign's own words, and drop the territory column for
   * an office that has no territory.
   *
   * Called before the grid is created, because the grid copies its column definitions once at init
   * and never re-reads them — and before the boundary-map read below, so a slow second request
   * cannot delay the words on screen.
   */
  private applyAreaLabels(): void {
    for (const c of this.col) {
      if (c.field === 'electoral_area') {
        // seatLabel() always resolves — "District" via the 'other' jurisdiction spec when the
        // campaign declares no jurisdiction.
        c.headerName = this.campaignCtx.seatLabel();
      }
      if (c.field === 'any_electoral_area') {
        c.headerName = `District`;
      }
      if (c.field === 'seat_status') {
        c.headerName = this.campaignCtx.seatTerritoryLabel();
      }
    }

    // An at-large office (a mayor, a governor) represents no area, so "in your seat" has no answer
    // for any person. Drop the column rather than offering an empty one in the column chooser.
    if (this.campaignCtx.activeSeatAreaNames().length === 0) {
      const at = this.col.findIndex((c) => c.field === 'seat_status');
      if (at >= 0) this.col.splice(at, 1);
    }
  }

  /**
   * Build one column per boundary map the workspace holds, each headed with that map's own name,
   * and decide which electoral columns the grid opens with.
   *
   * A household sits inside several boundaries at once. The "District" column is the default
   * answer: it lists every one of those areas in a single cell. A provincial campaign in Toronto
   * holds a riding map and a ward map, and each still gets a column of its own so a single level
   * can be sorted or filtered on its own — the same split the CSV export writes — but those
   * per-map columns all start hidden, because each only repeats part of what District already
   * shows. Any of them can be switched on from the column chooser.
   */
  private applyAreaColumns(areaColumns: readonly BoundaryAreaColumnType[]): void {
    // Nothing to fill the District column from until the workspace has a map, so it stays hidden.
    const anyCol = this.col.find((c) => c.field === 'any_electoral_area');
    if (anyCol) anyCol.hide = areaColumns.length === 0;

    // The campaign's own map is already the `electoral_area` column above, under the campaign's
    // word for it, so it does not get a second column here.
    const extras: ColDef[] = areaColumns
      .filter((column) => !column.is_seat_set)
      .map((column) => ({
        field: column.field,
        headerName: column.label,
        editable: false,
        hide: true,
        minWidth: 140,
        cellClass: SECONDARY_CELL_CLASS,
      }));
    if (extras.length === 0) return;

    const anchor = this.col.findIndex((c) => c.field === 'any_electoral_area');
    this.col.splice(anchor < 0 ? this.col.length : anchor, 0, ...extras);
  }

  private async initializeComponent(): Promise<void> {
    try {
      await this.campaignCtx.ensureLoaded();
    } catch (err) {
      // The heading still resolves without a loaded context, so a failed load costs a word rather
      // than the page. Matching the households grid, which does the same.
      console.error('Failed to load campaign context for person column headings', err);
    }
    this.applyAreaLabels();
    try {
      this.applyAreaColumns(await this.areaColumnsSvc.list(this.campaignCtx.activeCampaignId()));
    } catch (err) {
      // A failed read costs the per-map columns, not the grid: every fixed column is already built
      // and the rows still arrive with every field they always had.
      console.error('Failed to load boundary maps for person area columns', err);
    }
    this.columnsReady.set(true);
    try {
      await this.loadTagOptions();
      await this.loadIssueOptions();
      void this.loadTotalCount();
    } catch (error) {
      console.error('Initialization failed', error);
    }
  }

  /**
   * Total people count for the grain header sentence (spec §5): "{n} people total".
   * The All/Donors/Volunteers segmented control was removed per the owner screenshot —
   * donor is derived from donations and volunteer/staff are first-class person
   * status (§15), not grid segments — so only the overall total is fetched.
   */
  private async loadTotalCount(): Promise<void> {
    try {
      const total = await this.personsService.count();
      this.totalSentence.set(total === 1 ? '1 person total' : `${new Intl.NumberFormat().format(total)} people total`);
    } catch (err) {
      console.error('Failed to load total count', err);
    }
  }

  private async loadTagOptions() {
    try {
      this.tagOptionValues = await this.tagOptionsSvc.getTagNames('tag');
    } catch {
      this.tagOptionValues = [];
    }
  }

  private async loadIssueOptions() {
    try {
      this.issueOptionValues = await this.tagOptionsSvc.getTagNames('issue');
    } catch {
      this.issueOptionValues = [];
    }
  }

  protected getPlusIcon(): PcIconNameType {
    return 'user-plus';
  }

  protected confirmOpenEditOnDoubleClick(event: any) {
    this.addressChangeModalId = event?.data?.household_id ?? event?.household_id;
    this.confirmAddressChange();
  }

  protected onAddressCellClicked(event: any) {
    const householdId = event?.data?.household_id ?? event?.household_id;
    if (householdId) {
      void this.router.navigate(['households', householdId]);
    }
  }

  protected getTitle() {
    return 'People';
  }

  protected getDescription() {
    return 'Manage individual contact records, edit detail fields, track issues/tags, and configure household assignments.';
  }

  // The CSV import wizard (spec §17) replaced the old in-grid import modal —
  // one idiom for the job instead of two. See libs/uxcommon/csv-import for
  // the shared header-mapping heuristic this grid used to own inline.
  protected openImportDialog() {
    void this.router.navigate(['/imports/new'], { queryParams: { type: 'people' } });
  }

  protected routeToHouseholds() {
    this.confirmAddressEditDlg().close();

    if (this.addressChangeModalId !== null) {
      void this.router.navigate(['households', this.addressChangeModalId]);
    }
  }

  private confirmAddressChange(): void {
    this.confirmAddressEditDlg().show();
  }

  protected async confirmDelete(selectedRows?: any[]): Promise<boolean> {
    const selected = selectedRows || this.grid()?.getSelectedRows() || [];
    if (!selected.length) {
      this.alertSvc.showError('No rows selected.');
      return true;
    }

    const ids = selected.map((r: any) => r.id);

    // Show standard delete confirmation
    const ok = await this.dialogs.confirm({
      title: this.config.messages.deleteConfirmTitle,
      message: deleteConfirmMessageFor(this.config.messages, selected.length),
      variant: this.config.messages.deleteConfirmVariant,
      icon: this.config.messages.deleteConfirmIcon,
      confirmText: this.config.messages.deleteConfirmText,
      cancelText: this.config.messages.deleteCancelText,
      allowBackdropClose: false,
    });
    if (!ok) return true; // Handled

    const end = this._loading.begin();
    try {
      // Call deleteMany without force, skipping global error toast
      await this.personsService.deleteMany(ids, undefined, true);
      this.alertSvc.showSuccess(deleteSuccessMessageFor(this.config.messages, ids.length));
    } catch (err) {
      // Check if it's the captain error message
      const errMsg =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : '';
      if (errMsg.includes('team captains')) {
        // Ask the user if they want to proceed despite being a team captain
        const forceOk = await this.dialogs.confirm({
          title: 'Team Captain Warning',
          message: errMsg,
          variant: 'warning',
          confirmText: 'Yes, delete anyway',
          cancelText: 'Cancel',
        });
        if (forceOk) {
          try {
            await this.personsService.deleteMany(ids, true, true);
            this.alertSvc.showSuccess(deleteSuccessMessageFor(this.config.messages, ids.length));
          } catch (forceErr) {
            const forceErrMsg =
              forceErr instanceof Error && forceErr.message
                ? forceErr.message
                : isRecord(forceErr) &&
                    isRecord(forceErr['data']) &&
                    typeof forceErr['data']['message'] === 'string' &&
                    forceErr['data']['message']
                  ? forceErr['data']['message']
                  : 'Delete failed';
            this.alertSvc.showError(forceErrMsg);
          }
        }
      } else {
        this.alertSvc.showError(errMsg || this.config.messages.deleteFailed);
      }
    } finally {
      end();
      this.grid()?.clearAllSelection();
      await this.grid()?.refresh();
    }
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
