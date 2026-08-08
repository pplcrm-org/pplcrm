import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { TabBar } from '@uxcommon/components/tabs/tabs';
import { Table } from '@uxcommon/components/table/table';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { DonationsService } from '../../../services/api/donations-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { DONATION_TABS } from './donation-tabs';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { countryDisplayName } from '@common';
import { WorkspaceCurrencyService } from '../../../shared/services/currency.service';

@Component({
  selector: 'pc-pledges-grid',
  imports: [EmptyState, RouterLink, TitleCasePipe, TabBar, Table, GridHeaderComponent],
  templateUrl: './pledges-grid.html',
})
export class PledgesGridComponent implements OnInit {
  private readonly donationsSvc = inject(DonationsService);
  private readonly alertSvc = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly money = inject(WorkspaceCurrencyService);

  /** All / One-time / Monthly pledges are sibling pages — route-linked pills, same bar on each. */
  protected readonly donationTabs = DONATION_TABS;

  protected readonly pledges = signal<any[]>([]);
  protected readonly _loading = createLoadingGate();
  protected readonly cancelling = signal<string | null>(null);
  /**
   * True when the last load threw. Without it a failed fetch left an empty list, and the page said
   * "No pledges yet" — a confident statement about the data that nobody had actually read.
   */
  protected readonly loadFailed = signal(false);

  protected readonly activePledgeCount = computed(() => this.pledges().filter((p) => p.status === 'active').length);

  protected readonly totalMonthlyCommitted = computed(
    () =>
      this.pledges()
        .filter((p) => p.status === 'active')
        .reduce((sum: number, p: any) => sum + Number(p.monthly_amount || 0), 0) / 100,
  );

  ngOnInit() {
    void this.load();
  }

  protected async cancelPledge(pledge: any) {
    const name =
      [pledge.person_first_name, pledge.person_last_name].filter(Boolean).join(' ') ||
      pledge.person_email ||
      'this donor';
    const confirmed = await this.dialogs.confirm({
      title: `Cancel pledge for ${name}?`,
      message: `This will stop the ${this.formatCurrency(pledge.monthly_amount)}/month recurring donation immediately. This cannot be undone.`,
      confirmText: 'Cancel pledge',
      cancelText: 'Keep pledge',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.cancelling.set(String(pledge.id));
    try {
      await this.donationsSvc.cancelPledge(String(pledge.id));
      this.alertSvc.showSuccess('Pledge cancelled successfully.');
      await this.load();
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to cancel pledge.');
    } finally {
      this.cancelling.set(null);
    }
  }

  protected formatCurrency(amountCents: number | null | undefined): string {
    return this.money.format(amountCents);
  }

  /** The Monthly Committed tile holds an already-divided total, not cents. */
  protected formatUnits(amount: number | null | undefined): string {
    return this.money.formatUnits(amount);
  }

  protected formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }

  protected toStr(val: any): string {
    return String(val);
  }

  /**
   * The pledge's billing-address country was stored as a printed name ('Canada') on older pledges
   * and as an ISO code ('CA') since the "Record donation" dialog switched formats. Renders a
   * recognized code as its printed name; anything else (a legacy name, free text) prints unchanged.
   */
  protected readonly countryLabel = countryDisplayName;

  protected statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
      active: 'badge-success',
      past_due: 'badge-warning',
      cancelled: 'badge-ghost',
      unpaid: 'badge-error',
    };
    return map[status] ?? 'badge-neutral';
  }

  /** Retry button on the load-failure state. */
  protected retry(): void {
    void this.load();
  }

  private async load() {
    const end = this._loading.begin();
    try {
      const data = await this.donationsSvc.listPledges();
      this.pledges.set(data || []);
      this.loadFailed.set(false);
    } catch {
      this.loadFailed.set(true);
      this.alertSvc.showError('Failed to load pledges. Please try again.');
    } finally {
      end();
    }
  }
}
