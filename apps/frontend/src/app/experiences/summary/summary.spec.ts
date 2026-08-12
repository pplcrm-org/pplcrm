import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Summary } from './summary';
import { DashboardService } from './services/dashboard.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AuthService } from '../../auth/auth-service';
import { vi, describe, beforeEach, it, expect, afterEach } from 'vitest';

/** One `snapshot.windows[key]` entry with every field defaulted to "no data yet". */
function emptyWindow(overrides: Record<string, unknown> = {}) {
  return {
    closedCount: 0,
    responseCount: 0,
    avgFirstResponseHours: null,
    timeToCloseCount: 0,
    avgTimeToCloseHours: null,
    perUser: [],
    ...overrides,
  };
}

/** A well-formed `dashboard.getStats` response (REVIEW6 T1-3 shape), overridable per test. */
function statsFixture(overrides: Record<string, unknown> = {}) {
  return {
    unassignedCount: 0,
    totalOpenCount: 0,
    field: { doorsKnocked7d: 0, conversations7d: 0, turfsKnockingNow: 0 },
    userLive: [],
    contactsGrowth: [],
    oldestUnassignedAgeHours: null,
    firstResponseDueHours: null,
    draftNewsletter: null,
    upcomingEvents: [],
    unassignedSlaBreaches: 0,
    unassignedEmailSlaBreaches: 0,
    unassignedTaskSlaBreaches: 0,
    snapshot: {
      computedAt: new Date().toISOString(),
      refreshPending: false,
      windows: { d7: emptyWindow(), d30: emptyWindow(), d60: emptyWindow(), d90: emptyWindow() },
    },
    taskSlaHours: 24,
    emailSlaHours: 24,
    emailSlaWarningThreshold: 1,
    emailSlaCriticalThreshold: 4,
    taskSlaWarningThreshold: 1,
    taskSlaCriticalThreshold: 4,
    ...overrides,
  };
}

describe('summary', () => {
  let component: Summary;
  let fixture: ComponentFixture<Summary>;
  let mockDashboardSvc: any;
  let mockAlertSvc: any;

  beforeEach(async () => {
    mockDashboardSvc = {
      getStats: vi.fn().mockResolvedValue(statsFixture()),
      refreshStats: vi.fn().mockResolvedValue({ status: 'queued' }),
      getBreachedEmails: vi.fn().mockResolvedValue({ items: [], totalCount: 0, hasMore: false }),
      getBreachedTasks: vi.fn().mockResolvedValue({ items: [], totalCount: 0, hasMore: false }),
    };

    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [Summary],
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: mockDashboardSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: AuthService, useValue: { getUserSignal: () => () => null } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should be defined', () => {
    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should manage isRefreshing state with minimum duration delay', async () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;

    expect(component['isRefreshing']()).toBe(false);

    // Trigger loadStats manually
    const loadPromise = component['loadStats']();

    // isRefreshing should immediately be true
    expect(component['isRefreshing']()).toBe(true);

    // Let the service call resolve, then advance timers
    await Promise.resolve(); // allow microtasks (like getStats resolving) to run

    // Advance by 500ms
    vi.advanceTimersByTime(500);
    expect(component['isRefreshing']()).toBe(true);

    // Advance by another 500ms
    vi.advanceTimersByTime(500);

    // Wait for the loadStats promise to completely finish
    await loadPromise;

    expect(component['isRefreshing']()).toBe(false);
  });

  it('should not trigger multiple loads if already refreshing', async () => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;

    // First load
    const firstLoad = component['loadStats']();
    expect(mockDashboardSvc.getStats).toHaveBeenCalledTimes(1);

    // Second load call immediately while refreshing
    const secondLoad = component['loadStats']();
    expect(mockDashboardSvc.getStats).toHaveBeenCalledTimes(1); // Still 1

    // Finish the refreshing
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    await firstLoad;
    await secondLoad;

    expect(component['isRefreshing']()).toBe(false);

    // Call load again after finishing
    void component['loadStats']();
    expect(mockDashboardSvc.getStats).toHaveBeenCalledTimes(2);

    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });

  it('switches the displayed window without refetching (all windows already in the payload)', async () => {
    mockDashboardSvc.getStats.mockResolvedValue(
      statsFixture({
        totalOpenCount: 10,
        snapshot: {
          computedAt: new Date().toISOString(),
          refreshPending: false,
          windows: {
            d7: emptyWindow({ closedCount: 7, avgFirstResponseHours: 1 }),
            d30: emptyWindow({ closedCount: 30, avgFirstResponseHours: 5 }),
            d60: emptyWindow({ closedCount: 60, avgFirstResponseHours: 10 }),
            d90: emptyWindow({ closedCount: 90, avgFirstResponseHours: 20 }),
          },
        },
      }),
    );

    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit -> loadStats()
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockDashboardSvc.getStats).toHaveBeenCalledTimes(1);
    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('5.0h'); // d30 avgFirstResponseHours, the default window
    expect(text).toContain('75%'); // 30 closed / (30 closed + 10 open)

    component['setWindow']('d7');
    fixture.detectChanges();

    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1.0h'); // d7 avgFirstResponseHours
    expect(text).toContain('41%'); // 7 closed / (7 closed + 10 open), rounded
    expect(mockDashboardSvc.getStats).toHaveBeenCalledTimes(1); // no refetch — the window switch is local
  });

  it('shows a calm "calculating" state when snapshot.windows is null, while the live half renders normally', async () => {
    mockDashboardSvc.getStats.mockResolvedValue(
      statsFixture({
        totalOpenCount: 42,
        snapshot: { computedAt: null, refreshPending: false, windows: null },
      }),
    );

    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Statistics are being calculated');
    expect(text).not.toContain('Avg first response');
    expect(text).toContain('42'); // the live "Open emails" tile still renders
  });

  it('renders the "as of" line in a warning tone once the snapshot is more than 24h old', async () => {
    const staleIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockDashboardSvc.getStats.mockResolvedValue(
      statsFixture({
        snapshot: {
          computedAt: staleIso,
          refreshPending: false,
          windows: { d7: emptyWindow(), d30: emptyWindow(), d60: emptyWindow(), d90: emptyWindow() },
        },
      }),
    );

    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['isStale']()).toBe(true);

    // Several ancestor divs also contain this text; the innermost (last in document order) is the
    // one carrying the tone class.
    const el = fixture.nativeElement as HTMLElement;
    const matches = Array.from(el.querySelectorAll('div')).filter((d) => d.textContent?.includes('Statistics as of'));
    const asOfEl = matches[matches.length - 1];
    expect(asOfEl?.classList.contains('text-warning')).toBe(true);
  });

  it('clicking refresh calls the mutation and starts polling for the new snapshot', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    mockDashboardSvc.getStats.mockResolvedValue(
      statsFixture({
        snapshot: {
          computedAt: new Date().toISOString(),
          refreshPending: false,
          windows: { d7: emptyWindow(), d30: emptyWindow(), d60: emptyWindow(), d90: emptyWindow() },
        },
      }),
    );

    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component['snapshotRefreshPending']()).toBe(false);

    await component['refreshStats']();
    fixture.detectChanges(); // flush the effect that starts polling

    expect(mockDashboardSvc.refreshStats).toHaveBeenCalledTimes(1);
    expect(component['snapshotRefreshPending']()).toBe(true);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 4000);
  });

  it('shows the server-authored message when the refresh mutation is rate-limited', async () => {
    mockDashboardSvc.getStats.mockResolvedValue(
      statsFixture({
        snapshot: {
          computedAt: new Date().toISOString(),
          refreshPending: false,
          windows: { d7: emptyWindow(), d30: emptyWindow(), d60: emptyWindow(), d90: emptyWindow() },
        },
      }),
    );
    mockDashboardSvc.refreshStats.mockRejectedValue(new Error('Too many requests. Retry in 42 seconds.'));

    fixture = TestBed.createComponent(Summary);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    await component['refreshStats']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Too many requests. Retry in 42 seconds.');
    expect(component['snapshotRefreshPending']()).toBe(false);
  });
});
