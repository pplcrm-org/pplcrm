import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi, describe, beforeEach, it, expect } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { BreadcrumbsService } from '@uxcommon/components/breadcrumbs/breadcrumbs.service';

import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { DeliveriesRoutesService } from '../services/deliveries-routes-service';
import { DeliveriesRouteDetail } from './deliveries-route-detail';

/** A route with pending stop A (seq 1), delivered stop B (seq 2), pending stop C (seq 3). */
function fakeDetail() {
  const stop = (id: string, seq: number, status: string) => ({
    id,
    seq,
    status,
    request_id: `req-${id}`,
    leg_minutes: 2,
    reason: null,
    acted_at: null,
    acted_via: null,
    household_id: `hh-${id}`,
    request_status: status === 'delivered' ? 'delivered' : 'approved',
    lat: 45,
    lng: -75,
    first_name: id.toUpperCase(),
    person_id: null,
    address: `${seq} Test St`,
  });
  return {
    id: 'r1',
    name: 'Route',
    status: 'in_progress',
    volunteer_person_id: null,
    volunteer_name: null,
    start_address: '1 Start St',
    start_lat: 45,
    start_lng: -75,
    est_minutes: 10,
    est_km: 2,
    scheduled_for: null,
    link_active: false,
    link_expires_at: null,
    stops: [stop('a', 1, 'pending'), stop('b', 2, 'delivered'), stop('c', 3, 'pending')],
  };
}

describe('DeliveriesRouteDetail — route map inputs', () => {
  let component: DeliveriesRouteDetail;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeliveriesRouteDetail],
      providers: [
        { provide: DeliveriesRoutesService, useValue: { getById: vi.fn().mockResolvedValue(fakeDetail()) } },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
        { provide: BreadcrumbsService, useValue: { setCrumbs: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(), choose: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    })
      .overrideComponent(DeliveriesRouteDetail, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(DeliveriesRouteDetail);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('builds a start pin plus one numbered pin per located stop, tinted by status', () => {
    const markers = component['mapMarkers']();
    expect(markers).toHaveLength(4);
    expect(markers[0]).toMatchObject({ variant: 'info', tooltip: 'Start: 1 Start St' });
    expect(markers.slice(1).map((m) => m.label)).toEqual(['1', '2', '3']);
    // Stop b is delivered; the other two are still pending.
    expect(markers.slice(1).map((m) => m.variant)).toEqual(['primary', 'success', 'primary']);
  });

  it('draws the visit order as one dotted path starting at the start address', () => {
    const lines = component['mapRoute']();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.dashed).toBe(true);
    expect(lines[0]?.path).toHaveLength(4); // start + 3 located stops
    expect(lines[0]?.path[0]).toEqual({ lat: 45, lng: -75 });
  });

  it('narrates ungeocoded stops instead of silently dropping them', () => {
    const detail = fakeDetail();
    detail.stops = [{ ...detail.stops[0]!, lat: null as unknown as number, lng: null as unknown as number }];
    component['detail'].set(detail as any);

    expect(component['hasMap']()).toBe(false);
    expect(component['mapRoute']()).toEqual([]);
    expect(component['unlocatedNote']()).toContain("1 stop isn't on the map yet");
  });
});

describe('DeliveriesRouteDetail — drag-to-reorder stops', () => {
  let component: DeliveriesRouteDetail;
  let fixture: ComponentFixture<DeliveriesRouteDetail>;
  let mockSvc: any;
  let mockAlerts: any;

  beforeEach(async () => {
    mockSvc = {
      getById: vi.fn().mockResolvedValue(fakeDetail()),
      reorderStops: vi
        .fn()
        .mockResolvedValue({ id: 'r1', status: 'in_progress', est_minutes: 10, est_km: 2, stops: [] }),
      reorderStop: vi.fn(),
    };
    mockAlerts = { showError: vi.fn(), showSuccess: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [DeliveriesRouteDetail],
      providers: [
        { provide: DeliveriesRoutesService, useValue: mockSvc },
        { provide: AlertService, useValue: mockAlerts },
        { provide: BreadcrumbsService, useValue: { setCrumbs: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(), choose: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    })
      // Strip the template + child components — we only exercise the drop handler logic.
      .overrideComponent(DeliveriesRouteDetail, { set: { template: '', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(DeliveriesRouteDetail);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('moves a pending stop and persists the new pending order (delivered stop stays put)', async () => {
    component['detail'].set(fakeDetail() as any);
    // The reload after a successful persist returns the server's authoritative new order: C, B, A.
    const reloaded = fakeDetail();
    reloaded.stops = [
      { ...reloaded.stops[2]!, seq: 1 },
      { ...reloaded.stops[1]!, seq: 2 },
      { ...reloaded.stops[0]!, seq: 3 },
    ];
    mockSvc.getById.mockResolvedValue(reloaded);

    // Drag pending A (index 0) past delivered B to pending C's slot (index 2).
    await component['onStopDrop']({ previousIndex: 0, currentIndex: 2 } as any);

    // New pending order is C then A; the delivered stop is never listed in the persisted order.
    expect(mockSvc.reorderStops).toHaveBeenCalledWith('r1', ['c', 'a']);

    // After reconcile the delivered stop keeps its slot (seq 2); pending stops are swapped.
    const stops = component['detail']()!.stops;
    expect(stops.map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(stops.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(stops[1]!.id).toBe('b'); // delivered stop unmoved
  });

  it('refuses to move a non-pending stop (pending-only guard)', async () => {
    component['detail'].set(fakeDetail() as any);

    // Index 1 is the delivered stop B — the guard must reject it.
    await component['onStopDrop']({ previousIndex: 1, currentIndex: 0 } as any);

    expect(mockSvc.reorderStops).not.toHaveBeenCalled();
  });

  it('ignores a no-op drop', async () => {
    component['detail'].set(fakeDetail() as any);

    await component['onStopDrop']({ previousIndex: 0, currentIndex: 0 } as any);

    expect(mockSvc.reorderStops).not.toHaveBeenCalled();
  });

  it('rolls back the optimistic order and shows an error when persistence fails', async () => {
    mockSvc.reorderStops.mockRejectedValue(new Error('boom'));
    const snapshot = fakeDetail();
    component['detail'].set(snapshot as any);

    await component['onStopDrop']({ previousIndex: 0, currentIndex: 2 } as any);

    expect(mockAlerts.showError).toHaveBeenCalled();
    // Restored to the pre-drag order.
    expect(component['detail']()!.stops.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
