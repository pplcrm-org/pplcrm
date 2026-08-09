import { Component, DestroyRef, inject, signal, OnInit, computed, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardService, DashboardStats, DashboardUserLiveRow } from './services/dashboard.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { SpinOnClickDirective } from '@uxcommon/directives/spin-on-click.directive';
import { TabBar, type PcTabOption } from '@uxcommon/components/tabs/tabs';
import { SlaDetails } from './sla-details';
import { GettingStartedCard } from './getting-started-card';
import { DemoModeCard } from './demo-mode-card';
import { AuthService } from '../../auth/auth-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { getUserErrorMessage } from '../../services/api/user-message';
import { DASHBOARD_STATS_WINDOW_KEYS, DashboardStatsWindowKey, DashboardWindowStatsType } from '@common';

interface UpcomingEvent {
  id: string;
  name: string;
  start_time: string;
  capacity: number | null;
  location_address: string | null;
}

interface DraftNewsletter {
  id: string;
  name: string;
  total_recipients: number;
}

/** Row shape the representative-performance table renders: live open/breach counts joined to the selected window's closed/response numbers. */
interface UserStatsRow {
  user_id: string;
  first_name: string;
  last_name: string;
  openCount: number;
  closedCount: number;
  resolutionRate: number;
  avgFirstResponse: string;
  emailSlaBreaches: number;
  taskSlaBreaches: number;
}

/** Snapshot older than this reads in a warning tone: the nightly job likely failed. */
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000;
/** How often to poll `getStats` while a snapshot refresh is pending. */
const REFRESH_POLL_INTERVAL_MS = 4000;
/** Stop polling after this long even if the snapshot never lands, so a stuck job doesn't spin forever. */
const REFRESH_POLL_TIMEOUT_MS = 60_000;

const WINDOW_LABELS: Record<DashboardStatsWindowKey, string> = {
  d7: 'Last 7 days',
  d30: 'Last 30 days',
  d60: 'Last 60 days',
  d90: 'Last 90 days',
};

const WINDOW_TAB_OPTIONS: PcTabOption[] = [
  { id: 'd7', label: '7d' },
  { id: 'd30', label: '30d' },
  { id: 'd60', label: '60d' },
  { id: 'd90', label: '90d' },
];

function isDashboardStatsWindowKey(value: string): value is DashboardStatsWindowKey {
  return (DASHBOARD_STATS_WINDOW_KEYS as readonly string[]).includes(value);
}

@Component({
  imports: [EmptyState, Icon, SpinOnClickDirective, TabBar, SlaDetails, GettingStartedCard, DemoModeCard, RouterLink],
  selector: 'pc-summary',
  templateUrl: './summary.html',
})
export class Summary implements OnInit {
  private readonly dashboardSvc = inject(DashboardService);
  private readonly alertSvc = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const tab = this.defaultSlaTab();
      const open = this.showSlaDetails();
      if (open) {
        if (tab === 'emails') {
          if (this.breachedEmails().length === 0) {
            this.emailPage.set(1);
            void this.loadMoreEmails();
          }
        } else {
          if (this.breachedTasks().length === 0) {
            this.taskPage.set(1);
            void this.loadMoreTasks();
          }
        }
      }
    });

    // Poll while a snapshot refresh is pending (queued on load or by the Refresh control) and stop
    // as soon as it clears — either because the snapshot landed or the poll timed out.
    effect(() => {
      if (this.snapshotRefreshPending()) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    });
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  private readonly _loading = createLoadingGate();
  protected readonly isRefreshing = signal(false);

  // Greeting + date line (§1 "where am I": name the person and the day)
  private readonly currentUser = this.auth.getUserSignal();
  protected readonly todayLabel = computed(() =>
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  );
  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const name = this.currentUser()?.first_name?.trim();
    return name ? `Good ${part}, ${name}` : `Good ${part}`;
  });

  // LIVE KPIs (always fresh, every load)
  protected readonly unassignedOpenCount = signal(0);
  protected readonly totalOpenCount = signal(0);
  protected readonly activeContactsCount = signal(0);
  /** Raw per-user live rows (open counts + SLA breach counts); joined with the snapshot window below. */
  protected readonly userLive = signal<DashboardUserLiveRow[]>([]);

  // Next-action context (real data from the backend; null when nothing applies)
  protected readonly oldestUnassignedAgeHours = signal<number | null>(null);
  protected readonly firstResponseDueHours = signal<number | null>(null);
  protected readonly draftNewsletter = signal<DraftNewsletter | null>(null);
  protected readonly upcomingEvents = signal<UpcomingEvent[]>([]);

  // SLA Signals (LIVE)
  protected readonly unassignedEmailSlaBreaches = signal(0);
  protected readonly unassignedTaskSlaBreaches = signal(0);
  protected readonly totalEmailSlaBreaches = computed(
    () => this.unassignedEmailSlaBreaches() + this.userLive().reduce((acc, u) => acc + u.emailSlaBreaches, 0),
  );
  protected readonly totalTaskSlaBreaches = computed(
    () => this.unassignedTaskSlaBreaches() + this.userLive().reduce((acc, u) => acc + u.taskSlaBreaches, 0),
  );

  protected readonly breachedEmails = signal<unknown[]>([]);
  protected readonly breachedTasks = signal<unknown[]>([]);
  protected readonly emailPage = signal(1);
  protected readonly taskPage = signal(1);
  protected readonly hasMoreEmails = signal(false);
  protected readonly hasMoreTasks = signal(false);
  protected readonly isLoadingEmails = signal(false);
  protected readonly isLoadingTasks = signal(false);

  protected readonly emailSlaHours = signal(24);
  protected readonly taskSlaHours = signal(24);
  protected readonly emailSlaWarningThreshold = signal(1);
  protected readonly emailSlaCriticalThreshold = signal(4);
  protected readonly taskSlaWarningThreshold = signal(1);
  protected readonly taskSlaCriticalThreshold = signal(4);
  protected readonly showSlaDetails = signal(false);
  protected readonly defaultSlaTab = signal<'emails' | 'tasks'>('emails');

  protected readonly emailSlaStatus = computed(() => {
    const breaches = this.totalEmailSlaBreaches();
    const warning = this.emailSlaWarningThreshold();
    const critical = this.emailSlaCriticalThreshold();
    if (breaches === 0) return 'healthy';
    if (breaches >= critical) return 'critical';
    if (breaches >= warning) return 'warning';
    return 'healthy';
  });

  /** One-word email-health phrase for the briefing paragraph. */
  protected readonly emailHealthWord = computed(() => {
    switch (this.emailSlaStatus()) {
      case 'critical':
        return 'breaching SLA';
      case 'warning':
        return 'under pressure';
      default:
        return 'healthy';
    }
  });

  // SVG line chart data (contacts growth) — LIVE, fixed 30-day window, unrelated to the snapshot selector.
  protected readonly linePath = signal('');
  protected readonly areaPath = signal('');
  protected readonly linePoints = signal<Array<{ x: number; y: number; date: string; count: number }>>([]);
  /** True only on the very first load (no data yet) — drives stat-tile skeletons over a spinner. */
  protected readonly isInitialLoading = computed(() => !this._loading.loaded());
  protected readonly yAxisLabels = signal<{ y: number; value: number }[]>([]);
  protected readonly xAxisLabels = signal<{ x: number; label: string }[]>([]);
  protected readonly hoveredPoint = signal<{ x: number; y: number; date: string; count: number } | null>(null);

  // Retrospective statistics — a per-tenant snapshot computed by a background job (REVIEW6 T1-3).
  protected readonly windowKey = signal<DashboardStatsWindowKey>('d30');
  protected readonly windowOptions = WINDOW_TAB_OPTIONS;
  protected readonly windowLabel = computed(() => WINDOW_LABELS[this.windowKey()]);

  protected readonly snapshotComputedAt = signal<string | null>(null);
  protected readonly snapshotRefreshPending = signal(false);
  protected readonly snapshotWindows = signal<Record<DashboardStatsWindowKey, DashboardWindowStatsType> | null>(null);
  protected readonly hasSnapshot = computed(() => this.snapshotWindows() != null);

  protected readonly selectedWindow = computed<DashboardWindowStatsType | null>(
    () => this.snapshotWindows()?.[this.windowKey()] ?? null,
  );
  protected readonly avgFirstResponse = computed(() =>
    this.formatHoursOrDash(this.selectedWindow()?.avgFirstResponseHours ?? null),
  );
  protected readonly avgTimeToClose = computed(() =>
    this.formatHoursOrDash(this.selectedWindow()?.avgTimeToCloseHours ?? null),
  );
  /** Global resolution rate for the window: closed / (closed + currently open), 0 with no denominator. */
  protected readonly resolutionRate = computed(() => {
    const win = this.selectedWindow();
    if (!win) return 0;
    const denom = win.closedCount + this.totalOpenCount();
    return denom > 0 ? Math.round((win.closedCount / denom) * 100) : 0;
  });

  protected readonly userStats = computed<UserStatsRow[]>(() => {
    const win = this.selectedWindow();
    const perUser = new Map((win?.perUser ?? []).map((u) => [u.user_id, u]));
    return this.userLive().map((u) => {
      const w = perUser.get(u.user_id);
      const closedCount = w?.closedCount ?? 0;
      const denom = closedCount + u.openCount;
      return {
        user_id: u.user_id,
        first_name: u.first_name,
        last_name: u.last_name,
        openCount: u.openCount,
        closedCount,
        resolutionRate: denom > 0 ? Math.round((closedCount / denom) * 100) : 0,
        avgFirstResponse: this.formatHoursOrDash(w?.avgFirstResponseHours ?? null),
        emailSlaBreaches: u.emailSlaBreaches,
        taskSlaBreaches: u.taskSlaBreaches,
      };
    });
  });

  /** Warning tone once the snapshot is more than 24h old — the nightly job likely failed. */
  protected readonly isStale = computed(() => {
    const iso = this.snapshotComputedAt();
    if (!iso) return false;
    return Date.now() - new Date(iso).getTime() > SNAPSHOT_STALE_MS;
  });
  protected readonly asOfLabel = computed(() => {
    const iso = this.snapshotComputedAt();
    return iso ? this.formatAsOf(iso) : '';
  });

  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pollStartedAt = 0;

  public ngOnInit() {
    void this.loadStats();
  }

  protected async loadStats(announce = false) {
    if (this.isRefreshing()) return;
    this.isRefreshing.set(true);
    const start = Date.now();
    const end = this._loading.begin();
    try {
      const stats = await this.dashboardSvc.getStats();
      this.applyStats(stats);

      if (announce) {
        this.alertSvc.showSuccess('Stats reloaded. All figures current as of now');
      }
    } catch {
      this.alertSvc.showError('Failed to load dashboard metrics');
    } finally {
      end();
      const elapsed = Date.now() - start;
      const minSpin = 1000; // spin at least once (1 second minimum)
      if (elapsed < minSpin) {
        await new Promise((resolve) => setTimeout(resolve, minSpin - elapsed));
      }
      this.isRefreshing.set(false);
    }
  }

  /** Queue a background snapshot refresh (REVIEW6 T1-3). Rate-limited server-side to 3 per 5 minutes. */
  protected async refreshStats(): Promise<void> {
    if (this.snapshotRefreshPending()) return;
    try {
      await this.dashboardSvc.refreshStats();
      this.snapshotRefreshPending.set(true);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not queue a statistics refresh. Please try again.'));
    }
  }

  protected setWindow(id: string): void {
    if (!isDashboardStatsWindowKey(id)) return;
    this.windowKey.set(id);
  }

  /** Applies one `getStats` response to every live + snapshot signal. Shared by loadStats and the refresh poll. */
  private applyStats(stats: DashboardStats): void {
    this.unassignedOpenCount.set(stats.unassignedCount || 0);
    this.totalOpenCount.set(stats.totalOpenCount || 0);
    this.userLive.set(stats.userLive ?? []);

    const totalNewContacts = (stats.contactsGrowth || []).reduce(
      (acc: number, cur: { count?: number }) => acc + Number(cur.count || 0),
      0,
    );
    this.activeContactsCount.set(totalNewContacts);

    // Next-action context
    this.oldestUnassignedAgeHours.set(stats.oldestUnassignedAgeHours ?? null);
    this.firstResponseDueHours.set(stats.firstResponseDueHours ?? null);
    this.draftNewsletter.set(stats.draftNewsletter ?? null);
    this.upcomingEvents.set(stats.upcomingEvents ?? []);

    // Live SLA breaches
    this.unassignedEmailSlaBreaches.set(stats.unassignedEmailSlaBreaches || 0);
    this.unassignedTaskSlaBreaches.set(stats.unassignedTaskSlaBreaches || 0);

    // Reset breached lists (loaded on demand when the drill-down opens)
    if (this.showSlaDetails()) {
      if (this.defaultSlaTab() === 'emails') {
        this.breachedEmails.set([]);
        this.emailPage.set(1);
      } else {
        this.breachedTasks.set([]);
        this.taskPage.set(1);
      }
    } else {
      this.breachedEmails.set([]);
      this.emailPage.set(1);
      this.hasMoreEmails.set(false);

      this.breachedTasks.set([]);
      this.taskPage.set(1);
      this.hasMoreTasks.set(false);
    }

    this.emailSlaHours.set(stats.emailSlaHours ?? 24);
    this.taskSlaHours.set(stats.taskSlaHours ?? 24);
    this.emailSlaWarningThreshold.set(stats.emailSlaWarningThreshold ?? 1);
    this.emailSlaCriticalThreshold.set(stats.emailSlaCriticalThreshold ?? 4);
    this.taskSlaWarningThreshold.set(stats.taskSlaWarningThreshold ?? 1);
    this.taskSlaCriticalThreshold.set(stats.taskSlaCriticalThreshold ?? 4);

    // Retrospective snapshot (background job; may not exist yet)
    this.snapshotComputedAt.set(stats.snapshot.computedAt);
    this.snapshotRefreshPending.set(stats.snapshot.refreshPending);
    this.snapshotWindows.set(stats.snapshot.windows);

    // Line chart: contacts growth (last 30 days, always live)
    const growth = stats.contactsGrowth || [];
    const maxCount = Math.max(...growth.map((g: { count: number }) => g.count), 1);
    const width = 600;
    const height = 200;
    const padding = 20;

    const points: Array<{ x: number; y: number; date: string; count: number }> = growth.map(
      (g: { date: string; count: number }, i: number) => {
        const x = padding + (i / Math.max(growth.length - 1, 1)) * (width - padding * 2);
        const y = height - padding - (g.count / maxCount) * (height - padding * 2);
        return { x, y, date: g.date, count: g.count };
      },
    );
    this.linePoints.set(points);

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (firstPoint && lastPoint) {
      const lPath = points.map((p, i: number) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      this.linePath.set(lPath);
      this.areaPath.set(`${lPath} L ${lastPoint.x} ${height - padding} L ${firstPoint.x} ${height - padding} Z`);
    } else {
      this.linePath.set('');
      this.areaPath.set('');
    }

    const yLabels = [
      { y: 20, value: maxCount },
      { y: 60, value: Math.round(maxCount * 0.75) },
      { y: 100, value: Math.round(maxCount * 0.5) },
      { y: 140, value: Math.round(maxCount * 0.25) },
      { y: 180, value: 0 },
    ];
    this.yAxisLabels.set(yLabels);

    const xLabels: { x: number; label: string }[] = [];
    if (points.length > 0) {
      const indices = [
        0,
        Math.floor(points.length * 0.25),
        Math.floor(points.length * 0.5),
        Math.floor(points.length * 0.75),
        points.length - 1,
      ];
      const uniqueIndices = Array.from(new Set(indices)).sort((a, b) => a - b);
      for (const idx of uniqueIndices) {
        const pt = points[idx];
        if (!pt) continue;
        let dateStr = pt.date;
        try {
          const dateObj = new Date(pt.date);
          dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        } catch {
          /* keep raw date string on parse failure */
        }
        xLabels.push({ x: pt.x, label: dateStr });
      }
    }
    this.xAxisLabels.set(xLabels);
  }

  private formatHours(hours: number): string {
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes}m`;
    }
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return `${days}d ${remainingHours}h`;
    }
    return `${hours.toFixed(1)}h`;
  }

  /** "—" when the window holds no samples (backend sends null, never a fabricated 0). */
  private formatHoursOrDash(hours: number | null): string {
    return hours == null ? '—' : this.formatHours(hours);
  }

  /** "2:45 PM" today, "yesterday 2:45 PM", or "Jul 12 2:45 PM" further back. */
  private formatAsOf(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return time;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollStartedAt = Date.now();
    this.pollTimer = setInterval(() => void this.pollSnapshot(), REFRESH_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async pollSnapshot(): Promise<void> {
    if (Date.now() - this.pollStartedAt >= REFRESH_POLL_TIMEOUT_MS) {
      this.stopPolling();
      this.snapshotRefreshPending.set(false);
      return;
    }
    try {
      const stats = await this.dashboardSvc.getStats();
      const changed = stats.snapshot.computedAt !== this.snapshotComputedAt();
      this.applyStats(stats);
      if (changed) this.stopPolling();
    } catch {
      // Transient — the next tick retries; the effect stops the interval once refreshPending clears.
    }
  }

  /** Short "2h" / "3d" relative label for the next-action cards. */
  protected roundedHours(hours: number | null): string {
    if (hours == null) return '—';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours >= 24) return `${Math.round(hours / 24)}d`;
    return `${Math.round(hours)}h`;
  }

  protected formatEventTime(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  }

  protected formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } catch {
      return dateStr;
    }
  }

  protected toggleSlaDetails(tab: 'emails' | 'tasks') {
    if (this.showSlaDetails() && this.defaultSlaTab() === tab) {
      this.showSlaDetails.set(false);
    } else {
      this.defaultSlaTab.set(tab);
      this.showSlaDetails.set(true);
    }
  }

  protected async loadMoreEmails() {
    if (this.isLoadingEmails()) return;
    this.isLoadingEmails.set(true);
    try {
      const res = await this.dashboardSvc.getBreachedEmails(this.emailPage(), 10);
      if (this.emailPage() === 1) {
        this.breachedEmails.set(res.items);
      } else {
        this.breachedEmails.update((prev) => [...prev, ...res.items]);
      }
      this.hasMoreEmails.set(res.hasMore);
      this.emailPage.update((p) => p + 1);
    } catch {
      this.alertSvc.showError('Failed to load breached emails');
    } finally {
      this.isLoadingEmails.set(false);
    }
  }

  protected async loadMoreTasks() {
    if (this.isLoadingTasks()) return;
    this.isLoadingTasks.set(true);
    try {
      const res = await this.dashboardSvc.getBreachedTasks(this.taskPage(), 10);
      if (this.taskPage() === 1) {
        this.breachedTasks.set(res.items);
      } else {
        this.breachedTasks.update((prev) => [...prev, ...res.items]);
      }
      this.hasMoreTasks.set(res.hasMore);
      this.taskPage.update((p) => p + 1);
    } catch {
      this.alertSvc.showError('Failed to load breached tasks');
    } finally {
      this.isLoadingTasks.set(false);
    }
  }
}
