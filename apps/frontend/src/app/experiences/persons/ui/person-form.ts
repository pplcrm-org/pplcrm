import { Component, ElementRef, OnInit, computed, inject, input, resource, signal, linkedSignal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { form, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterModule } from '@angular/router';
import { type IAuthUser, UpdatePersonsType, UpdatePersonsObj } from '../../../../../../../libs/common/src';
import type { SupportLevel, VotingStatus, VolunteerStatus, StaffStatus } from '../../../../../../../libs/common/src';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@uxcommon/components/icons/icon';
import { Tags } from '@experiences/tags/ui/tags';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { Select as PcSelect } from '@uxcommon/components/select/select';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { Card as PcCard } from '@uxcommon/components/card/card';

import { UserService } from '../../../services/user.service';
import { HouseholdsService } from '../../households/services/households-service';
import { PersonsService } from '../services/persons-service';
import { CompaniesService } from '../../companies/services/companies-service';
import { AddressType, Persons, Households } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { Selectable } from 'kysely';
import { VolunteerService } from '../../../services/api/volunteer-service';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { SideDrawer } from '@uxcommon/components/side-drawer/side-drawer';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { PersonCampaignFacts } from './person-campaign-facts';
import { PersonStandingDraft } from './person-standing-draft';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { CampaignsService } from '../../campaigns/services/campaigns-service';

@Component({
  selector: 'pc-person-form',
  imports: [
    PcInput,
    PcSelect,
    PcTextarea,
    Tags,
    RouterModule,
    Icon,
    PcDetailHeader,
    SideDrawer,
    PcCard,
    DatePipe,
    PersonCampaignFacts,
    PersonStandingDraft,
  ],
  templateUrl: './person-form.html',
})
export class PersonForm implements OnInit {
  private readonly alertSvc = inject(AlertService);
  private readonly userService = inject(UserService);
  private readonly confirmDlg = inject(ConfirmDialogService);
  private readonly householdsSvc = inject(HouseholdsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly companiesSvc = inject(CompaniesService);
  private readonly router = inject(Router);
  private readonly volunteerSvc = inject(VolunteerService);
  private readonly tagOptionsSvc = inject(TagOptionsService);
  private readonly campaignsSvc = inject(CampaignsService);
  private readonly campaignContext = inject(CampaignContextService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  private _loading = createLoadingGate();
  private usersById = new Map<string, IAuthUser>();

  protected readonly householdResource = resource({
    params: () => this.householdId(),
    loader: async ({ params: householdId }) => {
      if (!householdId) return null;
      try {
        return await this.householdsSvc.getById(householdId);
      } catch {
        return null;
      }
    },
  });

  protected readonly addressString = computed(() => {
    const hh = this.householdResource.value() as Households | null | undefined;
    if (!hh || hh.is_placeholder) return null;
    return this.getFormattedAddress(hh);
  });

  /** Overview rail (§6): everyone else sharing this person's household. */
  protected readonly householdMembersResource = resource({
    params: () => this.householdId(),
    loader: async ({ params: householdId }) => {
      if (!householdId) return null;
      try {
        return await this.householdsSvc.getPeopleCount(householdId);
      } catch {
        return null;
      }
    },
  });

  protected readonly companyName = computed(() => {
    const id = this.person()?.company_id;
    if (!id) return null;
    return this.companies().find((c) => c.id === id)?.name ?? null;
  });

  protected readonly preferredContactLabel = computed(() => {
    switch (this.person()?.preferred_contact) {
      case 'email':
        return 'Email';
      case 'mobile':
        return 'Mobile phone';
      case 'home_phone':
        return 'Home phone';
      default:
        return 'No preference';
    }
  });

  protected readonly isPlaceholderHousehold = computed(() => {
    return (this.householdResource.value() as Households | null | undefined)?.is_placeholder ?? false;
  });

  /** Address line with the household's ward appended when known (e.g. "312 Alder St … · Ward 3"). */
  protected readonly addressWithWard = computed(() => {
    const base = this.addressString();
    if (!base) return null;
    const ward = (this.householdResource.value() as Households | null | undefined)?.ward;
    return ward ? `${base} · Ward ${ward}` : base;
  });

  // Drawer state for assigning household
  protected readonly assignDrawerOpen = signal(false);
  protected readonly householdResults = signal<any[]>([]);
  protected readonly householdSearch = signal('');
  protected readonly householdsLoading = signal(false);

  protected readonly pendingHouseholdId = signal<string | null>(null);
  protected readonly isLoading = this._loading.visible;

  /** Disables Save immediately on click — the loading gate stays false for its first
   *  300ms by design, which would leave a double-click window. */
  protected readonly saving = signal(false);

  protected readonly emailError = linkedSignal({
    source: () => this.form.email().value(),
    computation: () => null as string | null,
  });
  protected readonly person = signal<Selectable<Persons> | null>(null);
  protected readonly users = signal<IAuthUser[]>([]);
  protected readonly companies = signal<any[]>([]);
  protected readonly volunteerStats = signal<{ shifts_count: number; total_hours: number } | null>(null);
  protected readonly volunteerHistory = signal<any[]>([]);

  protected readonly payload = signal({
    first_name: '',
    middle_names: '',
    last_name: '',
    email: '',
    email2: '',
    home_phone: '',
    mobile: '',
    notes: '',
    company_id: '',
    preferred_contact: '',
    linkedin: '',
    twitter: '',
    facebook: '',
    instagram: '',
    assigned_to: '',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, UpdatePersonsObj);
  });

  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  protected id = input<string>();
  protected tags = signal<string[]>([]);
  protected issues = signal<string[]>([]);

  // Campaign standing captured on the NEW-person form (§15). Support/voting/subscribe
  // are campaign-scoped and can only be written once the person has an id, so they are
  // applied after the add succeeds; do_not_contact is a plain person field folded into
  // the add payload. Bound two-way to <pc-person-standing-draft>.
  protected readonly draftSupport = signal<SupportLevel | ''>('');
  protected readonly draftVoting = signal<VotingStatus | ''>('');
  protected readonly draftSubscribe = signal(false);
  protected readonly draftDnc = signal(false);
  // Volunteer/staff are global person status (§15) — folded straight into the add payload.
  protected readonly draftVolunteer = signal<VolunteerStatus | ''>('');
  protected readonly draftStaff = signal<StaffStatus | ''>('');

  // All known tag/issue names for the dashed "Suggestions:" chips under each editor (§4).
  protected readonly allTagNames = signal<string[]>([]);
  protected readonly allIssueNames = signal<string[]>([]);
  private readonly SUGGESTION_LIMIT = 6;
  protected readonly tagSuggestions = computed(() => this.suggestFrom(this.allTagNames(), this.tags()));
  protected readonly issueSuggestions = computed(() => this.suggestFrom(this.allIssueNames(), this.issues()));

  private suggestFrom(all: string[], applied: string[]): string[] {
    const used = new Set(applied.map((t) => t.toLowerCase().trim()));
    return all.filter((name) => !used.has(name.toLowerCase().trim())).slice(0, this.SUGGESTION_LIMIT);
  }

  /** Add a tag from a suggestion chip — mirrors the typed-add path (updates the list + persists). */
  protected addTagSuggestion(name: string): void {
    if (this.tags().some((t) => t.toLowerCase().trim() === name.toLowerCase().trim())) return;
    this.tags.update((list) => [...list, name]);
    void this.tagAdded(name);
  }

  protected addIssueSuggestion(name: string): void {
    if (this.issues().some((t) => t.toLowerCase().trim() === name.toLowerCase().trim())) return;
    this.issues.update((list) => [...list, name]);
    void this.issueAdded(name);
  }

  public readonly householdId = computed(() => (this.person()?.household_id ?? null) || this.pendingHouseholdId());

  public mode = input<'new' | 'edit'>('edit');
  protected readonly isNewMode = computed(() => this.mode() === 'new' || !this.id());

  protected readonly formName = computed(() => {
    const v = this.payload();
    return `${v.first_name || ''} ${v.middle_names || ''} ${v.last_name || ''}`.trim();
  });

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    const people: PcBreadcrumb = { label: 'People', route: '/people' };
    const id = this.person()?.id;
    if (id) {
      return [people, { label: this.formName() || 'Person', route: ['/people', String(id)] }, { label: 'Edit' }];
    }
    return [people, { label: 'New person' }];
  });

  protected readonly formInitials = computed(() => {
    const name = this.formName() || '?';
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase();
  });

  protected readonly buttonsToShow = computed<'two' | 'three'>(() => (this.person()?.id ? 'two' : 'three'));

  constructor() {
    // Load users once for display names
    this.userService
      .getUsers()
      .then((u) => {
        this.users.set(u);
        this.usersById = new Map(u.map((x) => [x.id, x]));
      })
      .catch(() => void 0);
  }

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    await this.loadPerson();
    await this.loadCompanies();
    void this.loadSuggestionNames();
    if (this.isNewMode()) {
      const state = window.history.state;
      if (state && state.cloneData) {
        const data = state.cloneData;
        this.payload.set({
          first_name: data.first_name ?? '',
          middle_names: data.middle_names ?? '',
          last_name: data.last_name ? `${data.last_name} (Copy)` : '',
          email: data.email ?? '',
          email2: data.email2 ?? '',
          home_phone: data.home_phone ?? '',
          mobile: data.mobile ?? '',
          notes: data.notes ?? '',
          company_id: data.company_id ?? '',
          preferred_contact: data.preferred_contact ?? '',
          linkedin: data.linkedin ?? '',
          twitter: data.twitter ?? '',
          facebook: data.facebook ?? '',
          instagram: data.instagram ?? '',
          assigned_to: data.assigned_to ? String(data.assigned_to) : '',
        });
        if (data.household_id) {
          this.pendingHouseholdId.set(data.household_id);
        }
      }
    }
  }

  private async loadSuggestionNames() {
    try {
      this.allTagNames.set(await this.tagOptionsSvc.getTagNames('tag'));
      this.allIssueNames.set(await this.tagOptionsSvc.getTagNames('issue'));
    } catch (err) {
      console.error('Failed to load tag/issue suggestions', err);
    }
  }

  private async loadCompanies() {
    try {
      const res = await this.companiesSvc.getAll();
      this.companies.set(res.rows || []);
    } catch {
      this.companies.set([]);
    }
  }

  protected async deletePerson() {
    const id = this.id();
    if (!id) return;
    const confirmed = await this.confirmDlg.confirm({
      title: 'Delete Person',
      message: 'Are you sure you want to delete this person? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.personsSvc.delete(id);
      this.personsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Person deleted');
      await this.router.navigate(['/people']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete person';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  public canDeactivate(): Promise<boolean> {
    return this.unsavedChanges.confirmDiscardIfDirty(this.formName() || 'this person');
  }

  public save(done?: () => void) {
    if (this.saving()) return;
    this.form().markAsTouched();
    if (this.form().invalid()) {
      // §4: Save never disables — instead of blocking, surface the errors and
      // move focus to the first invalid field so the user knows what to fix.
      queueMicrotask(() => {
        const el = this.host.nativeElement.querySelector<HTMLElement>('.input-error input, [aria-invalid="true"]');
        el?.focus();
      });
      return;
    }
    const raw = this.payload();
    const data = {
      ...raw,
      company_id: raw.company_id || null,
      assigned_to: raw.assigned_to || null,
      preferred_contact: raw.preferred_contact || null,
    } as UpdatePersonsType;
    return this.id() ? this.update(data, done) : this.add(data, done);
  }

  protected async applyEdit(input: { key: string; value: string; changed: boolean }) {
    if (input.changed) {
      const row = { [input.key]: input.value };
      this.update(row);
    }
  }

  protected async assignToHousehold(household_id: string) {
    const id = this.id();
    // NEW PERSON: just store the pending selection; it will be sent on save
    if (!id) {
      this.pendingHouseholdId.set(household_id);
      this.alertSvc.showSuccess('Household selected. It will be saved when you add the person');
      this.closeAssignDrawer();
      return;
    }

    // Ask scope: just this person vs everyone in current household
    const applyToAll = await this.confirmDlg.confirm({
      title: 'Change household',
      message: 'Apply to everyone in the current household, or just this person?',
      variant: 'info',
      confirmText: 'Everyone',
      cancelText: 'Just this person',
    });

    const currentHousehold = this.householdId();

    const end = this._loading.begin();
    try {
      if (applyToAll && currentHousehold) {
        // Single atomic tRPC call to the backend
        await this.personsSvc.moveEntireHousehold(currentHousehold, household_id);
      } else {
        // Only move this person
        await this.personsSvc.update(id, { household_id } as UpdatePersonsType);
      }

      // update local state for current person and UI
      this.person.update((p) => (p ? { ...p, household_id } : p));

      this.alertSvc.showSuccess('Assigned to selected household');
      this.closeAssignDrawer();
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not assign the household. Please try again.'));
    } finally {
      end();
    }
  }

  protected closeAssignDrawer() {
    this.assignDrawerOpen.set(false);
  }

  protected formatHouseholdRow(row: any) {
    const address = {
      apt: row.apt ?? null,
      street_num: row.street_num ?? '',
      street1: row.street1 ?? '',
      street2: row.street2 ?? '',
      city: row.city ?? '',
      state: row.state ?? '',
      zip: row.zip ?? '',
      country: row.country ?? '',
    } as AddressType;
    return this.getFormattedAddress(address);
  }

  protected getId() {
    const id = this.person()?.id;
    if (!id) return null;

    return id as unknown as string;
  }

  protected getUserName(id: string | null | undefined = null): string {
    if (!id) return '?';
    return this.usersById.get(String(id))?.first_name ?? '?';
  }

  protected navigateToHousehold() {
    const household_id = this.householdId();
    if (household_id) {
      void this.router.navigate(['households', household_id]);
    }
  }

  protected onHouseholdSearch(ev: Event) {
    const target = ev.target as HTMLInputElement | null;
    const val = target?.value ?? '';
    this.householdSearch.set(val);
    void this.fetchHouseholds();
  }

  protected openAssignDrawer() {
    this.assignDrawerOpen.set(true);
    // Initial fetch
    void this.fetchHouseholds();
  }

  protected async removeAddress() {
    const id = this.id();
    // New person: just clear the pending household — no API call needed yet
    if (!id) {
      this.pendingHouseholdId.set(null);
      return;
    }

    if (!this.person()) return;

    const confirmed = await this.confirmDlg.confirm({
      title: 'Remove Address',
      message: 'This will move the person to a new blank household (clearing address). Continue?',
      variant: 'danger',
      confirmText: 'Remove',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    const end = this._loading.begin();
    try {
      await this.personsSvc.removeHousehold(id);
      this.person.update((p) => (p ? { ...p, household_id: null } : p));
      this.alertSvc.showInfo('The person has been removed from the household. You may select a different household');
    } catch (err) {
      this.alertSvc.showError(
        getUserErrorMessage(err, 'Could not remove the person from the household. Please try again.'),
      );
    } finally {
      end();
    }
  }

  protected async tagAdded(tag: string) {
    const id = this.id();
    if (!id) return;
    try {
      await this.personsSvc.attachTag(id, tag, 'tag');
      await this.tagOptionsSvc.invalidate('tag');
    } catch (err) {
      console.error('Failed to attach tag:', err);
    }
  }

  protected async tagRemoved(tag: string) {
    const id = this.id();
    if (!id) return;

    const restoreTag = () => this.tags.update((curr) => (curr.includes(tag) ? curr : [...curr, tag]));

    try {
      // Volunteer/staff are first-class person status now (§15), no longer tags —
      // tag removal is the plain path with no team cascade.
      await this.personsSvc.detachTag(id, tag, 'tag');
      await this.updateTags();
      await this.tagOptionsSvc.invalidate('tag');
    } catch (err) {
      console.error('Failed to detach tag:', err);
      restoreTag();
    }
  }

  protected async issueAdded(issue: string) {
    const id = this.id();
    if (!id) return;
    try {
      await this.personsSvc.attachTag(id, issue, 'issue');
      await this.tagOptionsSvc.invalidate('issue');
    } catch (err) {
      console.error('Failed to attach issue:', err);
    }
  }

  protected async issueRemoved(issue: string) {
    const id = this.id();
    if (!id) return;

    const restoreIssue = () => this.issues.update((curr) => (curr.includes(issue) ? curr : [...curr, issue]));

    try {
      await this.personsSvc.detachTag(id, issue, 'issue');
      await this.updateTags();
      await this.tagOptionsSvc.invalidate('issue');
    } catch (err) {
      console.error('Failed to detach issue:', err);
      restoreIssue();
    }
  }

  private add(data: UpdatePersonsType, done?: () => void) {
    // Include any household selected via the drawer before saving
    const pendingHousehold = this.pendingHouseholdId();
    if (pendingHousehold) {
      data = { ...data, household_id: pendingHousehold } as UpdatePersonsType;
    }

    // do_not_contact is a plain person field — save it with the person.
    if (this.draftDnc()) {
      data = { ...data, do_not_contact: true } as UpdatePersonsType;
    }

    // Volunteer/staff are global person status (§15) — fold non-empty values in.
    if (this.draftVolunteer()) {
      data = { ...data, volunteer_status: this.draftVolunteer() } as UpdatePersonsType;
    }
    if (this.draftStaff()) {
      data = { ...data, staff_status: this.draftStaff() } as UpdatePersonsType;
    }

    // Snapshot the campaign-scoped standing NOW, before the success handler resets
    // the draft signals — it is applied after the person id exists.
    const standing = {
      support: this.draftSupport(),
      voting: this.draftVoting(),
      subscribe: this.draftSubscribe(),
      email: this.payload().email,
    };

    this.emailError.set(null);
    this.saving.set(true);
    const end = this._loading.begin();
    this.personsSvc
      .add(data, { context: { skipErrorHandler: true } })
      .then((created: unknown) => {
        this.alertSvc.showSuccess(`Added ${this.formName() || 'person'}.`);
        this.personsSvc.triggerRefresh();
        void this.applyStanding(created, standing);
        if (done) {
          done();
          this.pendingHouseholdId.set(null);
          this.tags.set([]);
          this.issues.set([]);
          this.draftSupport.set('');
          this.draftVoting.set('');
          this.draftSubscribe.set(false);
          this.draftDnc.set(false);
          this.draftVolunteer.set('');
          this.draftStaff.set('');
          this.form().reset();
        }
      })
      .catch((err: unknown) => {
        if (this.isDuplicateEmailError(err)) {
          this.emailError.set('This email address is already used by another person.');
        } else {
          this.alertSvc.showError(getUserErrorMessage(err, 'Could not save the person. Please try again.'));
        }
      })
      .finally(() => {
        end();
        this.saving.set(false);
      });
  }

  /**
   * Apply the standing captured on the add form once the person exists (§15).
   * Campaign-scoped writes are keyed to the active context; a failure here does
   * not undo the person — it was already saved — so we surface a soft error.
   */
  private async applyStanding(
    created: unknown,
    standing: { support: SupportLevel | ''; voting: VotingStatus | ''; subscribe: boolean; email: string },
  ): Promise<void> {
    const personId = isRecord(created) && created['id'] != null ? String(created['id']) : null;
    if (!personId) return;

    const wantsFact = !!standing.support || !!standing.voting;
    const wantsSubscription = standing.subscribe && !!standing.email.trim();
    if (!wantsFact && !wantsSubscription) return;

    try {
      await this.campaignContext.ensureLoaded();
      const campaign_id = this.campaignContext.activeCampaignId();
      if (!campaign_id) return;

      if (wantsFact) {
        await this.campaignsSvc.upsertPersonFact({
          campaign_id,
          person_id: personId,
          ...(standing.support ? { support_level: standing.support } : {}),
          ...(standing.voting ? { voting_status: standing.voting } : {}),
        });
      }
      if (wantsSubscription) {
        await this.campaignsSvc.setSubscription({ campaign_id, person_id: personId, status: 'subscribed' });
      }
    } catch (err) {
      this.alertSvc.showError(
        getUserErrorMessage(err, 'The person was added, but their campaign standing could not be saved.'),
      );
    }
  }

  private isDuplicateEmailError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as Record<string, any>;
    // tRPC wraps backend errors; check both data.httpStatus and message
    return (
      e['data']?.['httpStatus'] === 409 ||
      String(e['message'] ?? '')
        .toLowerCase()
        .includes('already exists')
    );
  }

  private async fetchHouseholds() {
    try {
      this.householdsLoading.set(true);
      const opts = {
        searchStr: this.householdSearch(),
        limit: 25,
        columns: ['id', 'street_num', 'street1', 'street2', 'apt', 'city', 'state', 'zip', 'country', 'persons_count'],
      };
      const res = await this.householdsSvc.getAll(opts);
      this.householdResults.set(res.rows || []);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load households. Please try again.'));
      this.householdResults.set([]);
    } finally {
      this.householdsLoading.set(false);
    }
  }

  private getFormattedAddress(address: AddressType): string {
    const parts: string[] = [];

    const streetParts = [
      address.apt ? `Apt ${address.apt}` : null,
      address.street_num,
      address.street1,
      address.street2,
    ].filter(Boolean);

    const locationParts = [address.city, address.state, address.zip, address.country].filter(Boolean);

    if (streetParts.length) parts.push(streetParts.join(' ').trim());
    if (locationParts.length) parts.push(locationParts.join(', ').trim());

    const formatted = parts.join(', ').trim();
    return formatted || 'No Address Assigned';
  }

  private async loadPerson() {
    const id = this.id();
    if (!id) return;

    const end = this._loading.begin();
    try {
      this.person.set((await this.personsSvc.getById(id)) as Selectable<Persons>);

      await this.updateTags();
      await this.loadVolunteerInfo();

      this.refreshForm();
    } finally {
      end();
    }
  }

  private refreshForm() {
    const person = this.person();
    if (!person) return;

    this.payload.set({
      first_name: person.first_name ?? '',
      middle_names: person.middle_names ?? '',
      last_name: person.last_name ?? '',
      email: person.email ?? '',
      email2: person.email2 ?? '',
      home_phone: person.home_phone ?? '',
      mobile: person.mobile ?? '',
      notes: person.notes ?? '',
      company_id: person.company_id ?? '',
      preferred_contact: person.preferred_contact ?? '',
      linkedin: person.linkedin ?? '',
      twitter: person.twitter ?? '',
      facebook: person.facebook ?? '',
      instagram: person.instagram ?? '',
      assigned_to: person.assigned_to ? String(person.assigned_to) : '',
    });
  }

  // Friendly labels for the field-naming save toast (§4).
  private readonly fieldLabels: Record<string, string> = {
    first_name: 'first name',
    middle_names: 'middle name',
    last_name: 'last name',
    email: 'email',
    email2: 'secondary email',
    mobile: 'mobile phone',
    home_phone: 'home phone',
    company_id: 'company',
    preferred_contact: 'preferred contact',
    assigned_to: 'owner',
    notes: 'notes',
    linkedin: 'LinkedIn',
    twitter: 'X',
    facebook: 'Facebook',
    instagram: 'Instagram',
  };

  private changedFieldLabels(): string[] {
    const f = this.form as unknown as Record<string, () => { dirty?: () => boolean }>;
    return Object.keys(this.fieldLabels)
      .filter((k) => {
        try {
          return !!f[k]?.().dirty?.();
        } catch {
          return false;
        }
      })
      .map((k) => this.fieldLabels[k]!);
  }

  private joinWithAnd(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  private update(data: Partial<UpdatePersonsType>, done?: () => void) {
    const id = this.id();
    if (!id) return;

    const changed = this.changedFieldLabels();
    const savedName = this.formName() || 'person';

    this.emailError.set(null);
    this.saving.set(true);
    const end = this._loading.begin();
    this.personsSvc
      .update(id, data, { context: { skipErrorHandler: true } })
      .then(() => {
        // Name the fields that changed (§4), e.g. "Saved Amira Hassan — email and mobile phone updated".
        const detail = changed.length ? `: ${this.joinWithAnd(changed)} updated` : '';
        this.alertSvc.showSuccess(`Saved ${savedName}${detail}.`);
        this.form().reset();
        this.personsSvc.triggerRefresh();
        if (done) {
          done();
        }
      })
      .catch((err: unknown) => {
        if (this.isDuplicateEmailError(err)) {
          this.emailError.set('This email address is already used by another person.');
        } else {
          this.alertSvc.showError(getUserErrorMessage(err, 'Could not save the person. Please try again.'));
        }
      })
      .finally(() => {
        end();
        this.saving.set(false);
      });
  }

  private async updateTags() {
    if (!this.person()) return;

    const id = this.id();
    const tags = id ? await this.personsSvc.getTags(id, 'tag') : [];
    this.tags.set(tags);

    const issues = id ? await this.personsSvc.getTags(id, 'issue') : [];
    this.issues.set(issues);
  }

  private async loadVolunteerInfo() {
    const id = this.id();
    if (!id) return;
    try {
      const stats = await this.volunteerSvc.getVolunteerStats(id);
      this.volunteerStats.set(stats);
      const history = await this.volunteerSvc.getHistoryForPerson(id);
      this.volunteerHistory.set(history || []);
    } catch (err) {
      console.error('Failed to load volunteer info', err);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
