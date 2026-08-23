import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';

import { AuthService } from '../../../auth/auth-service';
import { DonationsService } from '../../../services/api/donations-service';

/** What `donorPortal.getLinkStatus` reports for one person. Dates arrive as Date or ISO string. */
interface PortalLinkStatus {
  live_count: number;
  last_created_at: Date | string | null;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
}

/**
 * The giving-portal panel on the person record's Donations tab. Narrates the link state honestly:
 * Send ADDS a link without turning off older ones, Revoke stops ALL live links immediately. In a
 * demo workspace emailing donors is locked (explained-disabled tooltip), but minting is not mail —
 * Create + copy link stays live so staff can still hand the donor their page.
 */
@Component({
  selector: 'pc-donor-portal-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="pc-panel flex flex-col gap-3 p-4">
      <h3 class="text-sm font-semibold text-base-content">Giving portal</h3>

      @if (!loaded()) {
        <div class="skeleton h-10 w-full"></div>
      } @else {
        @if (status(); as s) {
          @if (s.live_count === 0) {
            <p class="text-xs text-base-content/60">No giving-portal link has been sent.</p>
            <div class="flex flex-wrap items-center gap-2">
              @if (isDemo()) {
                <span class="tooltip tooltip-right" [attr.data-tip]="demoTip">
                  <button type="button" class="btn btn-outline btn-primary btn-sm" disabled>Send portal link</button>
                </span>
                <button
                  type="button"
                  class="btn btn-outline btn-primary btn-sm"
                  [disabled]="busy()"
                  (click)="createAndCopy()"
                >
                  Create + copy link
                </button>
              } @else {
                <button type="button" class="btn btn-outline btn-primary btn-sm" [disabled]="busy()" (click)="send()">
                  Send portal link
                </button>
              }
            </div>
          } @else {
            <p class="text-xs text-base-content">
              Portal link sent {{ s.last_created_at | date: 'mediumDate' }} · expires
              {{ s.expires_at | date: 'mediumDate' }}
              @if (s.last_used_at) {
                · last opened {{ s.last_used_at | date: 'mediumDate' }}
              }
            </p>
            <p class="text-xs text-base-content/60">
              Sending again adds a new link without turning off
              {{ s.live_count === 1 ? 'the live one' : 'the ' + s.live_count + ' live ones' }}. Revoke stops every live
              link immediately.
            </p>
            <div class="flex flex-wrap items-center gap-2">
              @if (isDemo()) {
                <span class="tooltip tooltip-right" [attr.data-tip]="demoTip">
                  <button type="button" class="btn btn-outline btn-primary btn-sm" disabled>Send new link</button>
                </span>
                <button
                  type="button"
                  class="btn btn-outline btn-primary btn-sm"
                  [disabled]="busy()"
                  (click)="createAndCopy()"
                >
                  Create + copy link
                </button>
              } @else {
                <button type="button" class="btn btn-outline btn-primary btn-sm" [disabled]="busy()" (click)="send()">
                  Send new link
                </button>
              }
              <button type="button" class="btn btn-outline btn-error btn-sm" [disabled]="busy()" (click)="revoke()">
                Revoke
              </button>
            </div>
          }
          @if (lastUrl(); as url) {
            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-outline btn-primary btn-xs" (click)="copy(url)">Copy link</button>
              <span class="truncate font-mono text-[11px] text-base-content/50">{{ url }}</span>
            </div>
          }
        } @else {
          <p class="text-xs text-base-content/60">Could not load the link status.</p>
          <button type="button" class="btn btn-outline btn-primary btn-xs self-start" (click)="reload()">
            Try again
          </button>
        }
      }
    </div>
  `,
})
export class DonorPortalPanel {
  readonly personId = input.required<string>();

  private readonly donations = inject(DonationsService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);
  private readonly userSignal = this.auth.getUserSignal();

  /** Emailing donors is blocked server-side during demo mode; the tooltip explains it (§2). */
  protected readonly isDemo = computed(() => !!this.userSignal()?.tenant_demo_mode_at);
  protected readonly demoTip =
    'Emailing donors is locked during the demo. Remove the demo data to unlock it. You can still copy the link.';

  protected readonly loaded = signal(false);
  protected readonly status = signal<PortalLinkStatus | null>(null);
  protected readonly busy = signal(false);

  /** The raw URL from the last mint this session — offered as Copy link (it is shown only once). */
  protected readonly lastUrl = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.personId();
      untracked(() => {
        this.lastUrl.set(null);
        void this.load(id);
      });
    });
  }

  protected copy(url: string): void {
    navigator.clipboard
      .writeText(url)
      .then(() => this.alerts.showSuccess('Link copied to clipboard'))
      .catch(() => this.alerts.showError('Could not copy the link to the clipboard'));
  }

  /** The demo-mode path: minting is not mail, so this stays live while Send is locked. */
  protected async createAndCopy(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.donations.sendPortalLink(this.personId());
      this.lastUrl.set(res.url);
      this.copy(res.url);
      await this.load(this.personId());
    } catch {
      this.alerts.showError('Could not create the link. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected reload(): void {
    this.loaded.set(false);
    void this.load(this.personId());
  }

  protected async revoke(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      variant: 'danger',
      title: 'Revoke all giving-portal links?',
      message:
        'Every live link this donor has stops working immediately, including links in emails they already received. ' +
        'You can send a fresh link at any time.',
      confirmText: 'Revoke all links',
      cancelText: 'Keep links active',
    });
    if (!confirmed) return;

    this.busy.set(true);
    try {
      await this.donations.revokePortalLinks(this.personId());
      this.lastUrl.set(null);
      this.alerts.showSuccess('All giving-portal links revoked.');
      await this.load(this.personId());
    } catch {
      this.alerts.showError('Could not revoke the links. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async send(): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.donations.sendPortalLink(this.personId());
      this.lastUrl.set(res.url);
      if (res.emailed) {
        this.alerts.showSuccess('Portal link emailed to the donor.');
      } else {
        this.alerts.showInfo('Link created, but this person has no email on file. Copy it instead.');
      }
      await this.load(this.personId());
    } catch {
      this.alerts.showError('Could not send the link. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      this.status.set(await this.donations.getPortalLinkStatus(id));
    } catch {
      this.status.set(null);
    } finally {
      this.loaded.set(true);
    }
  }
}
