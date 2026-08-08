import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgModeService } from '../../../services/org-mode.service';
import { CanvassingService, type Coverage, type FieldReport } from '../services/canvassing-service';
import { CanvassingPage } from './canvassing-page';

/** The whole coverage picture, as the request that names no rectangle answers it. */
function fullCoverage(overrides: Partial<Extract<Coverage, { doors_only: false }>> = {}) {
  return {
    doors_only: false as const,
    doors: [
      { lat: 45.41, lng: -75.69, status: 'conversation' as const },
      { lat: 45.42, lng: -75.68, status: 'not_yet' as const },
    ],
    doors_in_view: 2,
    doors_total: 2,
    turfs: [
      {
        id: '1',
        name: 'Turf 1',
        boundary_name: 'W1',
        path: [
          { lat: 45.4, lng: -75.7 },
          { lat: 45.4, lng: -75.6 },
          { lat: 45.5, lng: -75.6 },
        ],
        doors: 2,
        conversation: 1,
        attempted: 0,
        not_yet: 1,
      },
    ],
    byBoundary: [{ boundary_name: 'W1', doors: 2, conversation: 1, attempted: 0, not_yet: 1 }],
    boundary_label: 'Ward',
    boundary_label_plural: 'Wards',
    ...overrides,
  };
}

/** The answer to a pan: the doors inside the new rectangle and nothing else. */
function doorsOnly(doors: { lat: number; lng: number; status: 'conversation' | 'attempted' | 'not_yet' }[]) {
  return { doors_only: true as const, doors, doors_in_view: doors.length };
}

function report(overrides: Partial<FieldReport> = {}): FieldReport {
  return {
    doors: 12,
    conversations: 5,
    contactRatePct: 42,
    supportIds: 3,
    responseMix: {
      supporter: 3,
      undecided: 1,
      non_supporter: 1,
      not_voting: 0,
      already_voted: 0,
      no_answer: 7,
    },
    perDay: [{ day: '2026-08-01', conversations: 5, no_answer: 7 }],
    byHour: [{ hour: 13, conversations: 5, attempts: 12 }],
    byTeam: [],
    topCanvassers: [{ name: 'Dana', doors: 12 }],
    ...overrides,
  };
}

/** A promise the test decides the fate of, for standing in for a read that has not answered yet. */
interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: Error) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let settleWith: (value: T) => void = () => undefined;
  let failWith: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    settleWith = res;
    failWith = rej;
  });
  return { promise, reject: (reason) => failWith(reason), resolve: (value) => settleWith(value) };
}

const SUMMARY = { turfCount: 1, inFieldCount: 0, doorsAttempted: 1, doorsTotal: 2, waitingCount: 0 };
const TODAY = {
  doorsKnocked: 1,
  conversations: 1,
  responseMix: { supporter: 1, undecided: 0, non_supporter: 0, not_voting: 0, already_voted: 0, no_answer: 0 },
};
const VIEWPORT = { north: 45.5, south: 45.3, east: -75.6, west: -75.8, zoom: 12 };

describe('CanvassingPage', () => {
  let fixture: ComponentFixture<CanvassingPage>;
  let component: CanvassingPage;
  let svc: {
    getCoverage: ReturnType<typeof vi.fn>;
    getFieldReport: ReturnType<typeof vi.fn>;
    getFieldSummary: ReturnType<typeof vi.fn>;
    getInFieldToday: ReturnType<typeof vi.fn>;
    getTurfs: ReturnType<typeof vi.fn>;
  };
  let alerts: {
    showError: ReturnType<typeof vi.fn>;
    showSuccess: ReturnType<typeof vi.fn>;
    showWarn: ReturnType<typeof vi.fn>;
  };

  /** Build the page and open the field report, which is where coverage lives. */
  async function openReport(): Promise<void> {
    fixture = TestBed.createComponent(CanvassingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    component['selectTab']('report');
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    svc = {
      getCoverage: vi.fn().mockResolvedValue(fullCoverage()),
      getFieldReport: vi.fn().mockResolvedValue(report()),
      getFieldSummary: vi.fn().mockResolvedValue(SUMMARY),
      getInFieldToday: vi.fn().mockResolvedValue(TODAY),
      getTurfs: vi.fn().mockResolvedValue([]),
    };
    alerts = { showError: vi.fn(), showSuccess: vi.fn(), showWarn: vi.fn() };

    TestBed.configureTestingModule({
      imports: [CanvassingPage],
      providers: [
        provideRouter([]),
        { provide: CanvassingService, useValue: svc },
        { provide: AlertService, useValue: alerts },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn(), prompt: vi.fn() } },
        { provide: OrgModeService, useValue: { term: () => 'Door knocking' } },
      ],
    });
  });

  describe('an answer that arrives after the reader has moved on', () => {
    it('drops a whole field-report read that a range change has already replaced', async () => {
      await openReport();
      // The next read hangs, then a second read answers first. The slow one belongs to the range
      // the reader has left, so neither half of it — the report or the coverage — may land.
      const stale = deferred<FieldReport>();
      svc.getFieldReport.mockReturnValueOnce(stale.promise);

      component['setRange']('today');
      component['setRange']('month');
      await fixture.whenStable();
      expect(component['report']()?.doors).toBe(12);

      stale.resolve(report({ doors: 999 }));
      await fixture.whenStable();
      expect(component['report']()?.doors).toBe(12);
    });

    it('says nothing about a failed read that a range change has already replaced', async () => {
      await openReport();
      const stale = deferred<FieldReport>();
      svc.getFieldReport.mockReturnValueOnce(stale.promise);

      component['setRange']('today');
      component['setRange']('month');
      await fixture.whenStable();

      stale.reject(new Error('gone'));
      await fixture.whenStable();
      expect(alerts.showError).not.toHaveBeenCalled();
    });

    it('drops a pan that is still waiting when the page is left, and stays silent about it', async () => {
      vi.useFakeTimers();
      try {
        fixture = TestBed.createComponent(CanvassingPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await vi.runAllTimersAsync();
        component['selectTab']('report');
        await vi.runAllTimersAsync();
        svc.getCoverage.mockClear();
        svc.getCoverage.mockRejectedValue(new Error('coverage is unavailable'));

        component['onCoverageViewport'](VIEWPORT);
        fixture.destroy();
        await vi.runAllTimersAsync();

        // The timer was cancelled, so the request for a page nobody is on was never made — and
        // no toast for it can appear over whatever page the reader opened next.
        expect(svc.getCoverage).not.toHaveBeenCalled();
        expect(alerts.showError).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('stays silent when a pan already in flight fails after the page is left', async () => {
      vi.useFakeTimers();
      try {
        fixture = TestBed.createComponent(CanvassingPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await vi.runAllTimersAsync();
        component['selectTab']('report');
        await vi.runAllTimersAsync();

        const pan = deferred<Coverage>();
        svc.getCoverage.mockReturnValueOnce(pan.promise);
        component['onCoverageViewport'](VIEWPORT);
        vi.advanceTimersByTime(400);
        fixture.destroy();
        pan.reject(new Error('coverage'));
        await vi.runAllTimersAsync();

        expect(alerts.showError).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('what a pan asks for and what it keeps', () => {
    it('keeps the turf outlines and the area roll-up that a pan does not re-send', async () => {
      vi.useFakeTimers();
      try {
        fixture = TestBed.createComponent(CanvassingPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await vi.runAllTimersAsync();
        component['selectTab']('report');
        await vi.runAllTimersAsync();

        svc.getCoverage.mockResolvedValue(doorsOnly([{ lat: 45.41, lng: -75.69, status: 'attempted' }]));
        component['onCoverageViewport'](VIEWPORT);
        await vi.runAllTimersAsync();

        const held = component['coverage']();
        expect(held?.doors).toEqual([{ lat: 45.41, lng: -75.69, status: 'attempted' }]);
        expect(held?.doors_in_view).toBe(1);
        // None of these came back with the pan, and none of them can have changed because the map
        // moved, so the page still holds the ones the first read gave it.
        expect(held?.turfs).toHaveLength(1);
        expect(held?.byBoundary).toHaveLength(1);
        expect(held?.doors_total).toBe(2);
        expect(held?.boundary_label).toBe('Ward');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('the caption under the coverage map', () => {
    function caption(): string {
      return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
    }

    it('counts the doors it is drawing', async () => {
      await openReport();
      expect(caption()).toContain('2 of your 2 doors are in this view, each shown on its own');
    });

    it('says the view is empty rather than calling nothing "too many to draw"', async () => {
      svc.getCoverage.mockResolvedValue(fullCoverage({ doors: [], doors_in_view: 0, doors_total: 2 }));
      await openReport();
      expect(caption()).toContain('None of your 2 doors are in this view');
      expect(caption()).not.toContain('too many to draw');
    });

    it('explains the shaded outlines when there are more doors than can be drawn', async () => {
      svc.getCoverage.mockResolvedValue(fullCoverage({ doors: [], doors_in_view: 9000, doors_total: 9000 }));
      await openReport();
      expect(caption()).toContain('9,000 doors are in this view — too many to draw one by one');
    });
  });
});
