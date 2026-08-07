import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PUBLISHED_BOUNDARY_ENTRIES } from '@common';
import type { BoundaryFeatureRowType, BoundaryGeometryType, BoundarySetRowType } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { PC_MAP_DEFAULT_ZOOM } from '@uxcommon/components/map/map';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { BoundariesSettingsComponent } from './boundaries-settings';
import { MAX_RESHAPE_VERTICES } from './boundary-geojson';
import { BoundariesService } from './services/boundaries-service';

/** A three-corner traced ring, as `polygonDrawn` hands it over. */
const TRIANGLE = [
  { lat: 45.4, lng: -75.7 },
  { lat: 45.4, lng: -75.6 },
  { lat: 45.5, lng: -75.6 },
];

/** A Polygon whose single ring holds `positions` full-precision positions. */
function hugeGeometry(positions: number): BoundaryGeometryType {
  const ring: [number, number][] = Array.from({ length: positions }, () => [-75.12345678901234, 45.98765432109876]);
  return { type: 'Polygon', coordinates: [ring] };
}

function makeSet(overrides: Partial<BoundarySetRowType> = {}): BoundarySetRowType {
  return {
    id: '1',
    slug: 'ottawa-wards-2022',
    label: 'Ottawa wards 2022',
    jurisdiction: 'ca_municipal',
    role: 'seat_area',
    chamber: null,
    region: 'ON',
    vintage: 'City of Ottawa 2022',
    source: 'drawn',
    file_id: null,
    name_property: null,
    code_property: null,
    feature_count: 2,
    editable: true,
    viewable: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * The envelope `features` returns: the areas plus how many the layer really has.
 *
 * The server stops sending outlines at a byte budget, so a caller must never read the layer's size
 * off the array it was handed. Tests build the envelope through this helper so a change to that
 * shape shows up in one place.
 */
function featureList(features: BoundaryFeatureRowType[], overrides: { total?: number; truncated?: boolean } = {}) {
  return {
    set_id: features[0]?.set_id ?? '1',
    features,
    total: overrides.total ?? features.length,
    truncated: overrides.truncated ?? false,
  };
}

function makeFeature(overrides: Partial<BoundaryFeatureRowType> = {}): BoundaryFeatureRowType {
  return {
    id: '10',
    set_id: '1',
    name: 'Ward 12',
    code: '12',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-75.7, 45.4],
          [-75.6, 45.4],
          [-75.6, 45.5],
          [-75.7, 45.4],
        ],
      ],
    },
    bbox: [-75.7, 45.4, -75.6, 45.5],
    ...overrides,
  };
}

const VALIDATION = {
  set_id: '1',
  examined: 120,
  total_geocoded: 120,
  unmatched: 7,
  multiply_matched: 3,
  capped: false,
};

describe('BoundariesSettingsComponent', () => {
  let fixture: ComponentFixture<BoundariesSettingsComponent>;
  let component: BoundariesSettingsComponent;
  let boundaries: {
    addFeature: ReturnType<typeof vi.fn>;
    addPublishedSet: ReturnType<typeof vi.fn>;
    createDrawnSet: ReturnType<typeof vi.fn>;
    deleteFeature: ReturnType<typeof vi.fn>;
    deleteSet: ReturnType<typeof vi.fn>;
    listFeatures: ReturnType<typeof vi.fn>;
    listHouseholdPins: ReturnType<typeof vi.fn>;
    listSets: ReturnType<typeof vi.fn>;
    rematch: ReturnType<typeof vi.fn>;
    updateFeature: ReturnType<typeof vi.fn>;
    uploadOriginalFile: ReturnType<typeof vi.fn>;
    uploadSet: ReturnType<typeof vi.fn>;
    validate: ReturnType<typeof vi.fn>;
  };
  let alerts: { showError: ReturnType<typeof vi.fn>; showSuccess: ReturnType<typeof vi.fn> };
  let dialogs: { confirm: ReturnType<typeof vi.fn> };

  async function build(sets: BoundarySetRowType[]): Promise<void> {
    boundaries.listSets.mockResolvedValue(sets);
    fixture = TestBed.createComponent(BoundariesSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    boundaries = {
      addFeature: vi.fn().mockResolvedValue(makeFeature({ id: '11', name: 'Ward 13' })),
      addPublishedSet: vi.fn().mockResolvedValue(makeSet({ id: '4', label: 'Federal ridings', source: 'bundled' })),
      createDrawnSet: vi.fn().mockResolvedValue(makeSet({ id: '2', label: 'Neighbourhoods', feature_count: 0 })),
      deleteFeature: vi.fn().mockResolvedValue(true),
      deleteSet: vi.fn().mockResolvedValue(true),
      listFeatures: vi.fn().mockResolvedValue(featureList([makeFeature()])),
      listHouseholdPins: vi
        .fn()
        .mockResolvedValue({ pins: [{ id: '5', lat: 45.42, lng: -75.69, label: '1 Main St' }], totalLocated: 1 }),
      listSets: vi.fn().mockResolvedValue([]),
      rematch: vi.fn().mockResolvedValue({ queued: true }),
      updateFeature: vi
        .fn()
        .mockImplementation((id: string, data: Record<string, unknown>) =>
          Promise.resolve(makeFeature({ id, ...data })),
        ),
      uploadOriginalFile: vi.fn().mockResolvedValue('99'),
      uploadSet: vi.fn().mockResolvedValue(makeSet({ id: '3', label: 'Uploaded wards', source: 'upload' })),
      validate: vi.fn().mockResolvedValue(VALIDATION),
    };
    alerts = { showError: vi.fn(), showSuccess: vi.fn() };
    dialogs = { confirm: vi.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [BoundariesSettingsComponent],
      providers: [
        provideRouter([]),
        { provide: BoundariesService, useValue: boundaries },
        { provide: AlertService, useValue: alerts },
        { provide: ConfirmDialogService, useValue: dialogs },
        { provide: AuthService, useValue: { getUserSignal: () => signal({ role: 'admin' }) } },
      ],
    });
  });

  describe('the empty state teaches instead of reporting a problem', () => {
    beforeEach(async () => {
      await build([]);
    });

    it('names the ways to get a map that this build can actually deliver', () => {
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Import the names you have');
      expect(text).toContain('Upload a published map');
      expect(text).toContain('Draw it yourself');
      // The catalog card appears only when the catalog holds something. Offering "add a published
      // map" over an empty catalog would be a promise nothing behind this page can keep.
      expect(text.includes('Add a published map')).toBe(PUBLISHED_BOUNDARY_ENTRIES.length > 0);
    });

    it('offers one card per way, and no card for a way that does not exist', () => {
      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('pc-empty-state .pc-panel');
      expect(cards).toHaveLength(PUBLISHED_BOUNDARY_ENTRIES.length > 0 ? 4 : 3);
    });

    it('says plainly that adding and re-matching a map costs nothing', () => {
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('cost nothing and call no paid service');
    });

    it('links to each of the three help articles it references', () => {
      const hrefs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toContain('/help/district-boundaries');
      expect(hrefs).toContain('/help/drawing-boundaries');
      expect(hrefs).toContain('/help/importing-districts');
      expect(hrefs).toContain('/help/geocoding-and-costs');
    });

    it('points at the existing import screen rather than describing it', () => {
      const hrefs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')].map((a) =>
        a.getAttribute('href'),
      );
      // The record type matters as much as the screen. Without ?type= the wizard opens on People,
      // which offers no reason to believe it is where area names come from.
      expect(hrefs).toContain('/imports/new?type=households');
    });
  });

  describe('the list of maps', () => {
    it('names each map in the words its own jurisdiction uses', async () => {
      await build([makeSet(), makeSet({ id: '2', jurisdiction: 'us_federal', role: 'subdivision', region: 'OH' })]);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Ottawa wards 2022');
      // A ca_municipal seat-area map is a set of Wards; a us_federal subdivision map is Precincts.
      expect(text).toContain('Wards');
      expect(text).toContain('Precincts');
    });

    it('shows where a map came from and how many areas it holds', async () => {
      await build([makeSet({ source: 'upload', feature_count: 23 })]);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Uploaded GeoJSON');
      expect(text).toContain('23');
      expect(text).toContain('City of Ottawa 2022');
    });

    it('deletes a map only through the project confirm dialog', async () => {
      await build([makeSet()]);
      await component['deleteSet'](makeSet());
      expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
      expect(boundaries.deleteSet).toHaveBeenCalledWith('1');
      expect(component['sets']()).toHaveLength(0);
    });

    it('does not delete when the dialog is dismissed', async () => {
      dialogs.confirm.mockResolvedValue(false);
      await build([makeSet()]);
      await component['deleteSet'](makeSet());
      expect(boundaries.deleteSet).not.toHaveBeenCalled();
    });

    it('stops offering new maps at the workspace limit, and says why', async () => {
      await build(Array.from({ length: 50 }, (_, index) => makeSet({ id: String(index + 1) })));
      expect(component['atSetLimit']()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('maximum of 50 boundary maps');
    });
  });

  describe('drawing', () => {
    beforeEach(async () => {
      await build([makeSet()]);
      await component['openMap'](makeSet());
      fixture.detectChanges();
    });

    it('loads the areas, the household pins and the validation counts on open', () => {
      expect(boundaries.listFeatures).toHaveBeenCalledWith('1');
      expect(boundaries.listHouseholdPins).toHaveBeenCalled();
      expect(boundaries.validate).toHaveBeenCalledWith('1');
      expect(component['mapMarkers']()).toHaveLength(1);
    });

    it('keeps a traced shape on the map until it is named', () => {
      component['onPolygonDrawn']([
        { lat: 45.4, lng: -75.7 },
        { lat: 45.4, lng: -75.6 },
        { lat: 45.5, lng: -75.6 },
      ]);
      const drawn = component['mapPolygons']().find((polygon) => polygon.label === 'Not saved yet');
      expect(drawn).toBeDefined();
      // Deliberately id-less: the map grows edit handles only on identified polygons, so the
      // unsaved shape shows no handles. Handles here would accept edits that never reach the save.
      expect(drawn?.id).toBeUndefined();
    });

    it('renders a feature past the reshape threshold view-only, and the rest editable', () => {
      component['features'].set([
        makeFeature(),
        makeFeature({ id: '20', name: 'Riverside', geometry: hugeGeometry(MAX_RESHAPE_VERTICES + 1) }),
      ]);
      const polygons = component['mapPolygons']();
      expect(polygons.find((polygon) => polygon.id === '10#0')?.editable).toBe(true);
      expect(polygons.find((polygon) => polygon.id === '20#0')?.editable).toBe(false);
    });

    it('saves a traced shape as a closed GeoJSON ring', async () => {
      component['onPolygonDrawn']([
        { lat: 45.4, lng: -75.7 },
        { lat: 45.4, lng: -75.6 },
        { lat: 45.5, lng: -75.6 },
      ]);
      component['areaPayload'].set({ name: 'Ward 13', code: '13' });
      await component['savePendingShape']();

      expect(boundaries.addFeature).toHaveBeenCalledTimes(1);
      const input = boundaries.addFeature.mock.calls[0][0];
      expect(input.set_id).toBe('1');
      expect(input.name).toBe('Ward 13');
      expect(input.geometry.type).toBe('Polygon');
      const ring = input.geometry.coordinates[0];
      expect(ring[0]).toEqual([-75.7, 45.4]);
      expect(ring[ring.length - 1]).toEqual(ring[0]);
      expect(component['pendingPath']()).toBeNull();
    });

    it('refuses to name a shape with no name, without a bare failure', async () => {
      component['onPolygonDrawn']([
        { lat: 45.4, lng: -75.7 },
        { lat: 45.4, lng: -75.6 },
        { lat: 45.5, lng: -75.6 },
      ]);
      component['areaPayload'].set({ name: '', code: '' });
      await component['savePendingShape']();
      expect(boundaries.addFeature).not.toHaveBeenCalled();
      expect(component['areaForm']().invalid()).toBe(true);
    });

    it('marks the fit numbers stale after saving an area instead of re-counting', async () => {
      boundaries.validate.mockClear();
      component['onPolygonDrawn']([
        { lat: 45.4, lng: -75.7 },
        { lat: 45.4, lng: -75.6 },
        { lat: 45.5, lng: -75.6 },
      ]);
      component['areaPayload'].set({ name: 'Ward 13', code: '' });
      await component['savePendingShape']();
      expect(boundaries.validate).not.toHaveBeenCalled();
      expect(component['validationStale']()).toBe(true);
    });

    it('re-counts the fit numbers on request and clears the stale flag', async () => {
      boundaries.validate.mockClear();
      component['validationStale'].set(true);
      await component['refreshValidation']('1');
      expect(boundaries.validate).toHaveBeenCalledWith('1');
      expect(component['validationStale']()).toBe(false);
    });

    it('reports both quality counts in plain words', () => {
      expect(component['validationSummary']()).toBe(
        '7 of 120 located households fall in no area, and 3 fall in more than one.',
      );
    });

    it('saves a reshaped area once the hand stops, keeping the other rings', async () => {
      component['onPolygonEdited']({
        id: '10#0',
        path: [
          { lat: 45.41, lng: -75.71 },
          { lat: 45.41, lng: -75.61 },
          { lat: 45.51, lng: -75.61 },
        ],
      });
      expect(component['savingShape']()).toBe(true);
      // A vertex drag reports more than once; nothing is sent until the edits are flushed.
      expect(boundaries.updateFeature).not.toHaveBeenCalled();

      await component['selectFeature']('10');
      expect(boundaries.updateFeature).toHaveBeenCalledTimes(1);
      const [id, data] = boundaries.updateFeature.mock.calls[0];
      expect(id).toBe('10');
      expect(data.geometry.coordinates[0][0]).toEqual([-75.71, 45.41]);
      expect(component['savingShape']()).toBe(false);
    });

    it('saves a buffered reshape before All maps clears the page, instead of dropping it', async () => {
      component['onPolygonEdited']({ id: '10#0', path: TRIANGLE });
      await component['showList']();
      expect(boundaries.updateFeature).toHaveBeenCalledTimes(1);
      expect(component['mode']()).toBe('list');
      expect(component['savingShape']()).toBe(false);
    });

    it('saves a buffered reshape when Done editing turns drawing off', async () => {
      await component['toggleDrawing']();
      component['onPolygonEdited']({ id: '10#0', path: TRIANGLE });
      await component['toggleDrawing']();
      expect(component['drawing']()).toBe(false);
      expect(boundaries.updateFeature).toHaveBeenCalledTimes(1);
    });

    it('saves a buffered reshape when the page is destroyed rather than dropping it', () => {
      component['onPolygonEdited']({ id: '10#0', path: TRIANGLE });
      fixture.destroy();
      // The flush is kicked off synchronously on destroy; the save call has already been made.
      expect(boundaries.updateFeature).toHaveBeenCalledTimes(1);
    });

    it('refuses a reshape the server would bounce, naming the problem instead of a raw 413', async () => {
      // Enough full-precision positions to serialise past the 1 MiB request-body limit.
      const hugePath = Array.from({ length: 40_000 }, () => ({ lat: 45.98765432109876, lng: -75.12345678901234 }));
      component['onPolygonEdited']({ id: '10#0', path: hugePath });
      await component['selectFeature']('10');

      expect(boundaries.updateFeature).not.toHaveBeenCalled();
      expect(alerts.showError).toHaveBeenCalledWith(expect.stringContaining('too detailed to reshape'));
      // The refused change must not stay drawn: the areas are re-read from the server.
      expect(boundaries.listFeatures).toHaveBeenCalledTimes(2);
      expect(component['savingShape']()).toBe(false);
    });

    it('asks before All maps discards a finished unsaved shape, and keeps it on cancel', async () => {
      component['onPolygonDrawn'](TRIANGLE);
      dialogs.confirm.mockResolvedValue(false);
      await component['showList']();
      expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard the unsaved shape?' }));
      expect(component['mode']()).toBe('map');
      expect(component['pendingPath']()).not.toBeNull();

      dialogs.confirm.mockResolvedValue(true);
      await component['showList']();
      expect(component['mode']()).toBe('list');
      expect(component['pendingPath']()).toBeNull();
    });

    it('asks before Done editing discards a finished unsaved shape', async () => {
      await component['toggleDrawing']();
      component['onPolygonDrawn'](TRIANGLE);
      dialogs.confirm.mockResolvedValue(false);
      await component['toggleDrawing']();
      expect(component['drawing']()).toBe(true);
      expect(component['pendingPath']()).not.toBeNull();
    });

    it('Escape hands the shape in progress to the map to cancel, with no confirm', async () => {
      await component['toggleDrawing']();
      fixture.detectChanges();
      const map = component['map']();
      expect(map).toBeDefined();
      if (!map) return;
      const cancel = vi.spyOn(map, 'cancelDrawing');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(dialogs.confirm).not.toHaveBeenCalled();
    });

    it('Enter asks the map to finish the shape, which refuses under three corners', async () => {
      await component['toggleDrawing']();
      fixture.detectChanges();
      const map = component['map']();
      expect(map).toBeDefined();
      if (!map) return;
      const finish = vi.spyOn(map, 'finishDrawing');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(finish).toHaveBeenCalledTimes(1);
    });

    it('leaves keys alone while typing in a field, and entirely when not drawing', async () => {
      const map = component['map']();
      expect(map).toBeDefined();
      if (!map) return;
      const cancel = vi.spyOn(map, 'cancelDrawing');

      // Drawing off: the keyboard belongs to the page.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(cancel).not.toHaveBeenCalled();

      // Drawing on, but the key was born in a form control: it keeps its own meaning.
      await component['toggleDrawing']();
      const field = document.createElement('input');
      document.body.appendChild(field);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      field.remove();
      expect(cancel).not.toHaveBeenCalled();
    });

    it('renames the selected area', async () => {
      await component['selectFeature']('10');
      component['areaPayload'].set({ name: 'Ward 12 (west)', code: '12' });
      await component['renameSelected']();
      expect(boundaries.updateFeature).toHaveBeenCalledWith('10', { name: 'Ward 12 (west)', code: '12' });
    });

    it('deletes an area only through the project confirm dialog', async () => {
      await component['selectFeature']('10');
      await component['deleteSelected']();
      expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
      expect(boundaries.deleteFeature).toHaveBeenCalledWith('10');
      expect(component['features']()).toHaveLength(0);
    });

    it('stops the map re-framing itself once the user starts working', async () => {
      expect(component['autoFit']()).toBe(true);
      await component['toggleDrawing']();
      expect(component['autoFit']()).toBe(false);
      expect(component['drawing']()).toBe(true);
    });
  });

  describe('the published-map picker', () => {
    it('opens without a round trip, because the catalog is compiled in', async () => {
      await build([makeSet()]);
      await component['startCatalog']();
      fixture.detectChanges();
      expect(component['mode']()).toBe('catalog');
    });

    it('says what an empty catalog means and offers the two paths that do work', async () => {
      // This is the state this release ships in: the mechanism is complete, no publisher's file has
      // been converted yet. The picker must say that plainly rather than showing an empty list that
      // reads as a loading failure.
      if (PUBLISHED_BOUNDARY_ENTRIES.length > 0) return;

      await build([makeSet()]);
      await component['startCatalog']();
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No published maps in this version');
      expect(text).toContain('Upload GeoJSON');
      expect(text).toContain('Draw a map');
      expect(component['catalogRows']()).toEqual([]);
    });

    it('never offers a map the workspace already holds', async () => {
      // Every published set carries the catalog slug verbatim, which is what makes this comparison
      // work — a second add would be a duplicate the server refuses, not a second copy.
      await build([makeSet({ id: '7', slug: 'ca-fed-2023', source: 'bundled' })]);
      await component['startCatalog']();
      fixture.detectChanges();
      for (const row of component['catalogRows']()) {
        if (row.entry.slug === 'ca-fed-2023') expect(row.added).toBe(true);
      }
    });

    it('refuses to add when the workspace is already at its map limit', async () => {
      await build(Array.from({ length: 50 }, (_, i) => makeSet({ id: String(i + 1), slug: `map-${i}` })));
      await component['addPublishedMap']({
        entry: {
          slug: 'ca-fed-2023',
          label: 'Canada — federal ridings',
          jurisdiction: 'ca_federal',
          region: null,
          chamber: null,
          role: 'seat_area',
          vintage: '2023 representation order',
          publisher: 'Elections Canada',
          licence: 'Open Government Licence — Canada 2.0',
          attribution: 'Contains information licensed under the Open Government Licence — Canada.',
          sourceUrl: 'https://example.invalid/',
          nameProperty: 'name',
          codeProperty: 'code',
          featureCount: 343,
          bytes: 3_000_000,
          sha256: 'a'.repeat(64),
          supersededBy: null,
        },
        added: false,
        suggested: true,
        size: '2.9 MB',
      });
      expect(boundaries.addPublishedSet).not.toHaveBeenCalled();
      expect(dialogs.confirm).not.toHaveBeenCalled();
    });
  });

  describe('opening a published map', () => {
    // A published map cannot be edited and DOES have shapes. Those were once the same flag, so the
    // list offered no way to open a 124-area riding map and told the user there was no shape in it.
    it('offers the map view for a published map, which has shapes but cannot be edited', async () => {
      const set = makeSet({ id: '1', source: 'bundled', editable: false, viewable: true, feature_count: 124 });
      boundaries.listFeatures.mockResolvedValue(featureList([makeFeature()], { total: 124 }));
      await build([set]);
      fixture.detectChanges();

      const openMap = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(openMap).not.toContain('no shape to open');

      await component['openMap'](set);
      fixture.detectChanges();
      // The map opened, and the one thing it must not offer is reshaping someone else's file.
      expect(component['mode']()).toBe('map');
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Edit map');
    });

    it('still says an imported list has no shape, because it genuinely has none', async () => {
      const set = makeSet({ id: '2', source: 'import', editable: false, viewable: false });
      await build([set]);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('no shape to open');
    });
  });

  describe('a map too large to draw all at once', () => {
    it('says how much of it is on screen instead of reporting the sample as the whole map', async () => {
      const set = makeSet({ id: '1', source: 'bundled', editable: false, feature_count: 343 });
      boundaries.listFeatures.mockResolvedValue(featureList([makeFeature()], { total: 343, truncated: true }));
      await build([set]);
      await component['openMap'](set);
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('too large to draw all at once');
      expect(text).toContain('343');
      // The limit is on the screen, not on the matching, and the copy has to say so.
      expect(text).toContain('Every area is still matched against your households');
    });

    it('shows no truncation warning for a map that fits', async () => {
      const set = makeSet();
      await build([set]);
      await component['openMap'](set);
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('too large to draw all at once');
    });
  });

  describe('the draw view of an empty workspace', () => {
    async function buildEmpty(set: BoundarySetRowType): Promise<void> {
      boundaries.listFeatures.mockResolvedValue(featureList([]));
      boundaries.listHouseholdPins.mockResolvedValue({ pins: [], totalLocated: 0 });
      await build([set]);
      await component['openMap'](set);
      fixture.detectChanges();
    }

    it('opens a Canadian map country-wide instead of at latitude 0, longitude 0', async () => {
      await buildEmpty(makeSet());
      expect(component['emptyMapCenter']()).toEqual({ lat: 56.1, lng: -106.3 });
      expect(component['emptyMapZoom']()).toBe(4);
    });

    it('opens a United States map on the United States', async () => {
      await buildEmpty(makeSet({ jurisdiction: 'us_federal' }));
      expect(component['emptyMapCenter']()).toEqual({ lat: 39.8, lng: -98.6 });
      expect(component['emptyMapZoom']()).toBe(4);
    });

    it('opens a world view when the jurisdiction names no country', async () => {
      await buildEmpty(makeSet({ jurisdiction: 'other', region: null }));
      expect(component['emptyMapCenter']()).toEqual({ lat: 30, lng: 0 });
      expect(component['emptyMapZoom']()).toBe(2);
    });

    it('hands framing back to the map as soon as there is anything to frame', async () => {
      // Default mocks: one saved area and one household pin.
      await build([makeSet()]);
      await component['openMap'](makeSet());
      expect(component['emptyMapCenter']()).toBeNull();
      expect(component['emptyMapZoom']()).toBe(PC_MAP_DEFAULT_ZOOM);
    });

    it('tells a pinless workspace how to start: zoom to the area, then place corners', async () => {
      await buildEmpty(makeSet());
      await component['toggleDrawing']();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Zoom to your area, then click to place corners.',
      );
    });
  });

  describe('permissions', () => {
    it('tells a viewer that only an admin or owner can change a map', async () => {
      TestBed.overrideProvider(AuthService, { useValue: { getUserSignal: () => signal({ role: 'viewer' }) } });
      await build([]);
      expect(component['canEdit']()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Only an admin or the workspace owner');
    });
  });
});
