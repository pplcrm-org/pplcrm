import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';

import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import type { PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { Table } from '@uxcommon/components/table/table';
import { createLoadingGate } from '@uxcommon/loading-gate';

import type { CompanionVolunteerRow, CompanionVolunteerStatus } from '../../../../../../../libs/common/src';
import { VolunteerAccessService } from '../services/volunteer-access-service';

const STATUS_LABELS: Record<CompanionVolunteerStatus, string> = {
  invited: 'Invited',
  verified: 'Awaiting approval',
  approved: 'Approved',
  revoked: 'Revoked',
};

const STATUS_TYPES: Record<CompanionVolunteerStatus, PcStatusType> = {
  invited: 'ghost',
  verified: 'warning',
  approved: 'success',
  revoked: 'error',
};

/**
 * Volunteer access admin page (COMPANION-APPS-PLAN.md §4 A3). Companion links
 * are personal: the volunteer verifies a code sent to their contact on file,
 * then an admin approves them here — once per volunteer, revocable anytime.
 * A bespoke `pc-table` (not the datagrid): four statuses, two actions.
 */
@Component({
  selector: 'pc-volunteer-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, StatusBadge, Table, GridHeaderComponent],
  templateUrl: './volunteer-access-page.html',
})
export class VolunteerAccessPage implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly confirmDlg = inject(ConfirmDialogService);
  private readonly svc = inject(VolunteerAccessService);

  protected readonly busyId = signal<string | null>(null);
  protected readonly flashedId = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly loading = createLoadingGate();
  protected readonly rows = signal<CompanionVolunteerRow[]>([]);

  public ngOnInit(): void {
    void this.refresh();
  }

  protected async approve(row: CompanionVolunteerRow): Promise<void> {
    this.busyId.set(row.id);
    try {
      await this.svc.approve(row.id);
      this.alerts.showSuccess(`Approved ${this.displayName(row)}. Their link works now`);
      this.flash(row.id);
      await this.refresh();
    } catch {
      this.alerts.showError('Could not approve. Try again');
    } finally {
      this.busyId.set(null);
    }
  }

  protected contactLine(row: CompanionVolunteerRow): string {
    return [row.email, row.mobile].filter(Boolean).join(' · ') || '—';
  }

  /** Overrides the workspace roam setting for one person; 'default' hands them back to it. */
  protected readonly roamOptions = [
    { label: 'Workspace default', value: 'default' },
    { label: 'Any turf in campaign', value: 'roam' },
    { label: 'Only assigned turfs', value: 'assigned' },
  ];

  protected roamValue(row: CompanionVolunteerRow): string {
    if (row.can_roam == null) return 'default';
    return row.can_roam ? 'roam' : 'assigned';
  }

  protected async onRoamChange(row: CompanionVolunteerRow, event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const canRoam = target.value === 'default' ? null : target.value === 'roam';
    this.busyId.set(row.id);
    try {
      await this.svc.setRoam(row.id, canRoam);
      this.alerts.showSuccess(`Updated turf access for ${this.displayName(row)}`);
      this.flash(row.id);
      await this.refresh();
    } catch {
      this.alerts.showError('Could not change turf access. Try again');
      await this.refresh();
    } finally {
      this.busyId.set(null);
    }
  }

  protected displayName(row: CompanionVolunteerRow): string {
    return [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed volunteer';
  }

  protected pendingSentence(): string | null {
    const pending = this.rows().filter((r) => r.status === 'verified').length;
    const total = this.rows().length;
    if (total === 0) return null;
    return pending > 0
      ? `${total} volunteer${total === 1 ? '' : 's'} · ${pending} awaiting approval`
      : `${total} volunteer${total === 1 ? '' : 's'}`;
  }

  protected async revoke(row: CompanionVolunteerRow): Promise<void> {
    const confirmed = await this.confirmDlg.confirm({
      title: `Revoke ${this.displayName(row)}'s access?`,
      message: 'Every device they verified stops working on their next request. You can approve them again later.',
      variant: 'danger',
      confirmText: 'Revoke access',
    });
    if (!confirmed) return;
    this.busyId.set(row.id);
    try {
      await this.svc.revoke(row.id);
      this.alerts.showSuccess(`Revoked ${this.displayName(row)}. Their devices are signed out`);
      await this.refresh();
    } catch {
      this.alerts.showError('Could not revoke. Try again');
    } finally {
      this.busyId.set(null);
    }
  }

  protected statusLabel(status: CompanionVolunteerStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusType(status: CompanionVolunteerStatus): PcStatusType {
    return STATUS_TYPES[status];
  }

  protected verifiedLine(row: CompanionVolunteerRow): string {
    if (!row.verified_at) return '—';
    const channel = row.verify_channel === 'sms' ? 'text' : row.verify_channel === 'email' ? 'email' : '';
    const date = new Date(row.verified_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return channel ? `via ${channel} · ${date}` : date;
  }

  private flash(id: string): void {
    this.flashedId.set(id);
    setTimeout(() => this.flashedId.set(null), 1500);
  }

  private async refresh(): Promise<void> {
    const end = this.loading.begin();
    try {
      this.rows.set(await this.svc.getAll());
      this.loaded.set(true);
    } catch {
      this.alerts.showError('Could not load volunteers. Refresh to try again');
    } finally {
      end();
    }
  }
}
