import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgModeService } from '../../../services/org-mode.service';
import { CanvassingService, type TurfDetail, type TurfDoor } from '../services/canvassing-service';
import { JoinCodesService } from '../../volunteer-access/services/join-codes-service';
import { TurfPrintPage } from './turf-print-page';

function door(over: Partial<TurfDoor> & Pick<TurfDoor, 'household_id' | 'street' | 'street_num' | 'walk_order'>) {
  return {
    address: `${over.street_num} ${over.street}`,
    apt: null,
    attempts: 0,
    last_canvasser: null,
    last_knocked_at: null,
    last_outcome: null,
    last_response: null,
    lat: 45.4,
    lng: -75.7,
    residents: [],
    status: 'not_yet' as const,
    ...over,
  } satisfies TurfDoor;
}

/**
 * Two streets with doors on both sides, a talked door, a knocked-no-answer door, and one
 * door with no coordinates at all — the last one is the reason the sheet has to say how
 * many doors it could not place on the map.
 */
const DOORS: TurfDoor[] = [
  door({ household_id: 'a218', street: 'Alder St', street_num: '218', walk_order: 1, lat: 45.4, lng: -75.7 }),
  door({ household_id: 'a220', street: 'Alder St', street_num: '220', walk_order: 2, lat: 45.402, lng: -75.7 }),
  door({
    household_id: 'a221',
    street: 'Alder St',
    street_num: '221',
    walk_order: 3,
    lat: 45.403,
    lng: -75.706,
    residents: [{ id: 'p1', name: 'Ada Lovelace', dnc: false }],
    status: 'conversation',
  }),
  door({ household_id: 'a219', street: 'Alder St', street_num: '219', walk_order: 4, lat: 45.4, lng: -75.703 }),
  door({ household_id: 'b5', street: 'Birch Rd', street_num: '5', walk_order: 5, lat: 45.41, lng: -75.72 }),
  door({
    household_id: 'b9',
    street: 'Birch Rd',
    street_num: '9',
    walk_order: 6,
    lat: 45.414,
    lng: -75.72,
    status: 'attempted',
  }),
  door({
    household_id: 'b6',
    street: 'Birch Rd',
    street_num: '6',
    walk_order: 7,
    lat: null,
    lng: null,
  }),
];

const GEOCODED = DOORS.filter((d) => d.lat != null && d.lng != null).length;

/** Alder walks up the evens then back down the odds; Birch up the odds then back down the evens. */
const EXPECTED_ORDER = [
  '218 Alder St',
  '220 Alder St',
  '221 Alder St',
  '219 Alder St',
  '5 Birch Rd',
  '9 Birch Rd',
  '6 Birch Rd',
];

function detail(overrides: Partial<TurfDetail> = {}): TurfDetail {
  return {
    id: 'turf-1',
    name: 'Riverside 3',
    status: 'in_field',
    list_id: null,
    list_name: null,
    campaign_name: 'Test campaign',
    boundary_name: 'W1',
    boundary_set_id: 'set-1',
    boundary_label: 'Ward',
    door_count: DOORS.length,
    attempted: 2,
    conversations: 1,
    last_activity_at: null,
    centroid_lat: 45.41,
    centroid_lng: -75.71,
    boundary: [],
    canvassers: [],
    doors: DOORS,
    ...overrides,
  };
}

const CODE_ROW = {
  id: 'code-1',
  code: 'ABC123',
  status: 'active' as const,
  turf_id: 'turf-1',
  url: 'https://go.example.test/j/ABC123',
};

describe('TurfPrintPage', () => {
  let fixture: ComponentFixture<TurfPrintPage>;
  let svc: { getTurfDetail: ReturnType<typeof vi.fn> };
  let joinCodes: {
    create: ReturnType<typeof vi.fn>;
    getForCampaign: ReturnType<typeof vi.fn>;
    qr: ReturnType<typeof vi.fn>;
  };

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(TurfPrintPage);
    fixture.componentRef.setInput('id', 'turf-1');
    fixture.detectChanges();
    // The turf and then its join code are two chained reads, so one settle is not enough.
    for (let i = 0; i < 4; i++) await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function rows(): HTMLTableRowElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'));
  }

  /** Rows carrying a door, as opposed to the full-width street heading rows. */
  function doorRows(): HTMLTableRowElement[] {
    return rows().filter((r) => r.querySelectorAll('td').length === 6);
  }

  function streetHeadings(): string[] {
    return rows()
      .filter((r) => r.querySelectorAll('td').length === 1)
      .map((r) => r.textContent?.trim() ?? '');
  }

  beforeEach(() => {
    svc = { getTurfDetail: vi.fn().mockResolvedValue(detail()) };
    joinCodes = {
      create: vi.fn(),
      getForCampaign: vi.fn().mockResolvedValue([CODE_ROW]),
      qr: vi.fn().mockResolvedValue({
        code: 'ABC123',
        url: CODE_ROW.url,
        matrix: [
          [true, false],
          [false, true],
        ],
      }),
    };

    TestBed.configureTestingModule({
      imports: [TurfPrintPage],
      providers: [
        provideRouter([]),
        { provide: CanvassingService, useValue: svc },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn(), showWarn: vi.fn() } },
        { provide: OrgModeService, useValue: { term: () => 'Door knocking' } },
        { provide: JoinCodesService, useValue: joinCodes },
      ],
    });
  });

  describe('the head of the sheet', () => {
    it('names the turf and counts the doors and the ones still to walk', async () => {
      await open();
      expect(text()).toContain('Riverside 3');
      expect(text()).toContain('7 doors · 5 to walk');
      expect(text()).toContain('Start at: 218 Alder St');
      expect(text()).toContain('Alder St · Birch Rd');
    });
  });

  describe('the walk list', () => {
    it('heads each street with its name', async () => {
      await open();
      expect(streetHeadings()).toEqual(['Alder St', 'Birch Rd']);
    });

    it('lists the doors in walking order with the numbers the map uses', async () => {
      await open();
      const cells = doorRows().map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent?.trim() ?? ''));
      expect(cells.map((c) => c[1])).toEqual(EXPECTED_ORDER);
      expect(cells.map((c) => c[0])).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('leaves the result and notes columns empty to write in', async () => {
      await open();
      const cells = doorRows().map((r) => Array.from(r.querySelectorAll('td')).map((c) => c.textContent?.trim() ?? ''));
      expect(cells.every((c) => c[4] === '' && c[5] === '')).toBe(true);
      expect(cells[0]?.[3]).toBe('To walk');
      expect(cells[2]?.[3]).toBe('Talked');
      expect(cells[5]?.[3]).toBe('Knocked, no answer');
    });
  });

  describe('the schematic map', () => {
    it('draws one dot per door that has a map position, and says so for the rest', async () => {
      await open();
      const circles = (fixture.nativeElement as HTMLElement).querySelectorAll('svg circle');
      expect(circles.length).toBe(GEOCODED);
      expect(text()).toContain('1 doors have no map position yet; they appear only in the list.');
      expect(text()).toContain('Schematic map. Door positions are approximate and roads are not drawn.');
    });

    it('draws one dashed route through the doors still to walk, on a canvas sized to the turf', async () => {
      await open();
      const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
      const paths = svg?.querySelectorAll('path') ?? [];
      expect(paths.length).toBe(1);
      expect(paths[0]?.getAttribute('stroke-dasharray')).toBe('4 4');
      const height = Number((svg?.getAttribute('viewBox') ?? '').split(' ')[3]);
      expect(height).toBeGreaterThanOrEqual(240);
      expect(height).toBeLessThanOrEqual(520);
    });

    it('a finished turf still draws the route, through every placed door', async () => {
      svc.getTurfDetail.mockResolvedValue(
        detail({ doors: DOORS.map((d) => ({ ...d, status: 'conversation' as const })) }),
      );
      await open();
      // Scoped to the map's own svg — the join-code QR below it is an svg with a path too.
      const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
      expect(svg?.querySelectorAll('path').length).toBe(1);
    });
  });

  describe('the join code', () => {
    it('prints the code when there is one', async () => {
      await open();
      expect(text()).toContain('Have a phone? Scan to canvass in the app.');
      expect(text()).toContain('ABC123');
    });

    it('asks for the code quietly, so a plan gate can never toast over the sheet', async () => {
      await open();
      expect(joinCodes.getForCampaign).toHaveBeenCalledWith({ silent: true });
      expect(joinCodes.qr).toHaveBeenCalledWith('code-1', { silent: true });
    });

    it('still prints the sheet when the code service fails', async () => {
      joinCodes.getForCampaign.mockRejectedValue(new Error('codes are down'));
      await open();
      expect(text()).toContain('Riverside 3');
      expect(doorRows().length).toBe(DOORS.length);
      expect(text()).not.toContain('Have a phone?');
    });
  });
});
