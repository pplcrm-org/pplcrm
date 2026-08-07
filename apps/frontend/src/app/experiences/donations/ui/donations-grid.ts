import { Component, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { TabBar } from '@uxcommon/components/tabs/tabs';
import { DataGrid } from '@frontend/shared/components/datagrid/datagrid';
import { provideDataGridConfig } from '@frontend/shared/components/datagrid/datagrid.tokens';
import { SECONDARY_CELL_CLASS } from '@frontend/shared/components/datagrid/grid-defaults';
import { DONATION_METHOD_LABELS, type DonationMethod } from '../../../../../../../libs/common/src';
import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { DonationsChangedService } from '../../../services/api/donations-changed.service';
import { DonationsService, type DonationLedgerSummary } from '../../../services/api/donations-service';
import { WorkspaceCurrencyService } from '../../../shared/services/currency.service';
import { DONATION_TABS, type DonationsScope } from './donation-tabs';
import { RecordDonationDialog } from './record-donation-dialog';

import type { CellParams, ColumnDef as ColDef } from '@frontend/shared/components/datagrid/grid-defaults';

/** Escape user data before it lands inside a cellRenderer HTML string. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Component({
  selector: 'pc-donations-grid',
  imports: [DataGrid, GridHeaderComponent, Icon, RecordDonationDialog, RouterLink, TabBar],
  templateUrl: './donations-grid.html',
  host: { class: 'block h-full' },
  providers: [
    // Component-scoped service instance: each tab fixes its own `listScope` (all vs one-time),
    // so the route-reuse strategy can keep both pages alive without them sharing a mutable scope.
    DonationsService,
    { provide: AbstractAPIService, useExisting: DonationsService },
    provideDataGridConfig({
      messages: {
        loadFailed: 'Failed to load donations. Please try again.',
        entityNoun: 'gift',
        entityNounPlural: 'gifts',
      },
    }),
  ],
})
export class DonationsGridComponent implements OnInit {
  private readonly donationsSvc = inject(DonationsService);
  private readonly donationsChanged = inject(DonationsChangedService);
  private readonly alertSvc = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly money = inject(WorkspaceCurrencyService);

  private readonly recordDialog = viewChild.required(RecordDonationDialog);

  /** All / One-time / Monthly pledges are sibling pages — route-linked pills, same bar on each. */
  protected readonly donationTabs = DONATION_TABS;

  /** Which tab rendered this instance. Each route has its own reuse key, so the snapshot
   * value is fixed for the lifetime of the component — no need to track route changes. */
  protected readonly scope: DonationsScope = this.route.snapshot.data['scope'] === 'one-time' ? 'one-time' : 'all';

  protected readonly _loading = createLoadingGate();

  /** Header-tile aggregates, computed server-side — the grid only ever holds one page of rows,
   * so totals can no longer be summed client-side. */
  protected readonly summary = signal<DonationLedgerSummary | null>(null);

  /**
   * True when the last summary fetch threw. Without it the tiles stayed at zero dollars and zero
   * gifts, which reads as "you have raised nothing" rather than "the totals were not read".
   */
  protected readonly summaryFailed = signal(false);

  protected readonly totalRaised = computed(() => (this.summary()?.totalCents ?? 0) / 100);
  protected readonly totalGiftCount = computed(() => this.summary()?.totalCount ?? 0);
  protected readonly thisMonthTotal = computed(() => (this.summary()?.thisMonthCents ?? 0) / 100);
  protected readonly thisMonthCount = computed(() => this.summary()?.thisMonthCount ?? 0);
  private readonly lastMonthTotal = computed(() => (this.summary()?.lastMonthCents ?? 0) / 100);
  protected readonly monthlyDonorCount = computed(() => this.summary()?.activePledgeCount ?? 0);
  protected readonly acknowledgedThisMonth = computed(() => this.summary()?.acknowledgedThisMonth ?? 0);

  /** "+18% vs April"-style delta. Null when there's no prior-month baseline to compare against. */
  protected readonly monthOverMonthDelta = computed(() => {
    const last = this.lastMonthTotal();
    if (last <= 0) return null;
    return Math.round(((this.thisMonthTotal() - last) / last) * 100);
  });

  protected readonly averageGift = computed(() => {
    const count = this.thisMonthCount();
    return count > 0 ? this.thisMonthTotal() / count : 0;
  });

  /** The All tab answers "how much have we raised?" for good — the one-time tab stays on the
   * month, which is the number that moves there. */
  protected readonly headerSentence = computed(() => {
    if (this.summaryFailed()) return 'Donation totals could not be loaded';
    const allTime = this.scope === 'all';
    const total = allTime ? this.totalRaised() : this.thisMonthTotal();
    const count = allTime ? this.totalGiftCount() : this.thisMonthCount();
    const formattedTotal = this.money.formatUnits(total);
    const gifts = `${count} ${count === 1 ? 'gift' : 'gifts'}`;
    if (count === 0) return allTime ? 'No donations recorded yet' : 'No gifts recorded yet this month';
    return allTime
      ? `${formattedTotal} raised in total across ${gifts}`
      : `${formattedTotal} raised this month across ${gifts}`;
  });

  /** The ledger columns. Nothing is editable inline — amounts and receipt state have legal
   * side effects (gap-free receipt numbering), so all edits go through the gift page. */
  protected readonly col: ColDef[] = [
    {
      // The door: opens the gift, not the donor — a row in a list of gifts is about the gift,
      // and the donor's own page is one further click from there.
      field: 'donor_name',
      headerName: 'Donor',
      editable: false,
      doorColumn: true,
      noHide: true,
      flex: true,
      minWidth: 200,
      valueGetter: (params: CellParams) => {
        const data = params?.data;
        if (!data) return '';
        return [data['person_first_name'], data['person_last_name']]
          .filter((p) => typeof p === 'string' && p.trim().length)
          .join(' ')
          .trim();
      },
      doorSubtitle: (params: CellParams) => {
        const email = params?.data?.['person_email'];
        return typeof email === 'string' && email.trim() ? email : null;
      },
    },
    // Hidden by default (the door subtitle already shows it) but filterable/sortable on demand.
    { field: 'person_email', headerName: 'Email', editable: false, hide: true, width: 220 },
    {
      field: 'amount',
      headerName: 'Amount',
      editable: false,
      width: 130,
      cellClass: 'text-right font-bold tabular-nums',
      valueFormatter: (params: CellParams) => this.money.format(Number(params.value ?? 0)),
    },
    {
      field: 'method',
      headerName: 'Method',
      editable: false,
      width: 170,
      cellRenderer: (params: CellParams) => {
        const label = escapeHtml(this.methodLabel(String(params.value ?? '')));
        const badge = `<span class="badge badge-ghost text-xs font-semibold px-2.5 py-1 capitalize">${label}</span>`;
        // An installment of a monthly pledge, so the All tab does not read as all one-time gifts.
        const monthly = params?.data?.['pledge_id']
          ? `<span class="badge badge-outline badge-primary text-xs font-semibold px-2.5 py-1">Monthly</span>`
          : '';
        return `<span class="inline-flex flex-wrap items-center gap-1.5">${badge}${monthly}</span>`;
      },
    },
    {
      field: 'created_at',
      headerName: 'Date',
      editable: false,
      width: 180,
      cellClass: `${SECONDARY_CELL_CLASS} tabular-nums`,
      valueFormatter: (params: CellParams) => this.formatDate(params.value as Date | string),
    },
    {
      field: 'receipt_status',
      headerName: 'Receipt',
      editable: false,
      width: 170,
      cellRenderer: (params: CellParams) => {
        const number = params?.data?.['receipt_number'];
        const numberText = typeof number === 'string' && number ? escapeHtml(number) : null;
        switch (params.value) {
          case 'receipted':
            return `<span class="badge badge-success badge-outline text-xs font-semibold px-2.5 py-1">${numberText ?? 'Tax receipt'}</span>`;
          case 'cancelled':
            return `<span class="badge badge-warning badge-outline text-xs font-semibold px-2.5 py-1">Receipt cancelled</span>`;
          case 'acknowledged':
            // Every gift lands here. Neutral, not success-green: the green badge is reserved for
            // an official tax receipt, which is a stronger claim than "we thanked them".
            return `<span class="badge badge-ghost text-xs font-semibold px-2.5 py-1" title="Donation receipt sent to the donor">${numberText ?? 'Acknowledged'}</span>`;
          default:
            return `<span class="badge badge-ghost text-xs font-semibold px-2.5 py-1 text-base-content/50">Not sent</span>`;
        }
      },
    },
  ];

  constructor() {
    // Fix this instance's slice of the ledger before the child grid's first fetch.
    this.donationsSvc.listScope = this.scope;

    // Reload whenever a gift or pledge is written anywhere in the app — this page's own Record
    // donation dialog, the sibling All/One-time tab, or a person's page. Both tabs stay alive in
    // the route-reuse cache, so a page that did not do the recording kept its old rows until the
    // browser reloaded; a page that is detached right now reacts when it is shown again.
    effect(() => {
      if (this.donationsChanged.version() === 0) return;
      untracked(() => {
        void this.loadSummary();
        // The grid listens to the service's refresh signal and re-fetches its current page.
        this.donationsSvc.triggerRefresh();
      });
    });
  }

  ngOnInit(): void {
    void this.loadSummary();
  }

  protected openRecordDonation(): void {
    this.recordDialog().open();
  }

  /** Header stat tiles hold already-divided dollar amounts, not cents. */
  protected formatUnits(amount: number | null | undefined): string {
    return this.money.formatUnits(amount);
  }

  protected formatDate(date: Date | string): string {
    try {
      return new Date(date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  /** Safe lookup into the fixed method → label map — `method` is a checked DB text column, not a
   * TS-narrowed union, so this guards with `in` rather than asserting the type. */
  protected methodLabel(method: string): string {
    return method in DONATION_METHOD_LABELS ? DONATION_METHOD_LABELS[method as DonationMethod] : method;
  }

  /** Retry button on the totals-failed state. */
  protected retrySummary(): void {
    void this.loadSummary();
  }

  private async loadSummary(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.summary.set(await this.donationsSvc.getLedgerSummary(this.scope));
      this.summaryFailed.set(false);
    } catch (_err) {
      this.summaryFailed.set(true);
      this.alertSvc.showError('Failed to load donation totals. Please try again.');
    } finally {
      end();
    }
  }
}
