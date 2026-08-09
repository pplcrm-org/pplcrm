import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanionHousehold, CompanionTurfPayload } from '@common';
import type { PcMapMarker, PcMapPolyline } from '@uxcommon/components/map/map-types';

import { CanvassMap } from './canvass-map';
import { CanvassStore } from './canvass-store';
import { GeoPosition } from './geo-position';

/**
 * The map tab's two colourings and its walking guidance. `<pc-map>` renders its
 * deterministic placeholder here (no Loader), so these tests read the computed
 * marker/polyline inputs and the surrounding narration, never Google's canvas.
 */

function door(over: Partial<CompanionHousehold> & { id: string; walk_order: number }): CompanionHousehold {
  return {
    address: '',
    street: 'Alder St',
    street_num: null,
    apt: null,
    lat: null,
    lng: null,
    dnc: false,
    yard_sign: null,
    door_outcome: null,
    hh_survey: null,
    last_knock: null,
    people: [],
    ...over,
  };
}

function payload(households: CompanionHousehold[]): CompanionTurfPayload {
  return {
    campaign_name: 'Vote Rivera',
    turf_id: '4',
    turf_name: 'Turf 4',
    canvasser_name: 'Jordan Rivera',
    script: '',
    issues: [],
    expires_at: null,
    households,
    segment_claims: [],
  };
}

/** Three geocoded doors on one street; house numbers and cut order disagree. */
function parityDoors(): CompanionHousehold[] {
  return [
    door({ id: '10', walk_order: 1, address: '218 Alder St', street_num: '218', lat: 43.7, lng: -79.25 }),
    door({ id: '11', walk_order: 2, address: '217 Alder St', street_num: '217', lat: 43.7001, lng: -79.2501 }),
    door({ id: '12', walk_order: 3, address: '220 Alder St', street_num: '220', lat: 43.7002, lng: -79.2502 }),
  ];
}

interface MapInternals {
  markers(): PcMapMarker[];
  walkPath(): PcMapPolyline[];
}

describe('CanvassMap', () => {
  let store: CanvassStore;
  let geo: GeoPosition;

  beforeEach(async () => {
    // The test DOM has no geolocation API; without one the service reads
    // 'unsupported' and the Find-me row never renders. Stub it BEFORE the
    // service is constructed, since it reads navigator once at that moment.
    if (!navigator.geolocation) {
      Object.defineProperty(navigator, 'geolocation', {
        value: { watchPosition: vi.fn(), clearWatch: vi.fn() },
        configurable: true,
      });
    }
    await TestBed.configureTestingModule({ imports: [CanvassMap], providers: [CanvassStore] }).compileComponents();
    store = TestBed.inject(CanvassStore);
    geo = TestBed.inject(GeoPosition);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function create(): { fixture: ReturnType<typeof TestBed.createComponent<CanvassMap>>; internals: MapInternals } {
    const fixture = TestBed.createComponent(CanvassMap);
    fixture.detectChanges();
    return { fixture, internals: fixture.componentInstance as unknown as MapInternals };
  }

  it('opens in walk mode with the walk legend', () => {
    store.payload.set(payload(parityDoors()));
    const { fixture } = create();
    expect(store.mapMode()).toBe('walk');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('To walk');
    expect(text).toContain('Knocked, nobody home');
    expect(text).not.toContain('Supporter');
  });

  it('the Results chip switches to the stance legend', () => {
    store.payload.set(payload(parityDoors()));
    const { fixture } = create();
    const results = fixture.debugElement
      .queryAll(By.css('button'))
      .find((b) => (b.nativeElement as HTMLElement).textContent?.trim() === 'Results');
    (results?.nativeElement as HTMLElement).click();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Supporter');
    expect(text).toContain('Canvassed, no stance');
  });

  it('numbers only the remaining pins, in walking order', () => {
    const doors = parityDoors().map((d) => (d.id === '10' ? { ...d, door_outcome: 'no_answer' as const } : d));
    store.payload.set(payload(doors));
    const { internals } = create();
    const byId = new Map(internals.markers().map((m) => [m.id, m]));
    // Walking order is 218, 220, 217; 218 is already knocked, so it keeps its
    // dot (blue, no number) while 220 and 217 stay numbered 2 and 3.
    expect(byId.get('10')?.label).toBeUndefined();
    expect(byId.get('10')?.variant).toBe('info');
    expect(byId.get('12')?.label).toBe('2');
    expect(byId.get('11')?.label).toBe('3');
    expect(byId.get('12')?.variant).toBe('primary');
    expect(byId.get('11')?.variant).toBe('warning');
  });

  it('draws one simplified dashed path through the remaining doors of a single street', () => {
    store.payload.set(payload(parityDoors()));
    const { internals } = create();
    const lines = internals.walkPath();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.dashed).toBe(true);
    expect(lines[0]?.path.length).toBeGreaterThanOrEqual(2);
  });

  it('draws no path across streets or in results mode', () => {
    const doors = parityDoors();
    doors.push(door({ id: '20', walk_order: 4, street: 'Scott Blvd', street_num: '1', lat: 43.71, lng: -79.26 }));
    store.payload.set(payload(doors));
    store.segmentKey.set(null);
    const { internals } = create();
    expect(internals.walkPath()).toHaveLength(0);

    store.segmentKey.set('alder st');
    expect(internals.walkPath()).toHaveLength(1);
    store.mapMode.set('results');
    expect(internals.walkPath()).toHaveLength(0);
  });

  it('counts every door in the scope, mapped or not', () => {
    const doors = parityDoors();
    doors.push(door({ id: '21', walk_order: 4, address: '222 Alder St', street_num: '222' }));
    store.payload.set(payload(doors));
    const { fixture } = create();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('4 of 4 doors left');
    expect(text).toContain(`1 door isn't on the map yet`);
  });

  it('says so when every door is done, and offers the next street only when one exists', () => {
    const doors = parityDoors().map((d) => ({ ...d, door_outcome: 'no_answer' as const }));
    store.payload.set(payload(doors));
    const { fixture } = create();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Every door on this turf is done.');
    expect(text).not.toContain('Pick the next street');
  });

  it('requests location only from the explicit tap, never on load', () => {
    const request = vi.spyOn(geo, 'request').mockImplementation(() => undefined);
    store.payload.set(payload(parityDoors()));
    const { fixture } = create();
    expect(request).not.toHaveBeenCalled();
    const find = fixture.debugElement
      .queryAll(By.css('button'))
      .find((b) => (b.nativeElement as HTMLElement).textContent?.includes('Find me on the map'));
    (find?.nativeElement as HTMLElement).click();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
