import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { form, validateStandardSchema } from '@angular/forms/signals';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { Icon as PcIcon } from '@icons/icon';
import { CompanyInputObj } from '../../../../../../../libs/common/src';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { CompaniesService } from '../services/companies-service';
import { PersonsService } from '../../persons/services/persons-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { StatusBadge as PcStatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

@Component({
  selector: 'pc-company-form',
  imports: [PcInput, PcTextarea, PcIcon, RouterModule, PcDetailHeader, PcStatusBadge, PcCard],
  templateUrl: './company-form.html',
})
export class CompanyForm implements OnInit {
  private readonly alertSvc = inject(AlertService);
  private readonly companiesSvc = inject(CompaniesService);
  private readonly personsSvc = inject(PersonsService);
  private readonly router = inject(Router);
  private readonly dialogs = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();

  /** Disables Save immediately on click — the loading gate stays false for its first
   *  300ms by design, which would leave a double-click window. */
  protected readonly saving = signal(false);

  protected readonly company = signal<any | null>(null);

  /** People employed here — feeds the Overview rail (§7). */
  protected readonly employeeCount = signal(0);

  /** Whether Google enrichment has run, for the Overview status badge. */
  protected readonly isEnriched = computed(() => {
    const raw = this.company()?.enrichment;
    if (!raw) return false;
    try {
      const enrichment = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return !!enrichment.google_enriched;
    } catch {
      return false;
    }
  });

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    const companies: PcBreadcrumb = { label: 'Companies', route: '/companies' };
    const id = this.company()?.id;
    if (id) {
      return [
        companies,
        { label: this.company()?.name || 'Company', route: ['/companies', String(id)] },
        { label: 'Edit' },
      ];
    }
    return [companies, { label: 'New company' }];
  });

  protected readonly payload = signal({
    name: '',
    description: '',
    website: '',
    industry: '',
    email: '',
    phone: '',
    notes: '',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, CompanyInputObj);
  });
  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);
  protected id = input<string>();
  protected isLoading = this._loading.visible;

  public mode = input<'new' | 'edit'>('edit');
  protected readonly isNewMode = computed(() => this.mode() === 'new' || !this.id());

  /** True while an add-time Google lookup is in flight (shows an inline hint). */
  protected readonly lookingUp = signal(false);
  /** True when another company already uses this name (advisory hint, not a block). */
  protected readonly duplicateName = signal(false);
  /** Last name we looked up, so repeated blurs on the same name don't re-hit Google. */
  private lastLookedUpName = '';

  private static readonly MIN_LOOKUP_NAME_LENGTH = 2;

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    await this.loadCompany();
    if (this.isNewMode()) {
      const state = window.history.state;
      if (state && state.cloneData) {
        const data = state.cloneData;
        this.payload.set({
          name: data.name ? `${data.name} (Copy)` : '',
          description: data.description ?? '',
          website: data.website ?? '',
          industry: data.industry ?? '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          notes: data.notes ?? '',
        });
      }
    }
  }

  private async loadCompany() {
    if (!this.id()) return;
    const end = this._loading.begin();
    try {
      const data = await this.companiesSvc.getById(this.id()!);
      this.company.set(data);
      if (data) {
        this.payload.set({
          name: data.name ?? '',
          description: data.description ?? '',
          website: data.website ?? '',
          industry: data.industry ?? '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          notes: data.notes ?? '',
        });
        this.form().reset();
      }
      try {
        this.employeeCount.set(await this.personsSvc.countByCompanyId(this.id()!));
      } catch {
        this.employeeCount.set(0);
      }
    } catch (err) {
      console.error('Failed to load company details:', err);
    } finally {
      end();
    }
  }

  /**
   * On name blur in the New Company form, ask Google Places for this company and
   * pre-fill only the fields the user left blank. Non-blocking and best-effort:
   * enrichment is a convenience, so a failed lookup never interrupts adding a
   * company. Auto-filled values are shown for the user to review and edit before
   * saving — nothing is persisted until they hit Create.
   */
  protected onNameBlur(): void {
    const name = this.payload().name.trim();
    if (name.length < CompanyForm.MIN_LOOKUP_NAME_LENGTH) {
      this.duplicateName.set(false);
      return;
    }
    // Duplicate check runs in both new and edit modes; Google auto-fill is new-only.
    void this.checkDuplicateName(name);
    if (this.isNewMode()) {
      void this.runNameLookup(name);
    }
  }

  /** Advisory duplicate-name check — updates the hint, never blocks saving. */
  private async checkDuplicateName(name: string): Promise<void> {
    try {
      const exists = await this.companiesSvc.checkNameExists(name, this.id());
      this.duplicateName.set(exists);
    } catch (err) {
      // Best-effort: a failed check just hides the hint, never blocks the form.
      console.error('Duplicate company-name check failed:', err);
      this.duplicateName.set(false);
    }
  }

  private async runNameLookup(name: string): Promise<void> {
    if (name === this.lastLookedUpName) return;
    this.lastLookedUpName = name;

    this.lookingUp.set(true);
    try {
      const result = await this.companiesSvc.lookupEnrichment(name);
      const current = this.payload();
      const next = { ...current };
      const filled: string[] = [];
      if (!current.website.trim() && result.website) {
        next.website = result.website;
        filled.push('website');
      }
      if (!current.phone.trim() && result.phone) {
        next.phone = result.phone;
        filled.push('phone');
      }
      if (!current.industry.trim() && result.industry) {
        next.industry = result.industry;
        filled.push('industry');
      }
      if (!current.description.trim() && result.description) {
        next.description = result.description;
        filled.push('description');
      }
      if (filled.length > 0) {
        this.payload.set(next);
        this.alertSvc.showSuccess(`Filled in ${filled.join(', ')} from Google. Review before saving`);
      }
    } catch (err) {
      // Best-effort only: never block adding a company on a Google lookup.
      console.error('Google company lookup failed:', err);
    } finally {
      this.lookingUp.set(false);
    }
  }

  protected async deleteCompany() {
    if (!this.id()) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Company',
      message: 'Are you sure you want to delete this company? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.companiesSvc.delete(this.id()!);
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

  public canDeactivate(): Promise<boolean> {
    return this.unsavedChanges.confirmDiscardIfDirty(this.company()?.name || 'this company');
  }

  protected save(done?: (() => void) | Event) {
    if (done instanceof Event) {
      done.preventDefault();
    }
    if (this.saving()) return;
    const raw = this.payload();
    if (this.id()) {
      this.saving.set(true);
      const end = this._loading.begin();
      this.companiesSvc
        .update(this.id()!, raw)
        .then(() => {
          this.companiesSvc.triggerRefresh();
          this.alertSvc.showSuccess('Company updated successfully');
          // Mark the form pristine so the deactivate guard doesn't prompt
          // "Leave without saving?" on the post-save navigation.
          this.form().reset();
          if (typeof done === 'function') {
            done();
          } else {
            void this.router.navigate(['/companies', this.id()]);
          }
        })
        .catch((err: any) => {
          const message =
            err instanceof Error && err.message
              ? err.message
              : isRecord(err) &&
                  isRecord(err['data']) &&
                  typeof err['data']['message'] === 'string' &&
                  err['data']['message']
                ? err['data']['message']
                : 'Unable to save company';
          this.alertSvc.showError(message);
        })
        .finally(() => {
          end();
          this.saving.set(false);
        });
    } else {
      this.saving.set(true);
      const end = this._loading.begin();
      this.companiesSvc
        .add(raw)
        .then(() => {
          this.companiesSvc.triggerRefresh();
          this.alertSvc.showSuccess('Company added successfully');
          // Mark the form pristine so the deactivate guard doesn't prompt
          // "Leave without saving?" on the post-save navigation.
          this.form().reset();
          if (typeof done === 'function') {
            done();
          } else {
            void this.router.navigate(['/companies']);
          }
        })
        .catch((err: any) => {
          const message =
            err instanceof Error && err.message
              ? err.message
              : isRecord(err) &&
                  isRecord(err['data']) &&
                  typeof err['data']['message'] === 'string' &&
                  err['data']['message']
                ? err['data']['message']
                : 'Unable to save company';
          this.alertSvc.showError(message);
        })
        .finally(() => {
          end();
          this.saving.set(false);
        });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
