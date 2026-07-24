import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailRow } from '@uxcommon/components/detail-row/detail-row';
import { ProfileCard } from '@uxcommon/components/profile-card/profile-card';
import { StatCard } from '@uxcommon/components/stat-card/stat-card';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { PcTabOption, TabPanel, Tabs } from '@uxcommon/components/tabs/tabs';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import type { IAuthUser } from '../../../../../../../libs/common/src';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { UserService } from '../../../services/user.service';
import { TasksService } from '../../tasks/services/tasks-service';
import { TeamsService } from '../services/teams-service';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

@Component({
  selector: 'pc-team-view',
  imports: [
    EmptyState,
    DatePipe,
    RouterModule,
    RecordActivities,
    DetailLayout,
    StatCard,
    Tabs,
    TabPanel,
    StatusBadge,
    ProfileCard,
    DetailRow,
  ],
  templateUrl: './team-view.html',
})
export class TeamViewComponent {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('team', this.id);

  private readonly alertSvc = inject(AlertService);
  private readonly teamsSvc = inject(TeamsService);
  private readonly tasksSvc = inject(TasksService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly dialogs = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly team = signal<any>(null);
  protected readonly teamTasks = signal<any[]>([]);
  protected readonly volunteers = computed(() => this.team()?.volunteers ?? []);
  protected readonly users = signal<IAuthUser[]>([]);
  private usersById = new Map<string, IAuthUser>();

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Teams', route: '/teams' },
    { label: this.team()?.name || 'Team' },
  ]);

  // Active tab state
  protected activeTab = signal<string>('volunteers');

  protected readonly teamTabs = computed<PcTabOption[]>(() => [
    { id: 'volunteers', label: 'Volunteers', badge: this.volunteers().length },
    { id: 'lists', label: 'Target lists', badge: this.team()?.lists?.length || 0 },
    { id: 'tasks', label: 'Team tasks', badge: this.teamTasks().length },
    // Activity is the record's history — last tab in every view.
    { id: 'activity', label: 'Activity' },
  ]);

  protected readonly captainName = computed(() => {
    const captainId = this.team()?.team_captain_id;
    if (!captainId) return '—';
    const match = this.volunteers().find((v: any) => v.id === captainId);
    return match ? `${match.first_name} ${match.last_name || ''}`.trim() : '—';
  });

  protected readonly leadName = computed(() => {
    const leadId = this.team()?.team_lead_user_id;
    if (!leadId) return '—';
    const match = this.users().find((u) => String(u.id) === String(leadId));
    return match ? `${match.first_name} ${match.last_name || ''}`.trim() : '—';
  });

  protected readonly activeTasksCount = computed(() => {
    return this.teamTasks().filter((t) => t.status !== 'done' && t.status !== 'archived').length;
  });

  constructor() {
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.loadAllData(currentId));
    });

    // Load users
    this.userService
      .getUsers()
      .then((u) => {
        this.users.set(u);
        this.usersById = new Map(u.map((x) => [x.id, x]));
      })
      .catch(() => void 0);
  }

  protected async loadAllData(id: string) {
    const isCurrent = this._requestGuard.begin();
    const end = this._loading.begin();
    try {
      // 1. Load team detail
      const data = await this.teamsSvc.getById(id);
      if (!isCurrent()) return; // superseded — do not land stale data
      this.team.set(data);

      // 2. Load associated tasks
      const res = await this.tasksSvc.getAll({
        filterModel: { team_id: { value: id } },
      } as any);
      if (!isCurrent()) return;
      this.teamTasks.set(res?.rows ?? []);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the team. Please try again.'));
    } finally {
      end();
      this.initialized.set(true);
    }
  }

  protected editTeam() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deleteTeam() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Team',
      message: 'Are you sure you want to delete this team? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.teamsSvc.delete(this.id());
      this.teamsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Team deleted');
      await this.router.navigate(['/teams']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete team';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  protected getCreatedAt(): Date | null {
    const date = this.team()?.created_at;
    return date ? new Date(date) : null;
  }

  protected getUpdatedAt(): Date | null {
    const date = this.team()?.updated_at;
    return date ? new Date(date) : null;
  }

  protected getUserName(id: string | null | undefined): string {
    if (!id) return '?';
    return this.usersById.get(String(id))?.first_name ?? '?';
  }

  protected getPriorityType(priority: string | null | undefined): any {
    const p = String(priority || '').toLowerCase();
    switch (p) {
      case 'urgent':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'info';
      default:
        return 'ghost';
    }
  }

  protected getStatusType(status: string | null | undefined): any {
    const s = String(status || '').toLowerCase();
    switch (s) {
      case 'done':
        return 'success';
      case 'in_progress':
        return 'info';
      case 'waiting':
        return 'error';
      case 'archived':
        return 'neutral';
      default:
        return 'ghost';
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
