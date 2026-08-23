import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { DonorPortalApiService, DonorPortalSubscription, isDeadLinkError } from './donor-portal-api';

/**
 * Per-campaign email preferences as instant-apply toggles: the switch flips optimistically, the
 * write goes out, and a failure rolls the switch back with a toast. When the address is suppressed
 * (bounces or complaints) the card says so honestly instead of pretending mail is flowing.
 */
@Component({
  selector: 'pc-donor-preferences',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pc-panel flex flex-col gap-3 p-5">
      <div>
        <p class="pc-eyebrow">Email preferences</p>
        <p class="text-xs text-base-content/60">Choose which updates reach your inbox.</p>
      </div>

      @if (emailSuppressed()) {
        <p class="text-xs text-warning">
          Email to your address is paused right now because messages to it were not being delivered. Your choices here
          are still saved.
        </p>
      }

      <ul class="flex flex-col gap-2">
        @for (row of rows(); track row.campaign_id) {
          <li class="flex items-center justify-between gap-3">
            <span class="text-xs text-base-content">
              {{ row.campaign_name }}
              @if (row.status === 'pending') {
                <span class="text-base-content/50">· awaiting confirmation</span>
              }
            </span>
            <input
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
              [checked]="row.status === 'subscribed'"
              [disabled]="busyId() === row.campaign_id"
              (change)="toggle(row)"
            />
          </li>
        }
      </ul>
    </div>
  `,
})
export class DonorPreferences implements OnInit {
  readonly token = input.required<string>();
  readonly subscriptions = input.required<DonorPortalSubscription[]>();
  readonly emailSuppressed = input.required<boolean>();

  /** The backend answered 404 mid-session: the link died under us — the page flips to dead. */
  readonly linkDead = output<void>();

  private readonly api = inject(DonorPortalApiService);
  private readonly alerts = inject(AlertService);

  protected readonly rows = signal<DonorPortalSubscription[]>([]);
  protected readonly busyId = signal<string | null>(null);

  public ngOnInit(): void {
    this.rows.set(this.subscriptions().map((s) => ({ ...s })));
  }

  protected async toggle(row: DonorPortalSubscription): Promise<void> {
    const previous = row.status;
    const next = previous === 'subscribed' ? 'unsubscribed' : 'subscribed';

    // Instant apply: flip first, roll back only if the write fails.
    this.setStatus(row.campaign_id, next);
    this.busyId.set(row.campaign_id);
    try {
      const res = await this.api.setSubscription(this.token(), row.campaign_id, next);
      this.setStatus(row.campaign_id, res.status);
    } catch (err) {
      this.setStatus(row.campaign_id, previous);
      if (isDeadLinkError(err)) {
        this.linkDead.emit();
        return;
      }
      this.alerts.showError('We could not save that preference. Try again.');
    } finally {
      this.busyId.set(null);
    }
  }

  private setStatus(campaignId: string, status: DonorPortalSubscription['status']): void {
    this.rows.update((rows) => rows.map((r) => (r.campaign_id === campaignId ? { ...r, status } : r)));
  }
}
