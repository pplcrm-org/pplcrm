import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { form, FormField, validateStandardSchema, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AddWebFormObj } from '../../../../../../../libs/common/src';
import { ListsService } from '@experiences/lists/services/lists-service';
import { FormsService } from '@experiences/forms/services/forms-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Tags } from '@experiences/tags/ui/tags';
import { TagItem } from '@uxcommon/components/tags/tagitem';
import { Icon } from '@icons/icon';
import { FormActions } from '@uxcommon/components/form-actions/form-actions';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { DonationsService } from '../../../services/api/donations-service';
import { environment } from '../../../../environments/environment';
import { donationPageUrl } from '../../../shared/public-pages';
import { AuthService } from '../../../auth/auth-service';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

@Component({
  selector: 'pc-fundraising-form',
  imports: [FormField, RouterModule, Tags, TagItem, Icon, FormActions, PcCard],
  templateUrl: './fundraising-form.html',
})
export class FundraisingFormComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formsSvc = inject(FormsService);
  private readonly listsSvc = inject(ListsService);
  private readonly alertSvc = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly settingsSvc = inject(SettingsService);
  private readonly donationsSvc = inject(DonationsService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly isInitialized = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly isNew = signal(true);
  protected readonly formId = signal<string | null>(null);
  // Public lookups are keyed (tenant, slug) — the UUID is internal only.
  protected readonly formSlug = signal<string | null>(null);

  protected setType(type: 'donation' | 'recurring_donation') {
    this.payload.update((p) => ({ ...p, form_type: type }));
  }

  // Connect readiness comes from the residency context (defaults true to avoid a banner flash
  // before it loads); tenants no longer hold Stripe keys.
  protected readonly stripeConnected = signal(true);

  // Donations are paused until the tenant confirms residency restrictions in Workspace → Donations.
  // Defaults to true so no false "paused" banner flashes before the context loads.
  protected readonly residencyAcknowledged = signal(true);

  protected readonly availableLists = signal<Array<{ id: string; name: string }>>([]);
  protected readonly selectedLists = signal<string[]>([]);
  protected readonly selectedTags = signal<string[]>([]);
  protected readonly selectedFields = signal<string[]>(['first_name', 'last_name', 'email', 'mobile', 'notes']);

  protected readonly payload = signal({
    name: '',
    description: '',
    redirect_url: '',
    status: 'active' as 'active' | 'archived',
    send_confirmation: true,
    send_alert: true,
    form_type: 'donation' as 'donation' | 'recurring_donation',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, AddWebFormObj);
  });

  /** Narrates "Unsaved changes · N fields" and powers canDeactivate below. */
  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  protected readonly isRecurring = computed(() => this.payload().form_type === 'recurring_donation');

  protected readonly embedSnippet = computed(() => {
    const slug = this.formSlug();
    if (!slug) return '';
    const apiOrigin = environment.apiUrl.replace(/\/$/, '');
    const tenantSlug = this.auth.getUser()?.tenant_slug ?? '';
    const recurring = this.isRecurring();

    const amountField = recurring
      ? `
  <div style="margin-bottom: 16px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Monthly Pledge Amount ($) *</label>
    <input type="number" name="monthly_amount" min="1" step="1" placeholder="25" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
    <small style="font-size: 12px; color: #666;">You will be billed this amount every month.</small>
  </div>`
      : `
  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Donation Amount ($ CAD) *</label>
    <input type="number" name="amount" min="1" step="any" placeholder="E.g. 50.00" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>`;

    const submitLabel = recurring ? 'Start Monthly Pledge' : 'Donate Now';

    return `<!-- pplCRM Embeddable Donation Form -->
<form action="${apiOrigin}/api/forms/submit/${slug}?t=${encodeURIComponent(tenantSlug)}" method="POST" style="max-width: 400px; font-family: sans-serif;">
  <input type="text" name="_hp" style="display:none !important" tabindex="-1" autocomplete="off" />

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">First Name *</label>
    <input type="text" name="first_name" placeholder="John" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Last Name *</label>
    <input type="text" name="last_name" placeholder="Doe" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Email Address *</label>
    <input type="email" name="email" placeholder="you@example.com" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Street Address *</label>
    <input type="text" name="street1" placeholder="E.g. 123 Main St" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">City *</label>
    <input type="text" name="city" placeholder="E.g. Toronto" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Country of Residence *</label>
    <select name="country" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
      <option value="CA">Canada</option>
      <option value="US">United States</option>
      <option value="GB">United Kingdom</option>
      <option value="AU">Australia</option>
    </select>
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">State / Province *</label>
    <input type="text" name="state" placeholder="E.g. ON or NY" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>

  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Zip / Postal Code *</label>
    <input type="text" name="zip" placeholder="E.g. M5V 2T6" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>${amountField}

  <button type="submit" style="background-color: #0ea5e9; color: white; padding: 10px 16px; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; width: 100%;">${submitLabel}</button>
</form>`;
  });

  protected readonly formUrl = computed(() => {
    const slug = this.formSlug();
    if (!slug) return '';
    const tenantSlug = this.auth.getUser()?.tenant_slug ?? '';
    return donationPageUrl(tenantSlug, slug);
  });

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'add') {
      this.isNew.set(false);
      this.formId.set(id);
    }
    void this.loadLists();
    void this.settingsSvc.load();
    void this.loadResidencyContext();
  }

  private async loadResidencyContext(): Promise<void> {
    try {
      const ctx = await this.donationsSvc.getResidencyContext();
      this.residencyAcknowledged.set(ctx.residencyAcknowledged);
      this.stripeConnected.set(ctx.stripeConnected);
    } catch {
      // non-fatal — leave the banners hidden if the context can't be read
    }
  }

  protected listName(id: string): string {
    const match = this.availableLists().find((list) => list.id === id);
    return match?.name ?? 'List';
  }

  protected handleListSelect(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) return;
    const value = select.value;
    if (!value) return;
    const current = new Set(this.selectedLists());
    if (!current.has(value)) {
      current.add(value);
      this.selectedLists.set(Array.from(current));
    }
    select.value = '';
  }

  protected removeList(listId: string): void {
    this.selectedLists.set(this.selectedLists().filter((id) => id !== listId));
  }

  protected handleTagsChange(tags: string[]): void {
    this.selectedTags.set(Array.isArray(tags) ? [...tags] : []);
  }

  protected copySnippet(): void {
    const code = this.embedSnippet();
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => this.alertSvc.showSuccess('Donation page snippet copied to clipboard!'),
      () => this.alertSvc.showError('Failed to copy to clipboard.'),
    );
  }

  protected copyUrl(): void {
    const url = this.formUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => this.alertSvc.showSuccess('Donation page URL copied!'),
      () => this.alertSvc.showError('Failed to copy URL.'),
    );
  }

  protected async deleteForm() {
    const id = this.formId();
    if (!id) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Donation Page',
      message: 'Are you sure you want to delete this donation page? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    this.saving.set(true);
    try {
      await this.formsSvc.delete(id);
      this.formsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Donation page deleted');
      await this.router.navigate(['/donations']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete donation page';
      this.alertSvc.showError(message);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * @param done called instead of navigating, so the leave guard can save without fighting the
   * router.
   * @returns whether the write landed.
   */
  protected async save(done?: (() => void) | Event): Promise<boolean> {
    if (done instanceof Event) {
      done.preventDefault();
    }

    this.form().markAsTouched();
    if (this.form().invalid()) {
      this.alertSvc.showError('Please check your inputs.');
      return false;
    }

    let saved = false;
    this.saving.set(true);
    this.error.set(null);

    await submit(this.form, {
      action: async () => {
        const values = this.payload();

        try {
          if (this.isNew()) {
            const payload = {
              name: values.name?.trim() ?? '',
              description: values.description?.trim() || null,
              redirect_url: values.redirect_url?.trim() || null,
              target_tags: this.selectedTags().length ? this.selectedTags() : null,
              target_lists: this.selectedLists().length ? this.selectedLists() : null,
              status: values.status,
              fields: this.selectedFields(),
              send_confirmation: !!values.send_confirmation,
              send_alert: !!values.send_alert,
              form_type: values.form_type,
            };
            const result = (await this.formsSvc.add(payload)) as { id: string };
            this.alertSvc.showSuccess('Donation page created successfully!');
            saved = true;
            if (typeof done === 'function') done();
            else void this.router.navigate(['/donation-pages', result.id]);
          } else {
            const id = this.formId()!;
            const payload = {
              name: values.name?.trim() ?? '',
              description: values.description?.trim() || null,
              redirect_url: values.redirect_url?.trim() || null,
              target_tags: this.selectedTags().length ? this.selectedTags() : null,
              target_lists: this.selectedLists().length ? this.selectedLists() : null,
              status: values.status,
              fields: this.selectedFields(),
              send_confirmation: !!values.send_confirmation,
              send_alert: !!values.send_alert,
            };
            await this.formsSvc.update(id, payload);
            this.alertSvc.showSuccess('Donation page updated successfully!');
            saved = true;
            if (typeof done === 'function') {
              done();
            } else {
              void this.router.navigate(['/donation-pages', id]);
            }
          }
        } catch (err) {
          const msg = err instanceof Error && err.message ? err.message : 'An error occurred while saving.';
          this.error.set(msg);
          this.alertSvc.showError(msg);
        } finally {
          this.saving.set(false);
        }
        return null;
      },
    });
    return saved;
  }

  public canDeactivate(): Promise<boolean> {
    return this.unsavedChanges.confirmDiscardIfDirty(this.payload().name || 'this donation page', () =>
      this.save(() => undefined),
    );
  }

  private async loadLists(): Promise<void> {
    const end = this._loading.begin();
    try {
      const result = await this.listsSvc.getAll({ limit: 100 });
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      this.availableLists.set(
        rows.map((row: any) => ({
          id: String(row.id),
          name: String(row.name),
        })),
      );
      if (!this.isNew()) {
        await this.loadPageDetails();
      }
    } catch (err) {
      console.error('Failed to load lists', err);
    } finally {
      this.isInitialized.set(true);
      end();
    }
  }

  private async loadPageDetails(): Promise<void> {
    const id = this.formId();
    if (!id) return;
    const end = this._loading.begin();
    try {
      const record = (await this.formsSvc.getById(id)) as any;
      if (record) {
        this.formSlug.set(record.slug ?? null);
        this.payload.set({
          name: record.name ?? '',
          description: record.description ?? '',
          redirect_url: record.redirect_url ?? '',
          status: (record.status as 'active' | 'archived') ?? 'active',
          send_confirmation: record.send_confirmation !== false,
          send_alert: record.send_alert !== false,
          form_type: (record.form_type as 'donation' | 'recurring_donation') ?? 'donation',
        });
        this.form().reset();
        this.selectedTags.set(Array.isArray(record.target_tags) ? record.target_tags : []);
        this.selectedLists.set(Array.isArray(record.target_lists) ? record.target_lists : []);
        if (record.fields) {
          const fields = Array.isArray(record.fields) ? record.fields : JSON.parse(record.fields);
          this.selectedFields.set(fields);
        }
      }
    } catch (err) {
      console.error('Failed to load page details', err);
      this.error.set('Failed to load page details.');
    } finally {
      end();
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
