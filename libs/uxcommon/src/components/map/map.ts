import { Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Loader } from '@googlemaps/js-api-loader';
import { Icon } from '../icons/icon';
import type { PcLatLng, PcMapMarker, PcMapPolygon, PcMapPolyline, PcMapVariant } from './map-types';

const DEFAULT_ZOOM = 14;
const DEFAULT_MAP_ID = 'DEMO_MAP_ID';
const FILL_OPACITY = 0.18;
const MUTED_OPACITY = 0.55;
const PIN_PX = 14;
const LABELLED_PIN_PX = 22;

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
 * See `docs/spec/pc-map-usage.md` for the consumption patterns and the binding
 * input/output contract.
 */
@Component({
  selector: 'pc-map',
  imports: [Icon],
  template: `
    @if (ready()) {
      <div #mapHost class="h-full w-full min-h-40"></div>
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

  public readonly markers = input<PcMapMarker[]>([]);
  public readonly polygons = input<PcMapPolygon[]>([]);
  public readonly polylines = input<PcMapPolyline[]>([]);
  public readonly center = input<PcLatLng | null>(null);
  public readonly zoom = input<number>(DEFAULT_ZOOM);
  public readonly fitBounds = input<boolean>(true);
  public readonly interactive = input<boolean>(true);
  public readonly deepLink = input<boolean>(false);
  public readonly mapId = input<string>(DEFAULT_MAP_ID);
  public readonly ariaLabel = input<string>('Map');

  public readonly markerClicked = output<PcMapMarker>();
  public readonly polygonClicked = output<PcMapPolygon>();

  protected readonly ready = signal(false);

  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');

  private map: google.maps.Map | null = null;
  private drawnMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
  private drawnPolygons: google.maps.Polygon[] = [];
  private drawnPolylines: google.maps.Polyline[] = [];
  private themeObserver: MutationObserver | null = null;

  protected readonly placeholderLabel = signal('Map unavailable');

  constructor() {
    // Kick off the SDK load once. If there is no Loader we stay a placeholder.
    void this.tryLoad();

    // Redraw whenever inputs change and the map is live.
    effect(() => {
      const markers = this.markers();
      const polygons = this.polygons();
      const polylines = this.polylines();
      // Recompute the placeholder caption from current content.
      this.placeholderLabel.set(this.computePlaceholderLabel(markers, polygons));
      if (this.map) {
        this.redraw(markers, polygons, polylines);
      }
    });

    // Once the host element materialises (after `ready` flips), build the map.
    effect(() => {
      const host = this.mapHost();
      if (host && !this.map) {
        this.buildMap(host.nativeElement);
      }
    });
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

      if (this.deepLink()) {
        this.map.addListener('click', () => this.openInMapsApp());
        hostEl.style.cursor = 'pointer';
      }

      this.observeTheme();
      this.redraw(this.markers(), this.polygons(), this.polylines());
    } catch {
      // A partial/broken SDK (or an offline draw failure) degrades to the
      // honest placeholder rather than crashing the host page.
      this.map = null;
      this.ready.set(false);
    }
  }

  private redraw(markers: PcMapMarker[], polygons: PcMapPolygon[], polylines: PcMapPolyline[]): void {
    if (!this.map) return;
    this.clearOverlays();

    for (const poly of polygons) {
      this.drawPolygon(poly);
    }
    for (const line of polylines) {
      this.drawPolyline(line);
    }
    for (const marker of markers) {
      this.drawMarker(marker);
    }

    if (!this.center()) {
      this.fitToContent(markers, polygons, polylines);
    }
  }

  private drawMarker(marker: PcMapMarker): void {
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
      gmpClickable: true,
    });
    advanced.addListener('gmp-click', () => {
      this.markerClicked.emit(marker);
      if (this.deepLink()) this.openInMapsApp(marker.position);
    });
    this.drawnMarkers.push(advanced);
  }

  private drawPolygon(poly: PcMapPolygon): void {
    if (!this.map) return;
    const color = this.resolveColor(poly.variant ?? 'neutral');
    const shape = new google.maps.Polygon({
      map: this.map,
      paths: poly.path,
      strokeColor: color,
      // Polygons can't render a dashed outline (that's a Polyline feature); a
      // dashed turf uses a thinner, lower-opacity solid stroke for now.
      // TODO(Wave 2F turf boundaries): overlay a dashed Polyline for `poly.dashed`.
      strokeWeight: poly.dashed ? 1.5 : 2,
      strokeOpacity: poly.dashed ? 0.6 : 0.9,
      fillColor: color,
      fillOpacity: FILL_OPACITY,
      clickable: true,
    });
    shape.addListener('click', () => this.polygonClicked.emit(poly));
    this.drawnPolygons.push(shape);
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
    this.themeObserver = new MutationObserver(() => this.redraw(this.markers(), this.polygons(), this.polylines()));
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
