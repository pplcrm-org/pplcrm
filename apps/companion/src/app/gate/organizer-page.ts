import type { OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

import type { CompanionOrganizerPayload, CompanionOrganizerPending } from '@common';
import { Icon } from '@icons/icon';
import { Qr } from '@uxcommon/components/qr/qr';

import { CompanionSessionService } from './companion-api';

/** Same cadence the gate polls at — a launch is a room, not a dashboard. */
const POLL_MS = 20_000;

/**
 * `/o/:token` — the page an organizer holds at a canvass launch.
 *
 * At a real launch the organizer is standing next to the people signing up. Texting an
 * approval link back and forth for each of them is a worse version of a list they could
 * simply look at, so this is that list: the QR big enough to show a room, and everyone who
 * has scanned it, with Approve next to each name.
 *
 * The URL is the credential (no sign-in, no CRM), so what it can reach is deliberately
 * narrow: one join code's scanners, and nothing else in the workspace. The link is short-
 * lived and dies with its code — the expiry is shown rather than left to be discovered.
 *
 * Everything the CRM's Volunteer access page can do that this cannot is intentional. This
 * is the launch, not the administration of it.
 */
@Component({
  selector: 'pc-organizer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Qr],
  template: `
    <div class="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-5">
      @if (loading()) {
        <div class="flex justify-center pt-16">
          <span class="loading loading-spinner loading-md opacity-40" aria-label="Loading"></span>
        </div>
      } @else if (payload(); as p) {
        @if (p.state === 'live') {
          <header class="flex flex-col gap-1">
            @if (p.organizationName) {
              <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
                {{ p.organizationName }}
              </p>
            }
            <h1 class="text-xl font-bold">{{ p.joiningLabel || 'Sign up volunteers' }}</h1>
            <p class="text-sm text-base-content/70">{{ headline(p) }}</p>
          </header>

          <!-- The QR is the reason this page exists on a phone, so it leads and it is
               tappable straight to full screen — held up across a room is the actual use. -->
          <button
            type="button"
            class="flex flex-col items-center gap-3 rounded-lg border border-base-300 bg-white p-4"
            (click)="fullscreen.set(true)"
          >
            @if (p.matrix; as matrix) {
              <span class="block w-full max-w-[240px]">
                <pc-qr [matrix]="matrix" [alt]="'QR code to join ' + (p.joiningLabel || 'this campaign')" />
              </span>
            }
            <span class="font-mono text-2xl font-semibold tabular-nums tracking-[0.25em] text-black">{{ p.code }}</span>
            <span class="flex items-center gap-1 text-xs text-black/60">
              <pc-icon name="arrows-pointing-out" [size]="4" />
              Tap to show full screen
            </span>
          </button>

          @if (error()) {
            <p class="text-sm text-error" role="alert">{{ error() }}</p>
          }

          <section class="flex flex-col gap-2">
            <h2 class="text-sm font-semibold">Waiting for you</h2>
            @for (person of p.pending ?? []; track person.volunteer_id) {
              <div class="flex items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ person.name }}</span>
                  <span class="block truncate text-xs text-base-content/60">{{ line(person) }}</span>
                </span>
                <!-- Approve is the expected answer at a launch, so it is the primary
                     control and the decline lives behind the smaller, quieter one. -->
                <button
                  type="button"
                  class="btn btn-primary btn-sm min-h-11"
                  [disabled]="busyId() !== null"
                  (click)="decide(person, 'approve')"
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm min-h-11"
                  [attr.aria-label]="'Not ' + person.name"
                  [disabled]="busyId() !== null"
                  (click)="decide(person, 'decline')"
                >
                  <pc-icon name="x-mark" [size]="5" />
                </button>
              </div>
            } @empty {
              <!-- Empty is the normal state for most of a launch, so it says what to do
                   next rather than reading as something being wrong (§3). -->
              <div class="rounded-lg border border-base-300 bg-base-100 p-5 text-center">
                <p class="text-sm text-base-content/70">
                  Nobody is waiting right now. Names appear here within a few seconds of someone scanning.
                </p>
              </div>
            }
          </section>

          <footer class="flex flex-col gap-1 text-xs text-base-content/50">
            <p>{{ approvedLine(p) }}</p>
            <p>{{ expiryLine(p) }}</p>
          </footer>
        } @else {
          <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <h1 class="text-lg font-semibold">This organizer link isn't active</h1>
            <p class="text-base-content/70">
              It may have expired, or the join code was rotated. Open Volunteer access in pplCRM and send yourself a new
              one.
            </p>
          </div>
        }
      }
    </div>

    <!-- Full screen: the whole point is a code readable from the back of a church basement. -->
    @if (fullscreen() && payload()?.matrix; as matrix) {
      <div
        class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Join QR code"
      >
        <div class="w-full max-w-[min(80vh,90vw)]">
          <pc-qr [matrix]="matrix" alt="QR code to join" />
        </div>
        <p class="font-mono text-3xl font-semibold tabular-nums tracking-[0.3em] text-black">{{ payload()?.code }}</p>
        <button type="button" class="btn btn-neutral min-h-12" (click)="fullscreen.set(false)">Done</button>
      </div>
    }
  `,
})
export class OrganizerPage implements OnInit {
  /** Route param — the organizer token from /o/:token. */
  public readonly token = input.required<string>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(CompanionSessionService);

  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly fullscreen = signal(false);
  protected readonly loading = signal(true);
  protected readonly payload = signal<CompanionOrganizerPayload | null>(null);

  protected readonly pendingCount = computed(() => this.payload()?.pending?.length ?? 0);

  /**
   * Init, not the constructor: a routed input is bound after construction, so reading
   * `token()` any earlier throws NG0950 and `load()`'s catch reports the link as dead. Here
   * the 20s poll hid it — the page healed itself on the next tick. On the approve page,
   * which has no poll, the same mistake made every link permanently dead.
   */
  public ngOnInit(): void {
    void this.load();
    const timer = setInterval(() => void this.poll(), POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  protected approvedLine(p: CompanionOrganizerPayload): string {
    const n = p.approvedCount ?? 0;
    if (n === 0) return 'Nobody has joined through this code yet.';
    return `${n} ${n === 1 ? 'volunteer has' : 'volunteers have'} joined through this code.`;
  }

  protected async decide(person: CompanionOrganizerPending, decision: 'approve' | 'decline'): Promise<void> {
    if (this.busyId()) return;
    this.busyId.set(person.volunteer_id);
    this.error.set(null);
    try {
      this.payload.set(await this.session.decideOnOrganizerPage(this.token(), person.volunteer_id, decision));
    } catch {
      this.error.set(`Couldn't save that for ${person.name}. Check your connection and try again.`);
    } finally {
      this.busyId.set(null);
    }
  }

  /** Says when the link stops working, so it is never a surprise mid-launch (§2). */
  protected expiryLine(p: CompanionOrganizerPayload): string {
    if (!p.expiresAt) return 'This link is temporary.';
    const at = new Date(p.expiresAt);
    if (Number.isNaN(at.getTime())) return 'This link is temporary.';
    return `This link stops working at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`;
  }

  protected headline(p: CompanionOrganizerPayload): string {
    const n = p.pending?.length ?? 0;
    if (n === 0) return 'Show this code. Anyone who scans it appears below.';
    return `${n} ${n === 1 ? 'person is' : 'people are'} waiting for you to let them in.`;
  }

  protected line(person: CompanionOrganizerPending): string {
    const contact = person.contact ?? 'verified';
    if (!person.requestedAt) return contact;
    const at = new Date(person.requestedAt);
    if (Number.isNaN(at.getTime())) return contact;
    return `${contact} · ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.payload.set(await this.session.getOrganizerPage(this.token()));
    } catch {
      this.payload.set({ state: 'dead' });
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Silent on failure, and never while a decision is in flight: a poll that overwrote the
   * list mid-tap would move the button out from under a thumb, and one missed tick on a
   * church-basement connection is not worth an error message.
   */
  private async poll(): Promise<void> {
    if (this.busyId() || this.loading()) return;
    try {
      const next = await this.session.getOrganizerPage(this.token());
      this.payload.set(next);
    } catch {
      // Keep showing what we have; the next tick tries again.
    }
  }
}
