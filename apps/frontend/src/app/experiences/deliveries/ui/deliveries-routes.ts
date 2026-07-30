import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import type { PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { Table } from '@uxcommon/components/table/table';
import { Icon } from '@icons/icon';

import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { companionUrl, volunteerLinkSentPhrase } from '../../../shared/public-pages';
import { AssignVolunteerDialog } from './assign-volunteer-dialog';
import { DeliveriesNav } from './deliveries-nav';

import { DeliveriesRoutesService, type DeliveryRouteRow } from '../services/deliveries-routes-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

type PersonSearchResult = { id: string; first_name: string | null; last_name: string | null; email: string | null };

const ROUTE_TONE: Record<string, PcStatusType> = {
  draft: 'neutral',
  assigned: 'info',
  in_progress: 'warning',
  completed: 'success',
  canceled: 'ghost',
};

/** Deliveries routes grid (spec §4.3 list). */
@Component({
  selector: 'pc-deliveries-routes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyState,
    RouterLink,
    StatusBadge,
    Icon,
    DatePipe,
    Table,
    RowActions,
    DeliveriesNav,
    AssignVolunteerDialog,
  ],
  templateUrl: './deliveries-routes.html',
})
export class DeliveriesRoutes implements OnInit {
  private readonly svc = inject(DeliveriesRoutesService);
  private readonly alerts = inject(AlertService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly assignDlg = viewChild.required<AssignVolunteerDialog>('assignDlg');
  /** Canceling a route can retire the in-progress count the nav badge is showing. */
  private readonly nav = viewChild.required(DeliveriesNav);
  protected readonly loading = createLoadingGate();

  protected readonly rows = signal<DeliveryRouteRow[]>([]);
  protected readonly loaded = signal(false);

  /** The route the open picker is acting on — the dialog itself is route-agnostic. */
  private readonly assigningRouteId = signal<string | null>(null);

  public ngOnInit(): void {
    void this.reload();
  }

  protected tone(status: string): PcStatusType {
    return ROUTE_TONE[status] ?? 'neutral';
  }

  protected label(status: string): string {
    return status === 'in_progress' ? 'in progress' : status;
  }

  /** Cancel is meaningless once a route is already canceled or completed. */
  protected canCancel(status: string): boolean {
    return status !== 'canceled' && status !== 'completed';
  }

  /** Delete only while nothing has happened yet (mirrors the route-detail rule). */
  protected canDelete(status: string): boolean {
    return status === 'draft' || status === 'assigned';
  }

  /** Re-sending only makes sense while the route is still live (same statuses as cancel). */
  protected canResend(status: string): boolean {
    return this.canCancel(status);
  }

  protected openAssign(row: DeliveryRouteRow): void {
    this.assigningRouteId.set(row.id);
    this.assignDlg().open(row.volunteer_person_id != null);
  }

  protected async onVolunteerSelected(person: PersonSearchResult | null): Promise<void> {
    const routeId = this.assigningRouteId();
    if (!routeId) return;
    try {
      const res = await this.svc.assignVolunteer(routeId, person?.id ?? null);
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
      await this.reload();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not update the volunteer');
    }
  }

  protected async copyLink(row: DeliveryRouteRow, regenerate = false): Promise<void> {
    try {
      const res = await this.svc.mintShareLink(row.id, regenerate);
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
        if (ok) await this.copyLink(row, true);
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
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not create the link');
    }
  }

  /** Mint a fresh link and send it to the volunteer's contacts (replaces the previously sent link). */
  protected async resendLink(row: DeliveryRouteRow): Promise<void> {
    try {
      const res = await this.svc.resendVolunteerLink(row.id);
      const phrase = volunteerLinkSentPhrase(res.sent);
      this.alerts.showSuccess(phrase ? `Fresh ${phrase}` : 'Link sent');
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not send the link');
    }
  }

  protected async cancelRoute(row: DeliveryRouteRow): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Cancel this route?',
      message: 'Its undelivered stops return to the planning pool. Delivered stops keep their record.',
      variant: 'danger',
      confirmText: 'Cancel route',
    });
    if (!ok) return;
    try {
      await this.svc.setStatus(row.id, 'canceled');
      this.alerts.showSuccess('Route canceled');
      await Promise.all([this.reload(), this.nav().refresh()]);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not cancel the route');
    }
  }

  protected async deleteRoute(row: DeliveryRouteRow): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Delete this route?',
      message: 'This removes the route. Its stops return to the planning pool.',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await this.svc.delete(row.id);
      this.alerts.showSuccess('Route deleted');
      await this.reload();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not delete the route');
    }
  }

  protected stopsLabel(row: DeliveryRouteRow): string {
    if (row.stops_total === 0) return '0';
    if (row.stops_delivered > 0 || row.status === 'in_progress' || row.status === 'completed') {
      return `${row.stops_delivered} of ${row.stops_total} delivered`;
    }
    return String(row.stops_total);
  }

  private async reload(): Promise<void> {
    const end = this.loading.begin();
    try {
      const list = await this.svc.getAll();
      this.rows.set(list.rows);
      this.loaded.set(true);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not load routes');
    } finally {
      end();
    }
  }
}
