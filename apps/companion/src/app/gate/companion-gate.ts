import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { CompanionAccessKind, CompanionAccessPayload, CompanionVerifyChannel, CompanionVerifyKind } from '@common';
import { Icon } from '@icons/icon';

import { CompanionApiError, CompanionSessionService } from './companion-api';

const POLL_MS = 20_000;
const RESEND_COOLDOWN_S = 30;

type GateView = 'loading' | 'dead' | 'unassigned' | 'identity' | 'verify' | 'pending' | 'ready' | 'unreachable';

/**
 * The verify + approve gate both companions sit behind (COMPANION-APPS-PLAN.md
 * §4 A4). Wrap an app in it; the app renders only once the device session is
 * verified AND the volunteer is admin-approved:
 *
 *   <pc-companion-gate kind="turf" [token]="token()" (ready)="load()">
 *     …the actual companion…
 *   </pc-companion-gate>
 */
@Component({
  selector: 'pc-companion-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    @switch (view()) {
      @case ('ready') {
        <ng-content></ng-content>
      }
      @case ('loading') {
        <div class="flex min-h-screen items-center justify-center">
          <span class="loading loading-spinner loading-md opacity-40" aria-label="Loading"></span>
        </div>
      }
      @case ('dead') {
        <div class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 class="text-lg font-semibold">This link isn't active</h1>
          @if (access()?.organizerName) {
            <p class="text-base-content/70">
              It may have expired or been replaced. Contact {{ access()?.organizerName }} to get a new link.
            </p>
          } @else {
            <p class="text-base-content/70">
              It may have expired or been replaced. Ask your organizer to send a new one.
            </p>
          }
        </div>
      }
      @case ('unreachable') {
        <div class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
          <pc-icon name="exclamation-triangle" [size]="8" class="text-warning"></pc-icon>
          <h1 class="text-lg font-semibold">Can't reach the server</h1>
          <p class="text-base-content/70">
            Your link is still good; this is usually a weak connection. This page keeps retrying on its own, or you can
            try now.
          </p>
          <button type="button" class="btn btn-primary" [disabled]="checking()" (click)="checkNow()">
            @if (checking()) {
              Trying…
            } @else {
              Try again
            }
          </button>
        </div>
      }
      @case ('unassigned') {
        <div class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 class="text-lg font-semibold">This link isn't ready yet</h1>
          <p class="text-base-content/70">
            It hasn't been connected to you.
            @if (access()?.organizerName) {
              Ask {{ access()?.organizerName }} to re-send your personal link.
            } @else {
              Ask your organizer to re-send your personal link.
            }
          </p>
        </div>
      }
      @case ('pending') {
        <div class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <span class="loading loading-ring loading-lg text-primary" aria-hidden="true"></span>
          <h1 class="text-lg font-semibold">You're verified, waiting for approval</h1>
          <p class="text-base-content/70">
            {{ access()?.organizerName || 'Your organizer' }} has been notified. This page checks automatically; keep it
            open or come back later.
          </p>
          <button type="button" class="btn btn-outline btn-sm" [disabled]="checking()" (click)="checkNow()">
            @if (checking()) {
              Checking…
            } @else {
              Check again
            }
          </button>
        </div>
      }
      @case ('identity') {
        <div class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
          <header class="flex flex-col gap-1 text-center">
            @if (access()?.organizationName) {
              <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
                {{ access()?.organizationName }}
              </p>
            }
            <h1 class="text-lg font-semibold">Join the canvass</h1>
            <!-- What am I signing up for? Answered before anything is typed (§1). -->
            @if (access()?.joiningLabel) {
              <p class="text-base-content/70">You'll be helping with {{ access()?.joiningLabel }}.</p>
            } @else {
              <p class="text-base-content/70">Tell us who you are and we'll send a code to confirm it.</p>
            }
          </header>

          <form class="flex flex-col gap-3" (submit)="submitIdentity($event)">
            <label class="flex flex-col gap-1">
              <span class="text-xs font-medium text-base-content/70">Your name</span>
              <input
                class="input input-bordered min-h-11 w-full"
                type="text"
                name="name"
                autocomplete="name"
                autocapitalize="words"
                placeholder="Dana Whitfield"
                [(ngModel)]="joinName"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs font-medium text-base-content/70">Email or mobile number</span>
              <input
                class="input input-bordered min-h-11 w-full"
                type="text"
                name="contact"
                inputmode="email"
                autocomplete="email"
                autocapitalize="none"
                placeholder="dana@example.com"
                [(ngModel)]="joinContact"
              />
              <span class="text-[11px] text-base-content/55">
                We send a one-time code here. {{ access()?.organizerName || 'Your organizer' }} approves you before you
                see anything.
              </span>
            </label>
            @if (error()) {
              <p class="text-center text-sm text-error" role="alert">{{ error() }}</p>
            }
            <button
              type="submit"
              class="btn btn-primary min-h-11 w-full"
              [disabled]="sending() || !joinName.trim() || !joinContact.trim()"
            >
              @if (sending()) {
                Sending a code…
              } @else {
                Send me a code
              }
            </button>
          </form>
        </div>
      }
      @case ('verify') {
        <div class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
          <header class="flex flex-col gap-1 text-center">
            @if (access()?.organizationName) {
              <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
                {{ access()?.organizationName }}
              </p>
            }
            <h1 class="text-lg font-semibold">
              @if (access()?.volunteerName) {
                Hi {{ access()?.volunteerName }}. Let's confirm it's you
              } @else {
                Let's confirm it's you
              }
            </h1>
            <p class="text-base-content/70">This personal link only works for you, so we verify each new phone once.</p>
          </header>

          @if (!sentTo()) {
            <div class="flex flex-col gap-2">
              @for (contact of access()?.contacts ?? []; track contact.channel) {
                <button
                  type="button"
                  class="btn btn-primary w-full"
                  [class.btn-outline]="contact.channel === 'sms'"
                  [disabled]="sending()"
                  (click)="send(contact.channel)"
                >
                  @if (contact.channel === 'email') {
                    Email a code to {{ contact.masked }}
                  } @else {
                    Text a code to {{ contact.masked }}
                  }
                </button>
              }
              @if ((access()?.contacts ?? []).length === 0) {
                <p class="text-center text-base-content/70">
                  There's no email or mobile number on file for you. Ask your organizer to add one, then reopen this
                  link.
                </p>
              }
            </div>
          } @else {
            <form class="flex flex-col gap-3" (submit)="confirm($event)">
              <p class="text-center text-base-content/70">Enter the 6-digit code sent to {{ sentTo() }}.</p>
              <input
                class="input input-bordered w-full text-center text-2xl tracking-[0.4em]"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                placeholder="••••••"
                aria-label="6-digit verification code"
                [(ngModel)]="codeValue"
                name="code"
              />
              @if (error()) {
                <p class="text-center text-sm text-error" role="alert">{{ error() }}</p>
              }
              <button type="submit" class="btn btn-primary w-full" [disabled]="confirming() || codeValue.length !== 6">
                @if (confirming()) {
                  Verifying…
                } @else if (codeValue.length !== 6) {
                  Enter the 6-digit code
                } @else {
                  Verify code
                }
              </button>
              <button type="button" class="btn btn-ghost btn-sm" [disabled]="cooldown() > 0" (click)="resend()">
                @if (cooldown() > 0) {
                  Resend code ({{ cooldown() }}s)
                } @else {
                  Resend code
                }
              </button>
            </form>
          }
          @if (!sentTo() && error()) {
            <p class="text-center text-sm text-error" role="alert">{{ error() }}</p>
          }
        </div>
      }
    }
  `,
})
export class CompanionGate implements OnInit {
  public readonly kind = input.required<CompanionAccessKind>();
  /** Absent for kind 'session', where the device session is the whole credential. */
  public readonly token = input<string | null>(null);
  /** Fires when the gate opens — the app behind it can start loading data. */
  public readonly ready = output<void>();

  protected readonly access = signal<CompanionAccessPayload | null>(null);
  protected readonly checking = signal(false);
  protected readonly confirming = signal(false);
  protected readonly cooldown = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly sentTo = signal<string | null>(null);
  protected readonly state = signal<'loading' | 'unreachable' | CompanionAccessPayload['state']>('loading');

  protected readonly view = computed<GateView>(() => {
    const state = this.state();
    if (state === 'loading') return 'loading';
    if (state === 'unreachable') return 'unreachable';
    if (state === 'ready') return 'ready';
    if (state === 'pending_approval') return 'pending';
    if (state === 'need_verification') return 'verify';
    // The identity form hands back a claim; from that point the code entry takes over,
    // which is why this checks the claim first rather than the server state.
    if (state === 'need_identity') return this.verifyToken() ? 'verify' : 'identity';
    if (state === 'unassigned') return 'unassigned';
    return 'dead';
  });

  protected codeValue = '';
  protected joinName = '';
  protected joinContact = '';

  /**
   * The credential the verify calls use.
   *
   * Identical to `token()` on every path but one: a join code names an ORGANIZATION, so
   * it cannot verify anybody. The identity step swaps in the one-shot claim that names
   * the person, and everything downstream is unchanged.
   */
  protected readonly verifyToken = signal<string | null>(null);
  /** The channel a QR joiner gave us, so "resend code" has somewhere to send it. */
  protected readonly joinChannel = signal<CompanionVerifyChannel | null>(null);

  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(CompanionSessionService);
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  public ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.stopPolling();
      if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    });
    void this.refresh();
  }

  protected async checkNow(): Promise<void> {
    this.checking.set(true);
    try {
      await this.refresh();
    } finally {
      this.checking.set(false);
    }
  }

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();
    if (this.codeValue.length !== 6 || this.confirming()) return;
    this.confirming.set(true);
    this.error.set(null);
    try {
      const result = await this.session.verifyConfirm(this.verifyKind(), this.credential(), this.codeValue);
      this.codeValue = '';
      if (result.status === 'ready') {
        this.state.set('ready');
        this.ready.emit();
      } else {
        this.state.set('pending_approval');
        this.startPolling();
      }
    } catch (err: unknown) {
      this.error.set(err instanceof CompanionApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      this.confirming.set(false);
    }
  }

  /**
   * Step one of a QR join: name plus one contact. Everything after this is the same
   * code-entry screen every other volunteer sees — deliberately not a second flow.
   */
  protected async submitIdentity(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending()) return;
    const code = this.token();
    const contact = this.joinContact.trim();
    if (!code || !this.joinName.trim() || !contact) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      // One field, two channels: an '@' is the only thing that distinguishes them, and
      // making someone pick from a radio group first is a question they can already answer.
      const looksLikeEmail = contact.includes('@');
      const [first, ...rest] = this.joinName.trim().split(/\s+/);
      const result = await this.session.joinStart({
        code,
        first_name: first ?? contact,
        ...(rest.length ? { last_name: rest.join(' ') } : {}),
        ...(looksLikeEmail ? { email: contact } : { mobile: contact }),
      });
      this.verifyToken.set(result.claim);
      this.joinChannel.set(result.channel);
      this.sentTo.set(result.masked);
      this.startCooldown();
    } catch (err: unknown) {
      this.error.set(err instanceof CompanionApiError ? err.message : 'Could not sign you up. Try again.');
    } finally {
      this.sending.set(false);
    }
  }

  protected resend(): void {
    const sent = this.sentTo();
    this.error.set(null);
    // On the join path there is no channel picker to fall back to — the volunteer gave
    // exactly one contact — so resend to it rather than emptying the screen.
    const joinChannel = this.joinChannel();
    if (joinChannel) {
      void this.send(joinChannel);
      return;
    }
    this.sentTo.set(null);
    // Re-open the channel picker; if there was exactly one channel, resend directly.
    const contacts = this.access()?.contacts ?? [];
    const only = contacts.length === 1 ? contacts[0] : undefined;
    if (only && sent) void this.send(only.channel);
  }

  protected async send(channel: CompanionVerifyChannel): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const { masked } = await this.session.verifyStart(this.verifyKind(), this.credential(), channel);
      this.sentTo.set(masked);
      this.startCooldown();
    } catch (err: unknown) {
      this.error.set(err instanceof CompanionApiError ? err.message : 'Could not send a code. Try again.');
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * Never rejects: getAccess maps every failure to the transient
   * 'unreachable' state, so the `void this.refresh()` calls in ngOnInit and
   * the approval poll can't become unhandled rejections on an offline tick.
   */
  private async refresh(): Promise<void> {
    const access = await this.session.getAccess(this.kind(), this.token());
    if (access.state === 'unreachable') {
      // Transient failure: never demote a real state (a pending screen stays
      // pending through an offline poll tick). Keep polling so the gate
      // recovers on its own once the connection returns.
      const current = this.state();
      if (current === 'loading' || current === 'unreachable') this.state.set('unreachable');
      this.startPolling();
      return;
    }
    this.access.set(access);
    const wasReady = this.state() === 'ready';
    this.state.set(access.state);
    if (access.state === 'pending_approval') {
      this.startPolling();
    } else {
      this.stopPolling();
      if (access.state === 'ready' && !wasReady) this.ready.emit();
    }
  }

  /** The token the verify calls send: the join claim once we have one, else the link. */
  private credential(): string {
    return this.verifyToken() ?? this.token() ?? '';
  }

  /** 'session' never verifies — it is already past that point — so it maps to the link kind. */
  private verifyKind(): CompanionVerifyKind {
    const kind = this.kind();
    return kind === 'session' ? 'turf' : kind;
  }

  private startCooldown(): void {
    this.cooldown.set(RESEND_COOLDOWN_S);
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => {
      const next = this.cooldown() - 1;
      this.cooldown.set(Math.max(0, next));
      if (next <= 0 && this.cooldownTimer) {
        clearInterval(this.cooldownTimer);
        this.cooldownTimer = null;
      }
    }, 1000);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
