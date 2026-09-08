import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { GeocodeChip } from '@uxcommon/components/geocode-chip/geocode-chip';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import type { PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { TabBar, type PcTabOption } from '@uxcommon/components/tabs/tabs';
import { Table } from '@uxcommon/components/table/table';
import { Icon } from '@icons/icon';

import { AddFromListDialog } from './add-from-list-dialog';
import { requestSourceLabelSentence } from './request-source-label';

import { DELIVERY_PURPOSE_LABELS } from '../../../../../../../libs/common/src';
import { DeliveriesRequestsService, type DeliveryRequestRow } from '../services/deliveries-requests-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

type Tab = 'open' | 'new' | 'approved' | 'delivered' | 'declined';

const STATUS_TONE: Record<string, PcStatusType> = {
  new: 'neutral',
  approved: 'info',
  delivered: 'success',
  declined: 'ghost',
};

/**
 * The Requests tab, embedded in the Canvassing page (turfs-absorb-deliveries Phase 4 —
 * one module, so nobody has to know which of two sidebar entries their yard signs live
 * under). Status tabs with live counts, readiness narration via the shared geocode chip,
 * bulk approve/decline, Add-from-list, and the "Cut into outings · N ready" primary —
 * which asks the HOST page to open the cut wizard in delivery mode (`cutRequested`),
 * because the wizard lives there. Disabled when nothing is approved-and-located, since
 * there would be nothing to send out.
 */
@Component({
  selector: 'pc-deliveries-requests',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AddFromListDialog, EmptyState, RouterLink, GeocodeChip, StatusBadge, Icon, DatePipe, TabBar, Table],
  templateUrl: './deliveries-requests.html',
})
export class DeliveriesRequests implements OnInit {
  private readonly svc = inject(DeliveriesRequestsService);
  private readonly alerts = inject(AlertService);
  protected readonly loading = createLoadingGate();

  /** "Cut into outings" pressed — the host page owns the cut wizard and opens it in delivery mode. */
  public readonly cutRequested = output<void>();

  protected readonly rows = signal<DeliveryRequestRow[]>([]);
  /** The server's total for the active tab — when it exceeds the loaded rows, the template says so. */
  protected readonly serverTotal = signal(0);
  protected readonly counts = signal<Record<string, number>>({});
  protected readonly readyCount = signal(0);
  protected readonly activeTab = signal<Tab>('open');
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly loaded = signal(false);

  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly sourceLabel = requestSourceLabelSentence;
  protected readonly newInView = computed(() => this.rows().filter((r) => r.status === 'new').length);

  private readonly tabs: Array<{ key: Tab; label: string }> = [
    { key: 'open', label: 'Open' },
    { key: 'new', label: 'New' },
    { key: 'approved', label: 'Approved' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'declined', label: 'Declined' },
  ];

  protected readonly tabOptions = computed<PcTabOption[]>(() =>
    this.tabs.map((t) => ({ id: t.key, label: t.label, badge: this.countFor(t.key) })),
  );

  public ngOnInit(): void {
    void this.reload();
  }

  protected statusTone(status: string): PcStatusType {
    return STATUS_TONE[status] ?? 'neutral';
  }

  protected countFor(tab: Tab): number {
    return this.counts()[tab] ?? 0;
  }

  protected async setTab(tab: string): Promise<void> {
    const match = this.tabs.find((t) => t.key === tab);
    if (!match || this.activeTab() === match.key) return;
    this.activeTab.set(match.key);
    this.selected.set(new Set());
    await this.reload();
  }

  protected isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  protected selectAllNew(): void {
    const next = new Set(this.selected());
    for (const r of this.rows()) if (r.status === 'new') next.add(r.id);
    this.selected.set(next);
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected cutOutings(): void {
    this.cutRequested.emit();
  }

  /** "Yard sign" / "Flyer" for the Kind column; an unknown stored value shows as the default. */
  protected purposeLabel(purpose: string | null): string {
    return DELIVERY_PURPOSE_LABELS[purpose === 'flyer' ? 'flyer' : 'yard_sign'];
  }

  /** Re-read the grid — called by the host page after a delivery cut claims requests. */
  public refresh(): void {
    void this.reload();
  }

  protected readonly addFromListOpen = signal(false);

  protected onAddFromListDone(created: number): void {
    this.addFromListOpen.set(false);
    if (created > 0) void this.reload();
  }

  protected async approveSelected(): Promise<void> {
    await this.applyStatus('approved');
  }

  protected async declineSelected(): Promise<void> {
    await this.applyStatus('declined');
  }

  private async applyStatus(status: 'approved' | 'declined'): Promise<void> {
    const ids = Array.from(this.selected());
    if (ids.length === 0) return;
    const end = this.loading.begin();
    try {
      await this.svc.setStatus(ids, status);
      this.alerts.showSuccess(
        `${status === 'approved' ? 'Approved' : 'Declined'} ${ids.length} request${ids.length === 1 ? '' : 's'}`,
      );
      this.selected.set(new Set());
      await this.reload();
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not update the requests');
    } finally {
      end();
    }
  }

  private async reload(): Promise<void> {
    const end = this.loading.begin();
    try {
      const [list, counts, ready] = await Promise.all([
        this.svc.getAll({ filterModel: { status: { value: this.activeTab() } } }),
        this.svc.getStatusCounts(),
        this.svc.getReadyCount(),
      ]);
      this.rows.set(list.rows);
      this.serverTotal.set(Number(list.count ?? list.rows.length));
      this.counts.set(counts);
      this.readyCount.set(ready);
      this.loaded.set(true);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not load requests');
    } finally {
      end();
    }
  }
}
