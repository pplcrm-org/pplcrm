import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';

import { haversineKm } from '@common';
import { Icon } from '@icons/icon';

import type { CanvassSegment } from './canvass-derive';
import { CanvassStore } from './canvass-store';
import { firstNameOf } from './canvass-ui';
import { GeoPosition } from './geo-position';

/** Anything further away than this is not "the street you are standing on". */
const NEARBY_RADIUS_KM = 0.5;

/**
 * Scope the walk to one street.
 *
 * A plain conditional panel, **never** the focus-based DaisyUI `.dropdown` — that idiom
 * closes on the first touch inside itself in Safari, and this bug has shipped twice
 * (`pplcrm-design-principles` §4).
 *
 * Three groups, in this order on purpose:
 *   1. **All doors** — today's exact behaviour, first, so nothing is ever hidden and the
 *      way back is the most obvious thing on screen.
 *   2. **Nearby** — only once the phone actually has a fix. No fix, no section; no
 *      apologising for a feature the volunteer never asked for.
 *   3. **All streets in this turf** — walk order, because that is the order the turf was
 *      cut in and the only one that means anything on foot.
 */
@Component({
  selector: 'pc-canvass-segment-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="flex flex-col gap-4 rounded-lg border border-base-300 bg-base-100 p-4">
      <header class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Show doors on</p>
          <h2 class="text-base font-semibold">Choose a street</h2>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Close" (click)="closed.emit()">
          <pc-icon name="x-mark" [size]="5" />
        </button>
      </header>

      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
        [class.border-primary]="store.segmentKey() === null"
        [class.border-base-300]="store.segmentKey() !== null"
        (click)="choose(null)"
      >
        <span>
          <span class="block font-medium">All doors</span>
          <span class="block text-xs text-base-content/70">{{ allDoorsSubtitle() }}</span>
        </span>
        @if (store.segmentKey() === null) {
          <span class="badge badge-primary badge-sm">Showing</span>
        }
      </button>

      @if (nearby().length > 0) {
        <section class="flex flex-col gap-2">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Near you</p>
          @for (s of nearby(); track s.key) {
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 rounded-lg border border-base-300 p-3 text-left"
              (click)="choose(s.key)"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ s.street }}</span>
                <span class="block truncate text-xs text-base-content/70">{{ subtitle(s) }}</span>
                @if (whoIsHere(s); as who) {
                  <span class="block truncate text-xs font-medium text-secondary">{{ who }}</span>
                }
              </span>
              <span class="shrink-0 text-xs text-base-content/60">{{ distanceLabel(s) }}</span>
            </button>
          }
        </section>
      } @else if (position.state() === 'prompt' && anyGeocoded()) {
        <button type="button" class="btn btn-outline btn-secondary btn-sm w-full" (click)="position.request()">
          Find the street I'm on
        </button>
      } @else if (position.state() === 'locating') {
        <p class="text-xs text-base-content/60">Looking for your location…</p>
      } @else if (position.state() === 'denied') {
        <p class="text-xs text-base-content/60">
          Location is off, so streets are listed in walk order. Turn it on in your browser settings to see what's
          nearest.
        </p>
      }

      <section class="flex flex-col gap-2">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
          All streets in this turf
        </p>
        @for (s of store.segments(); track s.key) {
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
            [class.border-primary]="store.segmentKey() === s.key"
            [class.border-base-300]="store.segmentKey() !== s.key"
            (click)="choose(s.key)"
          >
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ s.street }}</span>
              <span class="block truncate text-xs text-base-content/70">{{ subtitle(s) }}</span>
              <!-- Advisory, and worded as advice. Never disables the button: two people
                   choosing to work one street together is their call, not the app's. -->
              @if (whoIsHere(s); as who) {
                <span class="block truncate text-xs font-medium text-secondary">{{ who }}</span>
              }
            </span>
            @if (store.segmentKey() === s.key) {
              <span class="badge badge-primary badge-sm shrink-0">Showing</span>
            } @else if (s.key === nextDoorSegmentKey()) {
              <span class="shrink-0 text-xs font-medium text-primary">Your next door</span>
            }
          </button>
        }
      </section>
    </div>
  `,
})
export class CanvassSegmentPicker {
  public readonly closed = output<void>();

  protected readonly position = inject(GeoPosition);
  protected readonly store = inject(CanvassStore);

  /** Suppressed until a fix exists — an empty "Near you" heading answers nothing. */
  protected readonly nearby = computed<CanvassSegment[]>(() => {
    const here = this.position.coords();
    if (!here) return [];
    return this.store
      .segments()
      .filter((s) => s.centroid != null && haversineKm(here, s.centroid) <= NEARBY_RADIUS_KM)
      .sort((a, b) => (this.distanceKm(a) ?? Infinity) - (this.distanceKm(b) ?? Infinity));
  });

  protected readonly anyGeocoded = computed(() => this.store.segments().some((s) => s.centroid != null));

  /** Which street holds the next unattempted door, so narrowing to it is one tap. */
  protected readonly nextDoorSegmentKey = computed(() => {
    const segments = this.store.segments();
    return segments.find((s) => s.attempted < s.doors)?.key ?? null;
  });

  protected allDoorsSubtitle(): string {
    const stats = this.store.stats();
    return `${stats.doors_attempted} of ${stats.doors_total} attempted across the whole turf`;
  }

  protected choose(key: string | null): void {
    this.store.chooseSegment(key);
    this.closed.emit();
  }

  /**
   * "Dana is here" — who else has taken this street.
   *
   * Names, not counts, up to two: at a launch of five people the useful question is which
   * of your friends is over there, and "2 canvassers" answers a different one. Own claims
   * never appear (the store filters them), so this can only ever read as news.
   */
  protected whoIsHere(s: CanvassSegment): string | null {
    const claims = this.store.claimsByStreet().get(s.key);
    if (!claims?.length) return null;
    const names = claims.map((c) => firstNameOf(c.canvasser_name));
    if (names.length === 1) return `${names[0]} is here`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are here`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} more are here`;
  }

  protected distanceLabel(s: CanvassSegment): string {
    const km = this.distanceKm(s);
    if (km == null) return '';
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  }

  protected subtitle(s: CanvassSegment): string {
    return `${s.attempted} of ${s.doors} ${s.doors === 1 ? 'door' : 'doors'} attempted`;
  }

  private distanceKm(s: CanvassSegment): number | null {
    const here = this.position.coords();
    return here && s.centroid ? haversineKm(here, s.centroid) : null;
  }
}
