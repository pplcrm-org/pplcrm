import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailRow } from '@uxcommon/components/detail-row/detail-row';
import { Icon } from '@icons/icon';
import { ProfileCard } from '@uxcommon/components/profile-card/profile-card';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';

import {
  CHAMBER_LABELS,
  JURISDICTIONS,
  RECEIPT_REGIMES,
  isJurisdictionId,
  receiptRegimeHintForCampaign,
  regionsForCountry,
  seatLabelFor,
} from '../../../../../../../libs/common/src';
import type { CampaignReceiptRegimeHint, JurisdictionId } from '../../../../../../../libs/common/src';

import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { CampaignDetail, CampaignsService } from '../services/campaigns-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

/**
 * Campaigns §15 — campaign detail. Elections can be archived (read-only history)
 * and unarchived; the office context is permanent and shows neither action.
 */
@Component({
  selector: 'pc-campaign-view',
  imports: [DatePipe, RouterModule, RecordActivities, DetailLayout, ProfileCard, DetailRow, Icon],
  templateUrl: './campaign-view.html',
})
export class CampaignViewComponent {
  readonly id = input.required<string>();

  private readonly alerts = inject(AlertService);
  private readonly campaignsSvc = inject(CampaignsService);
  private readonly context = inject(CampaignContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly campaign = signal<Record<string, unknown> | null>(null);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Campaigns', route: '/workspace/campaigns' },
    { label: this.name() || 'Campaign' },
  ]);

  protected readonly name = computed(() => this.str('name'));
  protected readonly description = computed(() => this.str('description'));
  protected readonly notes = computed(() => this.str('notes'));
  protected readonly kind = computed(() => this.str('kind') || 'election');
  protected readonly status = computed(() => this.str('status') || 'active');
  protected readonly startdate = computed(() => this.str('startdate'));
  protected readonly enddate = computed(() => this.str('enddate'));
  protected readonly isOffice = computed(() => this.kind() === 'office');
  protected readonly isArchived = computed(() => this.status() === 'archived');
  protected readonly isCurrentContext = computed(() => this.context.activeCampaignId() === this.id());

  // ---------------------------------------------------------------------------------------------
  // The office this campaign contests. Everything below is read back in the jurisdiction's own
  // words, never in the stored identifiers: a campaign that recorded `ca_provincial` + `AB` reads
  // "Canada — provincial or territorial" and "Constituency", not "ca_provincial" and "seat_name".
  // ---------------------------------------------------------------------------------------------

  protected readonly jurisdiction = computed<JurisdictionId>(() => {
    const value = this.campaign()?.['jurisdiction'];
    return isJurisdictionId(value) ? value : 'other';
  });
  protected readonly spec = computed(() => JURISDICTIONS[this.jurisdiction()]);
  protected readonly officeRegion = computed(() => this.str('office_region') || null);
  protected readonly officeLocality = computed(() => this.str('office_locality'));
  protected readonly seatName = computed(() => this.str('seat_name'));
  protected readonly seatPosition = computed(() => this.str('seat_position'));
  protected readonly officeTitle = computed(() => this.str('office_title'));
  protected readonly isAtLarge = computed(() => this.str('seat_type') === 'at_large');

  /** "Alberta", "Ohio", or the stored code if this build does not know the name. */
  protected readonly regionName = computed(() => {
    const code = this.officeRegion();
    if (!code) return '';
    return regionsForCountry(this.spec().country).find((r) => r.code === code)?.name ?? code;
  });

  protected readonly chamberLabel = computed(() => {
    const chamber = this.str('chamber');
    if (chamber === 'upper' || chamber === 'lower') return CHAMBER_LABELS[chamber];
    return '';
  });

  /** This campaign's own word for a seat area: override, then regional exception, then default. */
  protected readonly seatWord = computed(() =>
    seatLabelFor(this.jurisdiction(), this.officeRegion(), this.str('seat_label_override') || null),
  );

  /** True once the campaign has said anything at all about the office it is contesting. */
  protected readonly hasOffice = computed(
    () => this.jurisdiction() !== 'other' || !!this.seatName() || !!this.officeTitle(),
  );

  /** Where the campaign runs, most specific first: "Toronto, Ontario". */
  protected readonly officePlace = computed(() =>
    [this.officeLocality(), this.regionName()].filter((part) => part.length > 0).join(', '),
  );

  /**
   * One plain sentence naming what is being contested. An at-large seat says so and names the area
   * it covers, because "at large" on its own tells a first-time reader nothing.
   */
  protected readonly officeSummary = computed(() => {
    const title = this.officeTitle();
    const seatWord = this.seatWord().toLowerCase();

    if (this.isAtLarge()) {
      const area = this.officeLocality() || this.regionName() || 'the whole area';
      const opening = title ? `${title}, elected at large across ${area}.` : `Elected at large across ${area}.`;
      return `${opening} There is no ${seatWord} for this seat.`;
    }

    const seat = this.seatName();
    if (!seat) {
      return title
        ? `${title}. The ${seatWord} it contests has not been recorded yet.`
        : `The ${seatWord} this campaign contests has not been recorded yet.`;
    }
    return title ? `${title} for the ${seatWord} of ${seat}.` : `Contesting the ${seatWord} of ${seat}.`;
  });

  /**
   * What the declared office can say about receipting. It is a hint shown beside a link to the
   * donation settings, and it never selects anything: which regime a workspace may issue under
   * depends on how the organization is registered, which the campaign record cannot know. For a US
   * campaign it explains that political contributions are not receipted at all.
   */
  protected readonly receiptHint = computed<CampaignReceiptRegimeHint | null>(() =>
    receiptRegimeHintForCampaign(this.jurisdiction(), this.officeRegion()),
  );

  /** The suggested regime's own display name, for the hint text. */
  protected readonly suggestedRegimeLabel = computed(() => {
    const hint = this.receiptHint();
    return hint?.kind === 'suggested' ? RECEIPT_REGIMES[hint.regime].label : '';
  });

  // Carry-over (§15): seed this campaign from a prior one.
  protected readonly carrySourceId = signal('');
  protected readonly carryCopySupport = signal(true);
  protected readonly carryCopySubscriptions = signal(false);
  protected readonly carryRunning = signal(false);
  protected readonly carrySources = computed(() => this.context.campaigns().filter((c) => c.id !== this.id()));

  constructor() {
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.load(currentId));
    });
  }

  protected editCampaign() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async workInThis(): Promise<void> {
    try {
      await this.context.setActive(this.id());
      this.alerts.showSuccess(`Now working in ${this.name()}`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not switch campaign. Please try again.'));
    }
  }

  protected onCarrySourceChange(event: Event): void {
    this.carrySourceId.set((event.target as HTMLSelectElement).value);
  }

  protected async runCarryOver(): Promise<void> {
    const sourceId = this.carrySourceId();
    if (!sourceId) return;
    if (this.carryCopySubscriptions()) {
      const confirmed = await this.dialogs.confirm({
        title: 'Copy email subscriptions?',
        message:
          'Consent collected by one campaign or the office does not automatically extend to another. Copying subscription lists across contexts is your compliance call. Confirm only if you are satisfied the consent carries over.',
        variant: 'danger',
        confirmText: 'I understand, copy subscriptions',
      });
      if (!confirmed) return;
    }
    this.carryRunning.set(true);
    try {
      const result = await this.campaignsSvc.carryOver({
        source_campaign_id: sourceId,
        target_campaign_id: this.id(),
        copy_support: this.carryCopySupport(),
        copy_subscriptions: this.carryCopySubscriptions(),
      });
      const r = result as { support_copied?: number; subscriptions_copied?: number };
      this.alerts.showSuccess(
        `Carried over ${r.support_copied ?? 0} support level(s) and ${r.subscriptions_copied ?? 0} subscription(s)`,
      );
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Carry-over failed. Please try again.'));
    } finally {
      this.carryRunning.set(false);
    }
  }

  protected async archive(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Archive campaign',
      message:
        'Archiving makes this campaign read-only: its supporter data, consent, and outreach history stay viewable, but nothing new can be recorded in it. Users assigned to this campaign move back to the office context. Open yard-sign requests in this campaign are declined and its delivery routes are canceled. You can unarchive it later.',
      confirmText: 'Archive',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.campaignsSvc.archive(this.id());
      await Promise.all([this.load(this.id()), this.context.refresh()]);
      this.alerts.showSuccess('Campaign archived');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to archive the campaign'));
    } finally {
      end();
    }
  }

  protected async unarchive(): Promise<void> {
    const end = this._loading.begin();
    try {
      await this.campaignsSvc.unarchive(this.id());
      await Promise.all([this.load(this.id()), this.context.refresh()]);
      this.alerts.showSuccess('Campaign unarchived');
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to unarchive the campaign'));
    } finally {
      end();
    }
  }

  private async load(id: string): Promise<void> {
    const isCurrent = this._requestGuard.begin();
    const end = this._loading.begin();
    try {
      const data: CampaignDetail = await this.campaignsSvc.getById(id);
      if (!isCurrent()) return;
      this.campaign.set((data ?? null) as Record<string, unknown> | null);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load the campaign. Please try again.'));
    } finally {
      end();
      this.initialized.set(true);
    }
  }

  private str(key: string): string {
    const value = this.campaign()?.[key];
    return typeof value === 'string' ? value : '';
  }
}
