import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { Qr } from '@uxcommon/components/qr/qr';

import type { JoinCodeQr, JoinCodeRow } from '../../../../../../../libs/common/src';
import { JoinCodesService } from '../services/join-codes-service';

/**
 * "Join by QR" — the surface an organizer holds up at a canvass launch.
 *
 * Serves two scopes from one component: the whole campaign (Volunteer access page) and
 * one turf (the canvassing row action). The only difference is `turfId`, which decides
 * whether a scanner lands on that turf with the group or on their own turf picker.
 *
 * Three orientation questions (`pplcrm-design-principles` §1): the eyebrow says what this
 * is, the count sentence says whether it is working, and the typeable code is there
 * because a cracked camera should not end someone's evening.
 */
@Component({
  selector: 'pc-join-code-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Qr],
  template: `
    <section class="pc-panel flex flex-col gap-4 p-5">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="pc-eyebrow">Join by QR</p>
          <h2 class="text-base font-semibold">{{ heading() }}</h2>
          <p class="mt-1 max-w-prose text-xs text-base-content/60">{{ subtitle() }}</p>
        </div>
        @if (active(); as code) {
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn btn-outline btn-sm" (click)="copyLink(code)">
              <pc-icon name="document-duplicate" [size]="4" />
              Copy link
            </button>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="!qr()" (click)="fullscreen.set(true)">
              <pc-icon name="arrows-pointing-out" [size]="4" />
              Show fullscreen
            </button>
            <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="rotate(code)">
              Rotate code
            </button>
          </div>
        }
      </header>

      @if (loading()) {
        <progress class="progress w-full max-w-xs"></progress>
      } @else if (active(); as code) {
        <div class="flex flex-wrap items-center gap-5">
          <div class="h-40 w-40 shrink-0 rounded-lg border border-base-300 bg-white p-2">
            @if (qr(); as bitmap) {
              <pc-qr [matrix]="bitmap.matrix" [alt]="'QR code to join ' + heading()" />
            }
          </div>
          <div class="flex min-w-0 flex-col gap-2">
            <p class="text-xs text-base-content/60">Can't scan? Enter this code at {{ joinHost() }}</p>
            <p class="font-mono text-2xl font-semibold tabular-nums tracking-[0.25em]">{{ code.code }}</p>
            <p class="text-xs text-base-content/60">{{ countSentence(code) }}</p>
            @if (code.max_uses != null) {
              <p class="text-xs text-base-content/60">
                Stops accepting people after {{ code.max_uses }} {{ code.max_uses === 1 ? 'scan' : 'scans' }}.
              </p>
            }
          </div>
        </div>
      } @else {
        <div class="flex flex-col items-start gap-3">
          <p class="max-w-prose text-sm text-base-content/70">
            No code yet. Create one and anyone who scans it can sign up on the spot — they still need your approval
            before they see anything.
          </p>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="create()">
            {{ busy() ? 'Creating…' : 'Create a join code' }}
          </button>
        </div>
      }
    </section>

    <!-- Fullscreen: the whole point is a code readable from across a church basement. -->
    @if (fullscreen() && qr(); as bitmap) {
      <div
        class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'Join QR code for ' + heading()"
      >
        <div class="w-full max-w-[min(80vh,80vw)]">
          <pc-qr [matrix]="bitmap.matrix" [alt]="'QR code to join ' + heading()" />
        </div>
        <p class="font-mono text-3xl font-semibold tabular-nums tracking-[0.3em] text-black">{{ bitmap.code }}</p>
        <p class="text-sm text-black/60">{{ joinHost() }}</p>
        <button type="button" class="btn btn-neutral" (click)="fullscreen.set(false)">Done</button>
      </div>
    }
  `,
})
export class JoinCodePanel {
  /** Scope the code to one turf, so a whole group lands on it together. */
  public readonly turfId = input<string | null>(null);
  public readonly turfName = input<string | null>(null);

  private readonly alerts = inject(AlertService);
  private readonly confirmDlg = inject(ConfirmDialogService);
  private readonly svc = inject(JoinCodesService);

  protected readonly busy = signal(false);
  protected readonly fullscreen = signal(false);
  protected readonly loading = signal(true);
  protected readonly qr = signal<JoinCodeQr | null>(null);
  protected readonly rows = signal<JoinCodeRow[]>([]);

  /** The live code for this scope. Revoked ones stay in the table but are not offered. */
  protected readonly active = computed(
    () => this.rows().find((r) => r.status === 'active' && (r.turf_id ?? null) === this.turfId()) ?? null,
  );

  protected readonly heading = computed(() => this.turfName() ?? 'Anyone joining this campaign');

  protected readonly subtitle = computed(() =>
    this.turfId()
      ? 'Everyone who scans this lands on this turf, so a group can walk it together.'
      : 'Scanners pick their own turf once you approve them.',
  );

  constructor() {
    void this.refresh();
  }

  protected countSentence(code: JoinCodeRow): string {
    if (code.joined_count === 0 && code.pending_count === 0) return 'Nobody has used this code yet.';
    const joined = `${code.joined_count} ${code.joined_count === 1 ? 'volunteer' : 'volunteers'} joined`;
    return code.pending_count > 0 ? `${joined} · ${code.pending_count} awaiting your approval` : `${joined}.`;
  }

  protected async copyLink(code: JoinCodeRow): Promise<void> {
    try {
      await navigator.clipboard.writeText(code.url);
      this.alerts.showSuccess('Join link copied');
    } catch {
      this.alerts.showError('Could not copy the link');
    }
  }

  protected async create(): Promise<void> {
    this.busy.set(true);
    try {
      const created = await this.svc.create({ turf_id: this.turfId(), label: this.turfName() });
      this.rows.update((r) => [created, ...r]);
      await this.loadQr(created.id);
    } catch {
      this.alerts.showError('Could not create a join code. Try again');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Rotating is destructive in a way nothing on this screen shows: every printed poster
   * and forwarded screenshot dies with the old code. Name that before doing it (§3).
   */
  protected async rotate(code: JoinCodeRow): Promise<void> {
    const confirmed = await this.confirmDlg.confirm({
      title: 'Rotate this join code?',
      message: `Anything already printed or shared with ${code.code} on it stops working immediately. Volunteers who already joined keep their access.`,
      variant: 'danger',
      confirmText: 'Rotate code',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.svc.rotate(code.id);
      await this.refresh();
      this.alerts.showSuccess('New code created. Reprint anything with the old one on it');
    } catch {
      this.alerts.showError('Could not rotate the code. Try again');
    } finally {
      this.busy.set(false);
    }
  }

  /** The host people type the code into, shown so the fallback is actionable, not theoretical. */
  protected joinHost(): string {
    const url = this.active()?.url;
    if (!url) return 'the volunteer app';
    try {
      return new URL(url).host;
    } catch {
      return 'the volunteer app';
    }
  }

  private async loadQr(id: string): Promise<void> {
    try {
      this.qr.set(await this.svc.qr(id));
    } catch {
      this.qr.set(null);
    }
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.rows.set(await this.svc.getForCampaign());
      const active = this.active();
      if (active) await this.loadQr(active.id);
      else this.qr.set(null);
    } catch {
      this.alerts.showError('Could not load join codes. Refresh to try again');
    } finally {
      this.loading.set(false);
    }
  }
}
