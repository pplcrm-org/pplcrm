import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import type { CompanionApprovalPayload } from '@common';
import { Icon } from '@icons/icon';

import { CompanionSessionService } from './companion-api';

/**
 * `/a/:token` — approve a volunteer from the text message, one tap.
 *
 * The admin arrives with no session and no app open, so the token in the URL is the
 * credential; it is single-use, short-lived, and only its hash is stored. The page's
 * whole job is to answer "who am I approving?" before the tap, and to end somewhere
 * concrete afterwards — including when someone else already decided.
 *
 * Lives in the companion app rather than the CRM because that is where a phone opening
 * an SMS link should land: no sign-in, no desktop layout, thumb-sized buttons.
 */
@Component({
  selector: 'pc-approve-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
      @if (loading()) {
        <div class="flex justify-center">
          <span class="loading loading-spinner loading-md opacity-40" aria-label="Loading"></span>
        </div>
      } @else if (payload(); as p) {
        @switch (p.state) {
          @case ('pending') {
            <header class="flex flex-col gap-1 text-center">
              @if (p.organizationName) {
                <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
                  {{ p.organizationName }}
                </p>
              }
              <h1 class="text-lg font-semibold">Approve {{ p.volunteerName }}?</h1>
              <p class="text-base-content/70">{{ subtitle(p) }}</p>
            </header>

            <div class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-4 text-sm">
              <div class="flex justify-between gap-3">
                <span class="text-base-content/60">Verified</span>
                <span class="font-medium">{{ p.volunteerContact || '—' }}</span>
              </div>
              @if (p.joiningLabel) {
                <div class="flex justify-between gap-3">
                  <span class="text-base-content/60">Joining</span>
                  <span class="font-medium">{{ p.joiningLabel }}</span>
                </div>
              }
              @if (p.requestedAt) {
                <div class="flex justify-between gap-3">
                  <span class="text-base-content/60">Asked</span>
                  <span class="font-medium">{{ when(p.requestedAt) }}</span>
                </div>
              }
            </div>

            @if (error()) {
              <p class="text-center text-sm text-error" role="alert">{{ error() }}</p>
            }

            <!-- Approving is the expected answer, so it leads. "Not this person" is the
                 honest label for decline: the admin is refusing a stranger, not a task. -->
            <button
              type="button"
              class="btn btn-primary min-h-12 w-full"
              [disabled]="busy()"
              (click)="decide('approve')"
            >
              {{ busy() ? 'Saving…' : 'Approve ' + p.volunteerName }}
            </button>
            <button type="button" class="btn btn-ghost min-h-11 w-full" [disabled]="busy()" (click)="decide('decline')">
              Not this person
            </button>
            <p class="text-center text-xs text-base-content/50">
              You can change this any time from Volunteer access in pplCRM.
            </p>
          }
          @case ('decided') {
            <div class="flex flex-col items-center gap-3 text-center">
              <pc-icon
                [name]="p.decision === 'approved' ? 'check-circle' : 'x-circle'"
                [size]="10"
                [class]="p.decision === 'approved' ? 'text-success' : 'text-base-content/40'"
              ></pc-icon>
              <h1 class="text-lg font-semibold">{{ decidedHeading(p) }}</h1>
              <p class="text-base-content/70">{{ decidedDetail(p) }}</p>
            </div>
          }
          @default {
            <div class="flex flex-col items-center gap-3 text-center">
              <h1 class="text-lg font-semibold">This approval link isn't active</h1>
              <p class="text-base-content/70">
                It may have expired or already been used. Open Volunteer access in pplCRM to approve anyone who is still
                waiting.
              </p>
            </div>
          }
        }
      }
    </div>
  `,
})
export class ApprovePage {
  /** Route param — the approval token from /a/:token. */
  public readonly token = input.required<string>();

  private readonly session = inject(CompanionSessionService);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly payload = signal<CompanionApprovalPayload | null>(null);

  protected readonly name = computed(() => this.payload()?.volunteerName ?? 'this volunteer');

  constructor() {
    void this.load();
  }

  protected async decide(decision: 'approve' | 'decline'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.payload.set(await this.session.actOnApproval(this.token(), decision));
    } catch {
      this.error.set("Couldn't save that. Check your connection and try again.");
    } finally {
      this.busy.set(false);
    }
  }

  protected decidedDetail(p: CompanionApprovalPayload): string {
    const who = p.decidedByName ? `${p.decidedByName} decided` : 'This was decided';
    const at = p.decidedAt ? ` ${this.when(p.decidedAt)}` : '';
    return p.decision === 'approved'
      ? `${who}${at}. They can start walking straight away.`
      : `${who}${at}. They can't see anything until someone approves them.`;
  }

  protected decidedHeading(p: CompanionApprovalPayload): string {
    const who = p.volunteerName ?? 'This volunteer';
    return p.decision === 'approved' ? `${who} is approved` : `${who} wasn't approved`;
  }

  protected subtitle(p: CompanionApprovalPayload): string {
    return `They verified their contact and are waiting on you. Approving lets them see doors${
      p.joiningLabel ? ` on ${p.joiningLabel}` : ''
    } — nothing else.`;
  }

  protected when(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.payload.set(await this.session.getApproval(this.token()));
    } catch {
      this.payload.set({ state: 'dead' });
    } finally {
      this.loading.set(false);
    }
  }
}
