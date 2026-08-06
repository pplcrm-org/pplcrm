import { Location } from '@angular/common';
import { Component, computed, effect, inject, input, resource, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { LogInteraction } from '@experiences/activity/ui/log-interaction/log-interaction';
import { PeopleInCompany } from './people-in-company';
import { CompaniesService } from '../services/companies-service';
import { UserService } from '../../../services/user.service';
import { PersonsService } from '../../persons/services/persons-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { Tabs as PcTabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';
import { DetailItem } from '@uxcommon/components/detail-item/detail-item';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { SystemMetadata } from '@uxcommon/components/system-metadata/system-metadata';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

@Component({
  selector: 'pc-company-view',
  imports: [
    RouterModule,
    PeopleInCompany,
    RecordActivities,
    LogInteraction,
    DetailLayout,
    PcCard,
    PcTabs,
    TabPanel,
    DetailItem,
    SystemMetadata,
    Icon,
    StatusBadge,
  ],
  templateUrl: './company-view.html',
})
export class CompanyView {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('company', this.id);
  protected readonly activityFeed = viewChild(RecordActivities);

  private readonly alertSvc = inject(AlertService);
  private readonly companiesSvc = inject(CompaniesService);
  private readonly personsSvc = inject(PersonsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly userService = inject(UserService);
  private readonly dialogs = inject(ConfirmDialogService);

  protected readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();

  protected readonly company = signal<any | null>(null);
  protected readonly employeeCount = signal(0);

  // Tabbed right column (matches person view): People is the default tab.
  protected readonly activeTab = signal<string>('people');
  protected readonly companyTabs = computed<PcTabOption[]>(() => [
    { id: 'people', label: 'People', badge: this.employeeCount() || undefined },
    { id: 'about', label: 'About' },
    // Activity is the record's history — last tab in every view.
    { id: 'activity', label: 'Activity' },
  ]);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Companies', route: '/companies' },
    { label: this.company()?.name || 'Company' },
  ]);

  private readonly usersResource = resource({
    loader: () => this.userService.getUsers(),
  });
  private readonly usersById = computed(() => new Map((this.usersResource.value() ?? []).map((x) => [x.id, x])));

  /** Up-to-two-letter initials for the header avatar (e.g. "HC" for Harborview Clinic). */
  protected readonly initials = computed(() => {
    const name = this.company()?.name || '';
    if (!name) return '?';
    return name
      .split(' ')
      .slice(0, 2)
      .map((w: string) => w[0] ?? '')
      .join('')
      .toUpperCase();
  });

  protected readonly enriching = signal(false);

  protected readonly isEnriched = computed(() => {
    const rawEnrichment = this.company()?.enrichment;
    if (!rawEnrichment) return false;

    let enrichment = null;

    try {
      enrichment = typeof rawEnrichment === 'string' ? JSON.parse(rawEnrichment) : rawEnrichment;
    } catch {
      return false;
    }
    return !!enrichment.google_enriched;
  });

  /** Header subtitle — industry · people count (§7). Parts drop out honestly when absent. */
  protected readonly subtitle = computed(() => {
    const parts: string[] = [];
    const industry = this.company()?.industry;
    if (industry) parts.push(industry);
    const n = this.employeeCount();
    parts.push(`${n} ${n === 1 ? 'person' : 'people'}`);
    return parts.join(' · ');
  });

  /** §7 header button label: "Re-check Google" once enriched, else "Enrich". */
  protected readonly enrichLabel = computed(() => (this.isEnriched() ? 'Re-check Google' : 'Enrich'));

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
      // 1. Load company details (triggers Google enrichment job on backend)
      const data = await this.companiesSvc.getById(id);
      if (!isCurrent()) return;
      this.company.set(data);
      // Spec §1: the address bar shows the record slug, never the internal id.
      // Cosmetic swap only — route param, record-nav pager and breadcrumbs keep the numeric id.
      if (typeof data?.slug === 'string' && data.slug.length > 0) {
        this.location.replaceState(`/companies/${data.slug}`);
      }

      // 2. Load employee count via dedicated count endpoint (no row data fetched)
      const count = await this.personsSvc.countByCompanyId(id);
      if (!isCurrent()) return;
      this.employeeCount.set(count);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the company. Please try again.'));
    } finally {
      end();
    }
  }

  /** Refresh the activity feed after a logged interaction. */
  protected onInteractionLogged(): void {
    this.activityFeed()?.loadActivities();
  }

  protected editCompany() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  /** §7 Enrich / Re-check Google — queues the Places lookup background job. */
  protected async enrichCompany() {
    const id = this.id();
    if (!id || this.enriching()) return;
    this.enriching.set(true);
    try {
      await this.companiesSvc.enrich(id, this.isEnriched());
      this.alertSvc.showSuccess('Enrichment queued. Fields fill in the background.');
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not queue enrichment. Please try again.'));
    } finally {
      this.enriching.set(false);
    }
  }

  protected async deleteCompany() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete company',
      message: 'Employees keep their person records. Only the employer grouping clears.',
      variant: 'danger',
      confirmText: 'Delete company',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.companiesSvc.delete(this.id());
      this.companiesSvc.triggerRefresh();
      this.alertSvc.showSuccess('Company deleted');
      await this.router.navigate(['/companies']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete company';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  protected copyToClipboard(text: string | null | undefined, label: string) {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.alertSvc.showSuccess(`${label} copied to clipboard`);
      })
      .catch(() => {
        this.alertSvc.showError(`Failed to copy ${label}`);
      });
  }

  protected getUserName(id: string | null | undefined): string {
    if (!id) return '?';
    return this.usersById().get(String(id))?.first_name ?? '?';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
