import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal } from '@angular/core';

import { haversineKm } from '@common';
import { Icon } from '@icons/icon';

import type { CanvassSegment } from './canvass-derive';
import { CanvassStore } from './canvass-store';
import { firstNameOf } from './canvass-ui';
import { GeoPosition } from './geo-position';

/**
 * Choose the street to walk.
 *
 * A plain conditional panel, **never** the focus-based DaisyUI `.dropdown` — that idiom
 * closes on the first touch inside itself in Safari, and this bug has shipped twice
 * (`pplcrm-design-principles` §4).
 *
 * There is deliberately no "All doors" option. A turf is a neighbourhood and a shift is a
 * street; a list of 143 addresses spanning nine streets is not something anyone walks in
 * one pass, and offering it as the default made narrowing the volunteer's first job.
 * Nothing is hidden by removing it — every street is here, including the single bucket
 * holding doors with no street on file, and the turf's own total is stated below the list.
 *
 * Order is the answer to "where am I": nearest first once the phone has a fix, walk order
 * otherwise. Both orders are named in the heading, because a list that silently reorders
 * itself when a location arrives is a list you stop trusting.
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
          <h2 class="text-base font-semibold">{{ orderTitle() }}</h2>
        </div>
        <button type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Close" (click)="closed.emit()">
          <pc-icon name="x-mark" [size]="5" />
        </button>
      </header>

      @if (position.state() === 'prompt' && anyGeocoded()) {
        <button type="button" class="btn btn-outline btn-primary btn-sm w-full" (click)="findMe()">
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
        @for (s of ordered(); track s.key) {
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
            <span class="flex shrink-0 flex-col items-end gap-0.5">
              @if (distanceLabel(s); as distance) {
                <span class="text-xs text-base-content/60">{{ distance }}</span>
              }
              @if (store.segmentKey() === s.key) {
                <span class="badge badge-primary badge-sm">Showing</span>
              } @else if (s.key === nextDoorSegmentKey()) {
                <span class="text-xs font-medium text-primary">Your next door</span>
              }
            </span>
          </button>
        }
      </section>

      <p class="text-xs text-base-content/60">{{ turfTotal() }}</p>
    </div>
  `,
})
export class CanvassSegmentPicker {
  public readonly closed = output<void>();

  protected readonly position = inject(GeoPosition);
  protected readonly store = inject(CanvassStore);

  /** Set by "Find the street I'm on" — the one path allowed to move the scope for them. */
  private readonly snapToNearest = signal(false);

  protected readonly anyGeocoded = computed(() => this.store.segments().some((s) => s.centroid != null));

  /**
   * Streets, nearest first when there is a fix.
   *
   * Streets with no geocoded door sort last rather than first: `Infinity` is the honest
   * distance to somewhere we cannot place, and burying it beats claiming it is next door.
   */
  protected readonly ordered = computed<CanvassSegment[]>(() => {
    const segments = this.store.segments();
    if (!this.position.coords()) return segments;
    return [...segments].sort((a, b) => (this.distanceKm(a) ?? Infinity) - (this.distanceKm(b) ?? Infinity));
  });

  /** Which street holds the next unattempted door, so narrowing to it is one tap. */
  protected readonly nextDoorSegmentKey = computed(() => {
    const segments = this.store.segments();
    return segments.find((s) => s.attempted < s.doors)?.key ?? null;
  });

  constructor() {
    // Only ever fires after an explicit tap on "Find the street I'm on" — asking to be put
    // on the street you are standing on is a request, so honouring it is not a surprise.
    // Any other fix that arrives leaves the chosen scope exactly where it is.
    effect(() => {
      const nearest = this.ordered()[0];
      if (!this.snapToNearest() || !nearest || !this.position.coords()) return;
      this.snapToNearest.set(false);
      this.store.chooseSegment(nearest.key);
      this.closed.emit();
    });
  }

  protected choose(key: string): void {
    this.snapToNearest.set(false);
    this.store.chooseSegment(key);
    this.closed.emit();
  }

  protected findMe(): void {
    this.snapToNearest.set(true);
    this.position.request();
  }

  protected orderTitle(): string {
    return this.position.coords() ? 'Streets nearest you' : 'Streets in walk order';
  }

  /** Always states the whole turf, so a street's count can never read as the turf's. */
  protected turfTotal(): string {
    const stats = this.store.stats();
    return `${stats.doors_attempted} of ${stats.doors_total} attempted across the whole turf.`;
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

  protected distanceLabel(s: CanvassSegment): string | null {
    const km = this.distanceKm(s);
    if (km == null) return null;
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
