import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnDestroy } from '@angular/core';

import type { CompanionHousehold } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import { residentSummary } from './canvass-derive';
import { CanvassStore } from './canvass-store';
import { lastVisitLabel, navigateUrl } from './canvass-ui';

/** How often the "… ago" line is recomputed while a door is open. */
const CLOCK_TICK_MS = 30_000;

/** The common couldn't-deliver reasons, offered as one-tap chips above the free-text box. */
const REASON_PRESETS = ['No safe place to leave it', 'Gate locked', 'Dog at the door', 'Address wrong'] as const;

/**
 * Delivery doorstep screen (turfs with mode 'delivery'): drop off what this door's
 * approved request asked for.
 *
 * A sibling of the canvass and GOTV door screens — this door's job is a hand-off, not a
 * conversation, so the screen is one big **Delivered** button plus the honest failure
 * path. "Couldn't deliver" requires a reason (that is why the list row's version of the
 * button lands here): the reason reaches the office on the request, so the retry is
 * informed. The door stays owed to this outing either way — it only returns to the pool
 * when the outing is retired.
 */
@Component({
  selector: 'pc-delivery-household',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (household(); as h) {
      <div class="flex flex-1 flex-col gap-4 p-4">
        <header class="flex items-start gap-2">
          <button type="button" class="btn btn-ghost btn-circle" aria-label="Back" (click)="back()">
            <pc-icon name="chevron-left" [size]="5"></pc-icon>
          </button>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-lg font-bold">{{ h.address }}</h1>
              <span [class]="chipClass(h)">{{ chipLabel(h) }}</span>
            </div>
            @if (residents(h); as names) {
              <p class="text-xs text-base-content/70">Requested by {{ names }}</p>
            }
          </div>
          <button
            type="button"
            class="btn btn-outline btn-primary btn-sm"
            [attr.aria-label]="'Navigate to ' + h.address"
            (click)="navigate(h)"
          >
            <pc-icon name="map-pin" [size]="4"></pc-icon>
            Navigate
          </button>
        </header>

        @if (lastVisit(h); as note) {
          <div class="flex items-center gap-2 rounded-lg bg-base-200 px-3 py-2 text-base-content/70">
            <pc-icon name="clock" [size]="4"></pc-icon>
            <p class="text-xs">{{ note }}</p>
          </div>
        }

        @switch (h.delivery_status ?? null) {
          @case ('delivered') {
            <div class="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
              <pc-icon name="check-circle" [size]="5" class="text-success"></pc-icon>
              <p class="flex-1 text-sm font-medium text-success">Delivered</p>
              <button type="button" class="btn btn-ghost btn-xs" (click)="undo(h)">Undo</button>
            </div>
          }
          @case ('undeliverable') {
            <div class="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div class="flex items-center gap-2">
                <pc-icon name="shield-exclamation" [size]="5" class="text-warning"></pc-icon>
                <p class="text-sm font-medium">Couldn't deliver — the reason was recorded.</p>
              </div>
              <p class="text-xs text-base-content/70">
                The door stays on this outing, so you (or a teammate) can try again.
              </p>
              <button type="button" class="btn btn-primary btn-sm min-h-11" (click)="deliver(h)">
                Managed it — mark delivered
              </button>
            </div>
          }
          @case ('pending') {
            <button type="button" class="btn btn-primary min-h-14 w-full text-base" (click)="deliver(h)">
              Delivered
            </button>

            <!-- The honest failure path. A reason is required: "couldn't deliver" with no
                 why tells the office nothing about whether a retry is worth sending. -->
            <div class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
              <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
                Couldn't deliver?
              </p>
              <div class="flex flex-wrap gap-2">
                @for (preset of reasonPresets; track preset) {
                  <button
                    type="button"
                    class="btn btn-xs"
                    [class.btn-warning]="reason() === preset"
                    [class.btn-outline]="reason() !== preset"
                    [class.btn-secondary]="reason() !== preset"
                    (click)="reason.set(preset)"
                  >
                    {{ preset }}
                  </button>
                }
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                placeholder="Or say what happened…"
                maxlength="500"
                [value]="reason()"
                (input)="reason.set($any($event.target).value)"
              />
              <button
                type="button"
                class="btn btn-outline btn-warning btn-sm min-h-11"
                [disabled]="!reason().trim()"
                (click)="cantDeliver(h)"
              >
                Record "couldn't deliver"
              </button>
            </div>
          }
          @default {
            <div class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-4 text-center">
              <p class="text-sm text-base-content/70">
                This door isn't carrying a delivery anymore — the office may have pulled its request back.
              </p>
            </div>
          }
        }
      </div>
    } @else {
      <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p class="text-base-content/70">This door isn't in your outing anymore.</p>
        <button type="button" class="btn btn-primary" (click)="back()">Back to the list</button>
      </div>
    }
  `,
})
export class DeliveryHousehold implements OnDestroy {
  private readonly alerts = inject(AlertService);
  protected readonly store = inject(CanvassStore);

  /** Ticks so the last-visit line stays true while the door is open. */
  private readonly now = signal(Date.now());
  private readonly clock = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);

  protected readonly reasonPresets = REASON_PRESETS;
  protected readonly reason = signal('');

  protected readonly household = computed<CompanionHousehold | null>(() => {
    const view = this.store.view();
    return view.kind === 'household' ? this.store.householdById(view.household_id) : null;
  });

  protected back(): void {
    this.store.view.set({ kind: 'list' });
  }

  protected chipClass(h: CompanionHousehold): string {
    if (h.delivery_status === 'delivered') return 'badge badge-success';
    if (h.delivery_status === 'undeliverable') return 'badge badge-warning';
    return 'badge badge-ghost';
  }

  protected chipLabel(h: CompanionHousehold): string {
    if (h.delivery_status === 'delivered') return 'Delivered';
    if (h.delivery_status === 'undeliverable') return "Couldn't deliver";
    return 'Waiting';
  }

  protected residents(h: CompanionHousehold): string {
    return residentSummary(h);
  }

  protected deliver(h: CompanionHousehold): void {
    if (this.store.deliverDoor(h.id, true)) {
      this.alerts.showSuccess('Marked delivered');
      this.back();
    }
  }

  protected undo(h: CompanionHousehold): void {
    if (this.store.deliverDoor(h.id, false)) this.alerts.showSuccess('Delivery undone. The door is owed again');
  }

  protected cantDeliver(h: CompanionHousehold): void {
    if (this.store.deliveryResult(h.id, this.reason())) {
      this.alerts.showSuccess('Recorded. The door stays on your list for a retry');
      this.reason.set('');
      this.back();
    }
  }

  protected navigate(h: CompanionHousehold): void {
    window.open(navigateUrl(h), '_blank', 'noopener');
  }

  protected lastVisit(h: CompanionHousehold): string | null {
    return lastVisitLabel(h.last_knock, {
      myName: this.store.payload()?.canvasser_name ?? null,
      now: this.now(),
    });
  }

  public ngOnDestroy(): void {
    clearInterval(this.clock);
  }
}
