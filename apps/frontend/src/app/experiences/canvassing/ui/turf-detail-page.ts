import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { BreadcrumbsService } from '@uxcommon/components/breadcrumbs/breadcrumbs.service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { Icon } from '@icons/icon';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcMapMarker, PcMapPolygon, PcMapPolyline, PcMapVariant } from '@uxcommon/components/map/map-types';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { StatusBadge, type PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';

import {
  KNOCK_OUTCOME_LABELS,
  KNOCK_RESPONSE_LABELS,
  groupForWalk,
  isKnockOutcome,
  orderForWalk,
  simplifyPath,
  type KnockResponse,
} from '../../../../../../../libs/common/src';
import { CanvassingService, type TurfDetail, type TurfDoor } from '../services/canvassing-service';
import { companionUrl, volunteerLinkSentPhrase } from '../../../shared/public-pages';
import { AssignTurfDialog } from './assign-turf-dialog';
import {
  TURF_STATUS_HINT,
  TURF_STATUS_LABEL,
  TURF_STATUS_TONE,
  refreshFromListExplainer,
  refreshResultMessage,
  renameResultMessage,
  renameTurfPrompt,
  turfRenameIntent,
} from './turf-vocabulary';
import { JoinCodePanel } from '../../volunteer-access/ui/join-code-panel';
import { JoinCodesService } from '../../volunteer-access/services/join-codes-service';
import { OrgModeService } from '../../../services/org-mode.service';

type TurfStatus = TurfDetail['status'];
type DoorStatus = TurfDoor['status'];
type DoorFilter = 'all' | DoorStatus;

/**
 * Door dots read the same here as on the field report's coverage map.
 *
 * The doors still to walk are the ones the reader is looking for, so they carry the
 * attention colour (warning) rather than a grey that reads as "nothing here"; a door
 * already knocked with no answer is information, not a job, so it drops to info.
 */
const DOOR_VARIANT: Record<DoorStatus, PcMapVariant> = {
  conversation: 'success',
  attempted: 'info',
  not_yet: 'warning',
};

const DOOR_TONE: Record<DoorStatus, PcStatusType> = {
  conversation: 'success',
  attempted: 'info',
  not_yet: 'warning',
};

const DOOR_LABEL: Record<DoorStatus, string> = {
  conversation: 'Talked',
  attempted: 'Knocked, no answer',
  not_yet: 'To walk',
};

const DOOR_FILTERS: { key: DoorFilter; label: string }[] = [
  { key: 'all', label: 'All doors' },
  { key: 'conversation', label: 'Talked' },
  { key: 'attempted', label: 'Knocked, no answer' },
  { key: 'not_yet', label: 'To walk' },
];

/** A numbered pin fits two characters, so past 99 the number stays in the table only. */
const MAX_PIN_LABEL = 99;

/**
 * One turf, opened (§13.1): where it is, who is walking it, and what happened at
 * every door. Everything shown is derived server-side from `turf_knocks` — this
 * page reads, and hands the roster/lifecycle actions back to the same dialogs the
 * turf list uses so there is one way to do each of them.
 */
@Component({
  selector: 'pc-turf-detail-page',
  imports: [
    DatePipe,
    Icon,
    PcMap,
    RouterLink,
    RowActions,
    StatusBadge,
    RecordActivities,
    AssignTurfDialog,
    JoinCodePanel,
  ],
  templateUrl: './turf-detail-page.html',
})
export class TurfDetailPage {
  public readonly id = input.required<string>();

  private readonly svc = inject(CanvassingService);
  private readonly joinCodes = inject(JoinCodesService);
  private readonly alerts = inject(AlertService);
  private readonly breadcrumbs = inject(BreadcrumbsService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  private readonly orgMode = inject(OrgModeService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;

  protected readonly detail = signal<TurfDetail | null>(null);
  protected readonly doorFilter = signal<DoorFilter>('all');
  protected readonly rosterOpen = signal(false);
  protected readonly qrOpen = signal(false);
  /** Guards the header button while the code is fetched or created — a double click must not mint two codes. */
  protected readonly copyingJoinLink = signal(false);

  protected readonly statusLabel = TURF_STATUS_LABEL;
  protected readonly statusHint = TURF_STATUS_HINT;
  protected readonly doorFilters = DOOR_FILTERS;
  protected readonly doorLabel = DOOR_LABEL;

  constructor() {
    // Load once the router has bound the required `id` input — reading it in the
    // constructor throws NG0950. Re-runs when the id changes.
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });

    // The parent crumb is worded by the tenant's organization mode, matching the
    // sidebar entry and the route's own `data.breadcrumb` term — this trail overwrites
    // that default, so hardcoding it here showed "Canvassing" to an office workspace
    // that had just clicked "Door knocking". Reading the term inside the effect keeps
    // it live if the mode changes.
    effect(() => {
      const d = this.detail();
      if (!d) return;
      this.breadcrumbs.setCrumbs([
        { label: this.orgMode.term('nav.canvassing'), route: '/canvassing' },
        { label: d.name },
      ]);
    });
  }

  protected readonly progressPct = computed<number>(() => {
    const d = this.detail();
    if (!d || d.door_count <= 0) return 0;
    return Math.min(100, Math.round((d.attempted / d.door_count) * 100));
  });

  /** Conversations per door attempted — the same reading the field report uses. */
  protected readonly contactRatePct = computed<number>(() => {
    const d = this.detail();
    if (!d || d.attempted <= 0) return 0;
    return Math.round((d.conversations / d.attempted) * 100);
  });

  /**
   * The suggested walking order, shared with the Companion and the printed sheet so no
   * two surfaces can disagree about which door is "3". Stored `walk_order` decides which
   * street comes first; within a street the doors walk up one side and back down the other.
   */
  protected readonly walkDoors = computed<TurfDoor[]>(() => orderForWalk(this.detail()?.doors ?? []));

  /** Household id → its place in the walking order, so pin, table row and sheet agree. */
  protected readonly walkSeq = computed<Map<string, number>>(() => {
    const seq = new Map<string, number>();
    this.walkDoors().forEach((d, i) => seq.set(d.household_id, i + 1));
    return seq;
  });

  protected readonly doors = computed<TurfDoor[]>(() => {
    const all = this.walkDoors();
    const filter = this.doorFilter();
    return filter === 'all' ? all : all.filter((x) => x.status === filter);
  });

  protected readonly doorCounts = computed<Record<DoorFilter, number>>(() => {
    const all = this.detail()?.doors ?? [];
    return {
      all: all.length,
      conversation: all.filter((d) => d.status === 'conversation').length,
      attempted: all.filter((d) => d.status === 'attempted').length,
      not_yet: all.filter((d) => d.status === 'not_yet').length,
    };
  });

  /**
   * A pin per geocoded door. Doors still to walk carry their walking number so the map
   * and the table can be read together; a walked door has no number to give, and past
   * door 99 the number no longer fits inside a pin.
   */
  protected readonly markers = computed<PcMapMarker[]>(() => {
    const seq = this.walkSeq();
    return (this.detail()?.doors ?? [])
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => {
        const n = seq.get(d.household_id);
        const label = d.status === 'not_yet' && n != null && n <= MAX_PIN_LABEL ? String(n) : undefined;
        return {
          position: { lat: Number(d.lat), lng: Number(d.lng) },
          variant: DOOR_VARIANT[d.status],
          tooltip:
            n == null ? `${d.address} — ${DOOR_LABEL[d.status]}` : `${n} · ${d.address} — ${DOOR_LABEL[d.status]}`,
          ...(label === undefined ? {} : { label }),
          id: d.household_id,
        };
      });
  });

  /**
   * One dashed line per street, through the doors still to walk on it.
   *
   * Streets are drawn separately on purpose: the line between two streets would be a
   * road we did not route, and a straight hop across a block is a claim we cannot make.
   * The path is simplified first, so a long straight street is two points rather than forty.
   */
  protected readonly polylines = computed<PcMapPolyline[]>(() => {
    const toWalk = (this.detail()?.doors ?? []).filter((d) => d.status === 'not_yet');
    const lines: PcMapPolyline[] = [];
    for (const group of groupForWalk(toWalk)) {
      const points = group.doors
        .filter((d) => d.lat != null && d.lng != null)
        .map((d) => ({ lat: Number(d.lat), lng: Number(d.lng) }));
      const path = simplifyPath(points);
      if (path.length >= 2) lines.push({ path, variant: 'primary', dashed: true, id: group.key });
    }
    return lines;
  });

  protected readonly polygons = computed<PcMapPolygon[]>(() => {
    const d = this.detail();
    if (!d || d.boundary.length === 0) return [];
    return [{ path: d.boundary, variant: 'neutral', dashed: true, label: d.name, id: d.id }];
  });

  /** Doors that can't be pinned yet — honest about why the map is short of dots. */
  protected readonly ungeocoded = computed<number>(() => {
    const all = this.detail()?.doors ?? [];
    return all.filter((d) => d.lat == null || d.lng == null).length;
  });

  protected tone(status: TurfStatus): PcStatusType {
    return TURF_STATUS_TONE[status];
  }

  protected doorTone(status: DoorStatus): PcStatusType {
    return DOOR_TONE[status];
  }

  /** "Talked · Supporter" — what the last visit to this door recorded. */
  protected lastVisitLabel(door: TurfDoor): string {
    if (!door.last_outcome) return '—';
    const outcome = isKnockOutcome(door.last_outcome) ? KNOCK_OUTCOME_LABELS[door.last_outcome] : door.last_outcome;
    const response = door.last_response ? KNOCK_RESPONSE_LABELS[door.last_response as KnockResponse] : null;
    return response ? `${outcome} · ${response}` : outcome;
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.detail.set(await this.svc.getTurfDetail(this.id()));
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load this turf.');
    } finally {
      end();
    }
  }

  protected async onRosterClosed(): Promise<void> {
    this.rosterOpen.set(false);
    await this.load();
  }

  /**
   * One volunteer was added; the roster dialog stays open for the next one.
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
      const url = companionUrl(`/t/${encodeURIComponent(res.token)}`);
      try {
        await navigator.clipboard.writeText(url);
        this.alerts.showSuccess(
          phrase ? `Canvasser added — ${phrase}. Link also copied.` : 'Personal link copied. Only they can open it.',
        );
      } catch {
        this.alerts.showSuccess(`Companion link: ${url}`);
      }
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

  /**
   * The join link is the same URL the QR encodes (/j/:code, scoped to this turf).
   * Copying it from the header covers the ask that arrives by text or email without
   * opening the QR dialog; when the turf has no live code yet, one is created first,
   * exactly as the QR panel would.
   */
  protected async copyJoinLink(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    this.copyingJoinLink.set(true);
    try {
      const rows = await this.joinCodes.getForCampaign();
      const code =
        rows.find((r) => r.status === 'active' && (r.turf_id ?? null) === d.id) ??
        (await this.joinCodes.create({ turf_id: d.id, label: d.name }));
      await navigator.clipboard.writeText(code.url).catch(() => undefined);
      this.alerts.showSuccess(
        'Join link copied. Anyone who opens it can sign up for this turf; they still need your approval.',
      );
    } catch {
      this.alerts.showError('Could not get the join link. Try again');
    } finally {
      this.copyingJoinLink.set(false);
    }
  }

  protected async refreshFromList(): Promise<void> {
    const detail = this.detail();
    const listName = detail?.list_name;
    if (!detail || !listName) return;
    const mapMissing = detail.boundary_name != null && detail.boundary_set_id == null;
    const ok = await this.confirm.confirm({
      title: `Re-read "${listName}"?`,
      message: refreshFromListExplainer(listName, mapMissing),
      confirmText: 'Refresh doors',
    });
    if (!ok) return;

    const end = this._loading.begin();
    try {
      const res = await this.svc.refreshFromList(this.id());
      this.alerts.showSuccess(refreshResultMessage(listName, res));
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to refresh turf.');
    } finally {
      end();
    }
  }

  /**
   * Reloading rather than patching the name in place is deliberate: the breadcrumb trail
   * and the map polygon's label are both driven off `detail()`, so one reload keeps every
   * place the name appears in step with the server's copy of it.
   */
  protected async rename(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const intent = turfRenameIntent(await this.confirm.prompt(renameTurfPrompt(d.name)), d.name);
    if (intent.kind === 'none') return;
    if (intent.kind === 'invalid') {
      this.alerts.showError(intent.reason);
      return;
    }

    const end = this._loading.begin();
    try {
      await this.svc.updateTurf(this.id(), { name: intent.name });
      this.alerts.showSuccess(renameResultMessage(d.name, intent.name));
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to rename turf.');
    } finally {
      end();
    }
  }

  protected async retire(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const ok = await this.confirm.confirm({
      title: 'Retire this turf?',
      message: `"${d.name}" will stop accepting knocks. Its totals stay in the field report.`,
      confirmText: 'Retire turf',
    });
    if (!ok) return;
    try {
      await this.svc.retire(this.id());
      this.alerts.showSuccess('Turf retired.');
      await this.router.navigate(['/canvassing']);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to retire turf.');
    }
  }
}
