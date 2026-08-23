import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { safeRedirectUrl } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { StatusBadge, PcStatusType } from '@uxcommon/components/status-badge/status-badge';

import { DonorPortalApiService, DonorPortalPledge, DonorPortalPledgeStatus, isDeadLinkError } from './donor-portal-api';

/**
 * One monthly pledge on the donor portal: amount, status, and the donor's own controls — update
 * the card behind it, change the amount, or cancel. A cancelled pledge stays visible with its
 * status narrated (disclosure over suppression), just without the action buttons.
 */
@Component({
  selector: 'pc-donor-pledge-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, StatusBadge],
  template: `
    <div class="pc-panel flex flex-col gap-3 p-5">
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="pc-eyebrow">Monthly gift</p>
          <p class="text-lg font-semibold tabular-nums text-base-content">
            {{ amountLabel() }}<span class="text-sm font-normal text-base-content/60"> / month</span>
          </p>
        </div>
        <pc-status-badge [type]="badge().type">{{ badge().label }}</pc-status-badge>
      </div>

      <p class="text-xs text-base-content/60">
        Started {{ pledge().started_at | date: 'mediumDate' }}
        @if (status() === 'cancelled' && pledge().cancelled_at) {
          · cancelled {{ pledge().cancelled_at | date: 'mediumDate' }}
        } @else if (pledge().next_billing_date) {
          · next payment {{ pledge().next_billing_date | date: 'mediumDate' }}
        }
      </p>

      @if (status() === 'past_due' || status() === 'unpaid') {
        <p class="text-xs text-warning">The last payment didn't go through. Updating your card usually fixes this.</p>
      }

      @if (status() !== 'cancelled') {
        <div class="flex flex-wrap items-center gap-2 pt-1">
          @if (pledge().can_manage_card) {
            <button type="button" class="btn btn-outline btn-primary btn-sm" [disabled]="busy()" (click)="updateCard()">
              Update card
            </button>
          }
          <button type="button" class="btn btn-outline btn-primary btn-sm" [disabled]="busy()" (click)="changeAmount()">
            Change amount
          </button>
          <button type="button" class="btn btn-outline btn-error btn-sm" [disabled]="busy()" (click)="cancel()">
            Cancel monthly gift
          </button>
        </div>
      }
    </div>
  `,
})
export class DonorPledgeCard {
  readonly token = input.required<string>();
  readonly pledge = input.required<DonorPortalPledge>();
  readonly orgName = input.required<string>();

  /** The backend answered 404 mid-session: the link died under us — the page flips to dead. */
  readonly linkDead = output<void>();

  private readonly api = inject(DonorPortalApiService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);

  /** Local overrides so a successful write shows immediately without refetching the summary. */
  private readonly statusOverride = signal<DonorPortalPledgeStatus | null>(null);
  private readonly amountOverride = signal<number | null>(null);

  protected readonly busy = signal(false);
  protected readonly status = computed(() => this.statusOverride() ?? this.pledge().status);
  protected readonly amountCents = computed(() => this.amountOverride() ?? this.pledge().monthly_amount_cents);
  protected readonly amountLabel = computed(() => `$${(this.amountCents() / 100).toFixed(2)}`);

  protected readonly badge = computed((): { label: string; type: PcStatusType } => {
    switch (this.status()) {
      case 'active':
        return { label: 'Active', type: 'success' };
      case 'past_due':
        return { label: 'Past due', type: 'warning' };
      case 'unpaid':
        return { label: 'Unpaid', type: 'warning' };
      case 'cancelled':
        return { label: 'Cancelled', type: 'neutral' };
    }
  });

  protected async cancel(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      variant: 'danger',
      emphasizeCancel: true,
      title: `Cancel your ${this.amountLabel()} monthly gift to ${this.orgName()}?`,
      message: 'Your monthly gift stops right away. Your past gifts and receipts stay available on this page.',
      confirmText: 'Cancel monthly gift',
      cancelText: 'Keep giving',
    });
    if (!confirmed) return;

    this.busy.set(true);
    try {
      await this.api.cancelPledge(this.token(), this.pledge().id);
      this.statusOverride.set('cancelled');
      this.alerts.showSuccess('Your monthly gift is cancelled.');
    } catch (err) {
      this.fail(err, 'We could not cancel your monthly gift. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async changeAmount(): Promise<void> {
    const raw = await this.dialogs.prompt({
      title: 'Change your monthly amount',
      message: `The new monthly amount for your gift to ${this.orgName()}.`,
      inputPlaceholder: '25.00',
      defaultValue: (this.amountCents() / 100).toFixed(2),
      confirmText: 'Save amount',
    });
    if (raw == null) return;

    const cents = parseAmountToCents(raw);
    if (cents == null) {
      this.alerts.showError('Enter an amount like 25 or 25.00.');
      return;
    }

    this.busy.set(true);
    try {
      const res = await this.api.setPledgeAmount(this.token(), this.pledge().id, cents);
      this.amountOverride.set(res.monthly_amount_cents);
      this.alerts.showSuccess(`Your monthly gift is now $${(res.monthly_amount_cents / 100).toFixed(2)}.`);
    } catch (err) {
      this.fail(err, 'We could not change the amount. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async updateCard(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.api.startCardUpdate(this.token(), this.pledge().id);
      // Assigning window.location.href is a raw navigation Angular's sanitizer never inspects, so
      // the API-supplied URL is re-checked at the sink exactly like the public form's redirect.
      // A refused value falls through to the error toast rather than navigating.
      const redirect = safeRedirectUrl(res.url);
      if (redirect) {
        window.location.href = redirect;
        return;
      }
      this.alerts.showError('We could not open the card update page. Try again.');
    } catch (err) {
      this.fail(err, 'We could not open the card update page. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  private fail(err: unknown, message: string): void {
    if (isDeadLinkError(err)) {
      this.linkDead.emit();
      return;
    }
    this.alerts.showError(message);
  }
}

/** "25", "25.00", "$25" → 2500; anything unparseable or non-positive → null. */
function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 ? cents : null;
}
