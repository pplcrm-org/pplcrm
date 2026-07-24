import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormField, email, form, minLength, pattern, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { GENERIC_SIGNIN_ERROR } from '../../../../../../libs/common/src';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { TokenService } from '../../services/api/token-service';
import { SERVER_UNREACHABLE_MESSAGE, getUserErrorMessage, isServerUnreachable } from '../../services/api/user-message';
import { AuthLayoutComponent } from 'apps/frontend/src/app/auth/auth-layout';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';

type SignInStep = 'email' | 'passkey' | 'password' | '2fa' | 'passkey-setup';

@Component({
  selector: 'pc-login',
  imports: [FormField, RouterLink, Icon, AuthLayoutComponent],
  templateUrl: './signin-page.html',
})
export class SignInPage implements OnInit, OnDestroy {
  private readonly alertSvc = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly suppressNavigation = signal<boolean>(false);
  private readonly tokenService = inject(TokenService);

  private _countdownInterval: ReturnType<typeof setInterval> | null = null;
  private _resendCooldownInterval: ReturnType<typeof setInterval> | null = null;
  private _loading = createLoadingGate();

  protected readonly step = signal<SignInStep>('email');
  protected readonly emailData = signal({ email: '' });
  protected readonly passwordData = signal({ password: '' });
  protected readonly otpData = signal({ code: '' });
  protected readonly emailFor2FA = signal<string>('');
  protected readonly pendingEmail = signal<string>('');
  protected readonly rateLimitSecondsLeft = signal<number>(0);
  protected readonly rateLimitMins = computed(() => Math.floor(this.rateLimitSecondsLeft() / 60));
  protected readonly rateLimitRemSecs = computed(() => this.rateLimitSecondsLeft() % 60);
  protected readonly resending = signal<boolean>(false);
  protected readonly resendCooldownSeconds = signal<number>(0);
  protected readonly resendCooldownMins = computed(() => Math.floor(this.resendCooldownSeconds() / 60));
  protected readonly resendCooldownRemSecs = computed(() => this.resendCooldownSeconds() % 60);
  protected readonly settingUpPasskey = signal<boolean>(false);
  protected readonly verificationPending = signal<boolean>(false);

  protected isLoading = this._loading.visible;
  protected persistence = signal(this.tokenService.getPersistence());

  public readonly emailForm = form(this.emailData, (p) => {
    required(p.email);
    email(p.email);
  });

  public readonly passwordForm = form(this.passwordData, (p) => {
    required(p.password);
    minLength(p.password, 8);
  });

  public readonly otpForm = form(this.otpData, (p) => {
    required(p.code);
    pattern(p.code, /^\d{6}$/);
  });

  constructor() {
    effect(() => {
      const user = this.authService.getUserSignal();
      if (user() && !this.suppressNavigation()) void this.router.navigate(['dashboard']);
    });
  }

  public get emailField() {
    return this.emailForm.email();
  }

  public get password() {
    return this.passwordForm.password();
  }

  public get code() {
    return this.otpForm.code();
  }

  public ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    const emailVal = params.get('email') || '';
    if (params.get('emailChanged') === 'true' || params.get('verificationPending') === 'true') {
      this.verificationPending.set(true);
      this.pendingEmail.set(emailVal);
      if (emailVal) {
        this.emailForm.email().value.set(emailVal);
        this.step.set('password');
      }
    } else if (params.get('returnUrl')) {
      // A returnUrl is only ever set when an expired/revoked session bounced the user here
      // (the auth guard redirects without one), so explain the involuntary sign-out.
      this.alertSvc.showInfo('Your session has expired. Please sign in again.');
    }
  }

  public ngOnDestroy() {
    this.clearCountdown();
    this.clearResendCooldown();
  }

  public goBackToEmail() {
    this.step.set('email');
    this.verificationPending.set(false);
    this.passwordData.update((p) => ({ ...p, password: '' }));
    this.otpData.update((o) => ({ ...o, code: '' }));
  }

  public usePasswordInstead() {
    this.step.set('password');
  }

  public async continueWithEmail(event?: Event) {
    event?.preventDefault();

    const rawEmail = this.emailData().email;
    const emailVal = rawEmail.trim().toLowerCase();

    if (rawEmail !== emailVal) {
      this.emailForm.email().value.set(emailVal);
    }

    this.emailForm().markAsTouched();

    await submit(this.emailForm, {
      action: async () => {
        let hasPasskeys = false;
        const end = this._loading.begin();
        try {
          ({ hasPasskeys } = await this.authService.checkEmail(emailVal));
        } catch (err) {
          // Backend unreachable: say so now and stay on the email step, instead of walking the
          // user into a password prompt that cannot possibly succeed.
          if (isServerUnreachable(err)) {
            this.alertSvc.showError(SERVER_UNREACHABLE_MESSAGE);
            return null;
          }
          // any other failure — fall through to password
        } finally {
          end();
        }

        if (hasPasskeys) {
          this.step.set('passkey');
          await this.signInWithPasskey();
        } else {
          this.step.set('password');
        }

        return null;
      },
      onInvalid: () => {
        const f = this.emailForm.email();
        const hasRequired = f.errors().some((e) => e.kind === 'required');
        this.alertSvc.showError(hasRequired ? 'Email is required.' : 'Please enter a valid email address.');
      },
    });
  }

  public async signInWithPasskey() {
    const end = this._loading.begin();
    try {
      const result = await this.authService.signInWithPasskey(this.persistence());
      if (result.cancelled) {
        this.step.set('password');
        return;
      }
      if (!result.user) throw new Error('Passkey authentication failed. Please try again.');
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        this.step.set('password');
        return;
      }
      this.handleError(err);
    } finally {
      end();
    }
  }

  public async signIn(event?: Event) {
    event?.preventDefault();

    this.tokenService.clearAll();

    const emailVal = this.emailData().email.trim().toLowerCase();
    const passwordVal = this.passwordData().password;

    this.verificationPending.set(false);
    this.passwordForm().markAsTouched();

    await submit(this.passwordForm, {
      action: async () => {
        const end = this._loading.begin();
        try {
          this.suppressNavigation.set(true);
          const res = await this.authService.signIn({
            email: emailVal,
            password: passwordVal,
            rememberMe: this.persistence(),
          });
          if (res.requires2FA) {
            this.suppressNavigation.set(false);
            this.step.set('2fa');
            this.emailFor2FA.set(res.email || emailVal);
            this.otpData.update((o) => ({ ...o, code: '' }));
          } else {
            const user = this.authService.getUser();
            const dismissed = !!user?.passkey_setup_dismissed_at;
            if (!dismissed) {
              const passkeys = (await this.authService.listPasskeys().catch(() => [])) as any[];
              if (passkeys.length === 0) {
                this.step.set('passkey-setup');
                return null;
              }
            }
            this.suppressNavigation.set(false);
          }
        } catch (err) {
          this.suppressNavigation.set(false);
          this.handleError(err, emailVal);
        } finally {
          end();
        }
        return null;
      },
      onInvalid: () => {
        const f = this.passwordForm.password();
        const hasMinLength = f.errors().some((e) => e.kind === 'minLength');
        this.alertSvc.showError(
          hasMinLength ? 'Password must be at least 8 characters.' : 'Please enter your password.',
        );
      },
    });
  }

  public async verify2FA(event?: Event) {
    event?.preventDefault();

    this.otpForm().markAsTouched();

    await submit(this.otpForm, {
      action: async () => {
        const end = this._loading.begin();
        try {
          const emailVal = this.emailFor2FA();
          const codeVal = this.otpData().code.trim();
          await this.authService.verify2FA({
            email: emailVal,
            code: codeVal,
            rememberMe: this.persistence(),
          });
        } catch (err) {
          this.handleError(err);
        } finally {
          end();
        }
        return null;
      },
      onInvalid: () => {
        const f = this.otpForm.code();
        const hasRequired = f.errors().some((e) => e.kind === 'required');
        const hasPattern = f.errors().some((e) => e.kind === 'pattern');
        const msg = hasRequired
          ? 'Verification code is required.'
          : hasPattern
            ? 'Verification code must be exactly 6 digits.'
            : 'Please enter a valid verification code.';
        this.alertSvc.showError(msg);
      },
    });
  }

  public async setupPasskey() {
    this.settingUpPasskey.set(true);
    try {
      const result = await this.authService.registerPasskey();
      if (result.verified) {
        this.alertSvc.showSuccess('Passkey set up successfully!');
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'NotAllowedError')) {
        this.alertSvc.showError(getUserErrorMessage(err, 'Failed to set up the passkey. Please try again.'));
      }
    } finally {
      this.settingUpPasskey.set(false);
      this.suppressNavigation.set(false);
    }
  }

  public async skipPasskeySetup() {
    try {
      await this.authService.dismissPasskeyPrompt();
    } catch {
      // non-fatal — still allow navigation
    }
    this.suppressNavigation.set(false);
  }

  public togglePersistence(target: EventTarget | null) {
    if (!target) return;
    const checked = (target as HTMLInputElement).checked;
    this.tokenService.setPersistence(checked);
    this.persistence.set(checked);
  }

  public async resendVerification() {
    const emailVal = this.pendingEmail().trim();
    if (!emailVal || this.resendCooldownSeconds() > 0) return;
    this.resending.set(true);
    try {
      await this.authService.resendVerificationEmail(emailVal);
      this.alertSvc.showSuccess('Verification email sent successfully!');
      this.startResendCooldown(60);
    } catch (err) {
      const tRPCData = getTRPCData(err);
      const retryAfterSec =
        (typeof tRPCData?.['retryAfterSec'] === 'number' ? tRPCData['retryAfterSec'] : undefined) ??
        this.parseRetryAfterSec(err instanceof Error && err.message ? err.message : '');
      if (retryAfterSec) {
        this.startResendCooldown(retryAfterSec);
      } else {
        this.alertSvc.showError(getUserErrorMessage(err, 'Could not send the verification email. Please try again.'));
      }
    } finally {
      this.resending.set(false);
    }
  }

  private clearCountdown() {
    if (this._countdownInterval !== null) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
  }

  private clearResendCooldown() {
    if (this._resendCooldownInterval !== null) {
      clearInterval(this._resendCooldownInterval);
      this._resendCooldownInterval = null;
    }
  }

  private startResendCooldown(seconds: number) {
    this.clearResendCooldown();
    this.resendCooldownSeconds.set(seconds);
    this._resendCooldownInterval = setInterval(() => {
      const current = this.resendCooldownSeconds();
      if (current <= 1) {
        this.resendCooldownSeconds.set(0);
        this.clearResendCooldown();
      } else {
        this.resendCooldownSeconds.update((s) => s - 1);
      }
    }, 1000);
  }

  private handleError(err: unknown, emailVal?: string) {
    const tRPCData = getTRPCData(err);
    const message = getUserErrorMessage(err, 'Something went wrong, please try again');
    const retryAfterSec =
      (typeof tRPCData?.['retryAfterSec'] === 'number' ? tRPCData['retryAfterSec'] : undefined) ??
      this.parseRetryAfterSec(message);
    if (retryAfterSec) {
      this.startRateLimitCountdown(retryAfterSec);
      return;
    }
    const code = typeof tRPCData?.['code'] === 'string' ? tRPCData['code'] : undefined;
    if (emailVal && message.toLowerCase().includes('not verified')) {
      this.verificationPending.set(true);
      this.pendingEmail.set(emailVal);
      this.alertSvc.showError(message);
    } else if (emailVal && (code === 'UNAUTHORIZED' || code === 'NOT_FOUND')) {
      this.alertSvc.showError(GENERIC_SIGNIN_ERROR);
    } else {
      this.alertSvc.showError(message);
    }
  }

  private parseRetryAfterSec(message: string): number | undefined {
    const match = message?.match(/retry in (\d+) second/i);
    return match ? parseInt(match[1]!, 10) : undefined;
  }

  private startRateLimitCountdown(seconds: number) {
    this.clearCountdown();
    this.rateLimitSecondsLeft.set(seconds);

    this._countdownInterval = setInterval(() => {
      const current = this.rateLimitSecondsLeft();
      if (current < 1) {
        this.clearCountdown();
      } else {
        this.rateLimitSecondsLeft.update((s) => s - 1);
      }
    }, 1000);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Extract the tRPC error `data` payload (e.g. rate-limit metadata) from a caught error. */
function getTRPCData(err: unknown): Record<string, unknown> | undefined {
  if (!isRecord(err)) return undefined;
  const originalError = err['originalError'];
  if (isRecord(originalError) && isRecord(originalError['data'])) return originalError['data'];
  return isRecord(err['data']) ? err['data'] : undefined;
}
