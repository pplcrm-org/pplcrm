import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { createLoadingGate } from '@uxcommon/loading-gate';
import {
  ORG_MODE_IS_ELECTORAL,
  SUPPORT_LEVELS,
  SUPPORT_LEVEL_LABELS,
  VOTING_STATUSES,
  VOTING_STATUS_LABELS,
  VOLUNTEER_STATUSES,
  VOLUNTEER_STATUS_LABELS,
  STAFF_STATUSES,
  STAFF_STATUS_LABELS,
} from '../../../../../../../libs/common/src';
import type { SupportLevel, VotingStatus, VolunteerStatus, StaffStatus } from '../../../../../../../libs/common/src';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { OrgModeService } from '../../../services/org-mode.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { YardSignStanding } from '../../deliveries/ui/yard-sign-standing';
import {
  CampaignsService,
  PersonCampaignFact,
  PersonSubscriptionsPayload,
} from '../../campaigns/services/campaigns-service';
import { PersonsService } from '../services/persons-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

/**
 * Standing card (Campaigns §15): this person's support level and voting status in the ACTIVE
 * context, their history across every campaign, their volunteer/staff standing, email consent,
 * and the global do-not-contact override. Unknown = no stored value, on purpose.
 *
 * Half of it is electoral and half of it is universal, which is why the card gates BLOCKS rather
 * than gating itself. A church and a charity have no support level and no voting status — but
 * they very much have volunteers, and email consent is the most load-bearing control on the page.
 * Hiding the whole card for them would take the unsubscribe button with it.
 */
@Component({
  selector: 'pc-person-campaign-facts',
  imports: [DatePipe, Icon, PcCard, YardSignStanding],
  templateUrl: './person-campaign-facts.html',
})
export class PersonCampaignFacts {
  readonly personId = input.required<string>();
  readonly dncFlag = input<boolean>(false);
  /** Seed values for the global volunteer/staff status selects (§15). */
  readonly volunteerStatus = input<string | null>(null);
  readonly staffStatus = input<string | null>(null);
  /** The person's household (null = no address) — drives the yard-sign standing control. */
  readonly householdId = input<string | null>(null);

  protected readonly context = inject(CampaignContextService);
  private readonly orgMode = inject(OrgModeService);

  /**
   * Support level, voting status and the cross-campaign history only mean something to an
   * organization that runs elections. Keyed on the org TYPE rather than a module toggle: whether
   * you canvass for votes is not a preference you flip.
   */
  protected readonly isElectoral = computed<boolean>(() => ORG_MODE_IS_ELECTORAL[this.orgMode.mode()]);

  /**
   * Yard signs are the Deliveries feature surfaced on a person, so they follow that module rather
   * than the org type — a congregation that turns Drop-offs on to run meal boxes gets the control
   * back, which is the whole point of modes setting defaults instead of hard limits.
   */
  protected readonly showYardSign = computed<boolean>(() => this.orgMode.isEnabled('deliveries'));
  private readonly campaignsSvc = inject(CampaignsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);

  protected readonly supportLevels = SUPPORT_LEVELS;
  protected readonly supportLabels = SUPPORT_LEVEL_LABELS;
  protected readonly votingStatuses = VOTING_STATUSES;
  protected readonly votingLabels = VOTING_STATUS_LABELS;
  protected readonly volunteerStatuses = VOLUNTEER_STATUSES;
  protected readonly volunteerLabels = VOLUNTEER_STATUS_LABELS;
  protected readonly staffStatuses = STAFF_STATUSES;
  protected readonly staffLabels = STAFF_STATUS_LABELS;

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly saving = signal(false);
  protected readonly facts = signal<PersonCampaignFact[]>([]);
  protected readonly doNotContact = signal(false);
  /** Global volunteer/staff standing ('' = not one). Seeded from the person row. */
  protected readonly volunteerSel = signal<string>('');
  protected readonly staffSel = signal<string>('');
  protected readonly consent = signal<PersonSubscriptionsPayload | null>(null);

  protected readonly activeCampaign = this.context.activeCampaign;
  protected readonly readonlyContext = this.context.isArchivedContext;

  /** The fact row for the active context (undefined = everything Unknown). */
  protected readonly activeFact = computed(() => {
    const id = this.context.activeCampaignId();
    return id ? this.facts().find((f) => String(f.campaign_id) === id) : undefined;
  });

  /** History rows for campaigns other than the active one. */
  protected readonly otherFacts = computed(() => {
    const id = this.context.activeCampaignId();
    return this.facts().filter((f) => String(f.campaign_id) !== id);
  });

  /** Subscription row for the active context (undefined = never asked). */
  protected readonly activeSubscription = computed(() => {
    const id = this.context.activeCampaignId();
    return id ? this.consent()?.subscriptions.find((s) => String(s.campaign_id) === id) : undefined;
  });

  protected readonly hasEmail = computed(() => !!this.consent()?.email);
  protected readonly suppressed = computed(() => (this.consent()?.suppressions.length ?? 0) > 0);

  /**
   * One honest, derived sendability state for the active context (§15):
   * subscribed in this campaign ∧ address healthy ∧ not DNC(email).
   */
  protected readonly sendState = computed<{ label: string; tone: 'ok' | 'warn' | 'muted' }>(() => {
    if (!this.hasEmail()) return { label: 'No email address', tone: 'muted' };
    if (this.doNotContact()) return { label: 'Do not contact', tone: 'warn' };
    const sub = this.activeSubscription();
    if (!sub) return { label: 'Never asked', tone: 'muted' };
    if (sub.status === 'pending') return { label: 'Awaiting opt-in confirmation', tone: 'muted' };
    if (sub.status === 'unsubscribed') return { label: 'Unsubscribed', tone: 'warn' };
    if (this.suppressed()) return { label: 'Subscribed, address bouncing', tone: 'warn' };
    return { label: 'Subscribed', tone: 'ok' };
  });

  constructor() {
    effect(() => {
      const personId = this.personId();
      void untracked(() => this.load(personId));
    });
    effect(() => {
      this.doNotContact.set(this.dncFlag());
    });
    effect(() => {
      this.volunteerSel.set(this.volunteerStatus() ?? '');
    });
    effect(() => {
      this.staffSel.set(this.staffStatus() ?? '');
    });
  }

  protected supportBadgeClass(level: string | null): string {
    switch (level) {
      case 'strong':
        return 'badge-success';
      case 'leaning':
        return 'badge-info';
      case 'leaning_against':
        return 'badge-warning';
      case 'against':
        return 'badge-error';
      case 'neutral':
      case 'undecided':
        return 'badge-neutral';
      default:
        return 'badge-ghost';
    }
  }

  protected supportLabel(level: string | null): string {
    return level ? (this.supportLabels[level as SupportLevel] ?? level) : 'Unknown';
  }

  protected votingLabel(status: string | null): string {
    return status ? (this.votingLabels[status as VotingStatus] ?? status) : 'Unknown';
  }

  protected async onSupportChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    await this.saveFact({ support_level: value === '' ? null : (value as SupportLevel) });
  }

  protected async onVotingChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    await this.saveFact({ voting_status: value === '' ? null : (value as VotingStatus) });
  }

  protected async setSubscription(status: 'subscribed' | 'unsubscribed'): Promise<void> {
    const campaignId = this.context.activeCampaignId();
    if (!campaignId) return;
    this.saving.set(true);
    try {
      await this.campaignsSvc.setSubscription({ campaign_id: campaignId, person_id: this.personId(), status });
      await this.load(this.personId());
      this.alerts.showSuccess(status === 'subscribed' ? 'Subscribed' : 'Unsubscribed');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not update the subscription'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleDnc(): Promise<void> {
    const next = !this.doNotContact();
    if (next) {
      const confirmed = await this.dialogs.confirm({
        title: 'Mark as do-not-contact',
        message:
          'This stops all outreach to this person (email, calls, and door knocks) in the office and every campaign. It is a global override, not a per-campaign preference.',
        variant: 'danger',
        confirmText: 'Stop all contact',
      });
      if (!confirmed) return;
    }
    this.saving.set(true);
    try {
      await this.personsSvc.update(this.personId(), { do_not_contact: next });
      this.doNotContact.set(next);
      this.alerts.showSuccess(next ? 'Marked as do-not-contact' : 'Do-not-contact removed');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not update do-not-contact'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async onVolunteerStatusChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    const next = value === '' ? null : (value as VolunteerStatus);
    await this.saveGlobalStatus({ volunteer_status: next }, this.volunteerSel, value, 'volunteer status');
  }

  protected async onStaffStatusChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value;
    const next = value === '' ? null : (value as StaffStatus);
    await this.saveGlobalStatus({ staff_status: next }, this.staffSel, value, 'staff status');
  }

  /**
   * Persist a global person status (volunteer/staff, §15). Optimistically stores
   * the new value on success; reverts on error by re-reading nothing (the select
   * is re-bound to the signal, so we just leave the prior value on failure).
   */
  private async saveGlobalStatus(
    change: { volunteer_status?: VolunteerStatus | null; staff_status?: StaffStatus | null },
    target: { set(v: string): void },
    value: string,
    label: string,
  ): Promise<void> {
    this.saving.set(true);
    try {
      await this.personsSvc.update(this.personId(), change);
      target.set(value);
      this.alerts.showSuccess('Saved');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, `Could not update ${label}`));
    } finally {
      this.saving.set(false);
    }
  }

  private async saveFact(change: {
    support_level?: SupportLevel | null;
    voting_status?: VotingStatus | null;
  }): Promise<void> {
    const campaignId = this.context.activeCampaignId();
    if (!campaignId) return;
    this.saving.set(true);
    try {
      await this.campaignsSvc.upsertPersonFact({
        campaign_id: campaignId,
        person_id: this.personId(),
        ...change,
      });
      await this.load(this.personId());
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not save. Please try again.'));
      await this.load(this.personId());
    } finally {
      this.saving.set(false);
    }
  }

  private async load(personId: string): Promise<void> {
    const end = this._loading.begin();
    try {
      const [facts, consent] = await Promise.all([
        this.campaignsSvc.getPersonFacts(personId),
        this.campaignsSvc.getPersonSubscriptions(personId),
        this.context.ensureLoaded(),
      ]);
      this.facts.set(facts);
      this.consent.set(consent);
      this.doNotContact.set(!!consent.do_not_contact);
    } catch {
      // The card degrades to "Unknown" rather than blocking the person page.
    } finally {
      end();
    }
  }
}
