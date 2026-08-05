import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { ShiftsService } from '../services/shifts-service';
import { VolunteerService } from '../../../services/api/volunteer-service';
import { AuthService } from '../../../auth/auth-service';
import { publicPageUrl } from '../../../shared/public-pages';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { Tabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { StatCard } from '@uxcommon/components/stat-card/stat-card';
import { ProfileCard } from '@uxcommon/components/profile-card/profile-card';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailRow } from '@uxcommon/components/detail-row/detail-row';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

@Component({
  selector: 'pc-shift-view',
  imports: [
    DatePipe,
    RouterModule,
    Icon,
    RecordActivities,
    DetailLayout,
    Tabs,
    TabPanel,
    StatusBadge,
    StatCard,
    ProfileCard,
    DetailRow,
    PcCard,
  ],
  templateUrl: './shift-view.html',
  providers: [VolunteerService],
})
export class ShiftViewComponent {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('shift', this.id);

  private readonly alertSvc = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly volunteerEventsSvc = inject(ShiftsService);
  private readonly volunteerSvc = inject(VolunteerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly event = signal<any | null>(null);
  protected readonly roster = signal<any[]>([]);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Forms', route: '/forms' },
    { label: this.event()?.name || 'Volunteer event' },
  ]);

  // Active tab state
  protected activeTab = signal<string>('roster');

  /**
   * A cancelled shift has given its spot back, so it is not one of the people coming.
   * The whole page counts volunteers this way — the tab badge, the "Signed Up" tile and
   * "Remaining Capacity" all read this, so they cannot disagree with each other or with
   * the public signup page's capacity check.
   */
  protected readonly activeRoster = computed(() => this.roster().filter((r) => r.status !== 'cancelled'));

  protected readonly eventTabs = computed<PcTabOption[]>(() => [
    { id: 'roster', label: 'Volunteer roster', badge: this.activeRoster().length },
    { id: 'activity', label: 'Activity' },
  ]);

  protected readonly eventPassed = computed(() => {
    const end = this.event()?.end_time;
    if (!end) return false;
    return new Date(end) < new Date();
  });

  protected readonly remainingCapacity = computed(() => {
    const detail = this.event();
    if (!detail || detail.capacity === null || detail.capacity === undefined) {
      return 'Unlimited';
    }
    const count = this.activeRoster().length;
    return Math.max(0, detail.capacity - count);
  });

  protected readonly publicUrl = computed(() => {
    const slug = this.event()?.slug;
    if (!slug) return '';
    return publicPageUrl(this.auth.getUser()?.tenant_slug, `v/${slug}`);
  });

  constructor() {
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.loadAllData(currentId));
    });
  }

  protected async loadAllData(id: string) {
    const isCurrent = this._requestGuard.begin();
    const end = this._loading.begin();
    try {
      // 1. Load Event details
      const detail = await this.volunteerEventsSvc.getById(id);
      if (!isCurrent()) return;
      this.event.set(detail);

      // 2. Load associated shifts/roster
      const rosterData = await this.volunteerSvc.getShiftsForEvent(id);
      if (!isCurrent()) return;
      this.roster.set(rosterData || []);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the shift. Please try again.'));
    } finally {
      end();
      this.initialized.set(true);
    }
  }

  protected editEvent() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deleteEvent() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Event',
      message: 'Are you sure you want to delete this event? This will also delete all signed up shifts.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.volunteerEventsSvc.delete(this.id());
      this.volunteerEventsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Event deleted');
      await this.router.navigate(['/forms']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete event';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  protected copySnippet(): void {
    const url = this.publicUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => this.alertSvc.showSuccess('Public signup link copied to clipboard!'),
      () => this.alertSvc.showError('Failed to copy to clipboard.'),
    );
  }

  protected getStatusType(status: string | null | undefined): any {
    const s = String(status || '').toLowerCase();
    switch (s) {
      case 'attended':
        return 'success';
      case 'signed_up':
        return 'warning';
      case 'no_show':
        return 'error';
      case 'cancelled':
        return 'neutral';
      default:
        return 'ghost';
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
