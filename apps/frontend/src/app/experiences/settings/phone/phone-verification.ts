import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { SettingsService } from '../services/settings-service';

/** Mirror of settings.getPhoneVerificationStatus — phones arrive masked from the backend. */
export interface PhoneVerificationStatus {
  verified: boolean;
  verifiedAt: Date | string | null;
  phone: string | null;
  pendingPhone: string | null;
  /** Whether sending is actually gated on it. Derived server-side from the send guard's own
   * predicate, so this card can never claim something sending does not enforce. */
  required: boolean;
}

/**
 * Sending-phone verification: send a code by SMS, then confirm it. Self-contained — it loads its
 * own status and owns its own two-step state — so both the Communications settings section and
 * the go-live wizard can drop it in without duplicating the flow.
 *
 * It was inline markup on the settings page backed by five signals on SettingsPage; extracted
 * because the wizard needs the same flow and a second copy would inevitably drift.
 */
@Component({
  selector: 'pc-phone-verification',
  imports: [Icon],
  template: `
    @if (showHeader()) {
      <div class="space-y-1">
        <h3 class="text-xs font-semibold text-base-content/90">Sending phone verification</h3>
        <p class="text-xs text-base-content/50">{{ blurb() }}</p>
      </div>
    }

    @if (status()?.verified) {
      <span class="badge badge-success gap-1.5 px-3 py-3.5 text-xs font-medium">
        <pc-icon name="check-circle" [size]="4"></pc-icon>
        {{ status()?.phone }} verified
      </span>
    } @else {
      <div class="flex max-w-lg flex-col gap-3 sm:flex-row">
        <div class="flex-1">
          <input
            type="tel"
            autocomplete="tel"
            placeholder="+1 555 123 4567"
            class="input input-bordered focus:input-primary w-full bg-base-200/30 text-xs"
            [value]="phone()"
            (input)="phone.set($any($event.target).value)"
          />
        </div>
        <button type="button" class="btn btn-primary" (click)="requestCode()" [disabled]="busy() || !phone().trim()">
          @if (busy() && !codeSentTo()) {
            <span class="loading loading-spinner loading-xs"></span>
          } @else {
            {{ codeSentTo() ? 'Resend code' : 'Send code' }}
          }
        </button>
      </div>

      @if (codeSentTo()) {
        <div class="mt-3 flex max-w-lg flex-col gap-3 sm:flex-row">
          <div class="flex-1">
            <input
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder="6-digit code"
              class="input input-bordered focus:input-primary w-full bg-base-200/30 text-xs"
              [value]="code()"
              (input)="code.set($any($event.target).value)"
            />
          </div>
          <button
            type="button"
            class="btn btn-primary"
            (click)="confirmCode()"
            [disabled]="busy() || code().trim().length < 6"
          >
            @if (busy()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              Verify
            }
          </button>
        </div>
        <p class="mt-2 text-xs text-base-content/50">
          We texted a code to <strong>{{ codeSentTo() }}</strong
          >. It expires in 10 minutes.
        </p>
      }
    }
  `,
})
export class PhoneVerification implements OnInit {
  private readonly settingsSvc = inject(SettingsService);
  private readonly alerts = inject(AlertService);

  /** Off in the wizard, which supplies its own step heading. */
  public readonly showHeader = input<boolean>(true);

  /** Fires once the number is verified, so a host step can advance. */
  public readonly verified = output<void>();

  protected readonly status = signal<PhoneVerificationStatus | null>(null);
  protected readonly phone = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly codeSentTo = signal<string | null>(null);

  /** True once the tenant has a verified number — what a host uses to gate "continue". */
  public readonly isVerified = computed<boolean>(() => this.status()?.verified === true);

  protected readonly blurb = computed<string>(() =>
    this.status()?.required === false
      ? 'Verifying a mobile number is not required on your plan, but it helps protect your sending reputation.'
      : 'Verify a mobile number once before your first newsletter send. It keeps spammers off the shared sending pool your newsletters depend on.',
  );

  public ngOnInit(): void {
    void this.load();
  }

  /** Public so a host can refresh after a plan change alters whether it is required. */
  public async load(): Promise<void> {
    try {
      this.status.set(await this.settingsSvc.getPhoneVerificationStatus());
    } catch {
      // Non-blocking: the surrounding page still renders without the card's state.
    }
  }

  protected async requestCode(): Promise<void> {
    const phone = this.phone().trim();
    if (!phone) return;
    this.busy.set(true);
    try {
      const result = await this.settingsSvc.requestPhoneVerification(phone);
      this.codeSentTo.set(result.phone);
      this.code.set('');
      this.alerts.showSuccess(`We texted a verification code to ${result.phone}.`);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not send the code.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmCode(): Promise<void> {
    const code = this.code().trim();
    if (!code) return;
    this.busy.set(true);
    try {
      const result = await this.settingsSvc.confirmPhoneVerification(code);
      this.alerts.showSuccess(`Phone ${result.phone} is verified — you're clear to send newsletters.`);
      this.codeSentTo.set(null);
      this.phone.set('');
      this.code.set('');
      await this.load();
      this.verified.emit();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not verify the code.');
    } finally {
      this.busy.set(false);
    }
  }
}
