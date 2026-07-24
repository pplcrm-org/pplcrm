import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { PcMap } from '@uxcommon/components/map/map';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import type { PcMapMarker, PcMapVariant } from '@uxcommon/components/map/map-types';
import { DELIVERY_SKIP_REASONS } from '@common';
import { Icon } from '@icons/icon';

import { CompanionGate } from '../gate/companion-gate';
import { CompanionSessionService } from '../gate/companion-api';

import type { PcIconNameType } from '@icons/icons.index';

interface PublicStop {
  id: string;
  seq: number;
  first_name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  status: 'pending' | 'delivered' | 'skipped';
  reason: string | null;
  acted_at: string | null;
}

interface PublicRouteData {
  organization_name: string;
  route_name: string;
  status: 'draft' | 'assigned' | 'in_progress' | 'completed' | 'canceled';
  start: { lat: number; lng: number };
  stops_total: number;
  stops_delivered: number;
  stops: PublicStop[];
}

type PageState = 'loading' | 'ready' | 'notfound' | 'session-expired' | 'ended' | 'error';

/**
 * The backend keeps dead/unknown/expired tokens a uniform 404 (NOT_ACTIVE in
 * deliveries-public.route.ts) and reserves 401/403 for device-session issues.
 * Anything else (edge 503 during a deploy, 429, proxy 5xx) is transient on a
 * flaky mobile network and must never be treated as a dead link.
 */
function isDeadLinkStatus(status: number): boolean {
  return status === 404 || status === 410;
}
type ViewMode = 'list' | 'map' | 'me';

/**
 * Deliveries companion (spec §4.4–4.5), served at /r/:token behind the
 * companion gate. The capability token scopes the route; the device session
 * header proves who is driving it. Every action posts with a fresh op_id so a
 * flaky-network retry applies exactly once, and re-renders from the
 * authoritative response.
 */
@Component({
  selector: 'pc-route-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CompanionGate, PcMap, StatusBadge, Icon],
  templateUrl: './route-page.html',
})
export class RoutePage {
  private readonly session = inject(CompanionSessionService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);

  /** Route param — the capability token from /r/:token. */
  public readonly token = input.required<string>();

  protected readonly reasons = DELIVERY_SKIP_REASONS;

  protected readonly state = signal<PageState>('loading');
  protected readonly data = signal<PublicRouteData | null>(null);
  protected readonly view = signal<ViewMode>('list');

  /** Bottom-nav sections — mirrors the Canvass Companion (List/Map/Me). */
  protected readonly tabs: { id: ViewMode; label: string; icon: PcIconNameType }[] = [
    { id: 'list', label: 'List', icon: 'queue-list' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'me', label: 'Me', icon: 'user-circle' },
  ];

  /** Shift-summary counts for the Me tab, derived from the authoritative stops. */
  protected readonly stats = computed<{ delivered: number; skipped: number; remaining: number; total: number }>(() => {
    const stops = this.data()?.stops ?? [];
    return {
      delivered: stops.filter((s) => s.status === 'delivered').length,
      skipped: stops.filter((s) => s.status === 'skipped').length,
      remaining: stops.filter((s) => s.status === 'pending').length,
      total: stops.length,
    };
  });

  protected readonly reasonPickerFor = signal<string | null>(null);
  protected readonly lastActioned = signal<string | null>(null);
  protected readonly selectedStopId = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly activeStopId = computed(() => this.data()?.stops.find((s) => s.status === 'pending')?.id ?? null);
  protected readonly handled = computed(() => this.data()?.stops.filter((s) => s.status !== 'pending').length ?? 0);
  protected readonly isDone = computed(() => this.data()?.status === 'completed');

  protected readonly markers = computed<PcMapMarker<PublicStop>[]>(() => {
    const d = this.data();
    if (!d) return [];
    const active = this.activeStopId();
    return d.stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({
        position: { lat: s.lat as number, lng: s.lng as number },
        variant: this.pinVariant(s, active),
        tooltip: `${s.seq}. ${s.address}`,
        id: s.id,
        payload: s,
      }));
  });

  protected openTab(tab: ViewMode): void {
    this.view.set(tab);
  }

  /**
   * "End shift on this device" — clears the verified device session so this
   * phone no longer holds access, then drops to a friendly ended screen. There
   * is no local queue to lose: every action posts immediately, so nothing about
   * these households is left behind in the browser.
   */
  protected async endShift(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'End shift on this device?',
      message: 'This signs this device out of the route. Your results are already with your organizer.',
      variant: 'danger',
      confirmText: 'End shift',
      cancelText: 'Keep going',
    });
    if (!confirmed) return;
    this.session.clearSession();
    this.state.set('ended');
    this.alerts.showSuccess('Shift ended. Reopen your link anytime');
  }

  protected statusChip(): { type: 'neutral' | 'warning' | 'success'; label: string } {
    const s = this.data()?.status;
    if (s === 'completed') return { type: 'success', label: 'Completed' };
    if (s === 'in_progress') return { type: 'warning', label: 'In progress' };
    return { type: 'neutral', label: 'Not started' };
  }

  protected selectStop(marker: PcMapMarker): void {
    // pc-map's markerClicked emits PcMapMarker<unknown>; the marker id carries our stop id.
    this.selectedStopId.set(marker.id ?? null);
  }

  protected navigate(stop: PublicStop): void {
    if (stop.lat == null || stop.lng == null) return;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`, '_blank', 'noopener');
  }

  protected openFullRoute(): void {
    const d = this.data();
    if (!d) return;
    const located = d.stops.filter((s) => s.lat != null && s.lng != null);
    if (located.length === 0) return;
    const origin = `${d.start.lat},${d.start.lng}`;
    const dest = located[located.length - 1];
    const waypoints = located
      .slice(0, -1)
      .map((s) => `${s.lat},${s.lng}`)
      .join('|');
    const params = new URLSearchParams({ api: '1', origin, destination: `${dest?.lat},${dest?.lng}` });
    if (waypoints) params.set('waypoints', waypoints);
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank', 'noopener');
  }

  protected openReasonPicker(stopId: string): void {
    this.reasonPickerFor.set(stopId);
  }

  protected cancelReason(): void {
    this.reasonPickerFor.set(null);
  }

  protected async deliver(stopId: string): Promise<void> {
    await this.post(stopId, 'deliver');
  }

  protected async skip(stopId: string, reason: string): Promise<void> {
    const saved = await this.post(stopId, 'skip', reason);
    // Keep the picker open on a failed save so a re-tap retries the same reason.
    if (saved) this.reasonPickerFor.set(null);
  }

  protected async defer(stopId: string): Promise<void> {
    await this.post(stopId, 'defer');
  }

  protected async undo(stopId: string): Promise<void> {
    await this.post(stopId, 'undo');
  }

  protected reload(): void {
    window.location.reload();
  }

  protected retryLoad(): void {
    this.state.set('loading');
    void this.load();
  }

  protected async load(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.state.set('notfound');
      return;
    }
    try {
      const res = await fetch(`/api/deliveries/r/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json', ...this.session.headers() },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) this.state.set('session-expired');
        else if (isDeadLinkStatus(res.status)) this.state.set('notfound');
        else this.state.set('error');
        return;
      }
      this.data.set((await res.json()) as PublicRouteData);
      this.state.set('ready');
    } catch {
      // Network failure: the link may be fine, so offer a retry, not a dead end.
      this.state.set('error');
    }
  }

  private pinVariant(s: PublicStop, activeId: string | null): PcMapVariant {
    if (s.status === 'delivered') return 'success';
    if (s.status === 'skipped') return 'warning';
    if (s.id === activeId) return 'primary';
    return 'muted';
  }

  /** Returns true when the action was saved and the fresh route payload applied. */
  private async post(stopId: string, action: 'deliver' | 'skip' | 'defer' | 'undo', reason?: string): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      const res = await fetch(
        `/api/deliveries/r/${encodeURIComponent(this.token())}/stops/${encodeURIComponent(stopId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...this.session.headers() },
          // A fresh op_id per tap — the server ledger makes retries apply exactly once.
          body: JSON.stringify({ action, reason: reason ?? null, op_id: crypto.randomUUID() }),
        },
      );
      if (!res.ok) {
        // A device-session problem (401/403) still routes back through the gate.
        // Every other failure must NOT discard the loaded route: the backend
        // collapses transient errors (5xx/429) into the SAME uniform 404 it uses
        // for a dead token, so a 404 here is ambiguous and treating it as
        // notfound would throw away a live route on a passing network blip. Keep
        // the route on screen, tell the volunteer, and leave the stop unchanged
        // so a re-tap retries. notfound stays reserved for the initial load().
        if (res.status === 401 || res.status === 403) this.state.set('session-expired');
        else this.alerts.showError("Couldn't save that stop. Check your connection and try again.");
        return false;
      }
      this.data.set((await res.json()) as PublicRouteData);
      if (action === 'deliver' || action === 'skip') this.lastActioned.set(stopId);
      else if (action === 'undo') this.lastActioned.set(null);
      return true;
    } catch {
      // Network failure: nothing changed server-side that we know of; say so
      // instead of losing the tap silently, and leave the stop retriable.
      this.alerts.showError("Couldn't save that stop. Check your connection and try again.");
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
