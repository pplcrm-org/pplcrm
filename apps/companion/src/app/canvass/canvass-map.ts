import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';

import type { CompanionHousehold, LatLng } from '@common';
import { simplifyPath } from '@common';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcMapMarker, PcMapPolyline, PcMapVariant } from '@uxcommon/components/map/map-types';

import {
  doorStatus,
  entryRemaining,
  householdStance,
  isAttempted,
  segmentKeyOf,
  type WalkEntry,
} from './canvass-derive';
import { CanvassSegmentPicker } from './canvass-segment-picker';
import { CanvassStore } from './canvass-store';
import { GeoPosition } from './geo-position';

interface LegendItem {
  label: string;
  dotClass: string;
}

/**
 * Map view (spec §3.3), in two colourings the volunteer can switch between:
 *
 * - **Walk** (the default): visit status. Numbered pins mark the doors still to
 *   walk in the suggested order (up one house-number side, back down the other),
 *   a dashed line runs through what remains of the scoped street, and finished
 *   doors shrink to plain dots. This answers "where do I go next" and "what did
 *   I miss" without reading a single address.
 * - **Results**: the same stance colours the walk-list rows use, so a door that
 *   reads green in the list can never read grey here.
 *
 * `<pc-map>` degrades to an honest placeholder without a Maps key, so this view
 * is safe everywhere. Location is only ever requested from an explicit tap on
 * "Find me on the map" — never on load.
 */
@Component({
  selector: 'pc-canvass-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PcMap, CanvassSegmentPicker],
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

      <div class="flex gap-2" role="group" aria-label="Map view">
        @for (option of modeOptions; track option.id) {
          <button
            type="button"
            class="btn flex-1"
            [class.btn-primary]="store.mapMode() === option.id"
            [class.btn-outline]="store.mapMode() !== option.id"
            [class.btn-secondary]="store.mapMode() !== option.id"
            [attr.aria-pressed]="store.mapMode() === option.id"
            (click)="store.mapMode.set(option.id)"
          >
            {{ option.label }}
          </button>
        }
      </div>

      @if (store.mapMode() === 'walk') {
        @if (remainingCount() > 0) {
          <p class="text-xs">
            <span class="font-semibold">{{ remainingCount() }} of {{ scopeTotal() }} doors left</span>
            on {{ scopeName() }}.
          </p>
        } @else if (scopeTotal() > 0) {
          <div class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
            <p class="font-medium">Every door on {{ scopeName() }} is done.</p>
            @if (store.segments().length > 1) {
              <button type="button" class="btn btn-primary" (click)="pickerOpen.set(!pickerOpen())">
                Pick the next street
              </button>
              @if (pickerOpen()) {
                <pc-canvass-segment-picker (closed)="pickerOpen.set(false)" />
              }
            }
          </div>
        }
      }

      <div class="h-[55vh] overflow-hidden rounded-lg border border-base-300">
        <pc-map
          [markers]="markers()"
          [polylines]="walkPath()"
          [userLocation]="geo.coords()"
          ariaLabel="Turf map"
          (markerClicked)="openMarker($event)"
        ></pc-map>
      </div>

      @if (unmappedCount() > 0) {
        <p class="text-xs text-base-content/60">{{ unmappedMessage() }}</p>
      }

      <div class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-base-300 bg-base-100 p-3">
        @for (item of legend(); track item.label) {
          <div class="flex items-center gap-2 text-xs text-base-content/80">
            <span class="h-3 w-3 shrink-0 rounded-full" [class]="item.dotClass"></span>
            {{ item.label }}
          </div>
        }
      </div>

      @switch (geo.state()) {
        @case ('prompt') {
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-outline btn-primary" (click)="geo.request()">
              Find me on the map
            </button>
            <span class="text-xs text-base-content/60">Only asks for location when tapped.</span>
          </div>
        }
        @case ('locating') {
          <p class="text-xs text-base-content/70">Looking for your location…</p>
        }
        @case ('ready') {
          <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-2 text-xs text-base-content/70">
              <span class="h-3 w-3 shrink-0 rounded-full border-2 border-base-100 bg-info shadow"></span>
              Location on
            </span>
            <button type="button" class="btn btn-outline btn-primary" (click)="centerOnMe()">Center on me</button>
          </div>
        }
        @case ('denied') {
          <p class="text-xs text-base-content/70">
            Location is off. Turn it on in your browser settings to see yourself on the map.
          </p>
        }
      }
    </div>
  `,
})
export class CanvassMap {
  protected readonly store = inject(CanvassStore);
  protected readonly geo = inject(GeoPosition);

  private readonly mapRef = viewChild(PcMap);

  protected readonly pickerOpen = signal(false);
  protected readonly modeOptions: { id: 'walk' | 'results'; label: string }[] = [
    { id: 'walk', label: 'Walk' },
    { id: 'results', label: 'Results' },
  ];

  private readonly walkLegend: LegendItem[] = [
    { label: 'Next door', dotClass: 'bg-primary' },
    { label: 'To walk', dotClass: 'bg-warning' },
    { label: 'Knocked, nobody home', dotClass: 'bg-info' },
    { label: 'Done', dotClass: 'bg-success' },
    { label: 'Do not contact', dotClass: 'bg-error' },
  ];
  private readonly resultsLegend: LegendItem[] = [
    { label: 'Next door', dotClass: 'bg-primary' },
    { label: 'No ID yet', dotClass: 'bg-base-content/40' },
    { label: 'Supporter', dotClass: 'bg-success' },
    { label: 'Undecided or mixed', dotClass: 'bg-warning' },
    { label: 'Not supporting, refused or DNC', dotClass: 'bg-error' },
    { label: 'Canvassed, no stance', dotClass: 'bg-neutral' },
  ];

  protected readonly legend = computed<LegendItem[]>(() =>
    this.store.mapMode() === 'walk' ? this.walkLegend : this.resultsLegend,
  );

  /** Doors, not walk-list rows: "7 of 19 doors left" must count every flat in a building. */
  protected readonly remainingCount = computed(
    () => this.store.scopedHouseholds().filter((h) => !isAttempted(h)).length,
  );
  protected readonly scopeTotal = computed(() => this.store.scopedHouseholds().length);

  protected readonly markers = computed<PcMapMarker[]>(() =>
    this.store.mapMode() === 'walk' ? this.walkMarkers() : this.resultsMarkers(),
  );

  /**
   * The suggested path through what remains of the scoped street, as ONE
   * simplified line: doors on a straight run are skipped, so the line bends
   * only at real turns (approximation is the point — it suggests a direction,
   * it does not trace doorsteps). Drawn only when the scope is a single
   * street; across streets the cut order zig-zags and a line would lie.
   */
  protected readonly walkPath = computed<PcMapPolyline[]>(() => {
    if (this.store.mapMode() !== 'walk') return [];
    const scoped = this.store.scopedHouseholds();
    if (scoped.length === 0 || new Set(scoped.map(segmentKeyOf)).size !== 1) return [];
    const points: LatLng[] = [];
    for (const entry of this.store.walkEntries()) {
      if (!entryRemaining(entry)) continue;
      const position = entryPosition(entry);
      if (position) points.push(position);
    }
    if (points.length < 2) return [];
    return [{ path: simplifyPath(points), variant: 'primary', dashed: true, id: 'walk-path' }];
  });

  private readonly walkMarkers = computed<PcMapMarker[]>(() => {
    const entries = this.store.walkEntries();
    const seqByKey = this.store.walkSeqByKey();
    const nextKey = this.store.nextEntryKey();
    // Pins fit two characters; past 99 rows the numbers drop and the line still shows the order.
    const showNumbers = entries.length <= 99;
    const markers: PcMapMarker[] = [];
    for (const entry of entries) {
      const position = entryPosition(entry);
      if (!position) continue;
      const remaining = entryRemaining(entry);
      const seq = seqByKey.get(entry.key);
      markers.push({
        position,
        id: entry.key,
        tooltip: this.walkTooltip(entry, seq),
        variant: walkVariant(entry, nextKey),
        label: remaining && showNumbers && seq != null ? String(seq) : undefined,
      });
    }
    return markers;
  });

  private readonly resultsMarkers = computed<PcMapMarker[]>(() =>
    this.store
      .scopedHouseholds()
      .filter((h) => h.lat != null && h.lng != null)
      .map(
        (h): PcMapMarker => ({
          // lat/lng narrowed by the filter above; ?? 0 keeps the types honest.
          position: { lat: h.lat ?? 0, lng: h.lng ?? 0 },
          id: h.id,
          tooltip: h.address,
          variant: this.resultsVariant(h),
        }),
      ),
  );

  protected readonly unmappedCount = computed(
    () => this.store.scopedHouseholds().filter((h) => h.lat == null || h.lng == null).length,
  );

  /** The street in view, or the whole turf when nothing narrower is scoped. */
  protected scopeName(): string {
    return this.store.activeSegment()?.street ?? 'this turf';
  }

  protected unmappedMessage(): string {
    const count = this.unmappedCount();
    return count === 1
      ? `1 door isn't on the map yet. Find it in the Turf list.`
      : `${count} doors aren't on the map yet. Find them in the Turf list.`;
  }

  protected centerOnMe(): void {
    const coords = this.geo.coords();
    if (coords) this.mapRef()?.focusOn([coords]);
  }

  protected openMarker(marker: PcMapMarker): void {
    const id = marker.id;
    if (id == null) return;
    if (this.store.mapMode() === 'results') {
      this.store.view.set({ kind: 'household', household_id: id });
      return;
    }
    // Walk-mode ids are walk-list row keys: a household id, or a folded building's key.
    const entry = this.store.walkEntries().find((e) => e.key === id);
    if (!entry) return;
    if (entry.kind === 'building') this.store.view.set({ kind: 'building', building_key: entry.key });
    else this.store.view.set({ kind: 'household', household_id: entry.household.id });
  }

  private walkTooltip(entry: WalkEntry, seq: number | undefined): string {
    const prefix = seq == null ? '' : `${seq} · `;
    if (entry.kind === 'building') {
      return `${prefix}${entry.address} · ${entry.attempted} of ${entry.units.length} units done`;
    }
    return `${prefix}${entry.household.address}`;
  }

  /**
   * Pin colour for the Results view, from the same `householdStance` the walk
   * list colours its rows by — so a door that reads green in the list can never
   * read grey on the map.
   *
   * Stance wins over "not visited yet" wherever there is one: an un-knocked door
   * the CRM already IDs as a supporter is exactly the door this view points at.
   */
  private resultsVariant(h: CompanionHousehold): PcMapVariant {
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

/** Where an entry sits on the map: the door itself, or a building's first located unit. */
function entryPosition(entry: WalkEntry): LatLng | null {
  const households = entry.kind === 'door' ? [entry.household] : entry.units;
  for (const h of households) {
    if (h.lat != null && h.lng != null) return { lat: h.lat, lng: h.lng };
  }
  return null;
}

/**
 * Pin colour for the Walk view: visit status, not politics. The one nuance is
 * `no_answer`, kept visually apart from "done" because a door nobody answered
 * is worth a second try on the way back.
 */
function walkVariant(entry: WalkEntry, nextKey: string | null): PcMapVariant {
  if (entry.key === nextKey) return 'primary';
  if (entry.kind === 'building') {
    return entry.attempted < entry.units.length ? 'warning' : 'success';
  }
  const h = entry.household;
  const status = doorStatus(h);
  if (status === 'dnc') return 'error';
  if (status === 'outcome:no_answer') return 'info';
  return isAttempted(h) ? 'success' : 'warning';
}
