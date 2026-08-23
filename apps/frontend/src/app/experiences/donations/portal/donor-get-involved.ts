import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@uxcommon/components/icons/icon';

import { DonorPortalApiService, DonorPortalYardSignStatus, isDeadLinkError } from './donor-portal-api';

/**
 * The cross-sell card: volunteer interest and a yard-sign request. Volunteer interest that is
 * already on record renders as confirmed from the start; a yard-sign affordance the workspace
 * cannot honour ('unavailable') hides quietly rather than erroring at the donor.
 */
@Component({
  selector: 'pc-donor-get-involved',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="pc-panel flex flex-col gap-3 p-5">
      <div>
        <p class="pc-eyebrow">Get involved</p>
        <p class="text-xs text-base-content/60">More ways to help beyond giving.</p>
      </div>

      <div class="flex items-center justify-between gap-3">
        @if (volunteerConfirmed()) {
          <span class="flex items-center gap-2 text-xs text-base-content">
            <pc-icon name="check-circle" [size]="4" class="text-success"></pc-icon>
            Thanks for offering to volunteer. The team will be in touch.
          </span>
        } @else {
          <span class="text-xs text-base-content">Lend a hand at events or on the ground.</span>
          <button
            type="button"
            class="btn btn-outline btn-primary btn-sm shrink-0"
            [disabled]="busy()"
            (click)="volunteer()"
          >
            I want to volunteer
          </button>
        }
      </div>

      @if (yardSignVisible()) {
        <div class="flex items-center justify-between gap-3 border-t border-base-200 pt-3">
          @if (yardSignLine(); as line) {
            <span class="flex items-center gap-2 text-xs text-base-content">
              <pc-icon name="yard-sign" [size]="4" class="text-primary"></pc-icon>
              {{ line }}
            </span>
          } @else {
            <span class="text-xs text-base-content">Show your support at home.</span>
            <button
              type="button"
              class="btn btn-outline btn-primary btn-sm shrink-0"
              [disabled]="busy()"
              (click)="requestYardSign()"
            >
              Request a yard sign
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class DonorGetInvolved implements OnInit {
  readonly token = input.required<string>();
  readonly volunteerInterest = input.required<boolean>();
  readonly yardSign = input.required<{ status: DonorPortalYardSignStatus } | null>();

  /** The backend answered 404 mid-session: the link died under us — the page flips to dead. */
  readonly linkDead = output<void>();

  private readonly api = inject(DonorPortalApiService);
  private readonly alerts = inject(AlertService);

  protected readonly busy = signal(false);

  private readonly volunteerJustConfirmed = signal(false);
  protected readonly volunteerConfirmed = computed(() => this.volunteerInterest() || this.volunteerJustConfirmed());

  /** null = show the request button; a string = the status line for an existing request. */
  private readonly yardSignStatusLine = signal<string | null>(null);
  private readonly yardSignHidden = signal(false);

  protected readonly yardSignVisible = computed(() => !this.yardSignHidden());
  protected readonly yardSignLine = computed(() => this.yardSignStatusLine());

  public ngOnInit(): void {
    const existing = this.yardSign();
    if (existing) this.yardSignStatusLine.set(lineForStatus(existing.status));
  }

  protected async requestYardSign(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.api.requestYardSign(this.token());
      if (res.status === 'unavailable') {
        // The workspace cannot honour this right now (plan, or no deliverable address). Hiding the
        // affordance quietly beats explaining the org's plan limits to its donor.
        this.yardSignHidden.set(true);
        return;
      }
      this.yardSignStatusLine.set(lineForStatus('new'));
      this.alerts.showSuccess('Yard sign requested.');
    } catch (err) {
      if (isDeadLinkError(err)) {
        this.linkDead.emit();
        return;
      }
      this.alerts.showError('We could not request a yard sign. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async volunteer(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.volunteerInterest(this.token());
      this.volunteerJustConfirmed.set(true);
      this.alerts.showSuccess('Thanks — your interest is noted.');
    } catch (err) {
      if (isDeadLinkError(err)) {
        this.linkDead.emit();
        return;
      }
      this.alerts.showError('We could not save that. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

function lineForStatus(status: DonorPortalYardSignStatus): string {
  switch (status) {
    case 'new':
      return 'Your yard sign request is in.';
    case 'approved':
      return 'Your yard sign is approved. Delivery is being arranged.';
    case 'delivered':
      return 'Your yard sign has been delivered.';
    case 'declined':
      return 'The team could not fulfil your last yard sign request.';
  }
}
