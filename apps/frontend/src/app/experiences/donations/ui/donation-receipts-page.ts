import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { Table } from '@uxcommon/components/table/table';
import { TabBar } from '@uxcommon/components/tabs/tabs';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { RECEIPT_KIND_LABELS, type ReceiptKind } from '@common';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { DonationReceiptsService } from '../../../services/api/donation-receipts-service';
import { downloadWithAuthHeader } from '../../../services/api/http-download';
import { TokenService } from '../../../services/api/token-service';
import { WorkspaceCurrencyService } from '../../../shared/services/currency.service';
import { DONATION_TABS } from './donation-tabs';

type ReceiptRowT = Awaited<ReturnType<DonationReceiptsService['listReceipts']>>[number];
type StatementRun = Awaited<ReturnType<DonationReceiptsService['listStatementRuns']>>[number];
type SettingsStatus = Awaited<ReturnType<DonationReceiptsService['getSettingsStatus']>>;

/** How many prior years the statement year picker offers. */
const STATEMENT_YEARS_BACK = 5;

/**
 * Receipts & year-end statements — the workspace-wide receipts ledger (official receipts and
 * giving statements), the needs-attention filter, and the batch statement runs. Admin/owner
 * only: the server refuses everyone else, and this page explains that instead of erroring.
 */
@Component({
  selector: 'pc-donation-receipts-page',
  imports: [EmptyState, RouterLink, Icon, TabBar, Table, GridHeaderComponent],
  templateUrl: './donation-receipts-page.html',
})
export class DonationReceiptsPageComponent implements OnInit {
  private readonly receiptsSvc = inject(DonationReceiptsService);
  private readonly alertSvc = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);
  private readonly tokenSvc = inject(TokenService);
  private readonly money = inject(WorkspaceCurrencyService);

  protected readonly donationTabs = DONATION_TABS;
  protected readonly _loading = createLoadingGate();

  protected readonly receipts = signal<ReceiptRowT[]>([]);
  protected readonly runs = signal<StatementRun[]>([]);
  protected readonly settingsStatus = signal<SettingsStatus | null>(null);
  protected readonly needsAttentionOnly = signal(false);
  /**
   * Off by default. Every gift produces an acknowledgement, so including them here would bury the
   * tax receipts and statements this page exists for under one row per gift.
   */
  protected readonly showAcknowledgements = signal(false);
  protected readonly running = signal(false);
  protected readonly retrying = signal(false);

  protected readonly isAdmin = computed(() => {
    const role = this.auth.getUser()?.role;
    return role === 'admin' || role === 'owner';
  });

  /** Year-end statements cover finished years; last year is the default pick. */
  protected readonly statementYears = (() => {
    const lastYear = new Date().getFullYear() - 1;
    return Array.from({ length: STATEMENT_YEARS_BACK }, (_, i) => lastYear - i);
  })();
  protected readonly statementYear = signal(new Date().getFullYear() - 1);

  protected readonly visibleReceipts = computed(() =>
    this.needsAttentionOnly() ? this.receipts().filter((r) => r.reissue_required) : this.receipts(),
  );

  ngOnInit(): void {
    if (this.isAdmin()) void this.load();
  }

  protected refresh(): void {
    void this.load();
  }

  protected toggleNeedsAttention(): void {
    this.needsAttentionOnly.update((v) => !v);
  }

  /** Server-side filter, so reloading is the point — the excluded rows were never fetched. */
  protected toggleAcknowledgements(): void {
    this.showAcknowledgements.update((v) => !v);
    void this.load();
  }

  protected setStatementYear(value: string): void {
    const year = Number(value);
    if (this.statementYears.includes(year)) this.statementYear.set(year);
  }

  protected kindLabel(kind: string): string {
    return kind in RECEIPT_KIND_LABELS ? RECEIPT_KIND_LABELS[kind as ReceiptKind] : kind;
  }

  protected formatCurrency(cents: number | null | undefined): string {
    return this.money.format(cents);
  }

  protected formatDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    try {
      return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  /**
   * Ask for the PDF again after a render failed. The receipt keeps its number and contents — only
   * the document is regenerated, and nothing is emailed to the donor.
   */
  protected async retryPdf(receipt: ReceiptRowT): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      await this.receiptsSvc.retryReceiptPdf({ receiptId: receipt.id });
      this.alertSvc.showSuccess('Generating the PDF again — refresh in a moment to download it.');
      await this.load();
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Could not retry the PDF');
    } finally {
      this.retrying.set(false);
    }
  }

  protected downloadReceipt(receipt: ReceiptRowT): void {
    if (!receipt.file_id) {
      this.alertSvc.showInfo(
        receipt.pdf_failed_at
          ? 'This PDF could not be generated. Use Retry PDF to try again.'
          : 'The PDF is still being generated — try again in a moment.',
      );
      return;
    }
    const base =
      receipt.kind === 'statement' ? `Giving-statement-${receipt.year}` : `Receipt-${receipt.receipt_number}`;
    void downloadWithAuthHeader(
      `${environment.apiUrl}/api/files/download/${receipt.file_id}`,
      this.tokenSvc.getAuthToken(),
      `${base}.pdf`,
    );
  }

  protected async runStatements(): Promise<void> {
    const year = this.statementYear();
    const confirmed = await this.dialogs.confirm({
      title: `Send ${year} year-end documents?`,
      message:
        `Every donor with a successful gift in ${year} gets one document: an official tax receipt ` +
        `where this workspace can issue one and the donor has a mailing address on file, otherwise ` +
        `a giving summary. Donors with an email address get theirs by email; the rest are marked ` +
        `for you to print. Large batches send in waves and can take a few hours — you'll be ` +
        `notified when it finishes.`,
      confirmText: 'Run year-end',
      cancelText: 'Not now',
    });
    if (!confirmed) return;
    this.running.set(true);
    try {
      await this.receiptsSvc.runYearEndStatements(year);
      this.alertSvc.showSuccess(`${year} year-end run started. You'll be notified when it completes.`);
      await this.load();
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Could not start the run');
    } finally {
      this.running.set(false);
    }
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      const [receipts, runs, status] = await Promise.all([
        this.receiptsSvc.listReceipts({
          limit: 200,
          kinds: this.showAcknowledgements()
            ? ['acknowledgement', 'per_gift', 'cumulative', 'statement']
            : ['per_gift', 'cumulative', 'statement'],
        }),
        this.receiptsSvc.listStatementRuns(),
        this.receiptsSvc.getSettingsStatus(),
      ]);
      this.receipts.set(receipts);
      this.runs.set(runs);
      this.settingsStatus.set(status);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to load receipts');
    } finally {
      end();
    }
  }
}
