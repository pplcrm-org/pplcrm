import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Loader } from '@googlemaps/js-api-loader';
import { Icon } from '../icons/icon';
import type { PcLatLng, PcMapMarker, PcMapPolygon, PcMapPolygonEdit, PcMapPolyline, PcMapVariant } from './map-types';

/** The zoom used when a host passes `center` without a `zoom`. Exported so a host that passes `zoom` conditionally can fall back to the same value. */
export const PC_MAP_DEFAULT_ZOOM = 14;
const DEFAULT_MAP_ID = 'DEMO_MAP_ID';
const FILL_OPACITY = 0.18;
const SELECTED_FILL_OPACITY = 0.32;
const MUTED_OPACITY = 0.55;
const PIN_PX = 14;
const LABELLED_PIN_PX = 22;

const DASHED_STROKE_WEIGHT = 1.5;
const DASHED_STROKE_OPACITY = 0.6;
const SOLID_STROKE_WEIGHT = 2;
const SOLID_STROKE_OPACITY = 0.9;
const SELECTED_STROKE_WEIGHT = 4;

/**
 * How close, in screen pixels, a newly placed vertex has to land to a vertex
 * that is already on the map before it snaps onto that vertex exactly.
 *
 * This is what lets two neighbouring areas share an edge. Without it every
 * hand-drawn pair leaves slivers of gap and overlap along the line they are
 * meant to share, because nobody clicks the same pixel twice.
 */
export const VERTEX_SNAP_TOLERANCE_PX = 12;

/** The fewest vertices that make an area rather than a line. */
const MIN_POLYGON_VERTICES = 3;
/** Web Mercator: the whole world is 256 · 2^zoom pixels wide and covers 360° of longitude. */
const WORLD_TILE_SIZE_PX = 256;
const FULL_TURN_DEGREES = 360;
const DEGREES_TO_RADIANS = Math.PI / 180;
/** Keeps the 1/cos(latitude) Mercator stretch finite near the poles. */
const MIN_LATITUDE_COSINE = 0.01;

const DRAFT_VERTEX_PX = 9;
const DRAFT_FIRST_VERTEX_PX = 14;
const DRAFT_FIRST_VERTEX_TOOLTIP = 'Click here to close the shape';

/**
 * The snap tolerance converted from screen pixels into degrees of longitude at
 * the given zoom. Pure arithmetic — no SDK, no map instance.
 */
export function snapToleranceInDegrees(zoom: number): number {
  return (VERTEX_SNAP_TOLERANCE_PX * FULL_TURN_DEGREES) / (WORLD_TILE_SIZE_PX * 2 ** zoom);
}

/**
 * Distance between two points measured the way the screen shows it, in units of
 * degrees of longitude. Mercator stretches latitude by 1/cos(latitude), so a
 * degree of latitude covers more pixels than a degree of longitude everywhere
 * except the equator; without that correction a tolerance in pixels would be
 * far too generous north-south in Canada and the northern United States.
 */
function screenDistanceInDegrees(a: PcLatLng, b: PcLatLng): number {
  const midLatitude = (a.lat + b.lat) / 2;
  const stretch = 1 / Math.max(Math.cos(midLatitude * DEGREES_TO_RADIANS), MIN_LATITUDE_COSINE);
  return Math.hypot(b.lng - a.lng, (b.lat - a.lat) * stretch);
}

/**
 * Return the candidate vertex nearest `point` when one lies within
 * `toleranceDegrees`, otherwise `point` unchanged. Ties go to the first
 * candidate, so the same click always produces the same vertex.
 */
export function snapVertexToNearby(
  point: PcLatLng,
  candidates: readonly PcLatLng[],
  toleranceDegrees: number,
): PcLatLng {
  let nearest: PcLatLng | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = screenDistanceInDegrees(point, candidate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }
  if (nearest === null || nearestDistance > toleranceDegrees) return point;
  return { lat: nearest.lat, lng: nearest.lng };
}

/** The outcome of one click while a shape is being drawn. */
export interface PcMapDraftAdvance {
  /** The vertex ring after the click. When `closed` is true this is the finished shape. */
  path: PcLatLng[];
  /** True when the click landed on the first vertex and closed the ring. */
  closed: boolean;
}

/**
 * Apply one click to the shape in progress. Pure: no SDK, no map, no side
 * effects, so the drawing rules can be tested on their own.
 *
 * - Clicking the first vertex once there are at least three closes the shape.
 * - Any other click adds a vertex, snapped to a nearby existing vertex when one
 *   is within tolerance.
 * - The vertex placed immediately before is never a snap candidate; snapping
 *   onto it would add an edge of zero length.
 * - While the draft has fewer than three vertices, nothing at the first
 *   vertex's position is a snap candidate either (not the first vertex itself,
 *   and not a saved vertex sharing its exact position). Snapping there would
 *   build `[first, second, first]`, and one more click near the first vertex
 *   would then "close" a ring with zero area that passes every ≥3 check.
 */
export function advanceDraftPath(
  draft: readonly PcLatLng[],
  point: PcLatLng,
  existingVertices: readonly PcLatLng[],
  toleranceDegrees: number,
): PcMapDraftAdvance {
  const first = draft[0];
  if (first !== undefined && draft.length >= MIN_POLYGON_VERTICES) {
    if (screenDistanceInDegrees(point, first) <= toleranceDegrees) {
      return { path: [...draft], closed: true };
    }
  }
  const excluded = first !== undefined && draft.length < MIN_POLYGON_VERTICES ? first : null;
  const candidates = [...existingVertices, ...draft.slice(0, -1)].filter(
    (candidate) => excluded === null || candidate.lat !== excluded.lat || candidate.lng !== excluded.lng,
  );
  return { path: [...draft, snapVertexToNearby(point, candidates, toleranceDegrees)], closed: false };
}

/**
 * The ring with the vertex at `index` removed, or `null` when the removal is
 * refused: an index outside the ring, or a ring already at the three-vertex
 * minimum, where removing one would turn the area into a line.
 *
 * This rule exists because Google Maps has no built-in remove-a-vertex gesture
 * (its own delete-vertex sample wires the menu by hand). `<pc-map>` implements
 * removal itself on vertex right-click; the guard is kept pure so it can be
 * tested without the SDK.
 */
export function removeRingVertex(ring: readonly PcLatLng[], index: number): PcLatLng[] | null {
  if (ring.length <= MIN_POLYGON_VERTICES) return null;
  if (!Number.isInteger(index) || index < 0 || index >= ring.length) return null;
  return [...ring.slice(0, index), ...ring.slice(index + 1)];
}

/**
 * Whether a polygon offers edit handles (and body dragging) in drawing mode.
 *
 * - Never outside drawing mode.
 * - Never without an `id`: `polygonEdited` reports edits by id, so an id-less
 *   shape (the boundaries page's not-yet-saved preview) cannot report its
 *   edits. Handles on it would accept changes that are silently thrown away.
 * - Never when the host set `editable: false` (a shape too detailed to reshape
 *   on the map).
 */
export function polygonEditability(drawing: boolean, poly: Pick<PcMapPolygon, 'editable' | 'id'>): boolean {
  return drawing && poly.id !== undefined && poly.editable !== false;
}

/**
 * Read a live Google polygon's vertex ring back out as plain pairs. The one
 * place an SDK value crosses into the component's own vocabulary; nothing that
 * leaves this component carries an SDK type.
 */
function readPolygonPath(shape: google.maps.Polygon): PcLatLng[] {
  const ring: PcLatLng[] = [];
  shape.getPath().forEach((vertex) => ring.push({ lat: vertex.lat(), lng: vertex.lng() }));
  return ring;
}

/**
 * `<pc-map>` — the single Google Maps primitive for the whole app (§13 maps
 * ruling: Google Maps Platform only, no mixed providers).
 *
 * - **Real browser + a provided `Loader`** → lazy-loads the `maps` + `marker`
 *   libraries and draws markers/polygons tinted by DaisyUI semantic tokens.
 * - **No `Loader` (unit tests) / offline / a load failure** → renders a
 *   deterministic placeholder (a pin icon + label) and never touches the
 *   network. This mirrors the geocoding mock's degrade-don't-crash approach, so
 *   the app never crashes and never fakes a pin.
 *
 * ## Drawing mode
 *
 * `drawingEnabled` is off by default, so nothing about an existing `<pc-map>`
 * changes. Turned on, the map lets someone trace areas onto it:
 *
 * - Clicking the map places a vertex. A vertex placed near one that is already
 *   on the map snaps onto it exactly (see `VERTEX_SNAP_TOLERANCE_PX`), which is
 *   how two neighbouring areas come to share an edge.
 * - Clicking the first vertex again, or calling `finishDrawing()`, closes the
 *   shape and emits `polygonDrawn`.
 * - Identified saved polygons become editable and draggable, so their vertices
 *   can be moved; each change emits `polygonEdited`. A polygon without an `id`,
 *   or with `editable: false`, stays view-only (see `polygonEditability`).
 * - Right-clicking a vertex of an editable polygon removes that vertex — the
 *   component removes it itself, because Google Maps has no built-in gesture
 *   for this. Removal is refused at three vertices (see `removeRingVertex`).
 * - Right-clicking the body of an identified saved polygon emits
 *   `polygonDeleted` with its id (view-only shapes included: a shape too
 *   detailed to reshape can still be deleted).
 * - In drawing mode a click places a vertex wherever it lands, including on a
 *   saved shape or a marker — shapes and pins do not intercept it. Clicking a
 *   saved polygon emits `polygonSelected` only when drawing mode is off.
 *
 * Every drawing output carries plain `PcLatLng` values and ids, never a Google
 * SDK object, so a host can hold and post the result without loading the SDK.
 *
 * See `docs/spec/pc-map-usage.md` for the consumption patterns and the binding
 * input/output contract.
 */
@Component({
  selector: 'pc-map',
  imports: [Icon],
  template: `
    @if (ready()) {
      <div #mapHost data-testid="map-canvas" class="h-full w-full min-h-40"></div>
    } @else {
      <div
        class="flex h-full w-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-base-200 text-base-content/40 select-none"
        role="img"
        [attr.aria-label]="ariaLabel()"
      >
        <pc-icon name="map-pin" [size]="8" class="text-base-content/25"></pc-icon>
        <span class="text-xs font-medium text-base-content/50">{{ placeholderLabel() }}</span>
      </div>
    }
  `,
})
export class PcMap {
  /** Optional so unit tests (and any host without the SDK key) fall back to the placeholder. */
  private readonly loader = inject(Loader, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  public readonly markers = input<PcMapMarker[]>([]);
  public readonly polygons = input<PcMapPolygon[]>([]);
  public readonly polylines = input<PcMapPolyline[]>([]);
  public readonly center = input<PcLatLng | null>(null);
  public readonly zoom = input<number>(PC_MAP_DEFAULT_ZOOM);
  public readonly fitBounds = input<boolean>(true);
  public readonly interactive = input<boolean>(true);
  public readonly deepLink = input<boolean>(false);
  public readonly mapId = input<string>(DEFAULT_MAP_ID);
  public readonly ariaLabel = input<string>('Map');
  /** Off by default. On, the map accepts traced areas — see the class comment. */
  public readonly drawingEnabled = input<boolean>(false);
  /** The id of the polygon currently selected; it draws with a heavier stroke and a stronger fill. */
  public readonly selectedPolygonId = input<string | null>(null);

  public readonly markerClicked = output<PcMapMarker>();
  public readonly polygonClicked = output<PcMapPolygon>();
  /** A newly traced area, as its vertex ring. The ring is not repeated at the end. */
  public readonly polygonDrawn = output<PcLatLng[]>();
  /** A saved polygon whose shape changed: a vertex moved, added or removed, or the shape dragged. */
  public readonly polygonEdited = output<PcMapPolygonEdit>();
  /** The id of a saved polygon the user asked to delete by right-clicking its body. */
  public readonly polygonDeleted = output<string>();
  /** The id of a saved polygon the user clicked. */
  public readonly polygonSelected = output<string>();

  protected readonly ready = signal(false);

  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');

  private map: google.maps.Map | null = null;
  private drawnMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
  private drawnPolygons: google.maps.Polygon[] = [];
  private drawnPolylines: google.maps.Polyline[] = [];
  private themeObserver: MutationObserver | null = null;

  /** The vertices of the shape being traced right now. Empty when nothing is in progress. */
  private readonly draft = signal<PcLatLng[]>([]);
  private draftLine: google.maps.Polyline | null = null;
  private draftVertices: google.maps.marker.AdvancedMarkerElement[] = [];

  /** How many vertices the shape in progress has. A host's undo/cancel buttons read this. */
  public readonly draftVertexCount = computed(() => this.draft().length);
  /** True once the shape in progress has enough vertices to be an area. */
  public readonly canFinishDrawing = computed(() => this.draft().length >= MIN_POLYGON_VERTICES);

  protected readonly placeholderLabel = signal('Map unavailable');

  constructor() {
    // Kick off the SDK load once. If there is no Loader we stay a placeholder.
    void this.tryLoad();

    // Redraw whenever inputs change and the map is live.
    effect(() => {
      const markers = this.markers();
      const polygons = this.polygons();
      const polylines = this.polylines();
      const drawing = this.drawingEnabled();
      const selectedId = this.selectedPolygonId();
      // Recompute the placeholder caption from current content.
      this.placeholderLabel.set(this.computePlaceholderLabel(markers, polygons));
      if (this.map) {
        this.redraw(markers, polygons, polylines, drawing, selectedId);
      }
    });

    // Leaving drawing mode abandons whatever was half-traced. Read through
    // `untracked` so this effect stays driven by the mode, not by every vertex.
    effect(() => {
      if (this.drawingEnabled()) return;
      untracked(() => {
        if (this.draft().length > 0) this.draft.set([]);
      });
    });

    // The shape in progress redraws on its own so that placing a vertex does
    // not tear down and rebuild every saved polygon.
    effect(() => {
      const draft = this.draft();
      if (this.map) this.redrawDraft(draft);
    });

    // Once the host element materialises (after `ready` flips), build the map.
    effect(() => {
      const host = this.mapHost();
      if (host && !this.map) {
        this.buildMap(host.nativeElement);
      }
    });

    // Without this, a destroyed map stays fully reachable: the theme observer's
    // callback closes over the component, which holds the map, its overlays and
    // their listeners, and every theme flip redraws them all off-screen.
    this.destroyRef.onDestroy(() => this.teardown());
  }

  /**
   * Release everything the live map created. Safe in placeholder mode: when the
   * SDK never loaded there is no observer, no map and no overlays, and no
   * `google.*` symbol is touched.
   */
  private teardown(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    if (!this.map) return;
    for (const shape of this.drawnPolygons) google.maps.event.clearInstanceListeners(shape);
    this.clearOverlays();
    this.clearDraft();
    google.maps.event.clearInstanceListeners(this.map);
    this.map = null;
  }

  /**
   * Close the shape in progress and emit it. Does nothing while it is still a
   * line rather than an area, so a host can wire this to a button and read
   * `canFinishDrawing()` to decide whether the button is offered. Returns
   * whether the shape was closed, so a host's keyboard handler can consume the
   * key exactly when the call acted.
   */
  public finishDrawing(): boolean {
    const path = this.draft();
    if (path.length < MIN_POLYGON_VERTICES) return false;
    this.draft.set([]);
    this.polygonDrawn.emit(path);
    return true;
  }

  /** Throw away the shape in progress without emitting anything. Returns whether there was one. */
  public cancelDrawing(): boolean {
    if (this.draft().length === 0) return false;
    this.draft.set([]);
    return true;
  }

  /** Remove the most recently placed vertex from the shape in progress. */
  public undoLastVertex(): void {
    if (this.draft().length === 0) return;
    this.draft.update((path) => path.slice(0, -1));
  }

  private async tryLoad(): Promise<void> {
    if (!this.loader) return;
    try {
      await this.loader.importLibrary('maps');
      await this.loader.importLibrary('marker');
      this.ready.set(true);
    } catch {
      // Bad key / offline / blocked — stay on the honest placeholder.
      this.ready.set(false);
    }
  }

  private buildMap(hostEl: HTMLElement): void {
    try {
      const explicitCenter = this.center();
      this.map = new google.maps.Map(hostEl, {
        center: explicitCenter ?? { lat: 0, lng: 0 },
        zoom: this.zoom(),
        mapId: this.mapId(),
        disableDefaultUI: !this.interactive(),
        gestureHandling: this.interactive() ? 'greedy' : 'none',
        scrollwheel: false, // §13.3 — keep the page scrolling
        streetViewControl: false,
        mapTypeControl: false,
        keyboardShortcuts: this.interactive(),
      });

      this.map.addListener('click', (event: google.maps.MapMouseEvent) => this.onMapClick(event));
      if (this.deepLink()) hostEl.style.cursor = 'pointer';

      this.observeTheme();
      this.redraw(this.markers(), this.polygons(), this.polylines(), this.drawingEnabled(), this.selectedPolygonId());
      this.redrawDraft(this.draft());
    } catch {
      // A partial/broken SDK (or an offline draw failure) degrades to the
      // honest placeholder rather than crashing the host page.
      this.map = null;
      this.ready.set(false);
    }
  }

  private redraw(
    markers: PcMapMarker[],
    polygons: PcMapPolygon[],
    polylines: PcMapPolyline[],
    drawing: boolean,
    selectedId: string | null,
  ): void {
    if (!this.map) return;
    this.clearOverlays();
    // A crosshair says the next click places a vertex rather than pans.
    this.map.setOptions({ draggableCursor: drawing ? 'crosshair' : null });

    for (const poly of polygons) {
      this.drawPolygon(poly, drawing, selectedId);
    }
    for (const line of polylines) {
      this.drawPolyline(line);
    }
    for (const marker of markers) {
      this.drawMarker(marker, drawing);
    }

    if (!this.center()) {
      this.fitToContent(markers, polygons, polylines);
    }
  }

  private drawMarker(marker: PcMapMarker, drawing: boolean): void {
    if (!this.map) return;
    const color = this.resolveColor(marker.variant ?? 'primary');
    const label = marker.label;
    const pin = document.createElement('div');
    const size = label ? LABELLED_PIN_PX : PIN_PX;
    pin.style.width = `${size}px`;
    pin.style.height = `${size}px`;
    pin.style.borderRadius = '9999px';
    pin.style.background = color;
    pin.style.border = '2px solid var(--color-base-100, #fff)';
    pin.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
    if (label) {
      // A numbered pin reads the visit order straight off the map.
      pin.textContent = label;
      pin.style.display = 'flex';
      pin.style.alignItems = 'center';
      pin.style.justifyContent = 'center';
      pin.style.color = 'var(--color-base-100, #fff)';
      pin.style.fontFamily = 'inherit';
      pin.style.fontSize = '11px';
      pin.style.fontWeight = '700';
      pin.style.lineHeight = '1';
    }
    if (marker.tooltip) pin.title = marker.tooltip;

    const advanced = new google.maps.marker.AdvancedMarkerElement({
      map: this.map,
      position: marker.position,
      content: pin,
      title: marker.tooltip ?? '',
      // In drawing mode pins are context, not targets: an interactive pin
      // swallows the click that should place a vertex at that exact spot. Made
      // inert for the whole of drawing mode, so a vertex can land on a pin.
      gmpClickable: !drawing,
    });
    advanced.addListener('gmp-click', () => {
      this.markerClicked.emit(marker);
      if (this.deepLink()) this.openInMapsApp(marker.position);
    });
    this.drawnMarkers.push(advanced);
  }

  private drawPolygon(poly: PcMapPolygon, drawing: boolean, selectedId: string | null): void {
    if (!this.map) return;
    const color = this.resolveColor(poly.variant ?? 'neutral');
    const id = poly.id;
    const isSelected = id !== undefined && id === selectedId;
    const editable = polygonEditability(drawing, poly);
    const shape = new google.maps.Polygon({
      map: this.map,
      paths: poly.path,
      strokeColor: color,
      // Polygons can't render a dashed outline (that's a Polyline feature); a
      // dashed turf uses a thinner, lower-opacity solid stroke for now.
      // TODO(Wave 2F turf boundaries): overlay a dashed Polyline for `poly.dashed`.
      strokeWeight: this.polygonStrokeWeight(poly.dashed === true, isSelected),
      strokeOpacity: poly.dashed ? DASHED_STROKE_OPACITY : SOLID_STROKE_OPACITY,
      fillColor: color,
      fillOpacity: isSelected ? SELECTED_FILL_OPACITY : FILL_OPACITY,
      // Stays clickable in every mode so the right-click gestures below keep
      // working; what a *left* click means is decided per mode in the listener.
      clickable: true,
      editable,
      draggable: editable,
    });
    shape.addListener('click', (event: google.maps.PolyMouseEvent) => {
      // The state boundary is drawing mode itself. A clickable polygon swallows
      // map clicks, so while drawing is on, a click that lands on a saved shape
      // is forwarded to vertex placement — otherwise no vertex could ever be
      // placed inside or against an existing area, and the click would instead
      // select the shape and overwrite the host's open side panel. Click-to-
      // select is therefore a browse-mode gesture; in drawing mode a host's
      // area list does the selecting.
      if (this.drawingEnabled()) {
        this.placeDraftVertex(event.latLng);
        return;
      }
      this.polygonClicked.emit(poly);
      if (id !== undefined) this.polygonSelected.emit(id);
    });
    if (editable && id !== undefined) this.watchPolygonEdits(shape, id);
    if (drawing && id !== undefined) {
      shape.addListener('rightclick', (event: google.maps.PolyMouseEvent) => {
        // Google Maps has no built-in remove-a-vertex gesture (its own sample
        // implements deletion by hand), so right-clicking a vertex removes it
        // here. `removeAt` fires the path's `remove_at` listener, which reports
        // the new ring through `polygonEdited` like any other edit.
        if (event.vertex !== undefined) {
          this.removeVertexAt(shape, event.vertex);
          return;
        }
        // A midpoint (edge) handle is not a vertex and not the body; ignore it.
        if (event.edge !== undefined) return;
        this.polygonDeleted.emit(id);
      });
    }
    this.drawnPolygons.push(shape);
  }

  /**
   * Remove one vertex from a live polygon, refusing below the three-vertex
   * minimum so a right-click can never turn an area into a line. The pure rule
   * lives in {@link removeRingVertex}; this applies it to the SDK object.
   */
  private removeVertexAt(shape: google.maps.Polygon, vertexIndex: number): void {
    if (removeRingVertex(readPolygonPath(shape), vertexIndex) === null) return;
    shape.getPath().removeAt(vertexIndex);
  }

  private polygonStrokeWeight(dashed: boolean, isSelected: boolean): number {
    if (isSelected) return SELECTED_STROKE_WEIGHT;
    return dashed ? DASHED_STROKE_WEIGHT : SOLID_STROKE_WEIGHT;
  }

  /**
   * Report every shape change on an editable polygon back to the host as plain
   * coordinates. Google mutates the polygon's own path in place, so the four
   * events below are the only notice that the saved shape and what is on screen
   * have diverged.
   */
  private watchPolygonEdits(shape: google.maps.Polygon, id: string): void {
    const emit = (): void => this.polygonEdited.emit({ id, path: readPolygonPath(shape) });
    const path = shape.getPath();
    path.addListener('set_at', emit);
    path.addListener('insert_at', emit);
    path.addListener('remove_at', emit);
    shape.addListener('dragend', emit);
  }

  /**
   * One click on the map. Drawing mode owns the click; otherwise the deep-link
   * behaviour is exactly what it was before drawing existed.
   */
  private onMapClick(event: google.maps.MapMouseEvent): void {
    if (this.drawingEnabled()) {
      this.placeDraftVertex(event.latLng);
      return;
    }
    if (this.deepLink()) this.openInMapsApp();
  }

  private placeDraftVertex(latLng: google.maps.LatLng | null): void {
    if (!latLng || !this.map) return;
    const point: PcLatLng = { lat: latLng.lat(), lng: latLng.lng() };
    const tolerance = snapToleranceInDegrees(this.map.getZoom() ?? this.zoom());
    const existingVertices = this.polygons().flatMap((polygon) => polygon.path);
    const advance = advanceDraftPath(this.draft(), point, existingVertices, tolerance);
    if (advance.closed) {
      this.draft.set([]);
      this.polygonDrawn.emit(advance.path);
      return;
    }
    this.draft.set(advance.path);
  }

  /**
   * Draw the shape in progress: the edges placed so far, plus a dot on every
   * vertex. The first dot is larger and labelled, because clicking it is how the
   * shape closes and a hidden affordance would be no affordance at all.
   */
  private redrawDraft(draft: PcLatLng[]): void {
    if (!this.map) return;
    this.clearDraft();
    if (draft.length === 0) return;
    const color = this.resolveColor('primary');
    this.draftLine = new google.maps.Polyline({
      map: this.map,
      path: draft,
      strokeColor: color,
      strokeWeight: SOLID_STROKE_WEIGHT,
      strokeOpacity: SOLID_STROKE_OPACITY,
      clickable: false,
    });
    draft.forEach((point, index) => this.drawDraftVertex(point, color, index === 0));
  }

  private drawDraftVertex(point: PcLatLng, color: string, isFirst: boolean): void {
    if (!this.map) return;
    const size = isFirst ? DRAFT_FIRST_VERTEX_PX : DRAFT_VERTEX_PX;
    const dot = document.createElement('div');
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.borderRadius = '9999px';
    dot.style.background = isFirst ? color : 'var(--color-base-100, #fff)';
    dot.style.border = `2px solid ${color}`;
    dot.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
    if (isFirst) dot.title = DRAFT_FIRST_VERTEX_TOOLTIP;

    const handle = new google.maps.marker.AdvancedMarkerElement({
      map: this.map,
      position: point,
      content: dot,
      title: isFirst ? DRAFT_FIRST_VERTEX_TOOLTIP : '',
      gmpClickable: isFirst,
    });
    if (isFirst) {
      // The marker swallows the click, so the map's own close-by-proximity
      // check never sees it — close the shape here instead.
      handle.addListener('gmp-click', () => this.finishDrawing());
    }
    this.draftVertices.push(handle);
  }

  private clearDraft(): void {
    this.draftLine?.setMap(null);
    this.draftLine = null;
    for (const handle of this.draftVertices) handle.map = null;
    this.draftVertices = [];
  }

  /**
   * An open path (a route's visit order). Dashed by default: the stroke is a
   * dotted symbol run, not a solid line, because the order is ours but the roads
   * are Google's — a solid line would imply a driving path we didn't compute.
   */
  private drawPolyline(line: PcMapPolyline): void {
    if (!this.map) return;
    const color = this.resolveColor(line.variant ?? 'primary');
    const dashed = line.dashed ?? true;
    const shape = new google.maps.Polyline({
      map: this.map,
      path: line.path,
      strokeColor: color,
      strokeWeight: dashed ? 0 : 3,
      strokeOpacity: dashed ? 0 : 0.9,
      clickable: false,
      icons: dashed
        ? [
            {
              icon: { path: 'M 0,-1 0,1', strokeColor: color, strokeOpacity: 0.9, strokeWeight: 3, scale: 1 },
              offset: '0',
              repeat: '10px',
            },
          ]
        : undefined,
    });
    this.drawnPolylines.push(shape);
  }

  private fitToContent(markers: PcMapMarker[], polygons: PcMapPolygon[], polylines: PcMapPolyline[]): void {
    if (!this.map || !this.fitBounds()) return;
    const bounds = new google.maps.LatLngBounds();
    let has = false;
    for (const m of markers) {
      bounds.extend(m.position);
      has = true;
    }
    for (const p of polygons) {
      for (const pt of p.path) {
        bounds.extend(pt);
        has = true;
      }
    }
    for (const l of polylines) {
      for (const pt of l.path) {
        bounds.extend(pt);
        has = true;
      }
    }
    if (!has) return;
    const soleMarker = markers.length === 1 && polygons.length === 0 && polylines.length === 0 ? markers[0] : undefined;
    if (soleMarker) {
      // A single door reads better centred at a street zoom than fit-to-point.
      this.map.setCenter(soleMarker.position);
      this.map.setZoom(this.zoom());
      return;
    }
    this.map.fitBounds(bounds);
  }

  private clearOverlays(): void {
    for (const m of this.drawnMarkers) m.map = null;
    for (const p of this.drawnPolygons) p.setMap(null);
    for (const l of this.drawnPolylines) l.setMap(null);
    this.drawnMarkers = [];
    this.drawnPolygons = [];
    this.drawnPolylines = [];
  }

  private observeTheme(): void {
    if (this.themeObserver || typeof MutationObserver === 'undefined') return;
    this.themeObserver = new MutationObserver(() => {
      this.redraw(this.markers(), this.polygons(), this.polylines(), this.drawingEnabled(), this.selectedPolygonId());
      this.redrawDraft(this.draft());
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  private openInMapsApp(position?: PcLatLng): void {
    const target = position ?? this.center() ?? this.markers()[0]?.position;
    if (!target) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${target.lat},${target.lng}`;
    window.open(url, '_blank', 'noopener');
  }

  /**
   * Resolve a semantic variant to a concrete CSS colour string Google's canvas
   * renderer accepts. Reads the live DaisyUI `--color-*` token through a probe
   * element so the value survives a theme flip.
   */
  private resolveColor(variant: PcMapVariant): string {
    const token = variant === 'muted' ? 'base-content' : variant;
    const host = this.mapHost()?.nativeElement ?? document.body;
    const probe = document.createElement('span');
    probe.style.color = `var(--color-${token})`;
    probe.style.display = 'none';
    host.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    host.removeChild(probe);
    if (variant === 'muted' && resolved.startsWith('rgb')) {
      return resolved.replace('rgb(', 'rgba(').replace(')', `, ${MUTED_OPACITY})`);
    }
    return resolved || '#3b82f6';
  }

  private computePlaceholderLabel(markers: PcMapMarker[], polygons: PcMapPolygon[]): string {
    if (markers.length === 0 && polygons.length === 0) return this.ariaLabel();
    const parts: string[] = [];
    if (markers.length) parts.push(`${markers.length} ${markers.length === 1 ? 'location' : 'locations'}`);
    if (polygons.length) parts.push(`${polygons.length} ${polygons.length === 1 ? 'area' : 'areas'}`);
    return parts.join(' · ');
  }
}
