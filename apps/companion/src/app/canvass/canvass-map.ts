import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import type { CompanionHousehold } from '@common';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcMapMarker, PcMapVariant } from '@uxcommon/components/map/map-types';

import { doorStatus, householdStance } from './canvass-derive';
import { CanvassStore } from './canvass-store';

/**
 * Map view (spec §3.3): every geocoded door as a pin colored by its derived
 * state. `<pc-map>` degrades to an honest placeholder without a Maps key, so
 * this view is safe everywhere. Pins carry "walk order · address" tooltips
 * (the pc-map pin primitive has no in-pin number labels).
 */
@Component({
  selector: 'pc-canvass-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PcMap],
  template: `
    <div class="flex flex-col gap-4 p-4">
      <header class="flex flex-col gap-0.5">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
          {{ store.payload()?.campaign_name }}
        </p>
        <h1 class="text-xl font-bold">{{ store.payload()?.turf_name }} on the map</h1>
        <!-- The map follows the walk list's scope; saying so beats a map that quietly
             shows fewer pins than the volunteer remembers (§2). -->
        @if (store.activeSegment(); as segment) {
          <p class="text-xs text-base-content/70">
            Showing {{ segment.street }} · {{ segment.doors }} of {{ store.stats().doors_total }} doors in this turf
          </p>
        }
      </header>

      <div class="h-[55vh] overflow-hidden rounded-lg border border-base-300">
        <pc-map [markers]="markers()" ariaLabel="Turf map" (markerClicked)="openMarker($event)"></pc-map>
      </div>

      @if (unmappedCount() > 0) {
        <p class="text-xs text-base-content/60">{{ unmappedMessage() }}</p>
      }

      <div class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-base-300 bg-base-100 p-3">
        @for (item of legend; track item.label) {
          <div class="flex items-center gap-2 text-xs text-base-content/80">
            <span class="h-3 w-3 shrink-0 rounded-full" [class]="item.dotClass"></span>
            {{ item.label }}
          </div>
        }
      </div>
    </div>
  `,
})
export class CanvassMap {
  protected readonly store = inject(CanvassStore);

  protected readonly legend: { label: string; dotClass: string }[] = [
    { label: 'Next door', dotClass: 'bg-primary' },
    { label: 'No ID yet', dotClass: 'bg-base-content/40' },
    { label: 'Supporter', dotClass: 'bg-success' },
    { label: 'Undecided or mixed', dotClass: 'bg-warning' },
    { label: 'Not supporting, refused or DNC', dotClass: 'bg-error' },
    { label: 'Canvassed, no stance', dotClass: 'bg-neutral' },
  ];

  protected readonly markers = computed<PcMapMarker[]>(() =>
    this.store
      .scopedHouseholds()
      .filter((h) => h.lat != null && h.lng != null)
      .map(
        (h): PcMapMarker => ({
          // lat/lng narrowed by the filter above; ?? 0 keeps the types honest.
          position: { lat: h.lat ?? 0, lng: h.lng ?? 0 },
          id: h.id,
          tooltip: `${h.walk_order} · ${h.address}`,
          variant: this.variantFor(h),
        }),
      ),
  );

  protected readonly unmappedCount = computed(
    () => this.store.scopedHouseholds().filter((h) => h.lat == null || h.lng == null).length,
  );

  protected unmappedMessage(): string {
    const count = this.unmappedCount();
    return count === 1
      ? `1 door isn't on the map yet. Find it in the Turf list.`
      : `${count} doors aren't on the map yet. Find them in the Turf list.`;
  }

  protected openMarker(marker: PcMapMarker): void {
    if (marker.id != null) this.store.view.set({ kind: 'household', household_id: marker.id });
  }

  /**
   * Pin colour, from the same `householdStance` the walk list colours its rows by — so a
   * door that reads green in the list can never read grey on the map.
   *
   * Stance wins over "not visited yet" wherever there is one: an un-knocked door the CRM
   * already IDs as a supporter is exactly the door this map exists to point at.
   */
  private variantFor(h: CompanionHousehold): PcMapVariant {
    if (h.id === this.store.nextDoorId()) return 'primary';
    if (h.dnc) return 'error';
    const status = doorStatus(h);
    if (status === 'dnc' || status === 'outcome:refused') return 'error';
    switch (householdStance(h)) {
      case 'supporter':
        return 'success';
      case 'non_supporter':
        return 'error';
      case 'undecided':
      case 'mixed':
        return 'warning';
      case null:
        return status === 'canvassed' ? 'neutral' : 'muted';
      default:
        return 'muted';
    }
  }
}
