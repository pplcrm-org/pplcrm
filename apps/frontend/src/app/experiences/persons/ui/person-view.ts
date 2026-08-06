import { DatePipe, Location } from '@angular/common';
import { Component, computed, effect, inject, input, resource, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import type { AddressType, Households } from '../../../../../../../libs/common/src/lib/kysely.models';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@uxcommon/components/icons/icon';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { LogInteraction } from '@experiences/activity/ui/log-interaction/log-interaction';
import { PeopleInHousehold } from './people-in-household';
import { UserService } from '../../../services/user.service';
import { HouseholdsService } from '../../households/services/households-service';
import { electoralAreaSuffix } from '../../households/services/household-areas';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { PersonsService } from '../services/persons-service';
import { VolunteerService } from '../../../services/api/volunteer-service';
import { DonationsService } from '../../../services/api/donations-service';
import { EventsService } from '../../../services/api/events-service';
import { ConnectionsService } from '../../../services/api/connections-service';
import { PersonCampaignFacts } from './person-campaign-facts';
import { PersonConnections } from './person-connections';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { Tabs as PcTabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailItem } from '@uxcommon/components/detail-item/detail-item';
import { SystemMetadata } from '@uxcommon/components/system-metadata/system-metadata';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { Tags } from '@experiences/tags/ui/tags';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

@Component({
  selector: 'pc-person-view',
  imports: [
    DatePipe,
    RouterModule,
    PeopleInHousehold,
    Icon,
    RecordActivities,
    LogInteraction,
    DetailLayout,
    PcCard,
    PcTabs,
    TabPanel,
    StatusBadge,
    DetailItem,
    SystemMetadata,
    Tags,
    PersonCampaignFacts,
    PersonConnections,
    ModalShell,
    EmptyState,
  ],
  templateUrl: './person-view.html',
})
export class PersonView {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('person', this.id);
  protected readonly activityFeed = viewChild(RecordActivities);

  private readonly alertSvc = inject(AlertService);
  private readonly userService = inject(UserService);
  private readonly householdsSvc = inject(HouseholdsService);
  /** Supplies the campaign's own word for the area shown after the address (Ward, Riding, …). */
  private readonly campaignContext = inject(CampaignContextService);
  private readonly personsSvc = inject(PersonsService);
  protected readonly donationsSvc = inject(DonationsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly volunteerSvc = inject(VolunteerService);
  private readonly eventsSvc = inject(EventsService);
  private readonly connectionsSvc = inject(ConnectionsService);

  protected readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;

  /**
   * True while the per-tab payloads (emails, donations, shifts, events, tags)
   * are in flight for the CURRENT person. The record itself paints as soon as
   * `getById` lands, so the tabs need their own signal: without it they would
   * claim "No donations yet" about a person whose donations are still loading.
   */
  protected readonly sectionsLoading = signal(false);

  protected readonly person = signal<any | null>(null);

  private readonly usersResource = resource({
    loader: () => this.userService.getUsers(),
  });
  private readonly usersById = computed(() => new Map((this.usersResource.value() ?? []).map((x) => [x.id, x])));

  // Analytics & Lists
  protected readonly volunteerHistory = signal<any[]>([]);
  protected readonly donationStats = signal<{
    cumulativeAmount: number;
    limitAmount: number;
    remainingAmount: number;
  } | null>(null);
  protected readonly donationHistory = signal<any[]>([]);
  protected readonly eventHistory = signal<any[]>([]);
  protected readonly connectionCount = signal(0);
  protected readonly activityData = signal<{ emails: any[]; newsletters: any[] }>({ emails: [], newsletters: [] });
  protected readonly tags = signal<string[]>([]);
  protected readonly issues = signal<string[]>([]);

  // True when the person has at least one active monthly pledge — powers the "Monthly donor" status chip.
  protected readonly hasActivePledge = signal(false);

  // Donations are truncated to the first 6 rows until the user expands (§3 "Show all N").
  protected readonly DONATION_PREVIEW_COUNT = 6;
  protected readonly showAllDonations = signal(false);
  protected readonly visibleDonations = computed(() =>
    this.showAllDonations() ? this.donationHistory() : this.donationHistory().slice(0, this.DONATION_PREVIEW_COUNT),
  );

  // Donation Dialog State
  protected readonly isCheckingEligibility = signal(false);
  protected readonly donationAmount = signal<number | null>(null);
  protected readonly showDonationModal = signal(false);
  protected readonly eligibilityError = signal<string | null>(null);

  // Address
  protected readonly householdId = computed(() => this.person()?.household_id ?? null);
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
    // Undefined while the household record is in flight — show blank, not a wrong claim.
    if (hh === undefined && this.householdResource.isLoading()) return '';
    if (!hh || hh.is_placeholder) return 'No Address Assigned';
    return this.getFormattedAddress(hh);
  });
  protected readonly isPlaceholderHousehold = computed(() => {
    return (this.householdResource.value() as Households | null | undefined)?.is_placeholder ?? false;
  });

  /**
   * Address plus the household's area on the active campaign's own boundary map, e.g.
   * "312 Alder Street … · Ward 3" for a municipal race and "… · Ottawa Centre" for a federal one.
   * The area is dropped when the address has not been placed on a map.
   */
  protected readonly addressDisplay = computed(() => {
    const base = this.addressString();
    if (base === 'No Address Assigned') return base;
    const area = electoralAreaSuffix(this.householdResource.value(), this.campaignContext.seatLabel());
    return area ? `${base} · ${area}` : base;
  });

  // Contact initials and full name computation
  protected readonly initials = computed(() => {
    const first = this.person()?.first_name || '';
    const last = this.person()?.last_name || '';
    if (!first && !last) return '?';
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  });

  protected readonly fullName = computed(() => {
    const p = this.person();
    if (!p) return '';
    return `${p.first_name || ''} ${p.middle_names || ''} ${p.last_name || ''}`.trim();
  });

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'People', route: '/people' },
    { label: this.fullName() || 'Person' },
  ]);

  // Status chip beside the name (§3), derived honestly: an active monthly pledge
  // outranks one-off gifts; "Donor" is DERIVED from donation history (§15), not a tag.
  protected readonly statusChip = computed<string | null>(() => {
    // The standing below is derived from data that lands after the record does
    // (pledges, donations, tags). Show nothing rather than a chip we'd have to
    // correct a moment later — a "Volunteer" that flips to "Monthly donor" reads
    // as a glitch.
    if (this.sectionsLoading()) return null;
    if (this.hasActivePledge()) return 'Monthly donor';
    if (this.donationHistory().length > 0) return 'Donor';
    // Volunteer/staff standing is first-class person status now (§15), not a tag.
    const volunteer = this.person()?.volunteer_status as string | null | undefined;
    if (volunteer) return volunteer === 'former' ? 'Former volunteer' : 'Volunteer';
    if (this.person()?.staff_status) return 'Staff';
    if (
      this.tags()
        .map((t) => t.toLowerCase())
        .includes('host')
    )
      return 'Host';
    return null;
  });

  // Human label for the person's preferred contact channel (§3 contact card row).
  protected readonly preferredContactLabel = computed<string | null>(() => {
    switch (this.person()?.preferred_contact) {
      case 'email':
        return 'Email';
      case 'mobile':
        return 'Mobile phone';
      case 'home_phone':
        return 'Home phone';
      default:
        return null;
    }
  });

  // Active tab state
  protected activeTab = signal<string>('household');

  // Seven tabs (§3): Newsletters fold into Emails; Household and Connections are distinct concepts, own tabs each.
  protected readonly personTabs = computed<PcTabOption[]>(() => [
    { id: 'household', label: 'Household' },
    { id: 'connections', label: 'Connections', badge: this.connectionCount() || undefined },
    { id: 'emails', label: 'Emails', badge: this.activityData()?.emails?.length || undefined },
    { id: 'donations', label: 'Donations', badge: this.donationHistory()?.length || undefined },
    { id: 'volunteer', label: 'Volunteer', badge: this.volunteerHistory()?.length || undefined },
    { id: 'events', label: 'Events', badge: this.eventHistory()?.length || undefined },
    // Activity is the record's history — last tab in every view.
    { id: 'activity', label: 'Activity' },
  ]);

  /** Payment method label for a donation row (§3): Card / Manual, with a `· monthly` suffix for pledge-linked rows. */
  protected donationMethod(donation: any): string {
    const base = donation?.stripe_session_id ? 'Card' : 'Manual';
    return donation?.pledge_id ? `${base} · monthly` : base;
  }

  /** Receipt status for a donation row — REAL receipt coverage from donation_receipts, not a
   * guess from the payment status (a succeeded gift with no issued receipt reads "No receipt"). */
  protected donationReceipt(donation: any): { label: string; type: 'success' | 'warning' | 'error' | 'neutral' } {
    const receiptStatus = String(donation?.receipt_status || '');
    if (receiptStatus === 'receipted') return { label: donation?.receipt_number || 'Receipted', type: 'success' };
    if (receiptStatus === 'cancelled') return { label: 'Receipt cancelled', type: 'warning' };
    const s = String(donation?.status || '').toLowerCase();
    if (s === 'refunded') return { label: 'Refunded', type: 'error' };
    if (s === 'disputed') return { label: 'Disputed', type: 'warning' };
    return { label: 'No receipt', type: 'neutral' };
  }

  protected getMailStatusType(status: string | null | undefined): any {
    const s = String(status || '').toLowerCase();
    if (s === 'sent' || s === 'delivered') return 'success';
    if (s === 'opened') return 'info';
    if (s === 'read') return 'neutral';
    return 'ghost';
  }

  protected getEmailEventType(eventType: string | null | undefined): any {
    const et = String(eventType || '').toLowerCase();
    if (et === 'open') return 'success';
    if (et === 'click') return 'warning';
    if (et === 'delivered' || et === 'processed') return 'info';
    if (['bounce', 'dropped', 'spamreport', 'unsubscribe'].includes(et)) return 'error';
    return 'ghost';
  }

  protected getShiftStatusType(status: string | null | undefined): any {
    const s = String(status || '').toLowerCase();
    if (s === 'attended') return 'success';
    if (s === 'signed_up') return 'warning';
    if (s === 'no_show') return 'error';
    return 'ghost';
  }

  protected getEventStatusType(status: string | null | undefined): any {
    const s = String(status || '').toLowerCase();
    if (s === 'attended') return 'success';
    if (s === 'registered') return 'warning';
    if (s === 'no_show') return 'error';
    if (s === 'cancelled') return 'neutral';
    return 'ghost';
  }

  constructor() {
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.loadAllData(currentId));
    });
  }

  /**
   * Spec §1: the address bar shows the record slug, never the internal id.
   * Cosmetic swap only (Location.replaceState) — the route param, record-nav
   * pager and breadcrumbs keep working on the numeric id.
   */
  private showSlugUrl(record: unknown): void {
    const slug =
      record != null && typeof record === 'object' && 'slug' in record ? (record as { slug: unknown }).slug : null;
    if (typeof slug === 'string' && slug.length > 0) {
      this.location.replaceState(`/people/${slug}`);
    }
  }

  protected async loadAllData(id: string) {
    const isCurrent = this._requestGuard.begin();
    const end = this._loading.begin();
    try {
      // 1. The record itself. The previous person stays on screen until this
      //    lands, so nothing below it may still be describing them once it does.
      const personData = await this.personsSvc.getById(id);
      if (!isCurrent()) return;
      this.resetSections();
      this.person.set(personData);
      this.showSlugUrl(personData);

      // 2. Everything the tabs need, in parallel. These used to be nine more
      //    serial round trips inside the same loading gate, which on a real
      //    network outlasted the gate's 300ms delay — so the page painted the
      //    new record and then blanked itself to a progress bar mid-navigation.
      await Promise.all([
        this.section(
          'tags',
          () => this.personsSvc.getTags(id, 'tag'),
          (v) => this.tags.set(v),
          isCurrent,
        ),
        this.section(
          'issues',
          () => this.personsSvc.getTags(id, 'issue'),
          (v) => this.issues.set(v),
          isCurrent,
        ),
        this.section(
          'volunteer details',
          () => this.volunteerSvc.getHistoryForPerson(id),
          (v) => this.volunteerHistory.set(v || []),
          isCurrent,
        ),
        this.section(
          'donation stats',
          () => this.donationsSvc.getStats(id),
          (v) => this.donationStats.set(v),
          isCurrent,
        ),
        this.section(
          'donation history',
          () => this.donationsSvc.getHistory(id),
          (v) => this.donationHistory.set(v || []),
          isCurrent,
        ),
        // Powers the "Monthly donor" chip.
        this.section(
          'pledges',
          () => this.donationsSvc.getPersonPledges(id),
          (v) => this.hasActivePledge.set((v || []).some((p: any) => String(p.status).toLowerCase() === 'active')),
          isCurrent,
        ),
        this.section(
          'event history',
          () => this.eventsSvc.getHistoryForPerson(id),
          (v) => this.eventHistory.set(v || []),
          isCurrent,
        ),
        // Connections: count only for the tab badge — the list loads inside the tab.
        this.section(
          'connection count',
          () => this.connectionsSvc.countForPerson(id),
          (v) => this.connectionCount.set(v),
          isCurrent,
        ),
        this.section(
          'activity log',
          () => this.personsSvc.getActivity(id),
          (v) => this.activityData.set(v || { emails: [], newsletters: [] }),
          isCurrent,
        ),
      ]);
      if (!isCurrent()) return;
      this.sectionsLoading.set(false);

      // Check query params for Stripe Checkout success redirects
      const params = this.route.snapshot.queryParams;
      if (params['checkout_success'] === 'true' && params['session_id']) {
        try {
          await this.donationsSvc.confirmDonation(params['session_id']);
          this.alertSvc.showSuccess('Donation processed successfully! Thank you for your support.');
          // Reload donation stats/history after confirmation
          const stats = await this.donationsSvc.getStats(id);
          this.donationStats.set(stats);
          const history = await this.donationsSvc.getHistory(id);
          this.donationHistory.set(history || []);
          void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        } catch (err) {
          console.error('Failed to confirm stripe checkout session:', err);
          this.alertSvc.showError('Finalizing payment verification...');
        }
      } else if (params['mock_donation_success'] === 'true' && params['session_id']) {
        try {
          const amt = Number(params['amount'] || 0);
          await this.donationsSvc.confirmMockDonation({
            personId: id,
            amountCents: amt * 100,
            sessionId: params['session_id'],
            province: params['province'] || '',
            country: params['country'] || '',
          });
          this.alertSvc.showSuccess('[MOCK] Donation recorded successfully!');
          const stats = await this.donationsSvc.getStats(id);
          this.donationStats.set(stats);
          const history = await this.donationsSvc.getHistory(id);
          this.donationHistory.set(history || []);
          void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        } catch (err) {
          console.error('Failed to record mock donation:', err);
        }
      }
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the person. Please try again.'));
    } finally {
      end();
    }
  }

  /**
   * One secondary fetch: applies its result only if this load is still the
   * current one, and never lets its own failure cancel a sibling's.
   */
  private async section<T>(
    label: string,
    fetch: () => Promise<T>,
    apply: (value: T) => void,
    isCurrent: () => boolean,
  ): Promise<void> {
    try {
      const value = await fetch();
      if (!isCurrent()) return;
      apply(value);
    } catch (err) {
      console.error(`Failed to load ${label}`, err);
    }
  }

  /**
   * Drop the previous record's per-tab data the moment a new record lands, so a
   * person is never shown above someone else's donations, shifts or emails.
   */
  private resetSections(): void {
    this.sectionsLoading.set(true);
    this.tags.set([]);
    this.issues.set([]);
    this.volunteerHistory.set([]);
    this.donationStats.set(null);
    this.donationHistory.set([]);
    this.hasActivePledge.set(false);
    this.showAllDonations.set(false);
    this.eventHistory.set([]);
    this.connectionCount.set(0);
    this.activityData.set({ emails: [], newsletters: [] });
  }

  /** Refresh the activity feed after a logged interaction. */
  protected onInteractionLogged(): void {
    this.activityFeed()?.loadActivities();
  }

  /** Number input mirror for the donation modal: empty/invalid input reads as null. */
  protected onDonationAmountInput(event: Event) {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.donationAmount.set(Number.isNaN(value) ? null : value);
  }

  protected openCollectDonation() {
    this.donationAmount.set(null);
    this.eligibilityError.set(null);
    this.showDonationModal.set(true);
  }

  protected closeDonationModal() {
    this.showDonationModal.set(false);
  }

  protected async submitDonation() {
    const amt = this.donationAmount();
    if (amt === null || amt <= 0) {
      this.alertSvc.showError('Please specify a valid donation amount.');
      return;
    }

    this.eligibilityError.set(null);

    // Donation eligibility and contribution limits are decided by where the donor lives, so an
    // assumed country/province would run those legal checks against an address the donor never
    // gave. Ask for the real one instead of inventing Canada/Ontario (REVIEW5 Tier 2 item 27).
    const hh = this.householdResource.value() as Households | null | undefined;
    const country = hh?.country?.trim() || null;
    const state = hh?.state?.trim() || null;
    if (!country || !state) {
      this.eligibilityError.set(
        "Add this donor's address first — the country and province or state decide whether they may give and how much.",
      );
      return;
    }
    const address = { country, state };

    this.isCheckingEligibility.set(true);

    try {
      const eligibility = await this.donationsSvc.checkEligibility({
        personId: this.id(),
        amountCents: amt * 100,
        address,
      });

      if (!eligibility.eligible) {
        this.eligibilityError.set(eligibility.reason || 'Donor is ineligible to donate.');
        this.isCheckingEligibility.set(false);
        return;
      }

      this.closeDonationModal();
      this.alertSvc.showSuccess('Redirecting to Stripe Checkout...');

      // Redirect
      const session = await this.donationsSvc.createCheckout({
        personId: this.id(),
        amountCents: amt * 100,
        address,
      });

      if (session && session.url) {
        window.location.href = session.url;
      } else {
        this.alertSvc.showError('Failed to initialize payment gateway.');
      }
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Verification check failed.');
    } finally {
      this.isCheckingEligibility.set(false);
    }
  }

  protected editPerson() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deletePerson() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Person',
      message: 'Are you sure you want to delete this person? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.personsSvc.delete(this.id());
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

  protected navigateToHousehold() {
    const household_id = this.householdId();
    if (household_id) {
      void this.router.navigate(['households', household_id]);
    }
  }

  /** Take the user to the People duplicates review UI (spec §5 / §9.3, Track D) to merge this
   * person into another. The pair-card comparison there is the one place merges are resolved,
   * so the safe "keep" choice always lives with the operator on that screen. */
  protected mergeIntoAnother(): void {
    void this.router.navigate(['/duplicates/people']);
  }

  /** Export the contact as a downloadable vCard (§3 overflow) — fully client-side. */
  protected exportVCard(): void {
    const p = this.person();
    if (!p) return;
    const esc = (v: unknown) => String(v ?? '').replace(/([,;\\])/g, '\\$1');
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${esc(p.last_name)};${esc(p.first_name)};${esc(p.middle_names)};;`,
      `FN:${esc(this.fullName())}`,
    ];
    if (p.company_name) lines.push(`ORG:${esc(p.company_name)}`);
    if (p.email) lines.push(`EMAIL;TYPE=INTERNET,PREF:${esc(p.email)}`);
    if (p.email2) lines.push(`EMAIL;TYPE=INTERNET:${esc(p.email2)}`);
    if (p.mobile) lines.push(`TEL;TYPE=CELL:${esc(p.mobile)}`);
    if (p.home_phone) lines.push(`TEL;TYPE=HOME:${esc(p.home_phone)}`);
    const addr = this.addressString();
    if (addr && addr !== 'No Address Assigned') lines.push(`ADR;TYPE=HOME:;;${esc(addr)};;;;`);
    lines.push('END:VCARD');

    const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.fullName() || 'contact'}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
    this.alertSvc.showSuccess(`Exported ${this.fullName()} as a vCard.`);
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
