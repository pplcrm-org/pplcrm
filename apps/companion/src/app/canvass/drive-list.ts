import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';

import type { CompanionHousehold } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import { doorStatus, doorStatusLabel, isAttempted, residentSummary } from './canvass-derive';
import { performQuickAction, quickActionsFor, showQuickActionsFor, type QuickActionId } from './canvass-quick-actions';
import { CanvassStore } from './canvass-store';
import { lastVisitLabel, navigateUrl, statusBadgeClass } from './canvass-ui';

/** Same cadence as the walk list: fresh enough for a group, kind to a pocketed phone. */
const REFRESH_MS = 60_000;

/**
 * Google's directions URL renders reliably up to about this many waypoints, so the
 * whole-route button opens the NEXT stops rather than pretending a 40-door outing fits
 * in one link. Origin is deliberately omitted — Google fills in the driver's current
 * position, which is where the next leg actually starts.
 */
const MAPS_CHAIN_STOPS = 10;

type ListFilter = 'all' | 'remaining' | 'visited';

/**
 * The drive "route view" (turfs with travel 'drive'): a flat stop list in the stored
 * driving order, not the walker's street sweep. No street picker, no odd/even sides —
 * a car doesn't work one sidewalk at a time. What replaces them: the next stop ringed,
 * per-stop Navigate, and "Open the next N stops in Google Maps" for turn-by-turn across
 * the whole leg. Rows keep the same one-tap outcomes as the walk list (shared in
 * canvass-quick-actions.ts), so recording works identically in either view.
 */
@Component({
  selector: 'pc-drive-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="flex flex-col gap-4 p-4">
      <header class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
            {{ store.payload()?.campaign_name }}
          </p>
          <h1 class="truncate text-xl font-bold">{{ store.payload()?.turf_name }}</h1>
        </div>
        <button type="button" class="btn btn-ghost btn-sm shrink-0" (click)="openPicker()">Switch turf</button>
      </header>

      <div class="rounded-lg border border-base-300 bg-base-100 p-4">
        <p class="font-medium">{{ progressLine() }}</p>
        <progress
          class="progress progress-primary mt-2 w-full"
          [value]="attempted()"
          [max]="stops().length"
          aria-label="Progress on this outing"
        ></progress>
        <button
          type="button"
          class="mt-1 text-xs text-base-content/50 underline decoration-dotted underline-offset-2"
          [disabled]="store.refreshing()"
          (click)="refreshNow()"
        >
          {{ freshness() }}
        </button>
      </div>

      @if (chainCount() > 0) {
        <button type="button" class="btn btn-outline btn-primary" (click)="openChain()">
          <pc-icon name="map-pin" [size]="4" />
          {{ chainLabel() }}
        </button>
      }

      <div class="flex gap-2" role="group" aria-label="Filter stops">
        @for (option of filterOptions; track option.id) {
          <button
            type="button"
            class="btn flex-1"
            [class.btn-primary]="filter() === option.id"
            [class.btn-outline]="filter() !== option.id"
            [class.btn-secondary]="filter() !== option.id"
            [attr.aria-pressed]="filter() === option.id"
            (click)="filter.set(option.id)"
          >
            {{ option.label }} ({{ countFor(option.id) }})
          </button>
        }
      </div>

      <div class="flex flex-col gap-2">
        @for (h of filtered(); track h.id) {
          <div
            class="rounded-lg border border-l-4 border-l-base-300 border-base-300 bg-base-100"
            [class.ring-2]="h.id === nextStopId()"
            [class.ring-primary]="h.id === nextStopId()"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 p-3 text-left"
              [attr.aria-expanded]="expandable(h) ? panelOpen(h) : null"
              (click)="rowTap(h)"
            >
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                [class.bg-primary]="h.id === nextStopId()"
                [class.text-primary-content]="h.id === nextStopId()"
                [class.border-primary]="h.id === nextStopId()"
                [class.border-base-300]="h.id !== nextStopId()"
                [class.text-base-content]="h.id !== nextStopId()"
              >
                {{ seqOf(h) }}
              </span>
              <span class="min-w-0 flex-1">
                @if (residents(h); as names) {
                  <span class="block truncate font-medium">{{ names }}</span>
                  <span class="block truncate text-xs text-base-content/70">{{ h.address }}</span>
                } @else {
                  <span class="block truncate font-medium">{{ h.address }}</span>
                }
                @if (lastVisit(h); as note) {
                  <span class="block truncate text-xs text-base-content/50">{{ note }}</span>
                }
              </span>
              <span class="flex shrink-0 items-center gap-1.5">
                <span [class]="chipClass(h)">{{ chipLabel(h) }}</span>
                @if (expandable(h)) {
                  <pc-icon
                    [name]="panelOpen(h) ? 'chevron-up' : 'chevron-down'"
                    [size]="4"
                    class="text-base-content/40"
                  />
                }
              </span>
            </button>
            <!-- Delivery stops show their buttons always (the job is the household's);
                 canvass and GOTV stops fold them until the row is tapped. -->
            @if (panelOpen(h)) {
              <div class="flex flex-col gap-2 border-t border-base-200 p-2">
                <div
                  class="gap-2"
                  [class.flex]="store.mode() !== 'canvass'"
                  [class.items-center]="store.mode() !== 'canvass'"
                  [class.grid]="store.mode() === 'canvass'"
                  [class.grid-cols-2]="store.mode() === 'canvass'"
                >
                  @for (action of quickActions(); track action.id) {
                    <button
                      type="button"
                      class="btn btn-outline btn-secondary btn-xs min-h-9 flex-1"
                      (click)="quickAct(h, action.id)"
                    >
                      {{ action.label }}
                    </button>
                  }
                  <button
                    type="button"
                    class="btn btn-outline btn-secondary btn-xs min-h-9"
                    [attr.aria-label]="'Navigate to ' + h.address"
                    title="Navigate to this stop"
                    (click)="navigate(h)"
                  >
                    <pc-icon name="map-pin" [size]="4" />
                  </button>
                </div>
                @if (expandable(h)) {
                  <button type="button" class="btn btn-ghost btn-xs min-h-9 w-full" (click)="open(h)">
                    Open this door
                    <pc-icon name="chevron-right" [size]="4" />
                  </button>
                }
              </div>
            }
          </div>
        } @empty {
          <div class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-6 text-center">
            <p class="text-base-content/70">{{ emptyMessage() }}</p>
            @if (filter() !== 'all') {
              <button type="button" class="btn btn-outline btn-primary" (click)="filter.set('all')">
                Show every stop
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class DriveList {
  protected readonly store = inject(CanvassStore);
  private readonly alerts = inject(AlertService);

  protected readonly filter = signal<ListFilter>('all');
  protected readonly filterOptions: { id: ListFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'remaining', label: 'Remaining' },
    { id: 'visited', label: 'Visited' },
  ];

  constructor() {
    const timer = setInterval(() => void this.store.refresh(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Every door in the stored driving order. walk_order IS that order on a drive turf. */
  protected readonly stops = computed<CompanionHousehold[]>(() =>
    [...this.store.households()].sort((a, b) => a.walk_order - b.walk_order),
  );

  protected readonly attempted = computed(() => this.stops().filter(isAttempted).length);

  /** The next stop in driving order not yet attempted — the ringed row. */
  protected readonly nextStopId = computed<string | null>(() => this.stops().find((h) => !isAttempted(h))?.id ?? null);

  protected readonly filtered = computed<CompanionHousehold[]>(() => {
    const stops = this.stops();
    const filter = this.filter();
    switch (filter) {
      case 'remaining':
        return stops.filter((h) => !isAttempted(h));
      case 'visited':
        return stops.filter(isAttempted);
      case 'all':
        return stops;
      default: {
        const _exhaustive: never = filter;
        return _exhaustive;
      }
    }
  });

  /** The located remaining stops the Google Maps chain would cover (capped). */
  private readonly chainStops = computed<CompanionHousehold[]>(() =>
    this.stops()
      .filter((h) => !isAttempted(h) && h.lat != null && h.lng != null)
      .slice(0, MAPS_CHAIN_STOPS),
  );

  protected readonly chainCount = computed(() => this.chainStops().length);

  protected chainLabel(): string {
    const n = this.chainCount();
    if (n === 1) return 'Open the next stop in Google Maps';
    return `Open the next ${n} stops in Google Maps`;
  }

  /**
   * Turn-by-turn for the next leg: no origin (Google uses the driver's position), the
   * last capped stop as destination, the rest as waypoints in driving order.
   */
  protected openChain(): void {
    const stops = this.chainStops();
    const dest = stops[stops.length - 1];
    if (!dest) return;
    const params = new URLSearchParams({ api: '1', destination: `${dest.lat},${dest.lng}` });
    const waypoints = stops
      .slice(0, -1)
      .map((h) => `${h.lat},${h.lng}`)
      .join('|');
    if (waypoints) params.set('waypoints', waypoints);
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank', 'noopener');
  }

  protected readonly quickActions = computed<{ id: QuickActionId; label: string }[]>(() =>
    quickActionsFor(this.store.mode()),
  );

  protected showQuickActions(h: CompanionHousehold): boolean {
    return showQuickActionsFor(this.store.mode(), h);
  }

  /** The one stop whose folded quick actions are showing; null = all folded. */
  protected readonly expandedId = signal<string | null>(null);

  /** Delivery stops never fold (household-level job); canvass/GOTV stops fold until tapped. */
  protected expandable(h: CompanionHousehold): boolean {
    return this.store.mode() !== 'delivery' && this.showQuickActions(h);
  }

  protected panelOpen(h: CompanionHousehold): boolean {
    if (!this.showQuickActions(h)) return false;
    if (this.store.mode() === 'delivery') return true;
    return this.expandedId() === h.id;
  }

  protected rowTap(h: CompanionHousehold): void {
    if (!this.expandable(h)) {
      this.open(h);
      return;
    }
    this.expandedId.set(this.expandedId() === h.id ? null : h.id);
  }

  protected quickAct(h: CompanionHousehold, action: QuickActionId): void {
    this.expandedId.set(null);
    performQuickAction(this.store, this.alerts, h, action);
  }

  protected navigate(h: CompanionHousehold): void {
    window.open(navigateUrl(h), '_blank', 'noopener');
  }

  protected open(h: CompanionHousehold): void {
    this.store.view.set({ kind: 'household', household_id: h.id });
  }

  protected openPicker(): void {
    this.store.view.set({ kind: 'picker' });
  }

  protected seqOf(h: CompanionHousehold): number {
    return this.stops().findIndex((s) => s.id === h.id) + 1;
  }

  /** Delivery rows wear their delivery state; every other mode wears the knock status. */
  protected chipClass(h: CompanionHousehold): string {
    if (this.store.mode() === 'delivery') {
      if (h.delivery_status === 'delivered') return 'badge badge-success';
      if (h.delivery_status === 'undeliverable') return 'badge badge-warning';
      return 'badge badge-ghost';
    }
    return statusBadgeClass(doorStatus(h));
  }

  protected chipLabel(h: CompanionHousehold): string {
    if (this.store.mode() === 'delivery') {
      if (h.delivery_status === 'delivered') return 'Delivered';
      if (h.delivery_status === 'undeliverable') return "Couldn't deliver";
      return 'Waiting';
    }
    return doorStatusLabel(doorStatus(h));
  }

  protected residents(h: CompanionHousehold): string {
    return residentSummary(h);
  }

  protected lastVisit(h: CompanionHousehold): string | null {
    return lastVisitLabel(h.last_knock, {
      myName: this.store.payload()?.canvasser_name ?? null,
      now: Date.now(),
    });
  }

  protected countFor(filter: ListFilter): number {
    const stops = this.stops();
    if (filter === 'remaining') return stops.filter((h) => !isAttempted(h)).length;
    if (filter === 'visited') return stops.filter(isAttempted).length;
    return stops.length;
  }

  protected progressLine(): string {
    return `${this.attempted()} of ${this.stops().length} stops done on this outing`;
  }

  protected emptyMessage(): string {
    const filter = this.filter();
    switch (filter) {
      case 'remaining':
        return 'Every stop on this outing is done.';
      case 'visited':
        return 'No stops recorded yet. Start with the ringed one.';
      case 'all':
        return 'There are no stops on this outing yet.';
      default: {
        const _exhaustive: never = filter;
        return _exhaustive;
      }
    }
  }

  protected freshness(): string {
    if (this.store.refreshing()) return 'Updating…';
    const at = this.store.lastRefreshedAt();
    if (!at) return 'Tap to update';
    const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
    if (minutes < 1) return 'Updated just now';
    if (minutes === 1) return 'Updated 1 minute ago';
    if (minutes < 60) return `Updated ${minutes} minutes ago`;
    return 'Updated over an hour ago · tap to update';
  }

  protected refreshNow(): void {
    void this.store.refresh();
  }
}
