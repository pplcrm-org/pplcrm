import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RECEIPT_KIND_LABELS } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';

import { apiBase } from '../../../shared/public-pages';
import { DonorPortalApiService, DonorPortalDonation, DonorPortalReceipt, isDeadLinkError } from './donor-portal-api';

const METHOD_LABELS: Record<string, string> = {
  card: 'Card',
  check: 'Check',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
};

/**
 * The donor's own ledger: every gift (refunds included — the list is honest) and every document
 * issued to them, with a download for each ready PDF. Plain pc-table markup, not the datagrid —
 * this is a short personal list on a public page.
 */
@Component({
  selector: 'pc-donor-giving-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, StatusBadge],
  template: `
    <div class="pc-panel flex flex-col gap-4 p-5">
      <div>
        <p class="pc-eyebrow">Your giving</p>
        <p class="text-xs text-base-content/60">
          {{ donations().length }} gift{{ donations().length === 1 ? '' : 's' }} on record.
        </p>
      </div>

      @if (donations().length === 0) {
        <p class="text-xs text-base-content/60">No gifts on record yet.</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table pc-table w-full">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Method</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (gift of donations(); track gift.id) {
                <tr>
                  <td class="tabular-nums text-base-content/75">{{ gift.date | date: 'mediumDate' }}</td>
                  <td class="font-semibold tabular-nums text-base-content">
                    \${{ (gift.amount_cents / 100).toFixed(2) }}
                  </td>
                  <td class="text-base-content/65">{{ methodLabel(gift.method) }}</td>
                  <td>
                    @if (gift.refunded_at || gift.status === 'refunded') {
                      <pc-status-badge type="neutral">Refunded</pc-status-badge>
                    } @else if (gift.status !== 'succeeded') {
                      <pc-status-badge type="neutral">{{ gift.status }}</pc-status-badge>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (receipts().length > 0) {
        <div class="border-t border-base-200 pt-4">
          <p class="pc-eyebrow mb-2">Receipts and documents</p>
          <ul class="flex flex-col gap-2">
            @for (receipt of receipts(); track receipt.id) {
              <li class="flex items-center justify-between gap-2">
                <span class="text-xs text-base-content">
                  {{ kindLabel(receipt.kind) }}
                  @if (receipt.number) {
                    <span class="text-base-content/60">· {{ receipt.number }}</span>
                  }
                  @if (receipt.year) {
                    <span class="text-base-content/60">· {{ receipt.year }}</span>
                  }
                </span>
                @if (receipt.pdf_ready) {
                  <button type="button" class="btn btn-outline btn-primary btn-xs" (click)="download(receipt)">
                    Download PDF
                  </button>
                } @else {
                  <span class="text-xs text-base-content/50">PDF being prepared</span>
                }
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
})
export class DonorGivingHistory {
  readonly token = input.required<string>();
  readonly donations = input.required<DonorPortalDonation[]>();
  readonly receipts = input.required<DonorPortalReceipt[]>();

  /** The backend answered 404 mid-session: the link died under us — the page flips to dead. */
  readonly linkDead = output<void>();

  private readonly api = inject(DonorPortalApiService);
  private readonly alerts = inject(AlertService);

  protected async download(receipt: DonorPortalReceipt): Promise<void> {
    try {
      const res = await this.api.getReceiptDownload(this.token(), receipt.id);
      if (!('url' in res)) {
        this.alerts.showInfo('This PDF is still being prepared. Try again in a moment.');
        return;
      }
      // The signed URL is origin-relative; apiBase() points it at the backend in dev and stays
      // same-origin in production. An anchor click keeps it a plain browser download.
      const anchor = document.createElement('a');
      anchor.href = `${apiBase()}${res.url}`;
      anchor.rel = 'noopener';
      anchor.click();
    } catch (err) {
      if (isDeadLinkError(err)) {
        this.linkDead.emit();
        return;
      }
      this.alerts.showError('We could not download this document. Try again.');
    }
  }

  protected kindLabel(kind: DonorPortalReceipt['kind']): string {
    return RECEIPT_KIND_LABELS[kind];
  }

  protected methodLabel(method: string): string {
    return METHOD_LABELS[method] ?? method;
  }
}
