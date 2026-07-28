import { Component, type OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { Icon } from '@icons/icon';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcMapMarker, PcMapPolygon, PcMapVariant } from '@uxcommon/components/map/map-types';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { TabBar, type PcTabOption } from '@uxcommon/components/tabs/tabs';

import type { FieldReportRangeType } from '../../../../../../../libs/common/src';
import {
  CanvassingService,
  type Coverage,
  type FieldReport,
  type FieldSummary,
  type InFieldToday,
  type TurfListItem,
} from '../services/canvassing-service';
import { companionUrl, volunteerLinkSentPhrase } from '../../../shared/public-pages';
import { AssignTurfDialog } from './assign-turf-dialog';
import { CompanionSettingsDialog } from './companion-settings-dialog';
import { CutTurfsDialog } from './cut-turfs-dialog';

type TurfStatus = TurfListItem['status'];
type Tab = 'turfs' | 'report';
type ReportRange = FieldReportRangeType['range'];
type CoverageStatus = Coverage['doors'][number]['status'];
type CoverageView = 'map' | 'ward';

/** Door-dot colours on the coverage map: talked → knocked-no-answer → not yet. */
/** Names shown inline on a turf row before the rest collapse into a "+N" count. */
const MAX_CANVASSER_CHIPS = 2;

const COVERAGE_VARIANT: Record<CoverageStatus, PcMapVariant> = {
  conversation: 'success',
  attempted: 'warning',
  not_yet: 'muted',
};

const COVERAGE_LEGEND: { status: CoverageStatus; label: string; dot: string }[] = [
  { status: 'conversation', label: 'Conversation', dot: 'bg-success' },
  { status: 'attempted', label: 'Knocked, no answer', dot: 'bg-warning' },
  { status: 'not_yet', label: 'Not yet knocked', dot: 'bg-base-300' },
];

const STATUS_VARIANT: Record<TurfStatus, PcMapVariant> = {
  draft: 'neutral',
  assigned: 'info',
  in_field: 'success',
  complete: 'primary',
  retired: 'muted',
};

const STATUS_LABEL: Record<TurfStatus, string> = {
  draft: 'Draft (unassigned)',
  assigned: 'Sent to app',
  in_field: 'In field now',
  complete: 'Complete',
  retired: 'Retired',
};

const STATUS_BADGE: Record<TurfStatus, string> = {
  draft: 'badge-ghost',
  assigned: 'badge-info',
  in_field: 'badge-success',
  complete: 'badge-primary',
  retired: 'badge-ghost opacity-60',
};

const RANGES: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'campaign', label: 'Campaign' },
];

@Component({
  selector: 'pc-canvassing-page',
  imports: [DatePipe, Icon, PcMap, RowActions, TabBar, CutTurfsDialog, AssignTurfDialog, CompanionSettingsDialog],
  templateUrl: './canvassing-page.html',
})
export class CanvassingPage implements OnInit {
  private readonly svc = inject(CanvassingService);
  private readonly alerts = inject(AlertService);
  private readonly dialog = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;

  protected readonly tab = signal<Tab>('turfs');

  protected readonly pageTabs: PcTabOption[] = [
    { id: 'turfs', label: 'Turfs & assignments' },
    { id: 'report', label: 'Field report' },
  ];
  protected readonly turfs = signal<TurfListItem[]>([]);
  protected readonly summary = signal<FieldSummary | null>(null);
  protected readonly today = signal<InFieldToday | null>(null);

  protected readonly reportRange = signal<ReportRange>('week');
  protected readonly report = signal<FieldReport | null>(null);
  protected readonly coverage = signal<Coverage | null>(null);
  protected readonly coverageView = signal<CoverageView>('map');

  protected readonly cutOpen = signal(false);
  /** Turf currently being assigned in the pick-a-volunteer dialog (null = closed). */
  protected readonly assignTarget = signal<TurfListItem | null>(null);
  /** Companion survey settings dialog (issues vocabulary + door script). */
  protected readonly settingsOpen = signal(false);

  protected readonly ranges = RANGES;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusBadge = STATUS_BADGE;
  protected readonly coverageLegend = COVERAGE_LEGEND;

  ngOnInit(): void {
    void this.loadTurfs();
  }

  /** Header sentence: "9 turfs · 3 in the field now · 1,412 of 2,860 doors attempted · 2 waiting for a canvasser". */
  protected readonly headline = computed<string>(() => {
    const s = this.summary();
    if (!s) return '';
    const parts = [
      `${s.turfCount} ${s.turfCount === 1 ? 'turf' : 'turfs'}`,
      `${s.inFieldCount} in the field now`,
      `${s.doorsAttempted.toLocaleString()} of ${s.doorsTotal.toLocaleString()} doors attempted`,
      `${s.waitingCount} waiting for a canvasser`,
    ];
    return parts.join(' · ');
  });

  /** Response-mix stacked bar segments for the "in the field today" card. */
  protected readonly todaySegments = computed(() => {
    const t = this.today();
    if (!t) return [];
    const m = t.responseMix;
    return [
      { key: 'supporter', label: 'Supporters', value: m.supporter, cls: 'bg-success' },
      { key: 'undecided', label: 'Undecided', value: m.undecided, cls: 'bg-warning' },
      { key: 'non_supporter', label: 'Non-supporters', value: m.non_supporter, cls: 'bg-error' },
      { key: 'not_voting', label: 'Not voting', value: m.not_voting, cls: 'bg-base-content/30' },
      { key: 'already_voted', label: 'Already voted', value: m.already_voted, cls: 'bg-info' },
      { key: 'no_answer', label: 'No answer', value: m.no_answer, cls: 'bg-base-300' },
    ].filter((s) => s.value > 0);
  });

  protected readonly todayTotal = computed<number>(() => this.todaySegments().reduce((n, s) => n + s.value, 0));

  /**
   * Tinted turf-centroid markers over the ward map (§13.1 turf map strip).
   * Each turf's stored centroid is pinned and tinted by its live status. (Filled
   * polygons per turf need the door hull — a follow-up; centroids read honestly.)
   */
  protected readonly mapMarkers = computed<PcMapMarker[]>(() => {
    return this.turfs()
      .filter((t) => t.status !== 'retired' && t.centroid_lat != null && t.centroid_lng != null)
      .map((t) => ({
        position: { lat: Number(t.centroid_lat), lng: Number(t.centroid_lng) },
        variant: this.variantFor(t.status),
        tooltip: `${t.name} — ${this.statusLabel[t.status]}`,
        id: t.id,
        payload: t.id,
      }));
  });

  protected readonly hasMap = computed<boolean>(() => this.mapMarkers().length > 0);

  protected variantFor(status: TurfStatus): PcMapVariant {
    return STATUS_VARIANT[status];
  }

  protected progressPct(t: TurfListItem): number {
    if (t.door_count <= 0) return 0;
    return Math.min(100, Math.round((t.attempted / t.door_count) * 100));
  }

  protected async loadTurfs(): Promise<void> {
    const end = this._loading.begin();
    try {
      const [turfs, summary, today] = await Promise.all([
        this.svc.getTurfs(),
        this.svc.getFieldSummary(),
        this.svc.getInFieldToday(),
      ]);
      this.turfs.set(turfs);
      this.summary.set(summary);
      this.today.set(today);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load canvassing.');
    } finally {
      end();
    }
  }

  protected async loadReport(): Promise<void> {
    const end = this._loading.begin();
    const range = { range: this.reportRange(), from: null, to: null };
    try {
      const [report, coverage] = await Promise.all([this.svc.getFieldReport(range), this.svc.getCoverage(range)]);
      this.report.set(report);
      this.coverage.set(coverage);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load field report.');
    } finally {
      end();
    }
  }

  /** Coverage door dots, coloured by whether we talked, knocked, or haven't reached them. */
  protected readonly coverageMarkers = computed<PcMapMarker[]>(() => {
    const cov = this.coverage();
    if (!cov) return [];
    return cov.doors.map((d) => ({
      position: { lat: d.lat, lng: d.lng },
      variant: COVERAGE_VARIANT[d.status],
    }));
  });

  /** Dashed turf boundaries (convex hull of each turf's doors). */
  protected readonly coveragePolygons = computed<PcMapPolygon[]>(() => {
    const cov = this.coverage();
    if (!cov) return [];
    return cov.turfs.map((t) => ({
      path: t.path,
      variant: 'neutral' as const,
      dashed: true,
      label: t.name,
      id: t.id,
    }));
  });

  protected selectTab(tab: string): void {
    if (tab !== 'turfs' && tab !== 'report') return;
    this.tab.set(tab);
    if (tab === 'report' && !this.report()) void this.loadReport();
  }

  protected setRange(range: ReportRange): void {
    this.reportRange.set(range);
    void this.loadReport();
  }

  protected openCut(): void {
    this.cutOpen.set(true);
  }

  protected onCutDone(created: number): void {
    this.cutOpen.set(false);
    if (created > 0) {
      this.alerts.showSuccess(`Cut ${created} ${created === 1 ? 'turf' : 'turfs'}.`);
      void this.loadTurfs();
    }
  }

  /** Open the canvasser roster for this turf (plan §5 B1). */
  protected assign(t: TurfListItem): void {
    this.assignTarget.set(t);
  }

  protected visibleCanvassers(t: TurfListItem): TurfListItem['canvassers'] {
    return t.canvassers.slice(0, MAX_CANVASSER_CHIPS);
  }

  protected extraCanvassers(t: TurfListItem): number {
    return Math.max(0, t.canvassers.length - MAX_CANVASSER_CHIPS);
  }

  /**
   * One volunteer was added. The roster dialog stays open — volunteers are usually
   * added several at a time — so this only announces the link and does not close it.
   */
  protected async onAssigned(res: { token: string; sent: { email: boolean; sms: boolean } }): Promise<void> {
    const phrase = volunteerLinkSentPhrase(res.sent);
    await this.copyCompanionLink(res.token, phrase ? `Canvasser added — ${phrase}. Link also copied.` : undefined);
    if (!phrase) {
      this.alerts.showWarn('They have no email or mobile on file — paste them the copied link yourself');
    }
  }

  protected async onRosterClosed(): Promise<void> {
    this.assignTarget.set(null);
    await this.loadTurfs();
  }

  private async copyCompanionLink(token: string, successMessage?: string): Promise<void> {
    const url = companionUrl(`/t/${encodeURIComponent(token)}`);
    try {
      await navigator.clipboard.writeText(url);
      this.alerts.showSuccess(successMessage ?? 'Personal link copied. Only the assigned volunteer can open it.');
    } catch {
      this.alerts.showSuccess(`Companion link: ${url}`);
    }
  }

  protected async refresh(t: TurfListItem): Promise<void> {
    const end = this._loading.begin();
    try {
      const res = await this.svc.refreshFromList(t.id);
      this.alerts.showSuccess(`Refreshed. ${res.added} added, ${res.removed} removed. Knock history kept.`);
      await this.loadTurfs();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to refresh turf.');
    } finally {
      end();
    }
  }

  protected async retire(t: TurfListItem): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Retire this turf?',
      message: `"${t.name}" will stop accepting knocks. Its totals stay in the field report.`,
      confirmText: 'Retire turf',
    });
    if (!ok) return;
    const end = this._loading.begin();
    try {
      await this.svc.retire(t.id);
      this.alerts.showSuccess('Turf retired.');
      await this.loadTurfs();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to retire turf.');
    } finally {
      end();
    }
  }

  protected async exportReport(): Promise<void> {
    try {
      const { filename, content } = await this.svc.exportFieldReport({
        range: this.reportRange(),
        from: null,
        to: null,
      });
      const blob = new Blob([content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      this.alerts.showSuccess('Report exported: doors, conversations and responses by team and by day (CSV).');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to export report.');
    }
  }

  protected hourLabel(h: number): string {
    const am = h < 12;
    const base = h % 12 === 0 ? 12 : h % 12;
    return `${base}${am ? 'am' : 'pm'}`;
  }

  protected barPct(value: number, max: number): number {
    if (max <= 0) return 0;
    return Math.round((value / max) * 100);
  }

  protected maxPerDay(): number {
    const r = this.report();
    if (!r) return 0;
    return Math.max(1, ...r.perDay.map((d) => d.conversations + d.no_answer));
  }

  protected maxByHour(): number {
    const r = this.report();
    if (!r) return 0;
    return Math.max(1, ...r.byHour.map((h) => h.attempts));
  }
}
