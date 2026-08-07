import { Component, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { DataGrid } from '@frontend/shared/components/datagrid/datagrid';
import { SECONDARY_CELL_CLASS } from '@frontend/shared/components/datagrid/grid-defaults';
import type { CellParams, ColumnDef as ColDef } from '@frontend/shared/components/datagrid/grid-defaults';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { DataGridUtilsService } from '@frontend/shared/components/datagrid/services/utils.service';
import { GrainTabs } from '@frontend/shared/components/grain-tabs/grain-tabs';
import type { BoundaryAreaColumnType } from '@common';
import { UpdateHouseholdsObj } from '../../../../../../../libs/common/src';

import { provideDataGridConfig } from '@frontend/shared/components/datagrid/datagrid.tokens';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { AreaColumnsService } from '../../../services/area-columns.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { PersonsService } from '../../persons/services/persons-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { HouseholdsService } from '../services/households-service';

@Component({
  selector: 'pc-households-grid',
  imports: [DataGrid, GrainTabs],
  host: { class: 'block h-full' },
  template: `
    <div class="flex h-full min-h-0 flex-col gap-6">
      <!-- The grid snapshots its column definitions when it is created, and the electoral column's
      heading is the campaign's own word, so it waits for the campaign context to answer. It is
      created either way: with no loaded context, seatLabel() resolves through the 'other'
      jurisdiction spec and the heading reads "District" rather than leaving a blank page. -->
      @if (columnsReady()) {
        <pc-datagrid
          #grid
          [showToolbar]="!inline()"
          [grainLayout]="!inline()"
          [fitColumns]="true"
          title="Households"
          i18n-title
          description="Manage household groups, track shared addresses, and organize family relationships."
          i18n-description
          [listId]="listId()"
          [colDefs]="col"
          [disableDelete]="false"
          [disableMerge]="false"
          [disableView]="false"
          [disableImport]="false"
          [confirmDeleteOverride]="onConfirmDeleteBind"
          (rowsDeleted)="onRowsDeleted()"
          [rowCanSelect]="rowCanSelectFn"
          [totalSentence]="totalSentence()"
          (importCSV)="openImportWizard()"
          addRoute="add"
          i18n-addRoute
          plusIcon="add-home"
          i18n-plusIcon
        >
          <div pcGridBelowHeader>
            @if (!inline()) {
              <pc-grain-tabs />
            }
          </div>
          @if (!inline() && unhoused().count > 0) {
            <p pcGridFooterStart class="truncate text-xs text-base-content/55" i18n>
              <button
                type="button"
                class="cursor-pointer underline decoration-base-content/30 underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary"
                (click)="openUnhoused()"
              >
                {{ unhoused().count }} {{ unhoused().count === 1 ? 'person' : 'people' }}
              </button>
              {{ unhoused().count === 1 ? "doesn't" : "don't" }} belong to a household: no address, or one that can't be
              matched to a door.
            </p>
          }
        </pc-datagrid>
      }
    </div>
  `,
  providers: [
    { provide: AbstractAPIService, useExisting: HouseholdsService },
    provideDataGridConfig({
      messages: {
        entityNoun: 'household',
        entityNounPlural: 'households',
        exportEntity: 'households',
        exportFileName: 'households-export.csv',
      },
    }),
  ],
})
export class HouseholdsGrid implements OnInit {
  private readonly utils = inject(DataGridUtilsService);
  private readonly tagOptionsSvc = inject(TagOptionsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly dialogSvc = inject(ConfirmDialogService);
  private readonly alertSvc = inject(AlertService);
  private readonly router = inject(Router);
  public readonly _loading = createLoadingGate();
  private readonly householdsService = inject(HouseholdsService);
  private readonly campaignCtx = inject(CampaignContextService);
  private readonly areaColumnsSvc = inject(AreaColumnsService);

  private readonly grid = viewChild<DataGrid<'households', never>>('grid');
  private readonly grainTabs = viewChild(GrainTabs);

  /** Flipped once the campaign context has answered, which is when the column headings are final. */
  protected readonly columnsReady = signal(false);

  private tagOptionValues: string[] = [];
  private issueOptionValues: string[] = [];
  public readonly onConfirmDeleteBind = (selected: any[]) => this.confirmDelete(selected);
  public readonly rowCanSelectFn = (row: any) => !row.is_placeholder;

  public inline = input<boolean>(false);

  protected col: ColDef[] = [
    {
      // The door that opens the household record: a generated address string, just like
      // the People grid's combined Name column. People count rides along as a muted subtitle.
      field: 'household',
      headerName: 'Household',
      editable: false,
      doorColumn: true,
      noHide: true,
      width: 260,
      minWidth: 180,
      valueGetter: (params: CellParams) => this.addressString(params.data),
      doorSubtitle: (params: CellParams) => {
        const n = Number((params.data as Record<string, unknown> | undefined)?.['persons_count'] ?? 0);
        return `${n} ${n === 1 ? 'person' : 'people'}`;
      },
    },
    {
      field: 'members',
      headerName: 'Members',
      editable: false,
      // Grows to fill leftover width when no notes/description column is visible.
      flex: true,
      width: 320,
      minWidth: 200,
      // Each member name is a link to their person card. The renderer output is
      // sanitized (event handlers stripped), so navigation is delegated to onCellClicked.
      cellRenderer: (params: CellParams) => this.renderMembers(params.value),
      onCellClicked: (params: CellParams) => this.onMemberClicked(params.event),
    },
    { field: 'city', headerName: 'City', editable: true, width: 150 },
    {
      field: 'tags',
      headerName: 'Tags',
      hide: true,
      editable: true,
      tagColumn: true,
      cellDataType: 'object',
      cellRendererParams: {
        type: 'households',
        obj: UpdateHouseholdsObj,
        service: this.householdsService,
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
        type: 'households',
        obj: UpdateHouseholdsObj,
        service: this.householdsService,
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
    // Electoral geography, replacing the three fixed text columns (district / precinct / ward) that
    // could only ever hold three answers. A household is inside several boundaries at once, so the
    // visible column shows its area on THIS campaign's map and the hidden one shows all of them.
    // Both headings are rewritten with the campaign's own word in `applyJurisdictionLabels`.
    {
      field: 'electoral_area',
      // Placeholder only: applyJurisdictionLabels always overwrites it before the grid is
      // created, and seatLabel() always resolves ("District" via the 'other' spec at worst).
      headerName: 'Electoral area',
      editable: false,
      minWidth: 140,
    },
    {
      field: 'any_electoral_area',
      headerName: 'All boundaries',
      editable: false,
      hide: true,
      minWidth: 220,
    },
    // Whether the door is in THIS campaign's seat, as a yes/no. Hidden by default: the area column
    // above already names the riding, which answers the same question and also says which other
    // riding a door outside yours is in. Kept in the column chooser, where it is the quickest way
    // to sort your own doors to the top, and hidden outright for an at-large office, which has no
    // seat area to be inside or outside of.
    {
      field: 'seat_status',
      headerName: 'In your seat',
      editable: false,
      hide: true,
      minWidth: 150,
      valueFormatter: (params: CellParams) => this.formatSeatStatus(params.value),
    },
    {
      field: 'updated_at',
      headerName: 'Last touch',
      editable: false,
      minWidth: 120,
      valueFormatter: (params: CellParams) => this.formatLastTouch(params.value),
    },
    {
      field: 'notes',
      headerName: 'Notes',
      editable: true,
      hide: true,
      width: 280,
      cellEditorParams: { textarea: true, rows: 5 },
    },
  ];
  public listId = input<string | null>(null);
  public showHeader = input<boolean>(true);

  /**
   * Grain total sentence for the header (spec §5): "{n} households across {m} wards", where the
   * last word is whatever this campaign calls the areas on its own map (wards, ridings, precincts).
   */
  protected readonly totalSentence = signal<string | null>(null);

  /** People with no matchable address (the placeholder household) — footer note + link target. */
  protected readonly unhoused = signal<{ count: number; household_id: string | null }>({
    count: 0,
    household_id: null,
  });

  public ngOnInit(): void {
    // Mute the secondary columns so the bold "Household" door reads as the way in. Members
    // keep full contrast — they're a second focal point (the People-grain of the household).
    for (const c of this.col) if (!c.doorColumn && c.field !== 'members') c.cellClass = SECONDARY_CELL_CLASS;

    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    try {
      await this.campaignCtx.ensureLoaded();
    } catch (err) {
      // seatLabel() still resolves without a loaded context — "District" via the 'other'
      // jurisdiction spec — so a failed load costs a word, not the page. Everything below runs.
      console.error('Failed to load campaign context for household column headings', err);
    }
    // Headings first, so the words the campaign uses do not wait on a second request.
    this.applyJurisdictionLabels();
    try {
      this.applyAreaColumns(await this.areaColumnsSvc.list(this.campaignCtx.activeCampaignId()));
    } catch (err) {
      // A failed read costs the per-map columns, not the grid: every fixed column is already built.
      console.error('Failed to load boundary maps for household area columns', err);
    }
    this.columnsReady.set(true);

    await this.loadTagOptions();
    await this.loadIssueOptions();
    void this.loadGrainSentence();
    if (!this.inline()) void this.loadUnhoused();
  }

  /**
   * One more area column per boundary map the workspace holds, headed with that map's own name.
   *
   * A household is inside several boundaries at once, and until now only the campaign's own map had
   * a column: a provincial campaign's ward, precinct and municipality all shared the hidden "All
   * boundaries" cell, where they can only be searched as text. One column each is what the CSV
   * export already does, and what makes "sort by ward" a thing the grid can do.
   *
   * Seat-area maps are shown, subdivisions and localities start hidden — decided by the map's
   * `role`, never by what its areas are called.
   */
  private applyAreaColumns(areaColumns: readonly BoundaryAreaColumnType[]): void {
    // The campaign's own map is the `electoral_area` column, under the campaign's word for it.
    const extras: ColDef[] = areaColumns
      .filter((column) => !column.is_seat_set)
      .map((column) => ({
        field: column.field,
        headerName: column.label,
        editable: false,
        hide: column.role !== 'seat_area',
        minWidth: 140,
        cellClass: SECONDARY_CELL_CLASS,
      }));
    if (extras.length === 0) return;

    const anchor = this.col.findIndex((c) => c.field === 'any_electoral_area');
    this.col.splice(anchor < 0 ? this.col.length : anchor, 0, ...extras);
  }

  /**
   * Rewrite the two electoral column headings in the campaign's own word. Called before the grid is
   * created, because the grid copies its column definitions once at init and never re-reads them.
   */
  private applyJurisdictionLabels(): void {
    // Both labels always resolve: seatLabelFor falls back to the 'other' spec ("District" /
    // "Districts") when the campaign declares no jurisdiction, so no local fallback exists here.
    const seat = this.campaignCtx.seatLabel();
    const seatPlural = this.campaignCtx.seatLabelPlural();
    for (const c of this.col) {
      if (c.field === 'electoral_area') c.headerName = seat;
      // The hidden column spans every map the workspace holds, not just this campaign's, so it
      // names the campaign's own areas first and then says there may be more.
      if (c.field === 'any_electoral_area') {
        c.headerName = `All boundaries (${seatPlural.toLowerCase()} and any other map)`;
      }
      if (c.field === 'seat_status') {
        // Headed with this level of government's own word — "In your riding", "In your wards".
        c.headerName = this.campaignCtx.seatTerritoryLabel();
      }
    }

    // An at-large office (a mayor, a governor) represents no area, so "in your seat" has no answer
    // for any door. Drop the column rather than offering an empty one in the column chooser.
    if (this.campaignCtx.activeSeatAreaNames().length === 0) {
      const at = this.col.findIndex((c) => c.field === 'seat_status');
      if (at >= 0) this.col.splice(at, 1);
    }
  }

  /**
   * The four answers, spelled out. `outside` and `unknown` must not both read as "no".
   *
   * "Outside the map" means the address was tested against every area and fell in none of them —
   * outside Ontario, or outside Canada. Blank means nothing has looked yet, usually because the
   * address has no coordinates. Telling someone their Vancouver donor is simply "No" would hide
   * that the answer for a Milton address might still be arriving.
   */
  protected formatSeatStatus(value: unknown): string {
    switch (value) {
      case 'in':
        return 'Yes';
      case 'other':
        return 'No — another area';
      case 'outside':
        return 'No — outside the map';
      default:
        return '';
    }
  }

  /** Deletes change the header counts — re-query the grain sentence, unhoused note, and tab totals. */
  protected onRowsDeleted(): void {
    void this.loadGrainSentence();
    if (!this.inline()) void this.loadUnhoused();
    this.grainTabs()?.reloadCounts();
  }

  private async loadUnhoused(): Promise<void> {
    try {
      this.unhoused.set(await this.householdsService.getUnhoused());
    } catch (err) {
      console.error('Failed to load unhoused people count', err);
    }
  }

  /** Opens the placeholder household, whose detail view lists everyone with no address. */
  protected openUnhoused(): void {
    const id = this.unhoused().household_id;
    if (id) void this.router.navigate(['/households', id]);
  }

  private async loadGrainSentence(): Promise<void> {
    try {
      const [total, areas] = await Promise.all([
        this.householdsService.count(),
        this.householdsService.countDistinctAreas(),
      ]);
      const fmt = new Intl.NumberFormat();
      const households = total === 1 ? '1 household' : `${fmt.format(total)} households`;
      // seatLabel()/seatLabelPlural() always resolve — "District"/"Districts" via the 'other'
      // spec when the campaign declares no jurisdiction.
      const areaWord =
        areas === 1 ? this.campaignCtx.seatLabel().toLowerCase() : this.campaignCtx.seatLabelPlural().toLowerCase();
      // A workspace with no boundary map yet has no areas to count, so the sentence drops that
      // clause rather than claiming zero.
      this.totalSentence.set(
        areas > 0 ? `${households} across ${fmt.format(areas)} ${areaWord}` : `${households} total`,
      );
    } catch (err) {
      console.error('Failed to load household grain counts', err);
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

  protected openEditOnDoubleClick(event: any) {
    this.grid()?.openEditOnDoubleClick(event?.data ?? event);
  }

  /** Renders member names as person-card links; a comma separator keeps them on one line. */
  private renderMembers(value: unknown): string {
    const members = Array.isArray(value) ? (value as Array<{ id?: unknown; name?: unknown }>) : [];
    const links = members
      .filter((m) => m && m.id != null && typeof m.name === 'string' && m.name.trim().length)
      .map((m) => {
        const id = this.escapeHtml(String(m.id));
        const name = this.escapeHtml(String(m.name));
        return `<a data-person-id="${id}" class="cursor-pointer hover:text-primary hover:underline underline-offset-[3px]">${name}</a>`;
      });
    if (!links.length) return '';
    // Block root truncates at the cell width; inline links stay on one line (not wrapped).
    return `<span class="block truncate">${links.join('<span class="text-base-content/40">, </span>')}</span>`;
  }

  /** Delegated navigation for a clicked member link (renderer HTML can't hold Angular handlers). */
  private onMemberClicked(event: Event | undefined): void {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;
    const anchor = target.closest('[data-person-id]');
    const id = anchor?.getAttribute('data-person-id');
    if (id) void this.router.navigate(['/people', id]);
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Street number + name for the Household door column (city has its own column). */
  private addressString(data: unknown): string {
    const d = data as Record<string, unknown> | undefined;
    if (!d) return '';
    if (d['is_placeholder']) return 'People with no addresses';
    return [d['street_num'], d['street1']].filter(Boolean).join(' ').trim();
  }

  /** Compact relative "last touch" — matches the household view's low-chrome style. */
  private formatLastTouch(value: unknown): string {
    if (value == null || (typeof value !== 'string' && !(value instanceof Date))) return '';
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return '';
    const diffDays = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
  }

  protected async confirmDelete(selectedRows?: any[]): Promise<boolean> {
    const selected = (selectedRows || this.grid()?.getSelectedRows() || []) as Array<{
      id: string;
      persons_count?: number | string | null;
      is_placeholder?: boolean;
    }>;

    if (!selected.length) {
      this.alertSvc.showError('No rows selected.');
      return true;
    }

    // Guard: the tenant's placeholder household is permanent and cannot be deleted.
    if (selected.some((r) => r.is_placeholder)) {
      this.alertSvc.showError('The placeholder household cannot be deleted. It holds people who have no address.');
      return true;
    }

    // Collect IDs for households that have people
    const populated = selected.filter((r) => Number(r.persons_count ?? 0) > 0);
    const householdIds = selected.map((r) => r.id);

    if (populated.length > 0) {
      // Fetch person IDs for all households-with-people so we can act on them
      const personIdArrays = await Promise.all(
        populated.map(async (h) => {
          try {
            const people = (await this.personsSvc.getByHouseholdId(h.id, { columns: ['id'] })) as Array<{ id: string }>;
            return people.map((p) => p.id);
          } catch {
            return [];
          }
        }),
      );
      const personIds = personIdArrays.flat();
      const peopleCount = personIds.length;

      // Show the 3-option dialog and wait for user's choice
      const choice = await this.dialogSvc.choose<'delete-people' | 'keep-people'>({
        title: 'Households have people',
        message: `${populated.length} household(s) being deleted contain ${peopleCount} person(s).\nWhat would you like to do with those people?`,
        variant: 'warning',
        choices: [
          { label: 'Delete people too', value: 'delete-people', variant: 'danger' },
          { label: 'Keep people, just remove their address', value: 'keep-people', variant: 'warning' },
        ],
        cancelText: 'Cancel',
      });

      if (!choice) return true; // Handled (user clicked Cancel, so do nothing)

      if (choice === 'keep-people') {
        // Detach each person from their household (moves to blank household)
        await Promise.all(
          personIds.map((pid) =>
            this.personsSvc.removeHousehold(pid).catch(() => {
              // best-effort; continue
            }),
          ),
        );
      } else if (choice === 'delete-people') {
        // Delete all people in those households first
        if (personIds.length) {
          try {
            await this.personsSvc.deleteMany(personIds);
          } catch {
            this.alertSvc.showError('Failed to delete people. Aborting household deletion.');
            return true;
          }
        }
      }

      // Now delete the households themselves
      try {
        await this.householdsService.deleteMany(householdIds);
        this.alertSvc.showSuccess('Households deleted successfully.');
      } catch {
        this.alertSvc.showError('Failed to delete one or more households.');
      }
      return true;
    } else {
      // No people attached — delegate to the standard flow
      return false;
    }
  }

  // The CSV import wizard (spec §17) replaced the old in-grid import modal —
  // one idiom for the job across every record type.
  protected openImportWizard(): void {
    void this.router.navigate(['/imports/new'], { queryParams: { type: 'households' } });
  }
}
