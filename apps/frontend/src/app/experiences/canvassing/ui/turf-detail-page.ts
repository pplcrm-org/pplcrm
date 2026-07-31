import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { BreadcrumbsService } from '@uxcommon/components/breadcrumbs/breadcrumbs.service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { Icon } from '@icons/icon';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcMapMarker, PcMapPolygon, PcMapVariant } from '@uxcommon/components/map/map-types';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { StatusBadge, type PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';

import {
  KNOCK_OUTCOME_LABELS,
  KNOCK_RESPONSE_LABELS,
  isKnockOutcome,
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

/** Door dots read the same here as on the field report's coverage map. */
const DOOR_VARIANT: Record<DoorStatus, PcMapVariant> = {
  conversation: 'success',
  attempted: 'warning',
  not_yet: 'muted',
};

const DOOR_TONE: Record<DoorStatus, PcStatusType> = {
  conversation: 'success',
  attempted: 'warning',
  not_yet: 'ghost',
};

const DOOR_LABEL: Record<DoorStatus, string> = {
  conversation: 'Talked',
  attempted: 'Knocked',
  not_yet: 'Not yet',
};

const DOOR_FILTERS: { key: DoorFilter; label: string }[] = [
  { key: 'all', label: 'All doors' },
  { key: 'conversation', label: 'Talked' },
  { key: 'attempted', label: 'Knocked, no answer' },
  { key: 'not_yet', label: 'Not yet knocked' },
];

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

  protected readonly doors = computed<TurfDoor[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const filter = this.doorFilter();
    return filter === 'all' ? d.doors : d.doors.filter((x) => x.status === filter);
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

  protected readonly markers = computed<PcMapMarker[]>(() =>
    (this.detail()?.doors ?? [])
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => ({
        position: { lat: Number(d.lat), lng: Number(d.lng) },
        variant: DOOR_VARIANT[d.status],
        tooltip: `${d.address} — ${DOOR_LABEL[d.status]}`,
        id: d.household_id,
      })),
  );

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

  /** One volunteer was added; the roster dialog stays open for the next one. */
  protected async onAssigned(res: { token: string; sent: { email: boolean; sms: boolean } }): Promise<void> {
    const phrase = volunteerLinkSentPhrase(res.sent);
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
    const listName = this.detail()?.list_name;
    if (!listName) return;
    const ok = await this.confirm.confirm({
      title: `Re-read "${listName}"?`,
      message: refreshFromListExplainer(listName),
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
