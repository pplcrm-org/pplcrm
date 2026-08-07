import { Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { describeListDefinition } from '@experiences/lists/services/list-definition';
import { ListsRefreshService } from '@experiences/lists/services/lists-refresh.service';
import { ListsService } from '@experiences/lists/services/lists-service';
import { DataGrid } from '@frontend/shared/components/datagrid/datagrid';
import { provideDataGridConfig } from '@frontend/shared/components/datagrid/datagrid.tokens';
import type { CellParams, ColumnDef as ColDef } from '@frontend/shared/components/datagrid/grid-defaults';
import { Icon } from '@icons/icon';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { UpdateListType } from '../../../../../../../libs/common/src';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { CampaignContextService } from '../../../services/campaign-context.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatDateTime(value: unknown): string {
  if (value == null) return '—';
  const date = new Date(value as string | number | Date);
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Component({
  selector: 'pc-lists-grid',
  imports: [DataGrid, Icon, GridHeaderComponent],
  host: { class: 'block h-full' },
  template: `
    <div class="flex h-full min-h-0 flex-col gap-4 p-6">
      <!-- Page header: the one list-page header idiom (pc-grid-header, design §4). The grid's
           own in-grid title/toolbar are switched off below so this is the only header, and its
           p-6 padding moves here since the grid itself no longer applies it (no title/grainLayout). -->
      <pc-grid-header title="Lists" [totalSentence]="summarySentence()">
        <button type="button" class="btn btn-primary btn-sm gap-1.5 shrink-0" (click)="grid.doAdd()">
          <pc-icon name="plus" [size]="4"></pc-icon>
          <span>New list</span>
        </button>
      </pc-grid-header>

      <pc-datagrid
        #grid
        class="min-h-0 flex-1"
        [colDefs]="col"
        [disableDelete]="false"
        [disableView]="false"
        [allowFilter]="false"
        [enableSelection]="false"
        [showToolbar]="false"
        [showColumnMenus]="false"
        plusIcon="add-list"
        i18n-plusIcon
        addRoute="add"
        i18n-addRoute
      ></pc-datagrid>

      <!-- Footer explainer (verbatim §8): narrates what each list type does. -->
      <p class="text-xs leading-relaxed text-base-content/60">
        Smart lists refresh themselves. Membership updates automatically as people and households change. Static lists
        run their rules once at creation and save a fixed snapshot; membership only changes when you edit it by hand.
        Opening a list shows its members, the newsletters sent to it, and its history.
      </p>
    </div>
  `,
  providers: [
    { provide: AbstractAPIService, useExisting: ListsService },
    provideDataGridConfig({
      messages: {
        entityNoun: 'list',
        entityNounPlural: 'lists',
        exportEntity: 'lists',
        exportFileName: 'lists-export.csv',
      },
    }),
  ],
})
export class ListsGridComponent implements OnInit {
  private readonly refreshSvc = inject(ListsRefreshService);
  private readonly listsSvc = inject(ListsService);
  private readonly campaignCtx = inject(CampaignContextService);
  private readonly grid = viewChild<DataGrid<'lists', UpdateListType>>('grid');

  /** The active campaign's word for the seat it contests, or null when it declares no office. */
  private readonly seatLabel = computed<string | null>(() => this.campaignCtx.seatLabel());

  /** Counts for the grain sentence — refreshed alongside the grid. */
  private readonly counts = signal<{ total: number; smart: number; static: number }>({ total: 0, smart: 0, static: 0 });

  protected readonly summarySentence = computed<string>(() => {
    const { total, smart, static: staticCount } = this.counts();
    const n = (v: number) => new Intl.NumberFormat().format(v);
    if (total === 0) return 'No lists yet · create a smart list that refreshes itself or a static snapshot';
    const listWord = total === 1 ? 'list' : 'lists';
    return `${n(total)} ${listWord} · ${n(smart)} smart (refresh themselves), ${n(staticCount)} static (fixed snapshots)`;
  });

  constructor() {
    effect(() => {
      const count = this.refreshSvc.refreshCount();
      if (count > 0) {
        untracked(() => {
          void this.grid()?.refresh();
          void this.loadCounts();
        });
      }
    });
  }

  public ngOnInit(): void {
    void this.campaignCtx.ensureLoaded();
    void this.loadCounts();
  }

  private async loadCounts(): Promise<void> {
    try {
      const result = await this.listsSvc.getAll();
      const rows = isRecord(result) && Array.isArray(result['rows']) ? result['rows'] : [];
      let smart = 0;
      for (const r of rows) {
        if (isRecord(r) && r['is_dynamic'] === true) smart += 1;
      }
      this.counts.set({ total: rows.length, smart, static: rows.length - smart });
    } catch {
      // The grid itself surfaces load errors; the sentence just stays put.
    }
  }

  protected col: ColDef[] = [
    {
      // LIST — the name is the door: opens the list's own page at /lists/:id, which
      // shows the members grid, the campaign history and the activity log. `doorColumn`
      // routes the click through the grid's own open path, so the URL names the list
      // AND the detail page gets the filtered prev/next record pager.
      field: 'name',
      doorColumn: true,
      headerName: 'List',
      cellRenderer: (p: CellParams) => {
        const name = String(p?.value ?? p?.data?.['name'] ?? 'Untitled list');
        const link = `<span class="cursor-pointer text-xs font-semibold underline decoration-base-content/20 underline-offset-[3px] transition-colors hover:text-primary hover:decoration-primary">${escapeHtml(name)}</span>`;
        // Built-in lists (§8) carry the badge rather than a disabled-looking row:
        // say what it is up front instead of only explaining after a failed delete.
        if (p?.data?.['system_key']) {
          return `<span class="inline-flex items-center gap-1.5">${link}<span class="badge badge-ghost badge-xs font-medium" title="Built in — always here, and can’t be deleted">Built in</span></span>`;
        }
        return link;
      },
    },
    {
      field: 'is_dynamic',
      headerName: 'Type',
      cellRenderer: (p: CellParams) => {
        const isSmart = p?.data?.['is_dynamic'] === true;
        return isSmart
          ? `<span class="badge badge-primary badge-sm font-semibold">Smart</span>`
          : `<span class="badge badge-neutral badge-sm font-semibold">Static</span>`;
      },
    },
    {
      field: 'object',
      headerName: 'Of',
      valueFormatter: (p: CellParams) => {
        const val = p?.value;
        if (val === 'people') return 'People';
        if (val === 'households') return 'Households';
        return typeof val === 'string' && val ? val : '—';
      },
    },
    {
      field: 'definition',
      headerName: 'Definition',
      // The seat label makes an electoral rule read in the campaign's own word ("Ward is 'Ward 4'"),
      // matching what the rule builder offered when the list was written.
      valueFormatter: (p: CellParams) => describeListDefinition(p?.data?.['definition'], this.seatLabel()),
    },
    {
      field: 'list_size',
      headerName: 'Members',
      // Right-aligned, tabular figures (§1/§8). Populated for both types.
      valueFormatter: (p: CellParams) => new Intl.NumberFormat().format(Number(p?.value ?? 0)),
    },
    {
      field: 'last_used_in',
      headerName: 'Last used in',
      valueFormatter: (p: CellParams) => {
        const val = p?.value;
        return typeof val === 'string' && val.trim() ? val : 'Not used yet';
      },
    },
    {
      field: 'updated_at',
      headerName: 'Updated',
      valueFormatter: (p: CellParams) => formatDateTime(p?.value),
    },
  ];
}
