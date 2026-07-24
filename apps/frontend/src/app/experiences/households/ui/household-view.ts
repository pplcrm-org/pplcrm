import { DatePipe, Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import type { IAuthUser } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { PcMap } from '@uxcommon/components/map/map';
import type { PcMapMarker } from '@uxcommon/components/map/map-types';
import { GeocodeChip } from '@uxcommon/components/geocode-chip/geocode-chip';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { LogInteraction } from '@experiences/activity/ui/log-interaction/log-interaction';
import { PeopleInHousehold } from '../../persons/ui/people-in-household';
import { UserService } from '../../../services/user.service';
import type { Selectable } from 'kysely';
import { HouseholdsService } from '../services/households-service';
import { Households } from '../../../../../../../libs/common/src/lib/kysely.models';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { YardSignStanding } from '../../deliveries/ui/yard-sign-standing';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { Tabs as PcTabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

type LastCanvass = { knocked_at: Date; canvasser_name: string | null; outcome: string } | null;

@Component({
  selector: 'pc-household-view',
  imports: [
    EmptyState,
    RouterModule,
    PeopleInHousehold,
    Icon,
    RecordActivities,
    LogInteraction,
    DetailLayout,
    PcCard,
    PcTabs,
    TabPanel,
    PcMap,
    GeocodeChip,
    DatePipe,
    YardSignStanding,
  ],
  templateUrl: './household-view.html',
})
export class HouseholdView {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('household', this.id);
  protected readonly activityFeed = viewChild(RecordActivities);

  private readonly alertSvc = inject(AlertService);
  private readonly userService = inject(UserService);
  private readonly householdsSvc = inject(HouseholdsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly dialogSvc = inject(ConfirmDialogService);
  protected readonly campaignContext = inject(CampaignContextService);
  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly household = signal<Selectable<Households> | null>(null);
  protected readonly users = signal<IAuthUser[]>([]);
  private usersById = new Map<string, IAuthUser>();

  protected readonly peopleCount = signal(0);
  protected readonly lastCanvass = signal<LastCanvass>(null);

  /** Real record id for child lookups — the route param may be a slug. */
  protected readonly householdRecordId = computed(() => {
    const h = this.household();
    return h && !h.is_placeholder ? String(h.id) : null;
  });

  // Tabbed right column (matches person view): Members is the default tab.
  protected readonly activeTab = signal<string>('members');
  protected readonly householdTabs = computed<PcTabOption[]>(() => [
    { id: 'members', label: 'Members', badge: this.peopleCount() || undefined },
    { id: 'activity', label: 'Activity' },
  ]);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Households', route: '/households' },
    { label: this.addressString() },
  ]);

  // Address
  protected readonly addressString = computed(() => {
    const raw = this.household();
    if (!raw) return 'No Address Assigned';
    if (raw.is_placeholder) return 'People with no addresses';
    if (raw.formatted_address) return raw.formatted_address;

    const parts: string[] = [];
    const streetParts = [raw.apt ? `Apt ${raw.apt}` : null, raw.street_num, raw.street1, raw.street2].filter(Boolean);

    const locationParts = [raw.city, raw.state, raw.zip, raw.country].filter(Boolean);

    if (streetParts.length) parts.push(streetParts.join(' ').trim());
    if (locationParts.length) parts.push(locationParts.join(', ').trim());

    return parts.join(', ').trim() || 'No Address Assigned';
  });

  /** Short "City, State" for the map address chip. */
  protected readonly cityLine = computed(() => {
    const h = this.household();
    if (!h) return '';
    return [h.city, h.state].filter(Boolean).join(', ');
  });

  protected readonly hasMap = computed(() => {
    const h = this.household();
    return !!(h && h.lat && h.lng && !h.is_placeholder);
  });

  /** One static, deep-linkable marker for the household's verified location (§6 map card). */
  protected readonly mapMarkers = computed<PcMapMarker[]>(() => {
    const h = this.household();
    if (!h || !h.lat || !h.lng || h.is_placeholder) return [];
    return [{ position: { lat: Number(h.lat), lng: Number(h.lng) }, tooltip: this.addressString() }];
  });

  /** Header subtitle — "Ward 4 · 3 people · Canvassed May 2" (§6). Parts drop out honestly when absent. */
  protected readonly subtitle = computed(() => {
    const h = this.household();
    if (!h || h.is_placeholder) return null;
    const parts: string[] = [];
    if (h.ward) parts.push(`Ward ${h.ward}`);
    const n = this.peopleCount();
    parts.push(`${n} ${n === 1 ? 'person' : 'people'}`);
    const canvass = this.lastCanvass();
    if (canvass) {
      parts.push(`Canvassed ${this.formatCanvassDate(canvass.knocked_at)}`);
    }
    return parts.join(' · ');
  });

  constructor() {
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.loadAllData(currentId));
    });

    // Load users for addedby/updatedby display names
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
      // 1. Load household details
      const householdData = (await this.householdsSvc.getById(id)) as Selectable<Households>;
      if (!isCurrent()) return; // superseded — do not land stale data
      this.household.set(householdData);
      // Spec §1: the address bar shows the record slug, never the internal id.
      // Cosmetic swap only — route param, record-nav pager and breadcrumbs keep the numeric id.
      if (typeof householdData?.slug === 'string' && householdData.slug.length > 0) {
        this.location.replaceState(`/households/${householdData.slug}`);
      }

      // 2. Load people count and last-canvass in parallel (both feed the header subtitle).
      const [count, canvass] = await Promise.all([
        this.householdsSvc.getPeopleCount(id),
        this.householdsSvc.getLastCanvass(id).catch(() => null),
      ]);
      if (!isCurrent()) return;
      this.peopleCount.set(count);
      this.lastCanvass.set((canvass as LastCanvass) ?? null);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the household. Please try again.'));
    } finally {
      end();
      this.initialized.set(true);
    }
  }

  /** Refresh the "Activity at this door" feed after a logged interaction. */
  protected onInteractionLogged(): void {
    this.activityFeed()?.loadActivities();
  }

  protected editHousehold() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deleteHousehold() {
    if (!this.id()) return;
    const end = this._loading.begin();
    try {
      // Fetch people belonging to this household
      const people = (await this.personsSvc.getByHouseholdId(this.id(), { columns: ['id'] })) as Array<{ id: string }>;
      const personIds = people.map((p) => p.id);
      const peopleCount = personIds.length;

      if (peopleCount > 0) {
        // Show the 3-option warning dialog
        const choice = await this.dialogSvc.choose<'delete-people' | 'keep-people'>({
          title: 'Households have people',
          message: `1 household(s) being deleted contain ${peopleCount} person(s).\nWhat would you like to do with those people?`,
          variant: 'warning',
          choices: [
            { label: 'Delete people too', value: 'delete-people', variant: 'danger' },
            { label: 'Keep people, just remove their address', value: 'keep-people', variant: 'warning' },
          ],
          cancelText: 'Cancel',
        });

        if (!choice) return; // Handled (user clicked Cancel, so do nothing)

        if (choice === 'keep-people') {
          for (const pid of personIds) {
            await this.personsSvc.removeHousehold(pid);
          }
        } else if (choice === 'delete-people') {
          await this.personsSvc.deleteMany(personIds);
        }
      } else {
        const confirmed = await this.dialogSvc.confirm({
          title: 'Delete Household',
          message: 'Are you sure you want to delete this household? This action cannot be undone.',
          variant: 'danger',
          confirmText: 'Delete',
        });
        if (!confirmed) return;
      }

      await this.householdsSvc.delete(this.id());
      this.householdsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Household deleted');
      await this.router.navigate(['/households']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete household';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  /** Compact "Canvassed May 2" style date for the header subtitle. */
  private formatCanvassDate(value: Date | string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  protected getUserName(id: string | null | undefined): string {
    if (!id) return '?';
    return this.usersById.get(String(id))?.first_name ?? '?';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
