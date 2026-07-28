import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { haversineKm, type CompanionTurfChoice, type CompanionTurfChoices } from '@common';
import { Icon } from '@icons/icon';

import { CanvassStore } from './canvass-store';
import { GeoPosition } from './geo-position';

/**
 * Pick which turf to walk.
 *
 * Serves two jobs on purpose: it is where a volunteer lands when they have no turf yet,
 * and the switcher they reach from the walk list. Both answer the same question, so
 * they are the same screen rather than two that drift apart.
 *
 * "Available" only appears when the organizer allows roaming. Turfs someone else is
 * already walking are listed, not hidden — joining one is the group-canvass case.
 */
@Component({
  selector: 'pc-canvass-turf-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="flex flex-col gap-4 p-4">
      <header class="flex items-center gap-2">
        @if (canGoBack()) {
          <button type="button" class="btn btn-ghost btn-circle" aria-label="Back to the walk list" (click)="back()">
            <pc-icon name="chevron-left" [size]="5" />
          </button>
        }
        <div class="flex flex-col gap-0.5">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
            {{ store.payload()?.campaign_name ?? 'Canvassing' }}
          </p>
          <h1 class="text-xl font-bold">Choose a turf</h1>
        </div>
      </header>

      @if (loading()) {
        <progress class="progress w-full"></progress>
      } @else if (choices(); as c) {
        @if (c.mine.length > 0) {
          <section class="flex flex-col gap-2">
            <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">Your turfs</p>
            @for (t of sorted(c.mine); track t.turf_id) {
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left"
                [class.ring-2]="t.turf_id === currentTurfId()"
                [class.ring-primary]="t.turf_id === currentTurfId()"
                [disabled]="busy() !== null"
                (click)="open(t)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ t.name }}</span>
                  <span class="block truncate text-xs text-base-content/70">{{ subtitle(t) }}</span>
                </span>
                @if (t.turf_id === currentTurfId()) {
                  <span class="badge badge-primary badge-sm">Open</span>
                }
              </button>
            }
          </section>
        }

        @if (c.may_roam) {
          <section class="flex flex-col gap-2">
            <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
              Available near you
            </p>
            @for (t of sorted(c.available); track t.turf_id) {
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left"
                [disabled]="busy() !== null"
                (click)="claim(t)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ t.name }}</span>
                  <span class="block truncate text-xs text-base-content/70">{{ subtitle(t) }}</span>
                </span>
                <span class="text-xs font-medium text-primary">
                  {{ busy() === t.turf_id ? 'Starting…' : 'Start' }}
                </span>
              </button>
            } @empty {
              <p class="rounded-lg border border-base-300 bg-base-100 p-4 text-xs text-base-content/70">
                {{ noneAvailableReason(c) }}
              </p>
            }
          </section>
        } @else if (c.mine.length === 0) {
          <div class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-6 text-center">
            <pc-icon name="map-pin" [size]="8" />
            <p class="text-base-content/70">Your organizer hasn't sent you a turf yet.</p>
            <button type="button" class="btn btn-outline btn-secondary" (click)="reload()">Check again</button>
          </div>
        }

        @if (position.state() === 'prompt' && showsDistance(c)) {
          <button type="button" class="btn btn-outline btn-secondary w-full" (click)="position.request()">
            Sort by what's closest
          </button>
        } @else if (position.state() === 'denied') {
          <p class="text-xs text-base-content/60">
            Location is off, so turfs are listed by ward. Turn it on in your browser settings to sort by distance.
          </p>
        }

        @if (error(); as message) {
          <p class="text-xs text-error">{{ message }}</p>
        }
      } @else {
        <div class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-6 text-center">
          <p class="text-base-content/70">Couldn't load your turfs. Check your connection.</p>
          <button type="button" class="btn btn-outline btn-secondary" (click)="reload()">Try again</button>
        </div>
      }
    </div>
  `,
})
export class CanvassTurfPicker {
  protected readonly position = inject(GeoPosition);
  protected readonly store = inject(CanvassStore);

  protected readonly busy = signal<string | null>(null);
  protected readonly choices = signal<CompanionTurfChoices | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);

  protected readonly currentTurfId = computed(() => this.store.payload()?.turf_id ?? null);
  /** Only offer to go back when there is a loaded turf to go back to. */
  protected readonly canGoBack = computed(() => this.store.payload() != null);

  constructor() {
    void this.reload();
  }

  protected back(): void {
    this.store.view.set({ kind: 'list' });
  }

  protected async claim(t: CompanionTurfChoice): Promise<void> {
    if (this.busy()) return;
    this.busy.set(t.turf_id);
    this.error.set(null);
    try {
      const message = await this.store.claimTurf(t.turf_id);
      if (message) this.error.set(message);
    } finally {
      this.busy.set(null);
    }
  }

  protected async open(t: CompanionTurfChoice): Promise<void> {
    if (this.busy()) return;
    if (t.turf_id === this.currentTurfId()) {
      this.store.view.set({ kind: 'list' });
      return;
    }
    this.busy.set(t.turf_id);
    try {
      await this.store.switchTurf(t.turf_id);
    } finally {
      this.busy.set(null);
    }
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.choices.set(await this.store.fetchTurfChoices());
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Distance first when the phone has a fix, otherwise ward then name — and the
   * template says which of the two is in effect rather than leaving the order a mystery.
   */
  protected sorted(list: readonly CompanionTurfChoice[]): CompanionTurfChoice[] {
    const here = this.position.coords();
    const out = [...list];
    if (here) {
      return out.sort((a, b) => (this.distanceKm(a) ?? Infinity) - (this.distanceKm(b) ?? Infinity));
    }
    return out.sort((a, b) => (a.ward ?? '').localeCompare(b.ward ?? '') || a.name.localeCompare(b.name));
  }

  /**
   * "Nothing available" has two very different causes, and saying the wrong one sends
   * the volunteer to the wrong place. Roaming widens reach inside campaigns they
   * already work in, so with no turf at all there is nothing to widen from yet.
   */
  protected noneAvailableReason(c: CompanionTurfChoices): string {
    return c.mine.length === 0
      ? "Your organizer hasn't placed you on a campaign yet. Once they do, you can pick your own turfs here."
      : 'Every other turf in your campaign already has someone on it. Ask your organizer where to help.';
  }

  /** Any turf with a centroid can show a distance, so the prompt is worth offering. */
  protected showsDistance(c: CompanionTurfChoices): boolean {
    return [...c.mine, ...c.available].some((t) => t.centroid_lat != null && t.centroid_lng != null);
  }

  protected subtitle(t: CompanionTurfChoice): string {
    const parts: string[] = [`${t.attempted} of ${t.doors} doors`];
    const km = this.distanceKm(t);
    if (km != null) parts.push(km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`);
    else if (t.ward) parts.push(t.ward);
    if (t.canvassers > 0) {
      parts.push(t.canvassers === 1 ? '1 canvasser here' : `${t.canvassers} canvassers here`);
    }
    return parts.join(' · ');
  }

  private distanceKm(t: CompanionTurfChoice): number | null {
    const here = this.position.coords();
    if (!here || t.centroid_lat == null || t.centroid_lng == null) return null;
    return haversineKm(here, { lat: t.centroid_lat, lng: t.centroid_lng });
  }
}
