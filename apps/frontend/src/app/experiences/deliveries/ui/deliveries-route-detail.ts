import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { BreadcrumbsService } from '@uxcommon/components/breadcrumbs/breadcrumbs.service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcLatLng, PcMapMarker, PcMapPolyline, PcMapVariant } from '@uxcommon/components/map/map-types';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import type { PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { companionUrl, volunteerLinkSentPhrase } from '../../../shared/public-pages';
import { DELIVERY_SKIP_REASONS } from '@common';
import type { DeliverySkipReason } from '@common';
import { Icon } from '@icons/icon';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';

import { AssignVolunteerDialog } from './assign-volunteer-dialog';
import {
  DeliveriesRoutesService,
  type DeliveryRouteDetail,
  type DeliveryRouteStop,
} from '../services/deliveries-routes-service';

type PersonSearchResult = { id: string; first_name: string | null; last_name: string | null; email: string | null };

const ROUTE_TONE: Record<string, PcStatusType> = {
  draft: 'neutral',
  assigned: 'info',
  in_progress: 'warning',
  completed: 'success',
  canceled: 'ghost',
};

/** Route detail (spec §4.3): header, actions, stops with reorder/actions, mandatory activity feed. */
@Component({
  selector: 'pc-deliveries-route-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    StatusBadge,
    Icon,
    DatePipe,
    EmptyState,
    PcMap,
    RecordActivities,
    AssignVolunteerDialog,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
  ],
  templateUrl: './deliveries-route-detail.html',
})
export class DeliveriesRouteDetail {
  public readonly id = input.required<string>();

  private readonly assignDlg = viewChild.required<AssignVolunteerDialog>('assignDlg');

  private readonly svc = inject(DeliveriesRoutesService);
  private readonly alerts = inject(AlertService);
  private readonly breadcrumbs = inject(BreadcrumbsService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  protected readonly loading = createLoadingGate();

  protected readonly detail = signal<DeliveryRouteDetail | null>(null);
  protected readonly renaming = signal(false);
  protected readonly draftName = signal('');

  protected readonly deliveredCount = computed(
    () => this.detail()?.stops.filter((s) => s.status === 'delivered').length ?? 0,
  );
  protected readonly skippedCount = computed(
    () => this.detail()?.stops.filter((s) => s.status === 'skipped').length ?? 0,
  );
  protected readonly pendingCount = computed(
    () => this.detail()?.stops.filter((s) => s.status === 'pending').length ?? 0,
  );
  protected readonly totalStops = computed(() => this.detail()?.stops.length ?? 0);

  /**
   * Only stops whose household has been geocoded can honestly appear on the map.
   * Narrowing here (rather than casting `lat`/`lng`) keeps the marker inputs
   * plain `PcLatLng` values.
   */
  private readonly mapStops = computed<{ stop: DeliveryRouteStop; position: PcLatLng }[]>(() => {
    const out: { stop: DeliveryRouteStop; position: PcLatLng }[] = [];
    for (const stop of this.detail()?.stops ?? []) {
      const { lat, lng } = stop;
      if (lat == null || lng == null) continue;
      out.push({ stop, position: { lat, lng } });
    }
    return out;
  });

  protected readonly hasMap = computed(() => this.mapStops().length > 0);

  /** Stops missing from the map are narrated, never silently dropped (design §2). */
  protected readonly unlocatedNote = computed<string | null>(() => {
    const missing = this.totalStops() - this.mapStops().length;
    if (missing === 0) return null;
    return missing === 1
      ? "1 stop isn't on the map yet. Its household address still needs to be located."
      : `${missing} stops aren't on the map yet. Their household addresses still need to be located.`;
  });

  /** Start pin (info) plus one numbered pin per located stop, tinted by its status. */
  protected readonly mapMarkers = computed<PcMapMarker<DeliveryRouteStop | null>[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const start: PcMapMarker<DeliveryRouteStop | null> = {
      position: { lat: d.start_lat, lng: d.start_lng },
      variant: 'info',
      tooltip: `Start: ${d.start_address}`,
      payload: null,
    };
    return [
      start,
      ...this.mapStops().map(({ stop, position }) => ({
        position,
        variant: this.pinVariant(stop.status),
        label: String(stop.seq),
        tooltip: `${stop.seq}. ${stop.address}`,
        id: stop.id,
        payload: stop,
      })),
    ];
  });

  /** The visit order as a dotted path from the start address. Dotted because we plan order, not roads. */
  protected readonly mapRoute = computed<PcMapPolyline[]>(() => {
    const d = this.detail();
    const stops = this.mapStops();
    if (!d || stops.length === 0) return [];
    return [
      {
        path: [{ lat: d.start_lat, lng: d.start_lng }, ...stops.map((s) => s.position)],
        variant: 'primary',
        dashed: true,
      },
    ];
  });

  protected readonly canDelete = computed(() => {
    const s = this.detail()?.status;
    return s === 'draft' || s === 'assigned';
  });

  constructor() {
    // Load only once the router has bound the required `id` input — reading it
    // synchronously in the constructor throws NG0950. Re-runs if the id changes.
    effect(() => {
      this.id();
      untracked(() => void this.load());
    });

    // Navbar trail with the route's real name once loaded (until then the route's
    // `data.breadcrumb` default — Deliveries / Routes — is showing).
    effect(() => {
      const d = this.detail();
      if (!d) return;
      this.breadcrumbs.setCrumbs([
        { label: 'Deliveries', route: '/deliveries' },
        { label: 'Routes', route: '/deliveries/routes' },
        { label: d.name },
      ]);
    });
  }

  protected tone(status: string): PcStatusType {
    return ROUTE_TONE[status] ?? 'neutral';
  }

  protected label(status: string): string {
    return status === 'in_progress' ? 'in progress' : status;
  }

  private async load(): Promise<void> {
    const end = this.loading.begin();
    try {
      const d = await this.svc.getById(this.id());
      this.detail.set(d);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not load route');
    } finally {
      end();
    }
  }

  protected onDraftNameInput(event: Event): void {
    this.draftName.set((event.target as HTMLInputElement).value);
  }

  protected startRename(): void {
    this.draftName.set(this.detail()?.name ?? '');
    this.renaming.set(true);
  }

  protected async saveRename(): Promise<void> {
    const name = this.draftName().trim();
    if (!name) return;
    try {
      await this.svc.update(this.id(), { name });
      this.renaming.set(false);
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not rename route');
    }
  }

  protected openAssign(): void {
    this.assignDlg().open(this.detail()?.volunteer_person_id != null);
  }

  protected async onVolunteerSelected(person: PersonSearchResult | null): Promise<void> {
    try {
      const res = await this.svc.assignVolunteer(this.id(), person?.id ?? null);
      if (!person) {
        this.alerts.showSuccess('Volunteer removed');
      } else {
        const phrase = volunteerLinkSentPhrase(res.sent);
        if (phrase) this.alerts.showSuccess(`Volunteer assigned — ${phrase}`);
        else
          this.alerts.showWarn(
            'Volunteer assigned, but they have no email or mobile on file — use "Copy volunteer link" to share it',
          );
      }
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not update the volunteer');
    }
  }

  protected async copyLink(regenerate = false): Promise<void> {
    try {
      const res = await this.svc.mintShareLink(this.id(), regenerate);
      if (res.status === 'exists') {
        // The raw token is never stored, so the existing link can't be shown again — the only way
        // to hand the user a copyable link is to mint a fresh one, which retires the old one.
        const ok = await this.confirm.confirm({
          title: 'Copy a fresh link?',
          message:
            'This route already has an active volunteer link, and for security the existing one can’t be shown again. Copying a fresh link replaces it. The old link stops working, so anyone you already sent it to will need the new one.',
          variant: 'warning',
          confirmText: 'Regenerate & copy',
        });
        if (ok) await this.copyLink(true);
        return;
      }
      const url = companionUrl(`/r/${res.token}`);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      // expires_at is null when the workspace disables link expiry (Workspace → App).
      this.alerts.showSuccess(
        regenerate
          ? 'Fresh link copied. The old link no longer works'
          : res.expires_at
            ? 'Link copied (valid 30 days)'
            : 'Link copied',
      );
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not create the link');
    }
  }

  /** Re-sending only makes sense while the route is still live. */
  protected canResend(): boolean {
    const status = this.detail()?.status;
    return status !== 'canceled' && status !== 'completed';
  }

  /** Mint a fresh link and send it to the volunteer's contacts (replaces the previously sent link). */
  protected async resendLink(): Promise<void> {
    try {
      const res = await this.svc.resendVolunteerLink(this.id());
      const phrase = volunteerLinkSentPhrase(res.sent);
      this.alerts.showSuccess(phrase ? `Fresh ${phrase}` : 'Link sent');
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not send the link');
    }
  }

  protected async revokeLink(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Revoke volunteer link?',
      message: 'The current link stops working immediately.',
      variant: 'danger',
      confirmText: 'Revoke link',
    });
    if (!ok) return;
    try {
      await this.svc.revokeShareLink(this.id());
      this.alerts.showSuccess('Volunteer link revoked');
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not revoke the link');
    }
  }

  protected openInGoogleMaps(): void {
    const d = this.detail();
    if (!d) return;
    const located = d.stops.filter((s) => s.lat != null && s.lng != null);
    if (located.length === 0) {
      this.alerts.showError('No located stops to navigate to');
      return;
    }
    const origin = `${d.start_lat},${d.start_lng}`;
    const dest = located[located.length - 1];
    const destination = `${dest?.lat},${dest?.lng}`;
    const waypoints = located
      .slice(0, -1)
      .map((s) => `${s.lat},${s.lng}`)
      .join('|');
    const params = new URLSearchParams({ api: '1', origin, destination });
    if (waypoints) params.set('waypoints', waypoints);
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank', 'noopener');
  }

  protected async cancelRoute(): Promise<void> {
    const undelivered = this.detail()?.stops.filter((s) => s.status === 'pending').length ?? 0;
    const ok = await this.confirm.confirm({
      title: 'Cancel this route?',
      message: `Its ${undelivered} undelivered stop${undelivered === 1 ? '' : 's'} return to the planning pool. Delivered stops keep their record.`,
      variant: 'danger',
      confirmText: 'Cancel route',
    });
    if (!ok) return;
    try {
      await this.svc.setStatus(this.id(), 'canceled');
      this.alerts.showSuccess('Route canceled');
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not cancel the route');
    }
  }

  protected async deleteRoute(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Delete this route?',
      message: 'This removes the route. Its stops return to the planning pool.',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await this.svc.delete(this.id());
      this.alerts.showSuccess('Route deleted');
      await this.router.navigate(['/deliveries/routes']);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not delete the route');
    }
  }

  /**
   * Drag-to-reorder handler for the pending stops. Every row is a CDK drag item but delivered/skipped
   * rows are drag-disabled, so `previousIndex` always lands on a pending row; CDK's indices are over
   * the FULL stop list. We move on a full-list copy, guard that the moved row is pending, then derive
   * the new pending order. Delivered/skipped rows keep their seq (the backend enforces this, and the
   * optimistic view leaves them in place). We persist, reconcile with a reload, and roll back on error.
   */
  protected async onStopDrop(event: CdkDragDrop<DeliveryRouteStop[]>): Promise<void> {
    const snapshot = this.detail();
    if (!snapshot) return;
    const from = event.previousIndex;
    const to = event.currentIndex;
    const full = [...snapshot.stops];
    if (from === to || from < 0 || to < 0 || from >= full.length || to >= full.length) return;
    // Guard: only a pending row may move — never displace a delivered/skipped stop.
    if (full[from]?.status !== 'pending') return;

    moveItemInArray(full, from, to);
    const newPendingOrder = full.filter((s) => s.status === 'pending');
    const orderedIds = newPendingOrder.map((s) => s.id);

    // Optimistic: keep non-pending rows in their original slots, drop the reordered pending stops
    // into the pending slots, and renumber seq contiguously for display (mirrors the server).
    let qi = 0;
    const optimisticStops = snapshot.stops.map((s, i) => {
      const base = s.status === 'pending' ? (newPendingOrder[qi++] ?? s) : s;
      return { ...base, seq: i + 1 };
    });
    this.detail.set({ ...snapshot, stops: optimisticStops });

    try {
      await this.svc.reorderStops(this.id(), orderedIds);
      await this.load();
    } catch (err) {
      this.detail.set(snapshot);
      this.alerts.showError(err instanceof Error ? err.message : 'Could not reorder');
    }
  }

  protected async reorder(stopId: string, direction: 'up' | 'down'): Promise<void> {
    try {
      await this.svc.reorderStop(this.id(), stopId, direction);
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not reorder');
    }
  }

  protected async markDelivered(stopId: string): Promise<void> {
    await this.runStopAction(stopId, 'deliver');
  }

  protected async removeStop(stopId: string): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Remove this stop?',
      message: 'The request returns to the planning pool.',
      variant: 'danger',
      confirmText: 'Remove stop',
    });
    if (!ok) return;
    await this.runStopAction(stopId, 'remove');
  }

  protected async couldntDeliver(stopId: string): Promise<void> {
    const reason = await this.confirm.choose<DeliverySkipReason>({
      title: "Couldn't deliver. Pick a reason",
      choices: DELIVERY_SKIP_REASONS.map((r) => ({ label: r, value: r })),
    });
    if (!reason) return;
    await this.runStopAction(stopId, 'skip', reason);
  }

  private async runStopAction(
    stopId: string,
    action: 'deliver' | 'skip' | 'remove',
    reason?: DeliverySkipReason,
  ): Promise<void> {
    try {
      await this.svc.stopAction(this.id(), stopId, action, reason ?? null);
      await this.load();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not update the stop');
    }
  }

  /** Same state→colour map as the stop chips, in map-variant terms. */
  private pinVariant(status: string): PcMapVariant {
    if (status === 'delivered') return 'success';
    if (status === 'skipped') return 'warning';
    return 'primary';
  }

  protected stopTone(status: string): PcStatusType {
    if (status === 'delivered') return 'success';
    if (status === 'skipped') return 'warning';
    return 'neutral';
  }
}
