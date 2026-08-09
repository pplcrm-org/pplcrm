import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityService } from '../../../experiences/activity/services/activity.service';
import { OrgModeService } from '../../../services/org-mode.service';
import { CanvassingService, type TurfDetail, type TurfDoor } from '../services/canvassing-service';
import { JoinCodesService } from '../../volunteer-access/services/join-codes-service';
import { TurfDetailPage } from './turf-detail-page';

/**
 * One door, spelled out enough that the walking order has something to sort on: a street,
 * a house number whose parity decides which side it is on, and the stored order the cutter
 * wrote. Coordinates are spread far enough apart that path simplification keeps them.
 */
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
 * Two streets, both with doors on either side of the road and a mix of statuses.
 *
 * Alder St starts on the even side (218 is the lowest stored order), so the walk goes up the
 * evens and back down the odds. Birch Rd starts on the odd side. Neither order is the stored
 * `walk_order`, which is the whole point: the page must show the derived order, not that.
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
  door({ household_id: 'b6', street: 'Birch Rd', street_num: '6', walk_order: 7, lat: 45.412, lng: -75.724 }),
];

/** Alder walks up the evens then back down the odds; Birch up the odds then back down the evens. */
const EXPECTED_ORDER = ['a218', 'a220', 'a221', 'a219', 'b5', 'b9', 'b6'];

function detail(overrides: Partial<TurfDetail> = {}): TurfDetail {
  return {
    id: 'turf-1',
    name: 'Turf 1',
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
    boundary: [
      { lat: 45.39, lng: -75.73 },
      { lat: 45.42, lng: -75.73 },
      { lat: 45.42, lng: -75.69 },
    ],
    canvassers: [],
    doors: DOORS,
    ...overrides,
  };
}

describe('TurfDetailPage', () => {
  let fixture: ComponentFixture<TurfDetailPage>;
  let component: TurfDetailPage;
  let svc: { getTurfDetail: ReturnType<typeof vi.fn> };

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(TurfDetailPage);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'turf-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  /** The door table's body rows, in the order they are rendered. */
  function bodyRows(): HTMLTableRowElement[] {
    const tables = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('table'));
    // The door table is the one numbering its rows; the roster table has no "#" column.
    const doorTable = tables.find((t) => t.querySelector('thead th')?.textContent?.trim() === '#');
    return doorTable ? Array.from(doorTable.querySelectorAll('tbody tr')) : [];
  }

  beforeEach(() => {
    svc = { getTurfDetail: vi.fn().mockResolvedValue(detail()) };

    TestBed.configureTestingModule({
      imports: [TurfDetailPage],
      providers: [
        provideRouter([]),
        { provide: CanvassingService, useValue: svc },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn(), showWarn: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(), prompt: vi.fn() } },
        { provide: OrgModeService, useValue: { term: () => 'Door knocking' } },
        {
          provide: JoinCodesService,
          useValue: { create: vi.fn(), getForCampaign: vi.fn().mockResolvedValue([]), qr: vi.fn() },
        },
        { provide: ActivityService, useValue: { getActivities: vi.fn().mockResolvedValue({ rows: [] }) } },
      ],
    });
  });

  describe('the order the doors are shown in', () => {
    it('lists the doors in the derived walking order, not the stored one', async () => {
      await open();
      const addresses = bodyRows().map((r) => r.querySelectorAll('td')[1]?.textContent?.trim() ?? '');
      expect(addresses).toEqual(EXPECTED_ORDER.map((id) => DOORS.find((d) => d.household_id === id)?.address));
    });

    it('numbers the rows 1..N by the walking order', async () => {
      await open();
      const numbers = bodyRows().map((r) => r.querySelectorAll('td')[0]?.textContent?.trim() ?? '');
      expect(numbers).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('keeps the walking order when a status filter narrows the table', async () => {
      await open();
      component['doorFilter'].set('not_yet');
      fixture.detectChanges();
      const numbers = bodyRows().map((r) => r.querySelectorAll('td')[0]?.textContent?.trim() ?? '');
      expect(numbers).toEqual(['1', '2', '4', '5', '7']);
    });
  });

  describe('the suggested walk drawn on the map', () => {
    it('draws one line per street and never joins two streets together', async () => {
      await open();
      const lines = component['polylines']();
      expect(lines.map((l) => l.id)).toEqual(['alder st', 'birch rd']);
      expect(lines.every((l) => l.dashed === true && l.variant === 'primary')).toBe(true);
    });

    it('leaves the doors that have already been knocked out of the line', async () => {
      await open();
      const alder = component['polylines']().find((l) => l.id === 'alder st');
      const talked = DOORS.find((d) => d.household_id === 'a221');
      expect(alder?.path.some((p) => p.lng === talked?.lng)).toBe(false);
    });

    it('numbers only the pins of doors still to walk', async () => {
      await open();
      const pins = component['markers']();
      expect(pins.find((p) => p.id === 'a218')?.label).toBe('1');
      expect(pins.find((p) => p.id === 'a221')?.label).toBeUndefined();
      expect(pins.find((p) => p.id === 'a218')?.tooltip).toContain('1 · 218 Alder St');
    });
  });

  describe('what the statuses are called', () => {
    it('calls an unknocked door "To walk" and a knocked one "Knocked, no answer"', async () => {
      await open();
      expect(text()).toContain('To walk');
      expect(text()).toContain('Knocked, no answer');
      expect(text()).toContain('Talked');
      expect(text()).not.toContain('Not yet knocked');
    });
  });
});
