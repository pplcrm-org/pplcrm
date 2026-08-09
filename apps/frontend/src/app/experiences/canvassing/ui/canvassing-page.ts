import {
  Component,
  DestroyRef,
  type OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { Icon } from '@icons/icon';
import { PcMap } from '@uxcommon/components/map/map';
import type {
  PcLatLng,
  PcMapMarker,
  PcMapPolygon,
  PcMapVariant,
  PcMapViewport,
} from '@uxcommon/components/map/map-types';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { TabBar, type PcTabOption } from '@uxcommon/components/tabs/tabs';

import type { FieldReportRangeType, MapViewportType } from '../../../../../../../libs/common/src';
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
import {
  TURF_STATUS_HINT,
  TURF_STATUS_LABEL,
  TURF_STATUS_MAP_VARIANT,
  TURF_STATUS_TONE,
  TURF_WALKED_LEGEND,
  TURF_WALKED_VARIANT,
  turfWalkedBucket,
  turfWalkedPct,
  refreshFromListExplainer,
  refreshResultMessage,
  renameResultMessage,
  renameTurfPrompt,
  turfRenameIntent,
} from './turf-vocabulary';
import { JoinCodePanel } from '../../volunteer-access/ui/join-code-panel';
import { OrgModeService } from '../../../services/org-mode.service';

type TurfStatus = TurfListItem['status'];
type Tab = 'turfs' | 'report';
type ReportRange = FieldReportRangeType['range'];
type CoverageStatus = Coverage['doors'][number]['status'];
type CoverageView = 'map' | 'boundary';

/**
 * The whole coverage picture — the doors plus the turf outlines, the area roll-up, the workspace
 * door total and the area word. This is what the page holds. The other answer the server can send
 * carries the doors of one rectangle alone (a pan cannot change anything else), and those are
 * folded into the picture already held rather than replacing it.
 */
type CoverageFull = Extract<Coverage, { doors_only: false }>;

/** Names shown inline on a turf row before the rest collapse into a "+N" count. */
const MAX_CANVASSER_CHIPS = 2;

/**
 * Door-dot colours on the coverage map, the same three the turf page uses so one door
 * never changes colour between two screens: still to walk carries the attention colour,
 * knocked with no answer is information, talked is done.
 */
const COVERAGE_VARIANT: Record<CoverageStatus, PcMapVariant> = {
  conversation: 'success',
  attempted: 'info',
  not_yet: 'warning',
};

const COVERAGE_LEGEND: { status: CoverageStatus; label: string; dot: string }[] = [
  { status: 'not_yet', label: 'To walk', dot: 'bg-warning' },
  { status: 'attempted', label: 'Knocked, no answer', dot: 'bg-info' },
  { status: 'conversation', label: 'Talked', dot: 'bg-success' },
];

/**
 * How long the coverage map sits still after a pan or zoom before its doors are re-read. Long
 * enough that crossing a city costs one request rather than six, short enough to feel immediate.
 */
const COVERAGE_SETTLE_MS = 350;

/** The three steps of the whole feature, shown until the first turfs exist. */
const GETTING_STARTED: { title: string; detail: string }[] = [
  {
    title: 'Cut turfs from a list',
    detail:
      'Pick a list of people or households. Their addresses are split into batches of roughly 40 doors that sit next to each other, and no turf crosses a boundary line on the map your campaign uses.',
  },
  {
    title: 'Add canvassers',
    detail:
      'Each volunteer gets their own link to the Canvass Companion, a web app on their phone. Nothing to install, and the link works only for them.',
  },
  {
    title: 'Watch the answers arrive',
    detail: 'Every door they log updates the person, the household and this page while they walk.',
  },
];

/**
 * Lower-case only the first letter. Boundary labels arrive sentence-case ("Polling division",
 * "Election district"), which is right at the start of a heading and wrong mid-sentence.
 */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

const RANGES: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'campaign', label: 'Campaign' },
];

@Component({
  selector: 'pc-canvassing-page',
  imports: [
    DatePipe,
    EmptyState,
    GridHeaderComponent,
    Icon,
    PcMap,
    RouterLink,
    RowActions,
    StatusBadge,
    TabBar,
    CutTurfsDialog,
    AssignTurfDialog,
    CompanionSettingsDialog,
    JoinCodePanel,
  ],
  templateUrl: './canvassing-page.html',
})
export class CanvassingPage implements OnInit {
  private readonly svc = inject(CanvassingService);
  private readonly alerts = inject(AlertService);
  private readonly dialog = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  private readonly orgMode = inject(OrgModeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;

  /**
   * Worded by the tenant's organization mode, so the page header matches the sidebar
   * entry the user clicked to get here ("Door knocking" in an office, "Visitation" in
   * a church). Prose below it stays fixed — see ORG_MODE_TERMS' doctrine on why only
   * fixed labels are translated.
   */
  protected readonly pageTitle = computed<string>(() => this.orgMode.term('nav.canvassing'));

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
  protected readonly coverage = signal<CoverageFull | null>(null);
  protected readonly coverageView = signal<CoverageView>('map');
  /** True while a pan or zoom is being answered, so the caption can say the map is catching up. */
  protected readonly coverageRefreshing = signal(false);

  /**
   * The coverage map, named in the template because this page holds two maps: the turf strip at the
   * top frames itself and is left alone, while this one is framed here and reports where it ends up.
   */
  private readonly coverageMap = viewChild<PcMap>('coverageMap');

  /** The pan waiting to settle, the guard against an old answer landing last, and the held frame. */
  private coverageTimer: ReturnType<typeof setTimeout> | null = null;
  private coverageSeq = 0;
  private wantedCoverageFrame: PcLatLng[] | null = null;

  protected readonly cutOpen = signal(false);
  /** Turf currently being assigned in the pick-a-volunteer dialog (null = closed). */
  protected readonly assignTarget = signal<TurfListItem | null>(null);
  /** Companion survey settings dialog (issues vocabulary + door script). */
  protected readonly settingsOpen = signal(false);
  /** Turf whose join QR is on screen (null = closed) — the group-canvass entry point. */
  protected readonly qrTarget = signal<TurfListItem | null>(null);

  protected readonly ranges = RANGES;
  protected readonly statusLabel = TURF_STATUS_LABEL;
  protected readonly statusHint = TURF_STATUS_HINT;
  protected readonly statusTone = TURF_STATUS_TONE;
  protected readonly coverageLegend = COVERAGE_LEGEND;
  protected readonly turfWalkedLegend = TURF_WALKED_LEGEND;

  /**
   * Whether individual doors are on the map, or the shaded turf outlines are standing in for them.
   *
   * Read off the response rather than guessed from a threshold here: the server owns the decision,
   * and a page that re-derived it could disagree with what it was actually sent.
   */
  protected readonly showingDoors = computed<boolean>(() => (this.coverage()?.doors.length ?? 0) > 0);
  protected readonly doorsInView = computed<number>(() => this.coverage()?.doors_in_view ?? 0);
  protected readonly doorsTotal = computed<number>(() => this.coverage()?.doors_total ?? 0);
  /** True when this campaign has any located door in any cut turf — what the Coverage card needs. */
  protected readonly hasCoverage = computed<boolean>(() => this.doorsTotal() > 0);
  protected readonly gettingStarted = GETTING_STARTED;

  /** First load has answered. Guards the getting-started panel against a false empty flash. */
  protected readonly loaded = signal(false);

  constructor() {
    // The coverage map only exists while the field-report tab is open and coverage has loaded, so
    // it may appear after the page has already worked out how it wants the map framed. Applying the
    // held frame when the map arrives is what stops it opening on the wrong place.
    effect(() => {
      const map = this.coverageMap();
      const wanted = untracked(() => this.wantedCoverageFrame);
      if (map && wanted) map.focusOn(wanted);
    });

    this.destroyRef.onDestroy(() => {
      // A pan waiting out its timer is a fetch for a page nobody is on any more, and an answer
      // still in flight has nowhere to land. Dropping the timer and moving the sequence number on
      // discards both, along with any error toast they would otherwise have raised over whatever
      // page the reader has moved to.
      this.cancelCoverageRefresh();
    });
  }

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
   * Tinted turf-centroid markers over the turf map (§13.1 turf map strip).
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

  /** A pin on the strip map carries its turf id — clicking it opens that turf. */
  protected openTurf(marker: PcMapMarker): void {
    const id = typeof marker.payload === 'string' ? marker.payload : marker.id;
    if (id) void this.router.navigate(['/canvassing', id]);
  }

  protected variantFor(status: TurfStatus): PcMapVariant {
    return TURF_STATUS_MAP_VARIANT[status];
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
      this.loaded.set(true);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load canvassing.');
    } finally {
      end();
    }
  }

  protected async loadReport(): Promise<void> {
    const end = this._loading.begin();
    const range = { range: this.reportRange(), from: null, to: null };
    // A pan still waiting out its timer belongs to the range being replaced, so it is dropped here.
    this.cancelCoverageRefresh();
    const seq = ++this.coverageSeq;
    try {
      // No rectangle on this first read: the map has not framed itself yet, so the answer covers
      // every turf, and comes back as shaded outlines alone when there are too many doors to draw.
      const [report, coverage] = await Promise.all([
        this.svc.getFieldReport(range),
        this.svc.getCoverage({ ...range, viewport: null }),
      ]);
      // One guard for both halves of the answer. They were asked for together, so if this read has
      // been overtaken — the range changed, or the page was left — neither half belongs on screen.
      if (seq !== this.coverageSeq) return;
      this.report.set(report);
      this.applyCoverage(coverage);
      // Frame what was just loaded. After this the map moves only when the reader moves it.
      this.frameCoverageMap();
    } catch (err) {
      if (seq !== this.coverageSeq) return;
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

  /**
   * The campaign's own word for one of the areas turfs are cut inside — 'Polling division',
   * 'Precinct', 'Ward', 'Riding'. The server resolves it, because the right word depends on the
   * campaign's declared jurisdiction and region. Nothing on this page hard-codes one; 'Area' is
   * only the stand-in shown before the coverage payload has arrived.
   */
  protected readonly boundaryLabel = computed<string>(() => this.coverage()?.boundary_label ?? 'Area');

  protected readonly boundaryLabelPlural = computed<string>(() => this.coverage()?.boundary_label_plural ?? 'Areas');

  /** The roll-up tab's label: "By polling division", "By ward". */
  protected readonly coverageByLabel = computed<string>(() => `By ${lowerFirst(this.boundaryLabel())}`);

  /**
   * The sentence under the roll-up. It names where the areas come from, and explains the row that
   * holds every unbounded turf's doors without claiming those doors are somewhere they are not.
   */
  protected readonly coverageTableNote = computed<string>(
    () =>
      `${this.boundaryLabelPlural()} come from the boundary map this campaign uses. ` +
      'The "Unbounded" row holds doors in turfs with no area of their own: the turf was cut with no map, or its ' +
      'doors fell outside every area of it. Closeness was the only thing that placed those doors.',
  );

  /**
   * One outline per turf (the convex hull of its doors), shaded by how far that turf has been
   * walked in the window on screen.
   *
   * These are always drawn, and they are the whole of the map whenever there are too many doors to
   * draw individually. The shading comes from exact per-turf totals rather than from the doors that
   * happened to be sent, so a turf shaded "half knocked" really is half knocked.
   *
   * Still dashed: the outline is the convex hull of the turf's own doors, not a real boundary, and
   * the dashes are what say so.
   */
  protected readonly coveragePolygons = computed<PcMapPolygon[]>(() => {
    const cov = this.coverage();
    if (!cov) return [];
    return cov.turfs.map((t) => {
      const pct = turfWalkedPct(t.doors, t.not_yet);
      return {
        path: t.path,
        variant: TURF_WALKED_VARIANT[turfWalkedBucket(pct)],
        dashed: true,
        label: `${t.name} — ${pct}% knocked`,
        id: t.id,
        payload: t.id,
      };
    });
  });

  /** A turf outline carries its turf id — clicking it opens that turf, like a pin on the strip map. */
  protected openTurfPolygon(polygon: PcMapPolygon): void {
    const id = typeof polygon.payload === 'string' ? polygon.payload : polygon.id;
    if (id) void this.router.navigate(['/canvassing', id]);
  }

  /**
   * The coverage map came to rest somewhere new: re-read its doors for the rectangle now on screen,
   * once the panning has stopped.
   *
   * One direction only. The map reports where it is; nothing here moves the map in reply, or the
   * two would chase each other. That is also why this map has auto-fit turned off and is framed
   * explicitly in `loadReport`.
   */
  protected onCoverageViewport(viewport: PcMapViewport): void {
    if (this.coverageTimer) clearTimeout(this.coverageTimer);
    this.coverageTimer = setTimeout(() => {
      this.coverageTimer = null;
      void this.loadCoverage({
        north: viewport.north,
        south: viewport.south,
        east: viewport.east,
        west: viewport.west,
      });
    }, COVERAGE_SETTLE_MS);
  }

  /**
   * Re-read coverage for one rectangle, or for everything when given none.
   *
   * The sequence number matters here for the same reason it does anywhere a map drives a fetch:
   * panning twice quickly starts two requests and the first can answer last, which would leave the
   * map showing the doors of a place the reader has already left.
   */
  private async loadCoverage(viewport: MapViewportType | null): Promise<void> {
    const seq = ++this.coverageSeq;
    this.coverageRefreshing.set(true);
    try {
      const coverage = await this.svc.getCoverage({
        range: this.reportRange(),
        from: null,
        to: null,
        viewport,
      });
      if (seq !== this.coverageSeq) return;
      this.applyCoverage(coverage);
    } catch (err) {
      if (seq === this.coverageSeq) {
        this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load coverage.');
      }
    } finally {
      if (seq === this.coverageSeq) this.coverageRefreshing.set(false);
    }
  }

  /**
   * Take one coverage answer.
   *
   * A request that named a rectangle comes back with the doors inside it and nothing else, because
   * nothing else the screen shows — the turf outlines and their walked percentages, the by-area
   * roll-up, the workspace door total, the campaign's word for an area — can have changed because
   * the map was panned. Those doors replace the doors of the picture already held; the rest of it
   * stands. The upshot is that the outlines and roll-up are re-read when the report is opened or
   * the date range changes, and not on every pan.
   */
  private applyCoverage(res: Coverage): void {
    if (!res.doors_only) {
      this.coverage.set(res);
      return;
    }
    const held = this.coverage();
    // Nothing to fold the doors into. Unreachable in practice — the map that asks for a rectangle
    // is only on screen once a whole picture has arrived — so the doors are dropped rather than
    // shown as a picture with no outlines, no totals and no area word.
    if (!held) return;
    this.coverage.set({ ...held, doors: res.doors, doors_in_view: res.doors_in_view });
  }

  /** Stop a pending coverage re-read and ignore whatever is already in flight for it. */
  private cancelCoverageRefresh(): void {
    if (this.coverageTimer) {
      clearTimeout(this.coverageTimer);
      this.coverageTimer = null;
    }
    this.coverageSeq += 1;
    this.coverageRefreshing.set(false);
  }

  /**
   * Frame the coverage map on every turf it holds.
   *
   * Framed from the turf outlines rather than from the doors, because the outlines always describe
   * the whole workspace while the doors describe only what is currently in view — framing the doors
   * would slowly zoom the map into whatever corner the last fetch returned.
   */
  private frameCoverageMap(): void {
    const cov = this.coverage();
    if (!cov) return;
    const points = cov.turfs.flatMap((t) => t.path);
    this.wantedCoverageFrame = points.length > 0 ? points : null;
    if (points.length > 0) this.coverageMap()?.focusOn(points);
  }

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
   *
   * `batchSize` is how many people were staged in this add. Copying to the clipboard
   * only makes sense for a batch of one — for a multi-add, each emission would overwrite
   * the previous person's link, so the clipboard would end up holding only the last
   * person's link while every toast claimed "Link also copied" (REVIEW4 T2-29).
   */
  protected async onAssigned(res: {
    token: string;
    sent: { email: boolean; sms: boolean };
    batchSize: number;
  }): Promise<void> {
    const phrase = volunteerLinkSentPhrase(res.sent);
    if (res.batchSize === 1) {
      await this.copyCompanionLink(res.token, phrase ? `Canvasser added — ${phrase}. Link also copied.` : undefined);
      if (!phrase) {
        this.alerts.showWarn('They have no email or mobile on file — paste them the copied link yourself');
      }
      return;
    }
    this.alerts.showSuccess(phrase ? `Canvasser added — ${phrase}.` : 'Canvasser added.');
    if (!phrase) {
      this.alerts.showWarn("They have no email or mobile on file — you'll have to get them their link yourself");
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
    if (!t.list_name) return;
    const mapMissing = t.boundary_name != null && t.boundary_set_id == null;
    const ok = await this.dialog.confirm({
      title: `Re-read "${t.list_name}"?`,
      message: refreshFromListExplainer(t.list_name, mapMissing),
      confirmText: 'Refresh doors',
    });
    if (!ok) return;

    const end = this._loading.begin();
    try {
      const res = await this.svc.refreshFromList(t.id);
      this.alerts.showSuccess(refreshResultMessage(t.list_name, res));
      await this.loadTurfs();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to refresh turf.');
    } finally {
      end();
    }
  }

  protected async rename(t: TurfListItem): Promise<void> {
    const intent = turfRenameIntent(await this.dialog.prompt(renameTurfPrompt(t.name)), t.name);
    if (intent.kind === 'none') return;
    if (intent.kind === 'invalid') {
      this.alerts.showError(intent.reason);
      return;
    }

    const end = this._loading.begin();
    try {
      await this.svc.updateTurf(t.id, { name: intent.name });
      this.alerts.showSuccess(renameResultMessage(t.name, intent.name));
      await this.loadTurfs();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to rename turf.');
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
