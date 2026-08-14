import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';

import { CanvassStore } from './canvass-store';

const CLOCK_TICK_MS = 30_000;

/**
 * Me tab (spec §3.6): identity + provenance, today's derived stats, top
 * issues heard, and the sync card (queue, work-offline, sync now). "End shift
 * on this device" wipes every local trace behind the project confirm dialog.
 */
@Component({
  selector: 'pc-canvass-me',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4 p-4">
      <header class="flex flex-col gap-0.5">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
          {{ store.payload()?.campaign_name }}
        </p>
        <h1 class="text-xl font-bold">{{ store.payload()?.canvasser_name }}</h1>
      </header>

      <div class="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-100 p-4">
        <p class="text-xs text-base-content/70">
          Signed in through your assignment link. Your organizer can revoke it, and ending your shift signs this phone
          out. No voter data stays in this browser after your shift.
        </p>
        <button type="button" class="btn btn-outline btn-error w-full" (click)="endShift()">
          End shift on this device
        </button>
      </div>

      <div class="rounded-lg border border-base-300 bg-base-100 p-4">
        <p class="text-xs text-base-content/60">Doors you logged this shift</p>
        <p class="text-2xl font-bold tabular-nums">{{ store.myDoorCount() }}</p>
        <p class="mt-1 text-xs text-base-content/60">{{ shiftFootnote() }}</p>
      </div>

      <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
        This turf, everyone together
      </p>

      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-base-300 bg-base-100 p-3">
          <p class="text-xs text-base-content/60">Doors attempted</p>
          <p class="text-lg font-bold tabular-nums">{{ stats().doors_attempted }} of {{ stats().doors_total }}</p>
        </div>
        <div class="rounded-lg border border-base-300 bg-base-100 p-3">
          <p class="text-xs text-base-content/60">Conversations</p>
          <p class="text-lg font-bold tabular-nums">{{ stats().conversations }}</p>
        </div>
        <div class="rounded-lg border border-base-300 bg-base-100 p-3">
          <p class="text-xs text-base-content/60">Supporters ID'd</p>
          <p class="text-lg font-bold tabular-nums">{{ stats().supporters }}</p>
        </div>
        <div class="rounded-lg border border-base-300 bg-base-100 p-3">
          <p class="text-xs text-base-content/60">Contact rate</p>
          <p class="text-lg font-bold tabular-nums">{{ stats().contact_rate }}%</p>
        </div>
      </div>

      <div class="rounded-lg border border-base-300 bg-base-100 p-4">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
          Top issues heard on this turf
        </p>
        @if (stats().top_issues.length > 0) {
          <ul class="mt-2 flex flex-col gap-1.5">
            @for (item of topIssues(); track item.issue) {
              <li class="flex items-center justify-between text-sm">
                <span>{{ item.issue }}</span>
                <span class="tabular-nums text-base-content/70">{{ item.count }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="mt-2 text-xs text-base-content/60">No issues recorded yet. They appear as you log conversations.</p>
        }
      </div>

      <div class="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-100 p-4">
        <div class="flex items-center justify-between">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Sync</p>
          <span [class]="syncChip().cls">{{ syncChip().label }}</span>
        </div>
        <p class="text-xs text-base-content/70">{{ lastSyncedLabel() }}</p>

        @if (store.queue().length > 0) {
          <div>
            <p class="text-xs font-medium text-base-content/80">Waiting to sync</p>
            <ul class="mt-1 flex flex-col gap-1">
              @for (entry of store.queue(); track entry.op.op_id) {
                <li class="truncate text-xs text-base-content/70">{{ entry.label }}</li>
              }
            </ul>
          </div>
        }

        @if (store.blocked().length > 0) {
          <div class="rounded-lg border border-error/40 bg-error/5 p-3">
            <p class="text-xs font-medium text-error">
              Couldn't sync ({{ store.blocked().length }}) — still on this phone, not in pplCRM
            </p>
            <ul class="mt-2 flex flex-col gap-2">
              @for (held of store.blocked(); track held.entry.op.op_id) {
                <li class="flex flex-col gap-1 border-t border-base-300 pt-2 first:border-0 first:pt-0">
                  <span class="text-xs font-medium">{{ held.entry.label }}</span>
                  <span class="text-xs text-base-content/70">{{ held.reason }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs self-start"
                    (click)="store.discardBlocked(held.entry.op.op_id)"
                  >
                    Discard this one
                  </button>
                </li>
              }
            </ul>
            @if (retryableCount() > 0) {
              <button type="button" class="btn btn-outline btn-error btn-sm mt-3 w-full" (click)="retryBlocked()">
                Try {{ retryableCount() === 1 ? 'it' : 'them' }} again ({{ retryableCount() }})
              </button>
            }
          </div>
        }

        <label class="flex min-h-11 items-center justify-between gap-3">
          <span>
            Work offline
            <span class="block text-xs text-base-content/60">Hold results on this phone until you sync</span>
          </span>
          <input
            type="checkbox"
            class="toggle toggle-primary"
            [checked]="store.workOffline()"
            (change)="onWorkOffline($event)"
          />
        </label>

        <button
          type="button"
          class="btn btn-outline btn-primary w-full"
          [disabled]="store.queue().length === 0"
          (click)="syncNow()"
        >
          {{ store.queue().length > 0 ? 'Sync now' : 'All synced' }}
        </button>
      </div>
    </div>
  `,
})
export class CanvassMe {
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  protected readonly store = inject(CanvassStore);

  protected readonly stats = computed(() => this.store.stats());
  protected readonly topIssues = computed(() => this.stats().top_issues.slice(0, 5));
  /** Held results that a re-send could still fix; the rest can only be read and discarded. */
  protected readonly retryableCount = computed(() => this.store.blocked().filter((b) => b.retryable).length);

  /**
   * Several volunteers can walk one turf, and the turf payload carries all of their
   * knocks. Saying so keeps the big number above from reading as the turf's total —
   * and stops the turf's totals below from reading as this volunteer's own work.
   */
  protected readonly shiftFootnote = computed(() => {
    const mine = this.store.myDoorCount();
    const turf = this.stats().doors_attempted;
    if (mine === 0) return 'Nothing logged from this phone yet.';
    if (turf > mine) return `${turf} doors attempted on this turf in total, including other canvassers.`;
    return 'Counted from this phone, so results logged elsewhere are not included.';
  });

  /** Ticks so "Last synced N min ago" stays honest while the tab sits open. */
  private readonly now = signal(Date.now());

  protected readonly lastSyncedLabel = computed(() => {
    const at = this.store.lastSyncedAt();
    if (at == null) return 'Not synced yet this visit';
    const minutes = Math.floor((this.now() - at.getTime()) / 60_000);
    if (minutes < 1) return 'Last synced just now';
    if (minutes < 60) return `Last synced ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `Last synced ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  });

  protected readonly syncChip = computed<{ label: string; cls: string }>(() => {
    const status = this.store.syncStatus();
    switch (status) {
      case 'syncing':
        return { label: 'Syncing…', cls: 'badge badge-info' };
      case 'offline':
        return { label: 'Offline', cls: 'badge badge-warning' };
      case 'error':
        return { label: 'Sync issue', cls: 'badge badge-error' };
      case 'idle':
        return this.store.queue().length > 0
          ? { label: 'Waiting to sync', cls: 'badge badge-warning' }
          : { label: 'Up to date', cls: 'badge badge-success' };
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected async endShift(): Promise<void> {
    // Try to save the work before offering to destroy it. Signing out must not become a
    // new way to lose doors somebody knocked, and the common case — a queue that simply
    // had not flushed yet — needs no warning at all once it has gone out.
    if (this.store.queue().length > 0 && this.store.online()) await this.store.flush(true);

    // Counts held results too: they are recorded work sitting on this phone, and ending
    // the shift destroys them exactly like a queued one.
    const unsynced = this.store.unsyncedCount();
    const confirmed = await this.dialogs.confirm({
      title: 'End shift on this device?',
      message:
        unsynced > 0
          ? `This signs this phone out and clears the results stored in this browser. ${unsynced} ${unsynced === 1 ? 'result has' : 'results have'} not reached pplCRM yet and will be lost. Sync first if you can.`
          : 'This signs this phone out and clears the results stored in this browser. Everything you recorded is already in pplCRM. Your organizer can send you a new link whenever you want to walk again.',
      variant: 'danger',
      confirmText: 'End shift',
      cancelText: 'Keep walking',
    });
    if (!confirmed) return;
    // Read before endShift() tears the state down, so the confirmation can honestly say
    // sharing stopped — and never claims it for a volunteer who kept location off.
    const wasSharing = this.store.locationSharing();
    await this.store.endShift();
    this.alerts.showSuccess(
      wasSharing
        ? 'Shift ended. Location sharing stopped and this phone is signed out'
        : 'Shift ended. This phone is signed out',
    );
  }

  protected retryBlocked(): void {
    void this.store.retryBlocked();
  }

  protected onWorkOffline(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.store.setWorkOffline(target.checked);
  }

  protected syncNow(): void {
    void this.store.flush(true);
  }
}
