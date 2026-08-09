import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PcMap,
  VERTEX_SNAP_TOLERANCE_PX,
  advanceDraftPath,
  clusterDiameterPx,
  formatClusterCount,
  polygonEditability,
  removeRingVertex,
  snapToleranceInDegrees,
  snapVertexToNearby,
} from './map';
import type { PcLatLng } from './map-types';

/**
 * `<pc-map>` is deliberately built to render a deterministic placeholder when no
 * `Loader` is provided (as here) — so component tests never touch the network
 * and never depend on the Google Maps SDK. See `docs/spec/pc-map-usage.md`.
 */
describe('PcMap', () => {
  let fixture: ComponentFixture<PcMap>;

  beforeEach(async () => {
    // No Loader provider on purpose → optional injection is null → placeholder.
    await TestBed.configureTestingModule({ imports: [PcMap] }).compileComponents();
    fixture = TestBed.createComponent(PcMap);
  });

  it('renders the placeholder (no network) when no Loader is provided', () => {
    fixture.detectChanges();
    const host = fixture.debugElement.query(By.css('[role="img"]'));
    expect(host).toBeTruthy();
    // The live-map <div> carries data-testid="map-canvas"; it is never created
    // without a Loader. (`#mapHost` is a template reference variable, not a CSS
    // id, so querying for it could never fail — this selector is the real one.)
    expect(fixture.debugElement.query(By.css('[data-testid="map-canvas"]'))).toBeNull();
  });

  it('tears down cleanly in placeholder mode, where there is no SDK to release', () => {
    fixture.detectChanges();
    // The destroy hook disconnects the theme observer and releases overlays.
    // With no Loader none of those exist, and teardown must not touch google.*.
    expect(() => fixture.destroy()).not.toThrow();
  });

  it('accepts a userLocation with no SDK and keeps the placeholder', () => {
    fixture.componentRef.setInput('userLocation', { lat: 43.7, lng: -79.25 });
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[role="img"]'))).toBeTruthy();
    fixture.componentRef.setInput('userLocation', null);
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('uses the ariaLabel on the placeholder when there is no content', () => {
    fixture.componentRef.setInput('ariaLabel', 'Household location');
    fixture.detectChanges();
    const host = fixture.debugElement.query(By.css('[role="img"]'));
    expect(host.nativeElement.getAttribute('aria-label')).toBe('Household location');
  });

  it('captions the placeholder with the marker/polygon count', () => {
    fixture.componentRef.setInput('markers', [
      { position: { lat: 41.9, lng: -87.6 } },
      { position: { lat: 41.8, lng: -87.7 } },
    ]);
    fixture.componentRef.setInput('polygons', [{ path: [{ lat: 41.9, lng: -87.6 }] }]);
    fixture.detectChanges();
    const caption = fixture.debugElement.query(By.css('[role="img"] span'));
    expect(caption.nativeElement.textContent.trim()).toBe('2 locations · 1 area');
  });

  describe('drawing mode', () => {
    it('is off unless a host asks for it', () => {
      fixture.detectChanges();
      expect(fixture.componentInstance.drawingEnabled()).toBe(false);
      expect(fixture.componentInstance.selectedPolygonId()).toBeNull();
    });

    it('leaves the placeholder exactly as it was when drawing is turned on with no SDK', () => {
      fixture.componentRef.setInput('drawingEnabled', true);
      fixture.componentRef.setInput('selectedPolygonId', 'set-1');
      fixture.componentRef.setInput('polygons', [{ id: 'set-1', path: [{ lat: 45.4, lng: -75.7 }] }]);
      fixture.detectChanges();
      const host = fixture.debugElement.query(By.css('[role="img"]'));
      expect(host).toBeTruthy();
      const caption = fixture.debugElement.query(By.css('[role="img"] span'));
      expect(caption.nativeElement.textContent.trim()).toBe('1 area');
    });

    it('starts with nothing traced and refuses to finish an empty shape', () => {
      fixture.detectChanges();
      const emitted: PcLatLng[][] = [];
      fixture.componentInstance.polygonDrawn.subscribe((path) => emitted.push(path));

      expect(fixture.componentInstance.draftVertexCount()).toBe(0);
      expect(fixture.componentInstance.canFinishDrawing()).toBe(false);

      // Each of these is safe with nothing in progress and emits nothing.
      fixture.componentInstance.finishDrawing();
      fixture.componentInstance.undoLastVertex();
      fixture.componentInstance.cancelDrawing();

      expect(emitted).toEqual([]);
      expect(fixture.componentInstance.draftVertexCount()).toBe(0);
    });
  });

  describe('density groups', () => {
    it('captions the placeholder with the households grouped, not the number of groups', () => {
      fixture.componentRef.setInput('clusters', [
        { position: { lat: 45.4, lng: -75.7 }, count: 12_000 },
        { position: { lat: 45.5, lng: -75.6 }, count: 23_400 },
      ]);
      fixture.detectChanges();
      const caption = fixture.debugElement.query(By.css('[role="img"] span'));
      expect(caption.nativeElement.textContent.trim()).toBe('35,400 grouped');
    });
  });

  describe('focusOn', () => {
    it('does nothing when handed no points, rather than clearing the view', () => {
      fixture.detectChanges();
      expect(() => fixture.componentInstance.focusOn([])).not.toThrow();
    });

    it('is safe before the SDK loads, so a host can frame the map as soon as its data arrives', () => {
      fixture.detectChanges();
      // Placeholder mode: there is no map to move, and the request is remembered rather than lost.
      expect(() => fixture.componentInstance.focusOn([{ lat: 45.4, lng: -75.7 }])).not.toThrow();
    });
  });
});

/**
 * How big a density bubble is drawn. Pure arithmetic, so the rule that a bubble's *area* carries
 * the count can be pinned without a map: doubling the drawn width has to mean four times as many.
 */
describe('clusterDiameterPx', () => {
  it('draws the biggest group in the view at the full size', () => {
    expect(clusterDiameterPx(500, 500)).toBe(clusterDiameterPx(9_999, 500));
  });

  it('sizes by area, so a quarter of the count is half the extra width', () => {
    const largest = clusterDiameterPx(400, 400);
    const quarter = clusterDiameterPx(100, 400);
    const smallest = clusterDiameterPx(0, 400);
    expect(quarter - smallest).toBeCloseTo((largest - smallest) / 2, 10);
  });

  it('never collapses to nothing, however small the count or however absurd the largest', () => {
    expect(clusterDiameterPx(0, 0)).toBeGreaterThan(0);
    expect(clusterDiameterPx(1, 1_000_000)).toBeGreaterThan(0);
    expect(clusterDiameterPx(-5, 100)).toBeGreaterThan(0);
  });
});

describe('formatClusterCount', () => {
  it('writes counts under a thousand in full', () => {
    expect(formatClusterCount(1)).toBe('1');
    expect(formatClusterCount(999)).toBe('999');
  });

  it('shortens thousands so the number still fits inside the bubble', () => {
    expect(formatClusterCount(1_204)).toBe('1.2k');
    expect(formatClusterCount(9_949)).toBe('9.9k');
    expect(formatClusterCount(35_400)).toBe('35k');
  });
});

/**
 * The snapping rules are plain arithmetic on lat/lng pairs, deliberately kept
 * out of the component so they can be checked without a map, a browser or the
 * Google SDK.
 */
describe('snapToleranceInDegrees', () => {
  it('converts the pixel tolerance to degrees of longitude at zoom 0', () => {
    // At zoom 0 the whole 360° world is 256 pixels wide.
    expect(snapToleranceInDegrees(0)).toBeCloseTo((VERTEX_SNAP_TOLERANCE_PX * 360) / 256, 10);
  });

  it('halves the tolerance for every zoom level in', () => {
    expect(snapToleranceInDegrees(11)).toBeCloseTo(snapToleranceInDegrees(10) / 2, 12);
  });

  it('shrinks as the map zooms in, so tracing gets more precise rather than stickier', () => {
    // Zoom 18 is roughly a city block on screen: a dozen pixels is a few metres.
    const metresPerDegreeAtEquator = 111_320;
    expect(snapToleranceInDegrees(18) * metresPerDegreeAtEquator).toBeLessThan(10);
    expect(snapToleranceInDegrees(18)).toBeGreaterThan(0);
  });
});

describe('snapVertexToNearby', () => {
  const tolerance = 0.001;

  it('returns the point unchanged when there is nothing to snap to', () => {
    const point = { lat: 45.42, lng: -75.7 };
    expect(snapVertexToNearby(point, [], tolerance)).toBe(point);
  });

  it('snaps onto a vertex inside the tolerance', () => {
    const point = { lat: 45.42, lng: -75.7 };
    const neighbour = { lat: 45.4202, lng: -75.7001 };
    expect(snapVertexToNearby(point, [neighbour], tolerance)).toEqual(neighbour);
  });

  it('leaves the point alone when the nearest vertex is outside the tolerance', () => {
    const point = { lat: 45.42, lng: -75.7 };
    const faraway = { lat: 45.45, lng: -75.7 };
    expect(snapVertexToNearby(point, [faraway], tolerance)).toBe(point);
  });

  it('picks the nearest of several candidates', () => {
    const point = { lat: 45.42, lng: -75.7 };
    const near = { lat: 45.4201, lng: -75.7 };
    const nearer = { lat: 45.42005, lng: -75.7 };
    expect(snapVertexToNearby(point, [near, nearer], tolerance)).toEqual(nearer);
  });

  it('returns a copy, so the snapped vertex never aliases the polygon it came from', () => {
    const point = { lat: 45.42, lng: -75.7 };
    const neighbour = { lat: 45.4201, lng: -75.7 };
    expect(snapVertexToNearby(point, [neighbour], tolerance)).not.toBe(neighbour);
  });

  it('accounts for the Mercator latitude stretch', () => {
    // The same latitude gap covers more screen distance far from the equator, so
    // a gap that snaps near the equator must not snap in northern Canada.
    const gap = 0.0009;
    const equator = { lat: 0, lng: 0 };
    const north = { lat: 70, lng: 0 };
    expect(snapVertexToNearby(equator, [{ lat: gap, lng: 0 }], tolerance)).toEqual({ lat: gap, lng: 0 });
    expect(snapVertexToNearby(north, [{ lat: 70 + gap, lng: 0 }], tolerance)).toBe(north);
  });
});

describe('advanceDraftPath', () => {
  const tolerance = 0.001;
  const noNeighbours: PcLatLng[] = [];

  it('adds the first vertex to an empty shape', () => {
    const result = advanceDraftPath([], { lat: 45.42, lng: -75.7 }, noNeighbours, tolerance);
    expect(result).toEqual({ path: [{ lat: 45.42, lng: -75.7 }], closed: false });
  });

  it('will not close a shape that is still a line', () => {
    const draft = [
      { lat: 45.42, lng: -75.7 },
      { lat: 45.43, lng: -75.7 },
    ];
    // A click right on the first vertex, but only two vertices exist.
    const result = advanceDraftPath(draft, { lat: 45.42, lng: -75.7 }, noNeighbours, tolerance);
    expect(result.closed).toBe(false);
    expect(result.path).toHaveLength(3);
  });

  it('closes the shape when a click lands near the first vertex', () => {
    const draft = [
      { lat: 45.42, lng: -75.7 },
      { lat: 45.43, lng: -75.7 },
      { lat: 45.43, lng: -75.69 },
    ];
    const result = advanceDraftPath(draft, { lat: 45.4201, lng: -75.7 }, noNeighbours, tolerance);
    expect(result).toEqual({ path: draft, closed: true });
  });

  it('snaps a new vertex onto a neighbouring area so the two share an edge', () => {
    const neighbourCorner = { lat: 45.43, lng: -75.69 };
    const neighbour = [{ lat: 45.42, lng: -75.69 }, neighbourCorner];
    const draft = [{ lat: 45.4, lng: -75.72 }];
    const result = advanceDraftPath(draft, { lat: 45.4301, lng: -75.6899 }, neighbour, tolerance);
    expect(result.closed).toBe(false);
    expect(result.path[1]).toEqual(neighbourCorner);
  });

  it('never snaps onto the vertex just placed, which would add an edge of zero length', () => {
    const previous = { lat: 45.42, lng: -75.7 };
    const draft = [previous];
    const click = { lat: 45.42005, lng: -75.7 };
    const result = advanceDraftPath(draft, click, noNeighbours, tolerance);
    expect(result.path[1]).toEqual(click);
  });

  it('lets a later vertex snap back onto an earlier one in the same shape', () => {
    const first = { lat: 45.42, lng: -75.7 };
    const draft = [first, { lat: 45.43, lng: -75.7 }, { lat: 45.43, lng: -75.69 }, { lat: 45.425, lng: -75.685 }];
    // Near the second vertex, which is neither the first (closing) nor the last.
    const result = advanceDraftPath(draft, { lat: 45.43004, lng: -75.7 }, noNeighbours, tolerance);
    expect(result.closed).toBe(false);
    expect(result.path[4]).toEqual({ lat: 45.43, lng: -75.7 });
  });

  it('leaves the shape in progress untouched — it returns a new ring', () => {
    const draft = [{ lat: 45.42, lng: -75.7 }];
    const result = advanceDraftPath(draft, { lat: 45.43, lng: -75.7 }, noNeighbours, tolerance);
    expect(draft).toHaveLength(1);
    expect(result.path).not.toBe(draft);
  });

  it('produces a ring a GeoJSON polygon can use directly, with no repeated closing vertex', () => {
    const corners: PcLatLng[] = [
      { lat: 45.42, lng: -75.7 },
      { lat: 45.43, lng: -75.7 },
      { lat: 45.43, lng: -75.69 },
    ];
    let path: PcLatLng[] = [];
    for (const corner of corners) {
      path = advanceDraftPath(path, corner, noNeighbours, tolerance).path;
    }
    const closing = advanceDraftPath(path, corners[0], noNeighbours, tolerance);
    expect(closing.closed).toBe(true);
    expect(closing.path).toEqual(corners);
    expect(closing.path.map((p) => [p.lng, p.lat])).toEqual([
      [-75.7, 45.42],
      [-75.7, 45.43],
      [-75.69, 45.43],
    ]);
  });

  it('will not snap the third vertex onto the first, which would set up a zero-area ring', () => {
    const first = { lat: 45.42, lng: -75.7 };
    const draft = [first, { lat: 45.43, lng: -75.7 }];
    const click = { lat: 45.4201, lng: -75.7 }; // within snap tolerance of the first vertex
    const result = advanceDraftPath(draft, click, noNeighbours, tolerance);
    expect(result.closed).toBe(false);
    // The click lands where it was made instead of snapping onto the first
    // vertex; snapping would produce [first, second, first], which one more
    // click near the first vertex would "close" into a ring with no area.
    expect(result.path[2]).toEqual(click);
  });

  it('will not reach the first vertex through a saved vertex at the same position either', () => {
    const sharedCorner = { lat: 45.42, lng: -75.7 };
    // A trace often starts on a neighbouring area's corner (that is what snapping
    // is for), so a saved vertex sits at exactly the first vertex's position.
    const neighbour = [sharedCorner];
    const draft = [{ ...sharedCorner }, { lat: 45.43, lng: -75.7 }];
    const click = { lat: 45.4201, lng: -75.7 };
    const result = advanceDraftPath(draft, click, neighbour, tolerance);
    expect(result.closed).toBe(false);
    expect(result.path[2]).toEqual(click);
  });

  it('still closes on the first vertex once the shape has three, so the guard costs nothing', () => {
    const first = { lat: 45.42, lng: -75.7 };
    const draft = [first, { lat: 45.43, lng: -75.7 }, { lat: 45.43, lng: -75.69 }];
    const result = advanceDraftPath(draft, { lat: 45.4201, lng: -75.7 }, noNeighbours, tolerance);
    expect(result).toEqual({ path: draft, closed: true });
  });
});

/**
 * Google Maps has no built-in remove-a-vertex gesture, so `<pc-map>` removes a
 * right-clicked vertex itself. The guard deciding whether a removal is allowed
 * is pure, so the three-vertex minimum can be pinned without the SDK.
 */
describe('removeRingVertex', () => {
  const square: PcLatLng[] = [
    { lat: 45.4, lng: -75.7 },
    { lat: 45.4, lng: -75.6 },
    { lat: 45.5, lng: -75.6 },
    { lat: 45.5, lng: -75.7 },
  ];

  it('removes the vertex at the index and returns the shorter ring', () => {
    expect(removeRingVertex(square, 1)).toEqual([square[0], square[2], square[3]]);
  });

  it('refuses at three vertices — removing one would leave a line, not an area', () => {
    expect(removeRingVertex(square.slice(0, 3), 0)).toBeNull();
  });

  it('refuses an index outside the ring', () => {
    expect(removeRingVertex(square, -1)).toBeNull();
    expect(removeRingVertex(square, 4)).toBeNull();
    expect(removeRingVertex(square, 1.5)).toBeNull();
  });

  it('leaves the given ring untouched', () => {
    const before = [...square];
    removeRingVertex(square, 2);
    expect(square).toEqual(before);
  });
});

/**
 * Which polygons grow edit handles in drawing mode. The rule is pure so the
 * "no handles whose edits are thrown away" contract can be pinned without the
 * SDK: an id-less polygon (a host's not-yet-saved preview shape) has no way to
 * report an edit, so it must never look editable.
 */
describe('polygonEditability', () => {
  it('never offers handles outside drawing mode', () => {
    expect(polygonEditability(false, { id: 'set-1' })).toBe(false);
  });

  it('never offers handles on a polygon without an id, whose edits could not be reported', () => {
    expect(polygonEditability(true, {})).toBe(false);
    expect(polygonEditability(true, { id: undefined })).toBe(false);
  });

  it('never offers handles on a polygon the host pinned view-only', () => {
    expect(polygonEditability(true, { id: 'set-1', editable: false })).toBe(false);
  });

  it('offers handles on an identified polygon in drawing mode otherwise', () => {
    expect(polygonEditability(true, { id: 'set-1' })).toBe(true);
    expect(polygonEditability(true, { id: 'set-1', editable: true })).toBe(true);
  });
});
