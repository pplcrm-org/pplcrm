import { Component, effect, inject, input, signal, computed, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@uxcommon/components/icons/icon';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { FormsService } from '../services/forms-service';
import { ListsService } from '../../lists/services/lists-service';
import { UserService } from '../../../services/user.service';
import type { IAuthUser } from '@common';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { Tabs, TabPanel, PcTabOption } from '@uxcommon/components/tabs/tabs';
import { StatCard } from '@uxcommon/components/stat-card/stat-card';
import { ProfileCard } from '@uxcommon/components/profile-card/profile-card';
import { DetailRow } from '@uxcommon/components/detail-row/detail-row';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../auth/auth-service';
import { donationPageUrl, publicPageUrl } from '../../../shared/public-pages';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';

@Component({
  selector: 'pc-form-view',
  imports: [
    StatusBadge,
    DatePipe,
    RouterModule,
    Icon,
    RecordActivities,
    DetailLayout,
    PcCard,
    Tabs,
    TabPanel,
    StatCard,
    ProfileCard,
    DetailRow,
  ],
  templateUrl: './form-view.html',
})
export class FormViewComponent {
  private readonly alertSvc = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly formsSvc = inject(FormsService);
  private readonly listsSvc = inject(ListsService);
  private readonly route = inject(ActivatedRoute);
  private readonly userService = inject(UserService);
  private readonly dialogs = inject(ConfirmDialogService);

  readonly id = input.required<string>();
  protected readonly recordNav = injectRecordNavigation('form', this.id);
  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly formRecord = signal<any | null>(null);
  protected readonly submissionsCount = signal(0);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Forms', route: '/forms' },
    { label: this.formRecord()?.name || 'Form' },
  ]);
  protected readonly availableLists = signal<Array<{ id: string; name: string }>>([]);
  protected readonly users = signal<IAuthUser[]>([]);
  private readonly router = inject(Router);
  private usersById = new Map<string, IAuthUser>();

  // Active tab state
  protected activeTab = signal<string>('targetActions');

  protected readonly formTabs = computed<PcTabOption[]>(() => [
    { id: 'targetActions', label: 'Target lists & actions' },
    { id: 'fieldsPreview', label: 'Fields & layout' },
    // Activity is the record's history — last tab in every view.
    { id: 'activity', label: 'Activity' },
  ]);

  protected readonly selectedFields = computed(() => {
    const record = this.formRecord();
    if (!record) return [];
    if (record.fields) {
      return Array.isArray(record.fields) ? record.fields : JSON.parse(record.fields);
    }
    return ['first_name', 'last_name', 'email', 'mobile', 'notes'];
  });

  protected readonly fieldsCount = computed(() => {
    const fields = this.selectedFields();
    // Email is always required and present
    const standardFieldsCount = fields.filter((f: string) => f !== 'email').length;
    return standardFieldsCount + 1;
  });

  protected readonly targetListsNames = computed(() => {
    const record = this.formRecord();
    if (!record || !record.target_lists) return [];
    const listIds: string[] = Array.isArray(record.target_lists)
      ? record.target_lists
      : JSON.parse(record.target_lists || '[]');

    return listIds.map((id) => this.availableLists().find((l) => l.id === id)?.name).filter(Boolean) as string[];
  });

  protected readonly embedSnippet = computed(() => {
    const record = this.formRecord();
    if (!record || !this.id()) return '';
    const apiOrigin = environment.apiUrl.replace(/\/$/, '');
    const fields = this.selectedFields();
    const isDonation = record.form_type === 'donation';
    const isRecurring = record.form_type === 'recurring_donation';
    const isAnyDonation = isDonation || isRecurring;

    const addressFields = isAnyDonation
      ? `
  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Street Address *</label>
    <input type="text" name="street1" placeholder="123 Main St" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>
  <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px; margin-bottom: 12px;">
    <div>
      <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">City *</label>
      <input type="text" name="city" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
    </div>
    <div>
      <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Zip / Postal *</label>
      <input type="text" name="zip" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
    </div>
  </div>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
    <div>
      <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">State / Province *</label>
      <input type="text" name="state" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
    </div>
    <div>
      <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Country *</label>
      <input type="text" name="country" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
    </div>
  </div>`
      : '';

    const amountField = isDonation
      ? `
  <div style="margin-bottom: 16px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Donation Amount ($) *</label>
    <input type="number" name="amount" min="1" step="1" placeholder="50" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>`
      : isRecurring
        ? `
  <div style="margin-bottom: 16px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Monthly Pledge Amount ($) *</label>
    <input type="number" name="monthly_amount" min="1" step="1" placeholder="25" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
    <small style="font-size: 12px; color: #666;">You will be billed this amount every month.</small>
  </div>`
        : '';

    const submitLabel = isRecurring ? 'Start Monthly Pledge' : isDonation ? 'Donate Now' : 'Subscribe';

    return `<!-- pplCRM Embeddable Form -->
<form action="${apiOrigin}/api/forms/submit/${this.formRecord()?.slug ?? ''}?t=${encodeURIComponent(this.auth.getUser()?.tenant_slug ?? '')}" method="POST" style="max-width: 400px; font-family: sans-serif;">
  <input type="text" name="_hp" style="display:none !important" tabindex="-1" autocomplete="off" />
${
  fields.includes('first_name') || isAnyDonation
    ? `  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">First Name${isAnyDonation ? ' *' : ''}</label>
    <input type="text" name="first_name" placeholder="First Name"${isAnyDonation ? ' required' : ''} style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>`
    : ''
}${
      fields.includes('last_name') || isAnyDonation
        ? `\n  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Last Name${isAnyDonation ? ' *' : ''}</label>
    <input type="text" name="last_name" placeholder="Last Name"${isAnyDonation ? ' required' : ''} style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>`
        : ''
    }
  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Email Address *</label>
    <input type="email" name="email" placeholder="you@example.com" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>${
    !isAnyDonation && fields.includes('mobile')
      ? `\n  <div style="margin-bottom: 12px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Mobile / Phone</label>
    <input type="text" name="mobile" placeholder="Phone Number" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;" />
  </div>`
      : ''
  }${
    !isAnyDonation && fields.includes('notes')
      ? `\n  <div style="margin-bottom: 16px;">
    <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 4px;">Notes / Message</label>
    <textarea name="notes" placeholder="How can we help?" rows="3" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; resize: vertical;"></textarea>
  </div>`
      : ''
  }${addressFields}${amountField}
  <button type="submit" style="background-color: #0ea5e9; color: white; padding: 10px 16px; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; width: 100%;">${submitLabel}</button>
</form>`;
  });

  protected readonly formUrl = computed(() => {
    const record = this.formRecord();
    if (!record?.slug) return '';
    const tenantSlug = this.auth.getUser()?.tenant_slug;
    // Donation forms keep the server-rendered page (Stripe checkout); standard forms live on the
    // /f/:slug SPA page on the tenant subdomain.
    if (record.form_type === 'donation' || record.form_type === 'recurring_donation') {
      return donationPageUrl(tenantSlug, record.slug);
    }
    return publicPageUrl(tenantSlug, `f/${record.slug}`);
  });

  constructor() {
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.loadAllData(currentId));
    });

    // Load users
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
      // 1. Load Form details
      const record = await this.formsSvc.getById(id);
      if (!isCurrent()) return; // superseded — do not land stale data
      this.formRecord.set(record);

      // 2. Load available Lists to resolve list names
      const result = await this.listsSvc.getAll({ limit: 100 });
      if (!isCurrent()) return;
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      this.availableLists.set(
        rows.map((row: any) => ({
          id: String(row.id),
          name: String(row.name),
        })),
      );

      // 3. Load submissions count
      const subCount = await this.formsSvc.getSubmissionsCount(id);
      if (!isCurrent()) return;
      this.submissionsCount.set(subCount);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the form. Please try again.'));
    } finally {
      end();
      this.initialized.set(true);
    }
  }

  protected editForm() {
    void this.router.navigate(['edit'], { relativeTo: this.route });
  }

  protected async deleteForm() {
    if (!this.id()) return;
    const backRoute: string = this.route.snapshot.data['backRoute'] ?? '/forms';
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Web Form',
      message: 'Are you sure you want to delete this web form? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.formsSvc.delete(this.id());
      this.formsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Web form deleted');
      await this.router.navigate([backRoute]);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete web form';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  protected copySnippet(): void {
    const code = this.embedSnippet();
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => this.alertSvc.showSuccess('Form HTML snippet copied to clipboard!'),
      () => this.alertSvc.showError('Failed to copy to clipboard.'),
    );
  }

  protected getCreatedAt(): Date | null {
    const date = this.formRecord()?.created_at;
    return date ? new Date(date) : null;
  }

  protected getUpdatedAt(): Date | null {
    const date = this.formRecord()?.updated_at;
    return date ? new Date(date) : null;
  }

  protected getUserName(id: string | null | undefined): string {
    if (!id) return '?';
    return this.usersById.get(String(id))?.first_name ?? '?';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
