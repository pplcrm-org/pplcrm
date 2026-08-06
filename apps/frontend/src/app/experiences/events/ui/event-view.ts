import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { Tabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';
import { StatCard } from '@uxcommon/components/stat-card/stat-card';
import { ProfileCard } from '@uxcommon/components/profile-card/profile-card';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailRow } from '@uxcommon/components/detail-row/detail-row';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { AuthService } from '../../../auth/auth-service';
import { publicPageUrl } from '../../../shared/public-pages';
import { EventsFrontendService } from '../services/events-frontend-service';
import { EventsService } from '../../../services/api/events-service';
import { PersonsService } from '../../persons/services/persons-service';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';

@Component({
  selector: 'pc-event-view',
  imports: [
    StatusBadge,
    EmptyState,
    DatePipe,
    RouterModule,
    Icon,
    RecordActivities,
    DetailLayout,
    Tabs,
    TabPanel,
    StatCard,
    ProfileCard,
    DetailRow,
    PcCard,
  ],
  templateUrl: './event-view.html',
  providers: [EventsService],
})
export class EventViewComponent {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('event', this.id);

  private readonly alertSvc = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly eventsFrontendSvc = inject(EventsFrontendService);
  private readonly eventsSvc = inject(EventsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ConfirmDialogService);

  protected readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();

  protected readonly event = signal<any | null>(null);
  protected readonly ticketTypes = signal<any[]>([]);
  protected readonly registrations = signal<any[]>([]);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Forms', route: '/forms' },
    { label: this.event()?.name || 'Event' },
  ]);

  // Person search for adding registrations
  protected readonly personSearch = signal('');
  protected readonly personSearchResults = signal<any[]>([]);
  protected readonly selectedPersonId = signal<string | null>(null);
  protected readonly selectedTicketTypeId = signal<string | null>(null);
  protected readonly addingRegistration = signal(false);
  protected readonly searchTimeout: ReturnType<typeof setTimeout> | null = null;

  protected activeTab = signal<string>('attendees');

  protected readonly eventTabs = computed<PcTabOption[]>(() => [
    {
      id: 'attendees',
      label: 'Attendees',
      badge: this.registrations().filter((r) => r.status !== 'cancelled').length,
    },
    { id: 'activity', label: 'Activity' },
  ]);

  protected readonly eventPassed = computed(() => {
    const end = this.event()?.end_time;
    if (!end) return false;
    return new Date(end) < new Date();
  });

  protected readonly activeCount = computed(() => this.registrations().filter((r) => r.status !== 'cancelled').length);

  protected readonly attendedCount = computed(() => this.registrations().filter((r) => r.status === 'attended').length);

  protected readonly publicUrl = computed(() => {
    const slug = this.event()?.slug;
    if (!slug) return '';
    return publicPageUrl(this.auth.getUser()?.tenant_slug, `e/${slug}`);
  });

  protected readonly remainingCapacity = computed(() => {
    const ev = this.event();
    if (!ev || ev.capacity === null || ev.capacity === undefined) return 'Unlimited';
    return Math.max(0, ev.capacity - this.activeCount());
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
      const [eventData, ticketData, regData] = await Promise.all([
        this.eventsFrontendSvc.getById(id),
        this.eventsSvc.getTicketTypes(id),
        this.eventsSvc.getRegistrations(id),
      ]);
      if (!isCurrent()) return;
      this.event.set(eventData);
      this.ticketTypes.set(ticketData || []);
      this.registrations.set(regData || []);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the event. Please try again.'));
    } finally {
      end();
    }
  }

  protected copyPublicUrl() {
    const url = this.publicUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => this.alertSvc.showSuccess('Public RSVP link copied to clipboard!'),
      () => this.alertSvc.showError('Failed to copy to clipboard.'),
    );
  }

  protected editEvent() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deleteEvent() {
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Event Page',
      message: 'Are you sure you want to delete this event? All registrations will also be deleted.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;

    const end = this._loading.begin();
    try {
      await this.eventsFrontendSvc.delete(this.id());
      this.eventsFrontendSvc.triggerRefresh();
      this.alertSvc.showSuccess('Event deleted');
      await this.router.navigate(['/forms']);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Unable to delete event');
    } finally {
      end();
    }
  }

  // Person search
  protected onPersonSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    void this.onPersonSearch(input?.value ?? '');
  }

  protected onTicketTypeChange(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    this.selectedTicketTypeId.set(select?.value ? select.value : null);
  }

  protected onStatusChange(reg: any, event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) return;
    void this.updateStatus(reg, select.value);
  }

  protected async onPersonSearch(query: string) {
    this.personSearch.set(query);
    this.selectedPersonId.set(null);
    if (!query.trim()) {
      this.personSearchResults.set([]);
      return;
    }
    try {
      const res = await this.personsSvc.getAll({ searchStr: query.toLowerCase().trim(), startRow: 0, endRow: 10 });
      this.personSearchResults.set(res?.rows || []);
    } catch {
      this.personSearchResults.set([]);
    }
  }

  protected selectPerson(person: any) {
    this.selectedPersonId.set(String(person.id));
    this.personSearch.set(`${person.first_name} ${person.last_name}`.trim());
    this.personSearchResults.set([]);
  }

  protected async addRegistration() {
    const personId = this.selectedPersonId();
    if (!personId) {
      this.alertSvc.showError('Please select a person to register.');
      return;
    }
    this.addingRegistration.set(true);
    try {
      await this.eventsSvc.addRegistration({
        event_id: this.id(),
        person_id: personId,
        ticket_type_id: this.selectedTicketTypeId() || null,
      });
      this.alertSvc.showSuccess('Registration added');
      this.personSearch.set('');
      this.selectedPersonId.set(null);
      this.selectedTicketTypeId.set(null);
      this.personSearchResults.set([]);
      const regs = await this.eventsSvc.getRegistrations(this.id());
      this.registrations.set(regs || []);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to add registration');
    } finally {
      this.addingRegistration.set(false);
    }
  }

  protected async checkIn(reg: any) {
    try {
      await this.eventsSvc.checkIn(String(reg.id));
      this.alertSvc.showSuccess(`${reg.first_name} checked in`);
      const regs = await this.eventsSvc.getRegistrations(this.id());
      this.registrations.set(regs || []);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to check in');
    }
  }

  protected async updateStatus(reg: any, status: string) {
    try {
      await this.eventsSvc.updateRegistration(String(reg.id), { status: status as any });
      const regs = await this.eventsSvc.getRegistrations(this.id());
      this.registrations.set(regs || []);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to update status');
    }
  }

  protected async deleteRegistration(reg: any) {
    const confirmed = await this.dialogs.confirm({
      title: 'Remove Registration',
      message: `Remove ${reg.first_name} ${reg.last_name} from this event?`,
      variant: 'danger',
      confirmText: 'Remove',
    });
    if (!confirmed) return;
    try {
      await this.eventsSvc.deleteRegistration(String(reg.id));
      this.alertSvc.showSuccess('Registration removed');
      const regs = await this.eventsSvc.getRegistrations(this.id());
      this.registrations.set(regs || []);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to remove registration');
    }
  }

  protected exportCsv() {
    const regs = this.registrations().filter((r) => r.status !== 'cancelled');
    const headers = ['First Name', 'Last Name', 'Email', 'Mobile', 'Ticket Type', 'Price', 'Status', 'Checked In At'];
    const rows = regs.map((r) => [
      r.first_name ?? '',
      r.last_name ?? '',
      r.email ?? '',
      r.mobile ?? '',
      r.ticket_type_name ?? '',
      r.ticket_price_cents != null ? `$${(r.ticket_price_cents / 100).toFixed(2)}` : 'Free',
      r.status ?? '',
      r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.event()?.slug || 'event'}-attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected getStatusType(status: string | null | undefined): any {
    switch (String(status || '').toLowerCase()) {
      case 'attended':
        return 'success';
      case 'registered':
        return 'warning';
      case 'no_show':
        return 'error';
      case 'cancelled':
        return 'neutral';
      default:
        return 'ghost';
    }
  }

  protected ticketTypeLabel(id: string | null): string {
    if (!id) return '';
    const t = this.ticketTypes().find((tt) => tt.id === id);
    return t ? t.name : '';
  }
}
