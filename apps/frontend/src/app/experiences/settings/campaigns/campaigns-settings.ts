import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { JURISDICTIONS, isJurisdictionId, regionsForCountry, seatLabelFor } from '../../../../../../../libs/common/src';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { CampaignListItem, CampaignsService } from '../../campaigns/services/campaigns-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

/**
 * Campaigns §15 — the Workspace settings home for campaign management (admin/owner
 * only, like everything under /workspace). Explains what campaigns are and how
 * members are assigned, lists the contexts, and lets an admin switch the campaign
 * they are working in. Cards, not a datagrid: a tenant has a handful of
 * campaigns, ever. Deep pages (detail, carry-over, add/edit) stay on /campaigns/*.
 */
@Component({
  selector: 'pc-campaigns-settings',
  imports: [RouterLink, Icon, DatePipe],
  templateUrl: './campaigns-settings.html',
})
export class CampaignsSettingsComponent implements OnInit {
  private readonly campaignsSvc = inject(CampaignsService);
  private readonly context = inject(CampaignContextService);
  private readonly alerts = inject(AlertService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly loaded = signal(false);
  protected readonly campaigns = signal<CampaignListItem[]>([]);

  protected readonly activeContextId = this.context.activeCampaignId;
  protected readonly current = computed(() => this.campaigns().filter((c) => c.status === 'active'));
  protected readonly archived = computed(() => this.campaigns().filter((c) => c.status === 'archived'));

  public ngOnInit(): void {
    void this.load();
  }

  protected kindLabel(kind: string): string {
    return kind === 'office' ? 'Office' : 'Election';
  }

  /**
   * The office a campaign contests, in one line, so a workspace running several can tell them apart
   * without opening each one: "Canada — federal · Riding: Ottawa Centre", "United States — state ·
   * Ohio · Lower chamber · Legislative district: LD-12".
   *
   * Returns an empty string when the campaign has recorded nothing about its office. That is a
   * normal state, and the card says so in its own words rather than showing a blank field here.
   */
  protected officeLine(campaign: CampaignListItem): string {
    const jurisdiction = isJurisdictionId(campaign.jurisdiction) ? campaign.jurisdiction : 'other';
    const spec = JURISDICTIONS[jurisdiction];
    const region = campaign.office_region?.trim() || null;
    const parts: string[] = [];

    if (jurisdiction !== 'other') parts.push(spec.label);

    const locality = campaign.office_locality?.trim();
    if (locality) parts.push(locality);
    if (region) parts.push(regionsForCountry(spec.country).find((r) => r.code === region)?.name ?? region);
    if (campaign.chamber === 'upper') parts.push('Upper chamber');
    if (campaign.chamber === 'lower') parts.push('Lower chamber');

    const seatWord = seatLabelFor(jurisdiction, region, campaign.seat_label_override);
    const seatName = campaign.seat_name?.trim();
    if (campaign.seat_type === 'at_large') parts.push('At large');
    else if (seatName) parts.push(`${seatWord}: ${seatName}`);

    const position = campaign.seat_position?.trim();
    if (position) parts.push(position);

    const title = campaign.office_title?.trim();
    if (title) parts.push(title);

    return parts.join(' · ');
  }

  protected async switchTo(campaign: CampaignListItem, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    try {
      await this.context.setActive(String(campaign.id));
      this.alerts.showSuccess(`Now working in ${campaign.name}`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not switch campaign. Please try again.'));
    }
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      const [rows] = await Promise.all([this.campaignsSvc.getSwitcherList(), this.context.ensureLoaded()]);
      this.campaigns.set(rows);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load campaigns'));
    } finally {
      this.loaded.set(true);
      end();
    }
  }
}
