import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { form, FormField, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterModule } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { AddCampaignObj, AddCampaignType, UpdateCampaignType } from '../../../../../../../libs/common/src';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

import { CampaignContextService } from '../../../services/campaign-context.service';
import { CampaignDetail, CampaignsService } from '../services/campaigns-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

/**
 * Campaigns §15 — create/edit. New campaigns are always elections: the office
 * context is permanent and created at signup, so there is never a second one.
 * Kind is immutable after creation; status changes only via archive/unarchive.
 */
@Component({
  selector: 'pc-campaign-form',
  imports: [FormField, RouterModule, PcDetailHeader, PcInput, PcTextarea, PcCard],
  templateUrl: './campaign-form.html',
})
export class CampaignFormComponent implements OnInit {
  readonly id = input<string>();

  private readonly alerts = inject(AlertService);
  private readonly router = inject(Router);
  private readonly campaignsSvc = inject(CampaignsService);
  private readonly context = inject(CampaignContextService);

  protected readonly isNew = computed(() => !this.id());
  protected readonly detail = signal<CampaignDetail | null>(null);
  /** getById is loosely typed at the crud-router boundary; read the name defensively. */
  protected readonly detailName = computed(() => {
    const name = (this.detail() as Record<string, unknown> | null)?.['name'];
    return typeof name === 'string' ? name : '';
  });
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    const campaigns: PcBreadcrumb = { label: 'Campaigns', route: '/workspace/campaigns' };
    const id = this.id();
    if (id) {
      return [campaigns, { label: this.detailName() || 'Campaign', route: ['/campaigns', id] }, { label: 'Edit' }];
    }
    return [campaigns, { label: 'New campaign' }];
  });

  protected readonly payload = signal({
    name: '',
    description: '',
    notes: '',
    kind: 'election' as const,
    startdate: '',
    enddate: '',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, AddCampaignObj);
  });

  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  public ngOnInit(): void {
    void this.loadCampaign();
  }

  public canDeactivate(): Promise<boolean> {
    // stayPut: the router is already navigating away, so the guard-time save must not navigate.
    return this.unsavedChanges.confirmDiscardIfDirty(this.detailName() || 'this campaign', () =>
      this.save(undefined, true),
    );
  }

  protected async save(done?: (() => void) | Event, stayPut = false): Promise<boolean> {
    if (done instanceof Event) done.preventDefault();

    this.form().markAsTouched();
    if (this.form().invalid()) return false;

    const raw = this.payload();
    this.saving.set(true);
    this.error.set(null);

    try {
      if (this.isNew()) {
        const payload: AddCampaignType = {
          name: raw.name.trim(),
          description: raw.description.trim() || null,
          notes: raw.notes.trim() || null,
          kind: 'election',
          startdate: raw.startdate || null,
          enddate: raw.enddate || null,
        };
        const result = await this.campaignsSvc.add(payload);
        this.campaignsSvc.triggerRefresh();
        await this.context.refresh();
        this.detail.set(result);
        this.form().reset();
        this.alerts.showSuccess('Campaign created');
        if (typeof done === 'function') done();
        else if (!stayPut) await this.router.navigate(['/workspace/campaigns']);
      } else {
        const payload: UpdateCampaignType = {
          name: raw.name.trim() || undefined,
          description: raw.description.trim() || null,
          notes: raw.notes.trim() || null,
          startdate: raw.startdate || null,
          enddate: raw.enddate || null,
        };
        const result = await this.campaignsSvc.update(this.id()!, payload);
        this.campaignsSvc.triggerRefresh();
        await this.context.refresh();
        this.detail.set(result);
        this.setForm(result);
        this.form().reset();
        this.alerts.showSuccess('Campaign updated');
        if (typeof done === 'function') done();
        else if (!stayPut) await this.router.navigate(['/campaigns', this.id()]);
      }
      return true;
    } catch (err) {
      const message = getUserErrorMessage(err, 'Unable to save the campaign');
      this.error.set(message);
      this.alerts.showError(message);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private async loadCampaign(): Promise<void> {
    if (this.isNew()) return;
    const end = this._loading.begin();
    try {
      const campaign = await this.campaignsSvc.getById(this.id()!);
      this.detail.set(campaign);
      this.setForm(campaign);
    } catch (err) {
      const message = getUserErrorMessage(err, 'Failed to load the campaign');
      this.error.set(message);
      this.alerts.showError(message);
    } finally {
      end();
    }
  }

  private setForm(campaign: CampaignDetail | null) {
    if (!campaign) return;
    const c = campaign as Record<string, unknown>;
    this.payload.set({
      name: typeof c['name'] === 'string' ? c['name'] : '',
      description: typeof c['description'] === 'string' ? c['description'] : '',
      notes: typeof c['notes'] === 'string' ? c['notes'] : '',
      kind: 'election',
      startdate: typeof c['startdate'] === 'string' ? c['startdate'] : '',
      enddate: typeof c['enddate'] === 'string' ? c['enddate'] : '',
    });
  }
}
