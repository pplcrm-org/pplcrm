import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { STALE_PING_MS, formatCrewDistance, formatWalkDistance } from '@common';
import { PcMap } from '@uxcommon/components/map/map';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { CanvassingService } from '../services/canvassing-service';

import type { CanvassLive, LiveCanvasser, LiveTurf, LiveWrappedShift, TurfDoor } from '../services/canvassing-service';
import type { PcMapMarker, PcMapPolyline, PcMapVariant } from '@uxcommon/components/map/map-types';

/** 30 s: pings arrive every 60 s, so one poll cycle halves the worst-case lag. */
const POLL_MS = 30_000;

/** Door colours on the street panel — identical to the turf detail page's mapping. */
const DOOR_VARIANT: Record<string, PcMapVariant> = {
  conversation: 'success',
  attempted: 'info',
  not_yet: 'warning',
};

const TURF_PIN_PX = 18;
const CANVASSER_DOT_PX = 28;

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase() || '?';
}

/** "1 min ago" / "18 min ago" / "2 h ago" — factual, never a warning. */
function agoLabel(iso: string | null, asOf: string): string {
  if (!iso) return 'No ping yet';
  const ms = new Date(asOf).getTime() - new Date(iso).getTime();
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** One run of equal tape values, widths in % — the client draws runs, never ticks. */
interface TapeRun {
  knocked: boolean;
  widthPct: number;
}

function tapeRuns(tape: boolean[]): TapeRun[] {
  if (tape.length === 0) return [];
  const runs: TapeRun[] = [];
  let value = tape[0] ?? false;
  let count = 0;
  for (const slot of tape) {
    if (slot === value) {
      count++;
      continue;
    }
    runs.push({ knocked: value, widthPct: (count / tape.length) * 100 });
    value = slot;
    count = 1;
  }
  runs.push({ knocked: value, widthPct: (count / tape.length) * 100 });
  return runs;
}

/**
 * Canvassing → Live: where the crew is right now (admin/owner only — the route to this
 * tab is gated by the page, and the server refuses editors regardless).
 *
 * Deliberately read-only: it reports and links out. The only two actions on the page are
 * "Canvasser record" and "Knocks this shift". Reassignment stays in Turfs & assignments.
 *
 * Polling never changes the selection, the scroll position, or the row order: open rows
 * keep the order they were first seen in, and only closing a shift moves a row (into
 * "Wrapped up today", which is sorted by end time).
 */
@Component({
  selector: 'pc-canvass-live-tab',
  imports: [PcMap, RouterLink],
  templateUrl: './live-tab.html',
})
export class CanvassLiveTab {
  private readonly service = inject(CanvassingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly loaded = this._loading.loaded;

  protected readonly live = signal<CanvassLive | null>(null);
  protected readonly loadFailed = signal(false);
  /** person_id of the followed canvasser; mirrored in ?canvasser= so a link can be shared. */
  protected readonly selectedId = signal<string | null>(null);

  /** Street-panel doors per turf, fetched once per turf and kept for the tab's life. */
  private readonly doorsByTurf = signal<ReadonlyMap<string, TurfDoor[]>>(new Map());
  private readonly fetchingDoors = new Set<string>();

  /** First-seen order for open rows — the freeze that stops polling reordering the board. */
  private readonly rowOrder = new Map<string, number>();
  private nextOrder = 0;
  private defaultSelectionDone = false;

  private readonly queryParams = toSignal(this.route.queryParamMap);

  constructor() {
    void this.load();
    const timer = setInterval(() => {
      if (!document.hidden) void this.load();
    }, POLL_MS);
    // Stop polling while the tab is hidden; refetch immediately on return.
    const onVisibility = (): void => {
      if (!document.hidden) void this.load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    });

    // Fetch the selected canvasser's turf doors for the street panel, once per turf.
    effect(() => {
      const turfId = this.selected()?.turf_id;
      if (turfId) this.ensureDoors(turfId);
    });
  }

  // ------------------------------------------------------------- derived ----

  protected readonly canvassers = computed<LiveCanvasser[]>(() => {
    const rows = this.live()?.canvassers ?? [];
    return [...rows].sort((a, b) => (this.rowOrder.get(a.shift_id) ?? 0) - (this.rowOrder.get(b.shift_id) ?? 0));
  });

  protected readonly wrapped = computed<LiveWrappedShift[]>(() => this.live()?.wrapped ?? []);

  protected readonly selected = computed<LiveCanvasser | null>(() => {
    const id = this.selectedId();
    if (id == null) return null;
    return this.canvassers().find((c) => c.person_id === id) ?? null;
  });

  protected readonly walkingTurfs = computed(() => this.turfsWithStatus('walking'));
  protected readonly pausedTurfs = computed(() => this.turfsWithStatus('paused'));
  protected readonly finishedTurfs = computed(() => this.turfsWithStatus('finished'));
  protected readonly waitingTurfs = computed(() => this.turfsWithStatus('waiting'));

  private turfsWithStatus(status: LiveTurf['status']): LiveTurf[] {
    return (this.live()?.turfs ?? []).filter((t) => t.status === status);
  }

  /** Overview map: one pin per turf coloured by status, canvasser dots above them. */
  protected readonly overviewMarkers = computed<PcMapMarker[]>(() => {
    const live = this.live();
    if (!live) return [];
    const markers: PcMapMarker[] = [];
    for (const turf of live.turfs) {
      if (turf.centroid_lat == null || turf.centroid_lng == null) continue;
      markers.push({
        position: { lat: Number(turf.centroid_lat), lng: Number(turf.centroid_lng) },
        variant: this.turfPinVariant(turf.status),
        size: TURF_PIN_PX,
        tooltip: this.turfTooltip(turf),
        id: `turf-${turf.id}`,
      });
    }
    for (const c of live.canvassers) {
      if (!c.position) continue;
      markers.push({
        position: c.position,
        variant: 'live',
        size: CANVASSER_DOT_PX,
        label: initialsOf(c.name),
        halo: c.person_id === this.selectedId(),
        dimmed: this.isStale(c),
        tooltip: `${c.name} · ${agoLabel(c.last_ping_at, live.as_of)}`,
        id: `canvasser-${c.shift_id}`,
        payload: c,
      });
    }
    return markers;
  });

  /** Street panel: the followed canvasser's doors, path and current position. */
  protected readonly streetMarkers = computed<PcMapMarker[]>(() => {
    const live = this.live();
    const sel = this.selected();
    if (!live || !sel) return [];
    const markers: PcMapMarker[] = (this.doorsByTurf().get(sel.turf_id) ?? [])
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => ({
        position: { lat: Number(d.lat), lng: Number(d.lng) },
        variant: DOOR_VARIANT[d.status] ?? 'warning',
        tooltip: d.address,
      }));
    if (sel.position) {
      markers.push({
        position: sel.position,
        variant: 'live',
        size: CANVASSER_DOT_PX,
        label: initialsOf(sel.name),
        dimmed: this.isStale(sel),
        tooltip: `${sel.name} · ${agoLabel(sel.last_ping_at, live.as_of)}`,
      });
    }
    return markers;
  });

  protected readonly streetPolylines = computed<PcMapPolyline[]>(() => {
    const path = this.selected()?.path;
    if (!path || path.length < 2) return [];
    // Solid on purpose: this line is measured positions, not an estimated order.
    return [{ path, variant: 'live', dashed: false }];
  });

  protected readonly asOf = computed(() => this.live()?.as_of ?? new Date().toISOString());

  /** The newest ping across the crew (open shifts arrive newest-first from the server). */
  protected readonly newestPing = computed<string | null>(() => {
    for (const c of this.canvassers()) {
      if (c.last_ping_at) return c.last_ping_at;
    }
    return null;
  });

  // ------------------------------------------------------------- actions ----

  protected select(personId: string): void {
    this.selectedId.set(personId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { canvasser: personId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ------------------------------------------------------------- helpers ----

  protected isStale(c: LiveCanvasser): boolean {
    const live = this.live();
    if (!live || !c.last_ping_at) return false;
    return new Date(live.as_of).getTime() - new Date(c.last_ping_at).getTime() > STALE_PING_MS;
  }

  protected lastSeenLabel(c: LiveCanvasser): string {
    if (c.location_state === 'off') return 'Location off';
    if (c.precision === 'turf' && c.last_ping_at) return `On this turf · ${agoLabel(c.last_ping_at, this.asOf())}`;
    return agoLabel(c.last_ping_at, this.asOf());
  }

  protected tapeRunsOf(tape: boolean[]): TapeRun[] {
    return tapeRuns(tape);
  }

  protected agoOf(iso: string | null): string {
    return agoLabel(iso, this.asOf());
  }

  protected timeOf(iso: string | null): string {
    return iso ? timeLabel(iso) : '';
  }

  protected distanceOf(meters: number): string {
    return formatWalkDistance(meters);
  }

  protected crewDistanceOf(meters: number): string {
    return formatCrewDistance(meters);
  }

  protected turfNames(turfs: LiveTurf[]): string {
    return turfs.map((t) => t.name).join(', ');
  }

  private turfPinVariant(status: LiveTurf['status']): PcMapVariant {
    switch (status) {
      case 'finished':
        return 'success';
      case 'waiting':
        return 'warning';
      case 'walking':
      case 'paused':
        return 'primary';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  private turfTooltip(turf: LiveTurf): string {
    switch (turf.status) {
      case 'finished':
        return `${turf.name} · every door knocked`;
      case 'walking':
        return `${turf.name} · being walked now`;
      case 'paused':
        return `${turf.name} · knocked today, nobody on it now`;
      case 'waiting':
        return turf.nearest_crew
          ? `${turf.name} · nobody · nearest crew ${formatCrewDistance(turf.nearest_crew.distance_m)}`
          : `${turf.name} · waiting for a canvasser`;
      default: {
        const _exhaustive: never = turf.status;
        return _exhaustive;
      }
    }
  }

  private ensureDoors(turfId: string): void {
    if (this.doorsByTurf().has(turfId) || this.fetchingDoors.has(turfId)) return;
    this.fetchingDoors.add(turfId);
    this.service
      .getTurfDetail(turfId)
      .then((detail) => {
        const next = new Map(this.doorsByTurf());
        next.set(turfId, detail.doors);
        this.doorsByTurf.set(next);
      })
      .catch(() => {
        // The street panel simply shows the path without doors; the next selection retries.
        this.fetchingDoors.delete(turfId);
      });
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      const data = await this.service.getLive();
      // Freeze row order: new shifts append; existing rows keep their first-seen slot.
      for (const c of data.canvassers) {
        if (!this.rowOrder.has(c.shift_id)) this.rowOrder.set(c.shift_id, this.nextOrder++);
      }
      this.live.set(data);
      this.loadFailed.set(false);
      this.applyDefaultSelection(data);
    } catch {
      this.loadFailed.set(true);
    } finally {
      end();
    }
  }

  /** Once, on first load: the shared link's canvasser, else the most recently pinged. */
  private applyDefaultSelection(data: CanvassLive): void {
    if (this.defaultSelectionDone) return;
    this.defaultSelectionDone = true;
    const fromUrl = this.queryParams()?.get('canvasser');
    if (fromUrl && data.canvassers.some((c) => c.person_id === fromUrl)) {
      this.selectedId.set(fromUrl);
      return;
    }
    const first = data.canvassers[0];
    if (first) this.selectedId.set(first.person_id);
  }
}
