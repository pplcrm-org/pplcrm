import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { DELIVERY_REQUEST_STATUSES, DELIVERY_REQUEST_STATUS_LABELS } from '../../../../../../../libs/common/src';
import type { DeliveryRequestStatus } from '../../../../../../../libs/common/src';

import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { requestSourceLabel } from './request-source-label';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { RouterOutputs } from '../../../services/api/trpc-types';
import { DeliveriesRequestsService } from '../services/deliveries-requests-service';

export type YardSignRequest = NonNullable<RouterOutputs['deliveries']['getSignStatus']['request']>;
export type YardSignOpenElsewhere = NonNullable<RouterOutputs['deliveries']['getSignStatus']['open_in_other_campaign']>;

/**
 * The yard-sign standing control (Deliveries §14): one select that reads and flips the
 * household's delivery-request status in the ACTIVE campaign context. The truth stays in
 * `delivery_requests` — "None requested" = no row, and the route line is derived from the
 * active (pending) stop, never a stored flag. Embedded in the person Campaign standing card
 * and the household view; flipping to Delivered covers signs installed without the app.
 */
@Component({
  selector: 'pc-yard-sign-standing',
  imports: [RouterLink],
  templateUrl: './yard-sign-standing.html',
  host: { class: 'block min-w-0' },
})
export class YardSignStanding {
  /** The household the sign belongs to; null = person without an address (muted guidance state). */
  readonly householdId = input.required<string | null>();
  /** When set (person view), a request created here is attributed to this person as requester. */
  readonly personId = input<string | null>(null);
  /** Off when the host surface already titles the section (the household card's eyebrow). */
  readonly showLabel = input<boolean>(true);

  protected readonly context = inject(CampaignContextService);
  private readonly svc = inject(DeliveriesRequestsService);
  private readonly alerts = inject(AlertService);

  protected readonly statuses = DELIVERY_REQUEST_STATUSES;
  protected readonly labels = DELIVERY_REQUEST_STATUS_LABELS;

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly saving = signal(false);
  protected readonly request = signal<YardSignRequest | null>(null);
  /** Set when ANOTHER campaign holds the household's one open request — creating here can only 409. */
  protected readonly openElsewhere = signal<YardSignOpenElsewhere | null>(null);
  /**
   * Non-null when the last read failed. Without it the control rendered every failure — and
   * every plan-gate refusal below Movement — as the authoritative answer "None requested".
   */
  protected readonly loadError = signal<string | null>(null);

  protected readonly readonlyContext = this.context.isArchivedContext;
  /** No local open request to manage and another campaign holds the slot: the select is a dead end. */
  protected readonly blockedByOtherCampaign = computed(() => !this.request() && this.openElsewhere() !== null);

  /** "Requested by Jane · web form · Jun 12" — parts drop out honestly when absent. */
  protected readonly metaLine = computed(() => {
    const r = this.request();
    if (!r) return '';
    const parts: string[] = [];
    if (r.person_name) parts.push(`Requested by ${r.person_name}`);
    parts.push(this.sourceLabel(r.source));
    const date = this.formatDate(r.updated_at);
    if (date) parts.push(date);
    return parts.join(' · ');
  });

  /** Shared with the requests grid so the two surfaces cannot disagree on a source's name. */
  private readonly sourceLabel = requestSourceLabel;

  constructor() {
    effect(() => {
      const householdId = this.householdId();
      const campaignId = this.context.activeCampaignId();
      void untracked(() => this.load(householdId, campaignId));
    });
    // Degrade quietly if the context can't load — the control shows "None requested".
    this.context.ensureLoaded().catch(() => void 0);
  }

  protected async onStatusChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value as DeliveryRequestStatus | '';
    const householdId = this.householdId();
    if (!value || !householdId) return;
    this.saving.set(true);
    try {
      const existing = this.request();
      if (existing) {
        await this.svc.setStatus([existing.id], value);
        this.alerts.showSuccess('Yard sign updated');
      } else {
        const created = await this.svc.add({
          household_id: householdId,
          person_id: this.personId(),
          campaign_id: this.context.activeCampaignId() ?? undefined,
        });
        if (value !== 'new') await this.svc.setStatus([created.id], value);
        this.alerts.showSuccess('Yard sign recorded');
      }
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not update the yard sign. Please try again.'));
    } finally {
      this.saving.set(false);
      await this.load(householdId, this.context.activeCampaignId());
    }
  }

  /** Retry after a failed read, without reloading the surrounding page. */
  protected retry(): void {
    void this.load(this.householdId(), this.context.activeCampaignId());
  }

  private async load(householdId: string | null, campaignId: string | null): Promise<void> {
    if (!householdId || !campaignId) {
      this.request.set(null);
      this.openElsewhere.set(null);
      this.loadError.set(null);
      return;
    }
    const end = this._loading.begin();
    try {
      const res = await this.svc.getSignStatus(householdId, campaignId);
      this.request.set(res.request);
      this.openElsewhere.set(res.open_in_other_campaign ?? null);
      this.loadError.set(null);
    } catch (err) {
      // Say the read failed instead of asserting "None requested", which is a claim about
      // the data that a failed read cannot support.
      this.request.set(null);
      this.openElsewhere.set(null);
      this.loadError.set(getUserErrorMessage(err, 'Could not load the yard sign status.'));
    } finally {
      end();
    }
  }

  private formatDate(value: Date | string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
