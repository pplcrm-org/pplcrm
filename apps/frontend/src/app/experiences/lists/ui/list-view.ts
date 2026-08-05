import { Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ListsService } from '@experiences/lists/services/lists-service';
import { buildDeleteConfirmMessage } from '@experiences/lists/services/list-consumers';
import { ListsType } from '../../../../../../../libs/common/src';
import { FormActions } from '@uxcommon/components/form-actions/form-actions';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { PersonsGrid } from '@experiences/persons/ui/persons-grid';
import { HouseholdsGrid } from '@experiences/households/ui/households-grid';
import { StatCard } from '@uxcommon/components/stat-card/stat-card';
import { Tabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';

@Component({
  selector: 'pc-list-view',
  imports: [FormActions, Icon, RouterLink, RecordActivities, PersonsGrid, HouseholdsGrid, StatCard, Tabs, TabPanel],
  templateUrl: './list-view.html',
})
export class ListView implements OnDestroy {
  readonly id = input.required<string>();

  private readonly alerts = inject(AlertService);
  private readonly lists = inject(ListsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ConfirmDialogService);
  protected loading = signal<boolean>(false);
  protected refreshing = signal<boolean>(false);
  protected memberCount = signal<number>(0);
  protected object = signal<'people' | 'households' | null>(null);
  protected listData = signal<ListsType | null>(null);
  protected stats = signal<any>(null);
  // Active tab state
  protected activeTab = signal<string>('members');

  protected readonly listTabs = computed<PcTabOption[]>(() => [
    { id: 'members', label: 'Members', badge: this.memberCount() },
    { id: 'newsletters', label: 'Newsletter campaigns', badge: this.stats()?.newsletters?.length || 0 },
  ]);

  protected isPeople = computed(() => this.object() === 'people');

  /** Built-in lists (§8) — product-owned, so undeletable and unrenameable. */
  protected readonly isSystem = computed(() => this.listData()?.system_key != null);

  constructor() {
    effect(() => {
      const currentId = this.id();
      untracked(() => {
        if (currentId) void this.loadListDetails();
      });
    });
  }

  protected async loadListDetails(id = this.id()) {
    try {
      this.loading.set(true);

      const list = (await this.lists.getById(id)) as ListsType;
      this.listData.set(list);
      this.object.set(list.object as 'people' | 'households');

      // Fetch list membership count efficiently
      const count = await this.lists.getMemberCount(id);
      this.memberCount.set(count);

      // Fetch campaign stats and history
      const statsData = await this.lists.getListStats(id);
      this.stats.set(statsData);
    } catch (_e) {
      this.alerts.showError('Failed to load list details');
    } finally {
      this.loading.set(false);
    }
  }

  private pollInterval: ReturnType<typeof setInterval> | null = null;

  protected async refreshList() {
    try {
      this.refreshing.set(true);
      await this.lists.refreshList(this.id());
      this.alerts.showSuccess('Refresh job scheduled in background');
      this.pollRefreshStatus();
    } catch (e) {
      this.alerts.showError(getUserErrorMessage(e, 'Could not refresh the list. Please try again.'));
      this.refreshing.set(false);
    }
  }

  private pollRefreshStatus() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(() => void this.pollStep(), 1500);
  }

  private async pollStep(): Promise<void> {
    try {
      const list = (await this.lists.getById(this.id())) as ListsType;
      this.listData.set(list);
      if (list.status !== 'refreshing') {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = null;
        this.refreshing.set(false);
        if (list.status === 'failed') {
          this.alerts.showError('List refresh failed in background');
        } else {
          this.alerts.showSuccess('List refreshed successfully');
        }
        await this.loadListDetails();
      }
    } catch (_e) {
      if (this.pollInterval) clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.refreshing.set(false);
    }
  }

  public ngOnDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  protected editList() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deleteList() {
    const id = this.id();
    if (!id || this.isSystem()) return;
    let consumers: unknown = null;
    try {
      consumers = await this.lists.getConsumers(id);
    } catch {
      // Fall back to the generic body if consumers can't be loaded.
    }
    const listName = this.listData()?.name ?? '';
    const confirmed = await this.dialogs.confirm({
      title: 'Delete list',
      message: buildDeleteConfirmMessage(listName, consumers),
      variant: 'danger',
      confirmText: 'Delete list',
      // Safe action styled primary (§8): "Keep list" is the reassuring default.
      cancelText: 'Keep list',
    });
    if (!confirmed) return;
    this.loading.set(true);
    try {
      await this.lists.delete(this.id());
      this.lists.triggerRefresh();
      this.alerts.showSuccess('List deleted');
      await this.router.navigate(['/lists']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete list';
      this.alerts.showError(message);
    } finally {
      this.loading.set(false);
    }
  }

  protected formatDate(value: Date | string | null | undefined): string {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  protected formatPercent(value: number | null | undefined): string {
    if (value == null) return '—';
    return `${value.toFixed(1)}%`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
