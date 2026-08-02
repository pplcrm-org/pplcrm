import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import { DetailRow } from '@uxcommon/components/detail-row/detail-row';
import { ProfileCard } from '@uxcommon/components/profile-card/profile-card';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { DONATION_METHOD_LABELS, RECEIPT_KIND_LABELS, type DonationMethod, type ReceiptKind } from '@common';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { DonationReceiptsService } from '../../../services/api/donation-receipts-service';
import { DonationsService } from '../../../services/api/donations-service';
import { downloadWithAuthHeader } from '../../../services/api/http-download';
import { TokenService } from '../../../services/api/token-service';
import { OrgModeService } from '../../../services/org-mode.service';
import { WorkspaceCurrencyService } from '../../../shared/services/currency.service';

type DonationDetail = Awaited<ReturnType<DonationsService['getDonation']>>;
type ReceiptRowT = Awaited<ReturnType<DonationReceiptsService['listReceipts']>>[number];

/**
 * One gift: amount/method/donor/campaign, its receipt history, and the issue / cancel /
 * cancel-and-replace actions. Receipt actions are admin/owner-only (they span campaigns and
 * legally belong to the workspace's declared signatory), so other roles see status only.
 */
@Component({
  selector: 'pc-donation-view',
  imports: [RouterModule, Icon, RecordActivities, DetailLayout, DetailRow, ProfileCard],
  templateUrl: './donation-view.html',
})
export class DonationViewComponent {
  readonly id = input.required<string>();

  private readonly donationsSvc = inject(DonationsService);
  private readonly receiptsSvc = inject(DonationReceiptsService);
  private readonly alertSvc = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);
  private readonly tokenSvc = inject(TokenService);
  private readonly router = inject(Router);
  private readonly money = inject(WorkspaceCurrencyService);
  private readonly orgMode = inject(OrgModeService);

  private readonly _loading = createLoadingGate();
  protected readonly isLoading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly donation = signal<DonationDetail | null>(null);
  protected readonly receipts = signal<ReceiptRowT[]>([]);
  protected readonly acting = signal(false);

  protected readonly isAdmin = computed(() => {
    const role = this.auth.getUser()?.role;
    return role === 'admin' || role === 'owner';
  });

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: this.orgMode.term('nav.donations'), route: '/donations' },
    { label: this.donorName() || 'Gift' },
  ]);

  protected readonly donorName = computed(() => {
    const d = this.donation();
    return d ? `${d.person_first_name ?? ''} ${d.person_last_name ?? ''}`.trim() : '';
  });

  /** The live (issued) official receipt, when one exists. */
  protected readonly liveReceipt = computed(() => this.receipts().find((r) => r.status === 'issued') ?? null);
  protected readonly canIssue = computed(
    () => this.isAdmin() && this.donation()?.status === 'succeeded' && !this.liveReceipt(),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  protected formatCurrency(cents: number | null | undefined): string {
    return this.money.format(cents);
  }

  protected methodLabel(method: string): string {
    return method in DONATION_METHOD_LABELS ? DONATION_METHOD_LABELS[method as DonationMethod] : method;
  }

  protected kindLabel(kind: string): string {
    return kind in RECEIPT_KIND_LABELS ? RECEIPT_KIND_LABELS[kind as ReceiptKind] : kind;
  }

  protected formatDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    try {
      return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  protected async issueReceipt(): Promise<void> {
    const d = this.donation();
    if (!d) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Issue an official receipt?',
      message:
        `A numbered receipt for ${this.formatCurrency(d.amount)} will be issued to ` +
        `${this.donorName() || 'this donor'}, saved as a PDF, and emailed to them if they have an ` +
        `email on file. Issued receipts cannot be edited — only cancelled and replaced.`,
      confirmText: 'Issue receipt',
      cancelText: 'Not yet',
    });
    if (!confirmed) return;
    await this.runAction(async () => {
      const receipt = await this.receiptsSvc.issueReceipt({ donationId: d.id });
      this.alertSvc.showSuccess(`Receipt ${receipt.receipt_number} issued. The PDF and email are on their way.`);
    });
  }

  protected async cancelReceipt(receipt: ReceiptRowT): Promise<void> {
    const reason = await this.dialogs.prompt({
      title: `Cancel receipt ${receipt.receipt_number}?`,
      message:
        'The receipt is kept (marked cancelled) — tax rules require cancelled receipts to be ' +
        'retained. Give a short reason; it is recorded on the receipt.',
      inputPlaceholder: 'e.g. Wrong donor address',
      confirmText: 'Cancel receipt',
      cancelText: 'Keep receipt',
      variant: 'danger',
    });
    if (!reason?.trim()) return;
    await this.runAction(async () => {
      await this.receiptsSvc.cancelReceipt({ receiptId: receipt.id, reason: reason.trim() });
      this.alertSvc.showSuccess(`Receipt ${receipt.receipt_number} cancelled.`);
    });
  }

  protected async reissueReceipt(receipt: ReceiptRowT): Promise<void> {
    let reason: string | undefined;
    if (receipt.status === 'issued') {
      const answer = await this.dialogs.prompt({
        title: `Replace receipt ${receipt.receipt_number}?`,
        message:
          'The current receipt is cancelled and a new one is issued in its place. The new PDF ' +
          'states which receipt it cancels and replaces. Give a short reason.',
        inputPlaceholder: 'e.g. Donor name was misspelled',
        confirmText: 'Cancel and replace',
        cancelText: 'Keep receipt',
      });
      if (!answer?.trim()) return;
      reason = answer.trim();
    }
    await this.runAction(async () => {
      const successor = await this.receiptsSvc.reissueReceipt({ receiptId: receipt.id, reason });
      this.alertSvc.showSuccess(`Receipt ${successor.receipt_number} issued, replacing ${receipt.receipt_number}.`);
    });
  }

  protected downloadReceipt(receipt: ReceiptRowT): void {
    if (!receipt.file_id) {
      this.alertSvc.showInfo('The PDF is still being generated — try again in a moment.');
      return;
    }
    const filename = `Receipt-${receipt.receipt_number ?? receipt.id}.pdf`;
    void downloadWithAuthHeader(
      `${environment.apiUrl}/api/files/download/${receipt.file_id}`,
      this.tokenSvc.getAuthToken(),
      filename,
    );
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.acting()) return;
    this.acting.set(true);
    try {
      await action();
      await this.load(this.id());
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Something went wrong');
    } finally {
      this.acting.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    const end = this._loading.begin();
    try {
      const donation = await this.donationsSvc.getDonation(id);
      this.donation.set(donation);
      // listReceipts is admin/owner-only server-side; other roles get status from the row itself.
      if (this.isAdmin()) {
        this.receipts.set(await this.receiptsSvc.listReceipts({ donationId: id }));
      }
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to load this gift');
      void this.router.navigate(['/donations']);
    } finally {
      this.initialized.set(true);
      end();
    }
  }
}
