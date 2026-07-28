import { DatePipe } from '@angular/common';
import { Component, OnInit, WritableSignal, computed, effect, inject, input, signal } from '@angular/core';
import { FormField, email, form, pattern, validate } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

import { IAuthUserDetail, SettingsEntryType } from '../../../../../../libs/common/src';
import { AuthService } from '../../auth/auth-service';
import { HouseholdsService } from '../households/services/households-service';
import { AccountSettingsComponent } from './account/account-settings';
import { ApiKeysSettingsComponent } from './api-keys/api-keys-settings';
import { BillingSettingsComponent } from './billing/billing-settings';
import { CampaignsSettingsComponent } from './campaigns/campaigns-settings';
import { ModulesSettings } from './modules/modules-settings';
import { DeliveriesSettingsComponent } from './deliveries/deliveries-settings';
import { DomainSettingsComponent } from './domains/domains-settings';
import { PhoneVerification } from './phone/phone-verification';
import { DonationsSettingsComponent } from './donations/donations-settings';
import { GoogleSyncSettings } from './google-sync/google-sync-settings';
import { MsSyncSettings } from './ms-sync/ms-sync-settings';
import { SettingsService, TenantSettingsSnapshot } from './services/settings-service';
import {
  SETTINGS_SECTIONS,
  SettingsFieldConfig,
  SettingsNavGroup,
  SettingsSectionConfig,
  WORKSPACE_NAV_GROUPS,
} from './settings.config';
import { StorageSettingsComponent } from './storage/storage-settings';

interface SectionFieldState {
  config: SettingsFieldConfig;
  controlName: string;
}

interface SectionState {
  config: SettingsSectionConfig;
  fields: SectionFieldState[];
  form: any;
  payload: WritableSignal<Record<string, any>>;
}

/** Self-saving sections rendered outside the config-driven form flow. One entry
 *  drives both the sidebar nav button and the content shell, so the two can
 *  never drift apart again. */
interface CustomSectionConfig {
  description: string;
  icon: PcIconNameType;
  id: string;
  title: string;
}

/** One sidebar nav entry, merged from either section source. `section` is set
 *  only for form-driven sections and drives the unsaved-changes dot. */
interface NavItem {
  icon: PcIconNameType;
  id: string;
  section?: SectionState;
  title: string;
}

interface NavGroup {
  items: NavItem[];
  label: string | null;
}

const CUSTOM_SECTIONS: CustomSectionConfig[] = [
  {
    id: 'modules',
    icon: 'adjustments-horizontal',
    title: 'Modules',
    description:
      'What kind of organization this is, and which optional modules appear in your sidebar. Turning one off never deletes anything.',
  },
  {
    id: 'campaigns',
    icon: 'square-3-stack-3d',
    title: 'Campaigns',
    description:
      'Separate working contexts (your permanent office plus election campaigns) that share one contact list. Admins manage them and assign users to them.',
  },
  {
    id: 'email-sync',
    icon: 'envelope',
    title: 'Email sync',
    description:
      'Connect your email provider to automatically sync incoming and outgoing emails into your pplcrm inbox.',
  },
  {
    id: 'domains',
    icon: 'globe-americas',
    title: 'Domain verification',
    description: 'Configure DNS verification records (SPF, DKIM, DMARC) so you can send emails from your own domain.',
  },
  {
    id: 'donations',
    icon: 'currency-dollar',
    title: 'Donations',
    description:
      'Configure donation limit, residency restrictions, progressive tax credit tiers, and connect your Stripe account.',
  },
  {
    id: 'deliveries',
    icon: 'house-modern',
    title: 'Deliveries',
    description: 'Planning defaults the Plan routes page starts from — stop time, driving speed, drivers, return trip.',
  },
  {
    id: 'storage',
    icon: 'archive-box',
    title: 'Storage',
    description: 'Plan quota, usage, and the files taking up the most space.',
  },
  {
    id: 'billing',
    icon: 'credit-card',
    title: 'Billing',
    description: 'Manage your subscription plans, view invoice details, and update payment methods.',
  },
  {
    id: 'account',
    icon: 'user-circle',
    title: 'Account',
    description: 'Manage your organization account: pause billing or permanently delete all data.',
  },
  {
    id: 'api-keys',
    icon: 'lock-closed',
    title: 'API keys',
    description: 'One key for server-side integrations: submit forms, RSVPs, and signups, or connect Zapier.',
  },
];

@Component({
  selector: 'pc-settings-page',
  imports: [
    FormField,
    Icon,
    MsSyncSettings,
    GoogleSyncSettings,
    BillingSettingsComponent,
    CampaignsSettingsComponent,
    ModulesSettings,
    DeliveriesSettingsComponent,
    DomainSettingsComponent,
    DonationsSettingsComponent,
    AccountSettingsComponent,
    ApiKeysSettingsComponent,
    StorageSettingsComponent,
    PhoneVerification,
    DatePipe,
    EmptyState,
  ],
  templateUrl: './settings-page.html',
})
export class SettingsPage implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Kept so existing template/route bindings read naturally; the page is workspace-only now. */
  protected readonly currentMode = 'workspace' as const;
  protected readonly currentUserDetail = signal<IAuthUserDetail | null>(null);
  private readonly userSignal = this.auth.getUserSignal();
  /** Mailbox sync and Stripe Connect are blocked server-side during the demo; the inline
   *  banners explain it (§2 explained-disabled). Ordinary workspace settings save normally in
   *  demo mode. */
  protected readonly isDemo = computed(() => !!this.userSignal()?.tenant_demo_mode_at);
  /** Sender, phone and domain verification unlock with a settled plan — Free included — rather
   *  than with demo removal, because the go-live wizard needs them before that point. */
  protected readonly planSelected = computed(() => this.userSignal()?.tenant_plan_selected === true);
  protected readonly emailCooldownSeconds = signal<Record<string, number>>({});
  protected readonly lastFingerprintRecomputeTime = signal<Date | null>(null);
  protected readonly fingerprintRecomputeNextAvailable = computed(() => {
    const lastTime = this.lastFingerprintRecomputeTime();
    if (!lastTime) return null;
    const nextAvailable = new Date(lastTime.getTime());
    nextAvailable.setMonth(nextAvailable.getMonth() + 1);
    return nextAvailable;
  });
  protected readonly hasLoaded = signal(false);
  protected readonly householdsSvc = inject(HouseholdsService);
  protected readonly isFingerprintRecomputeCooldown = computed(() => {
    const nextAvailable = this.fingerprintRecomputeNextAvailable();
    if (!nextAvailable) return false;
    return Date.now() < nextAvailable.getTime();
  });
  protected readonly lastRequestedEmail = signal<string | null>(null);
  protected readonly lastVerificationTimes = signal<Record<string, number>>({});
  protected readonly recomputingFingerprints = signal(false);
  protected readonly savingSectionId = signal<string | null>(null);
  protected readonly sectionStates: SectionState[];
  protected readonly sections = SETTINGS_SECTIONS;
  protected readonly selectedSectionId = signal<string>('');
  // The config-driven section currently shown, so the header Save/Cancel act on it.
  // Custom self-saving sections (billing, domains, email-sync, etc.) aren't in sectionStates → returns null.
  protected readonly headerSection = computed<SectionState | null>(() => {
    const id = this.selectedSectionId();
    const section = this.visibleSections.find((s) => s.config.id === id) ?? null;
    // A section with no stored fields (Data & duplicates) is action-only — a permanently
    // disabled Save/Cancel pair reads as something being broken.
    return section && section.fields.length > 0 ? section : null;
  });
  protected readonly senderEmailInput = signal('');
  protected readonly settingsSvc = inject(SettingsService);
  private readonly snapshotSignal = this.settingsSvc.snapshotSignal;
  protected readonly verifiedEmailsList = computed<string[]>(() => {
    return this.settingsSvc.getValue<string[]>('communications.verified_emails') || [];
  });
  protected readonly verifyingEmail = signal<string | null>(null);

  protected trackField = (_: number, field: SectionFieldState) => field.controlName;
  protected trackSection = (_: number, section: SectionState) => section.config.id;

  /** The custom (self-saving) sections visible in the current mode. */
  protected get visibleCustomSections(): CustomSectionConfig[] {
    return CUSTOM_SECTIONS;
  }

  /** The sidebar nav: both section sources merged in the order declared by the
   *  mode's nav groups. Sections missing from the declaration are appended to
   *  the last group so a new section can never silently vanish from the nav. */
  protected get navGroups(): NavGroup[] {
    const byId = new Map<string, NavItem>();
    for (const s of this.visibleSections) {
      byId.set(s.config.id, { id: s.config.id, title: s.config.title, icon: s.config.icon, section: s });
    }
    for (const c of this.visibleCustomSections) {
      byId.set(c.id, { id: c.id, title: c.title, icon: c.icon });
    }
    const declared: SettingsNavGroup[] = WORKSPACE_NAV_GROUPS;
    const groups: NavGroup[] = declared.map((g) => ({
      label: g.label,
      items: g.ids.map((id) => byId.get(id)).filter((item): item is NavItem => item != null),
    }));
    const declaredIds = new Set(declared.flatMap((g) => g.ids));
    const leftovers = [...byId.values()].filter((item) => !declaredIds.has(item.id));
    const lastGroup = groups.at(-1);
    if (leftovers.length > 0 && lastGroup) {
      lastGroup.items.push(...leftovers);
    }
    return groups.filter((g) => g.items.length > 0);
  }

  /** Custom sections whose actions the demo guard blocks; they render an explaining banner
   *  and their controls are disabled instead of failing server-side. Domains is NOT one of
   *  them — verification is gated on a settled plan, not on demo mode (see `isPlanLocked`). */
  protected isDemoLocked(sectionId: string): boolean {
    return this.isDemo() && (sectionId === 'email-sync' || sectionId === 'donations');
  }

  /** Sections the server gates on a settled plan rather than on demo mode: proving you own a
   *  domain, an email address or a phone number is setup, and the go-live wizard asks for it
   *  while the demo data is still in place. */
  protected isPlanLocked(sectionId: string): boolean {
    return !this.planSelected() && sectionId === 'domains';
  }

  /** Nav-button classes shared by config-driven and custom section buttons. */
  protected navClass(id: string): string {
    return this.isSelected(id) ? 'bg-primary/10 text-primary' : 'text-base-content/70 hover:bg-base-200/60';
  }

  public readonly section = input<string>();

  constructor() {
    this.sectionStates = this.sections.map((section) => this.buildSectionState(section));

    // Navbar crumb ("Settings"/"Workspace") comes from the route's `data.breadcrumb`
    // via BreadcrumbDefaultsService — no manual publish needed here anymore.

    effect(() => {
      const s = this.section();
      if (s) {
        this.selectedSectionId.set(s);
      } else {
        this.selectedSectionId.set('organization');
      }
    });

    effect(() => {
      const snapshot = this.snapshotSignal();
      this.applySnapshot(snapshot, false);
    });

    effect(() => {
      const snapshot = this.snapshotSignal();
      const verifiedEmails = (snapshot['communications.verified_emails'] as string[]) || [];

      const commsSection = this.sections.find((s) => s.id === 'communications');
      if (commsSection) {
        const fromEmailField = commsSection.fields.find((f) => f.key === 'communications.default_from_email');
        const replyToField = commsSection.fields.find((f) => f.key === 'communications.reply_to');

        // Reply-to only has to be an address the tenant proved it controls — nothing is sent from
        // it — so every verified address qualifies. A Gmail address is a perfectly good reply-to.
        const replyToOptions = [
          { label: 'Select a verified email', value: '' },
          ...verifiedEmails.map((email) => ({ label: email, value: email })),
        ];

        // The From list is narrower, and deliberately mirrors what the server will accept:
        // bulk mail needs DMARC alignment, which is a property of the DOMAIN. Offering a verified
        // Gmail here would be offering a choice that saves and then fails at send time.
        const fromOptions = [
          { label: 'Select a sending address', value: '' },
          ...this.sendableFromAddresses().map((email) => ({ label: email, value: email })),
        ];
        const platform = this.platformFromEmail();
        if (platform) {
          fromOptions.push({ label: `${platform} (your pplCRM address)`, value: platform });
        }

        if (fromEmailField) {
          fromEmailField.options = fromOptions;
        }
        if (replyToField) {
          replyToField.options = replyToOptions;
        }
      }
    });
  }

  /** This workspace's address on pplCRM's own sending domain; null when the option is off. */
  protected readonly platformFromEmail = computed<string | null>(() => {
    const value = this.snapshotSignal()['communications.platform_from_email'];
    return typeof value === 'string' && value ? value : null;
  });

  /**
   * Verified addresses that can actually carry bulk mail: the ones whose domain is DKIM-verified.
   * Single-address verification proves ownership but not deliverability, because DMARC aligns on
   * the domain.
   */
  protected readonly sendableFromAddresses = computed<string[]>(() => {
    const snapshot = this.snapshotSignal();
    const emails = (snapshot['communications.verified_emails'] as string[]) || [];
    const domains = (snapshot['communications.verified_domains'] as { domain?: string; status?: string }[]) || [];
    const verified = new Set(
      domains.filter((d) => d.status === 'verified' && d.domain).map((d) => String(d.domain).toLowerCase()),
    );
    return emails.filter((email) => verified.has(email.toLowerCase().split('@')[1] ?? ''));
  });

  /** Live value of the From field (the edited payload, not the saved snapshot) so the explainer
   * below reacts as the user changes the picker rather than only after a save. */
  protected readonly currentFromEmail = computed<string>(() => {
    const comms = this.sectionStates.find((s) => s.config.id === 'communications');
    const value = comms?.payload()['communications.default_from_email'];
    return typeof value === 'string' ? value : '';
  });

  /** Live value of Reply-to, for the same reason. */
  protected readonly currentReplyTo = computed<string>(() => {
    const comms = this.sectionStates.find((s) => s.config.id === 'communications');
    const value = comms?.payload()['communications.reply_to'];
    return typeof value === 'string' ? value : '';
  });

  /** True when the chosen From address is the pplCRM one, which makes Reply-to load-bearing. */
  protected readonly usingPlatformFrom = computed<boolean>(() => {
    const platform = this.platformFromEmail();
    return !!platform && this.currentFromEmail() === platform;
  });

  /** The send guard refuses this combination, so say so at the point of choice rather than
   * letting the user discover it when a finished newsletter refuses to go out. */
  protected readonly platformFromNeedsReplyTo = computed<boolean>(
    () => this.usingPlatformFrom() && !this.currentReplyTo().trim(),
  );

  /** Verified addresses the tenant could not use as a From address, with the reason. Shown so a
   * missing option is explained rather than silently absent (disclosure over suppression). */
  protected readonly unusableFromAddresses = computed<string[]>(() => {
    const sendable = new Set(this.sendableFromAddresses());
    const emails = (this.snapshotSignal()['communications.verified_emails'] as string[]) || [];
    return emails.filter((email) => !sendable.has(email));
  });

  protected get visibleSections(): SectionState[] {
    return this.sectionStates;
  }

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    await this.settingsSvc.load();
    this.hasLoaded.set(true);
    this.applySnapshot(this.settingsSvc.snapshot(), true);
    await this.loadLastFingerprintRecomputeTime();
  }

  // Working-days chips, rendered Mon→Sun; stored canonically in this order as a comma-joined string.
  protected readonly dayChips: ReadonlyArray<{ value: number; label: string }> = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 0, label: 'Sun' },
  ];

  private parseDays(raw: unknown): Set<number> {
    return new Set(
      String(raw ?? '')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n)),
    );
  }

  protected isDaySelected(section: SectionState, controlName: string, day: number): boolean {
    return this.parseDays(section.payload()[controlName]).has(day);
  }

  protected toggleDay(section: SectionState, controlName: string, day: number): void {
    const days = this.parseDays(section.payload()[controlName]);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    const ordered = this.dayChips
      .map((c) => c.value)
      .filter((d) => days.has(d))
      .join(',');
    section.payload.update((p) => ({ ...p, [controlName]: ordered }));
    section.form[controlName]().markAsDirty();
  }

  protected isEmailVerified(email: string | null | undefined): boolean {
    if (!email) return false;
    const verified = this.settingsSvc.getValue<string[]>('communications.verified_emails') || [];
    return verified.includes(email.toLowerCase().trim());
  }

  protected isSaving(section: SectionState) {
    return this.savingSectionId() === section.config.id;
  }

  protected isSectionDirty(section: SectionState) {
    return section.form().dirty();
  }

  protected isSectionInvalid(section: SectionState) {
    return section.form().invalid();
  }

  protected isSelected(sectionId: string) {
    return this.selectedSectionId() === sectionId;
  }

  protected isVerifyCooldown(email: string | null | undefined): boolean {
    if (!email) return false;
    const lastTime = this.lastVerificationTimes()[email.toLowerCase().trim()];
    if (!lastTime) return false;
    return Date.now() - lastTime < 60000;
  }

  protected async loadLastFingerprintRecomputeTime() {
    try {
      const res = await this.householdsSvc.getLastFingerprintRecomputation();
      if (res && res.lastRunAt) {
        this.lastFingerprintRecomputeTime.set(new Date(res.lastRunAt));
      } else {
        this.lastFingerprintRecomputeTime.set(null);
      }
    } catch (err) {
      console.error('Failed to load last fingerprint recompute time', err);
    }
  }

  protected async recomputeAddressFingerprints() {
    if (this.isFingerprintRecomputeCooldown()) {
      this.alerts.showError('Fingerprints can only be recomputed once a month.');
      return;
    }

    this.recomputingFingerprints.set(true);
    try {
      await this.householdsSvc.recomputeAddressFingerprints();
      this.alerts.showSuccess('Background job queued to recompute address fingerprints.');
      await this.loadLastFingerprintRecomputeTime();
    } catch (err) {
      this.alerts.showError(
        err instanceof Error && err.message ? err.message : 'Failed to trigger address fingerprint recomputation.',
      );
    } finally {
      this.recomputingFingerprints.set(false);
    }
  }

  protected resetSection(section: SectionState) {
    this.applySnapshot(this.settingsSvc.snapshot(), true, section);
  }

  protected async saveSection(section: SectionState) {
    if (!section.form().dirty()) return;

    const entries: SettingsEntryType[] = [];
    for (const field of section.fields) {
      const fieldSignal = (section.form as any)[field.controlName]();
      if (!fieldSignal.dirty()) continue;

      const value = this.prepareOutgoingValue(field.config, fieldSignal.value());
      entries.push({ key: field.config.key, value });
    }

    this.savingSectionId.set(section.config.id);
    try {
      if (entries.length > 0) {
        const snapshot = await this.settingsSvc.upsert(entries);
        this.applySnapshot(snapshot ?? this.settingsSvc.snapshot(), true, section);
      }

      this.alerts.showSuccess('Settings updated successfully');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Failed to save settings';
      this.alerts.showError(message);
    } finally {
      this.savingSectionId.set(null);
    }
  }

  protected selectSection(sectionId: string) {
    // Preserve query params: several of these hops are the go-live wizard sending the user from
    // one settings section to another (Domains → Billing → Communications), and dropping `?setup`
    // would strand them by removing the way back.
    void this.router.navigate(['/', this.currentMode, sectionId], { queryParamsHandling: 'preserve' });
  }

  protected async verifySenderEmail(email: string | null | undefined) {
    if (!email) return;
    const normalized = email.toLowerCase().trim();

    if (this.isVerifyCooldown(normalized)) {
      this.alerts.showError('Please wait at least one minute before requesting verification again.');
      return;
    }

    this.verifyingEmail.set(normalized);

    try {
      await this.settingsSvc.requestEmailVerification(normalized);
      this.lastVerificationTimes.update((prev) => ({
        ...prev,
        [normalized]: Date.now(),
      }));
      this.startEmailCooldown(normalized);
      this.lastRequestedEmail.set(normalized);
      // Clear only after success — on failure the user keeps their input to retry.
      this.senderEmailInput.set('');
      this.alerts.showSuccess(
        `Verification email sent to ${email}. Please check your inbox (and spam folder) and click the verification link.`,
      );
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to send verification email.');
    } finally {
      this.verifyingEmail.set(null);
    }
  }

  private applySnapshot(snapshot: TenantSettingsSnapshot, resetDirty: boolean, target?: SectionState) {
    const sections = target ? [target] : this.sectionStates;

    for (const state of sections) {
      const nextPayload = { ...state.payload() };
      let changed = false;

      for (const field of state.fields) {
        const fieldSignal = (state.form as any)[field.controlName]();
        if (!resetDirty && fieldSignal.dirty()) continue;

        const incoming = this.normalizeIncomingValue(field.config, snapshot[field.config.key]);
        if (nextPayload[field.controlName] !== incoming) {
          nextPayload[field.controlName] = incoming;
          changed = true;
        }
      }

      if (changed) {
        state.payload.set(nextPayload);
      }

      if (resetDirty) {
        state.form().reset();
      }
    }
  }

  private buildSectionState(section: SettingsSectionConfig): SectionState {
    const initialPayload: Record<string, any> = {};
    const fieldStates: SectionFieldState[] = [];

    for (const field of section.fields) {
      const controlName = this.controlNameFor(field.key);
      initialPayload[controlName] = this.normalizeIncomingValue(
        field,
        this.settingsSvc.getValue(field.key, field.defaultValue),
      );
      fieldStates.push({ config: field, controlName });
    }

    const payload = signal(initialPayload);
    const formSignal = form(payload, (p) => {
      for (const field of section.fields) {
        const controlName = this.controlNameFor(field.key);
        if (field.type === 'email') {
          email(p[controlName]);
        }
        if (field.type === 'url') {
          pattern(p[controlName], /^https?:\/\//i);
        }
        if (field.key === 'communications.default_from_email' || field.key === 'communications.reply_to') {
          validate(p[controlName], (ctx) => {
            const val = ((ctx.value() as string) || '').toLowerCase().trim();
            if (!val) return null;
            const verified = this.settingsSvc.getValue<string[]>('communications.verified_emails') || [];
            if (!verified.includes(val)) {
              return { kind: 'not-verified', message: 'Email address must be verified.' };
            }
            return null;
          });
        }
      }
    });

    return { config: section, payload, form: formSignal, fields: fieldStates };
  }

  private controlNameFor(key: string) {
    return key.replace(/[^a-zA-Z0-9]+/g, '_');
  }

  private defaultForField(field: SettingsFieldConfig) {
    switch (field.type) {
      case 'toggle':
        return false;
      case 'number':
        return null;
      case 'select':
        return field.options?.[0]?.value ?? '';
      default:
        return '';
    }
  }

  private normalizeIncomingValue(field: SettingsFieldConfig, raw: unknown) {
    const fallback = field.defaultValue ?? this.defaultForField(field);

    switch (field.type) {
      case 'toggle':
        return Boolean(raw ?? fallback ?? false);
      case 'number': {
        if (raw === null || raw === undefined || raw === '') return fallback ?? null;
        const numeric = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(numeric) ? numeric : (fallback ?? null);
      }
      case 'select': {
        const options = field.options ?? [];
        const candidate = raw === undefined || raw === null ? fallback : String(raw);
        const match = options.find((option) => option.value === candidate);
        if (match) return match.value;
        return (fallback ?? options[0]?.value ?? '') as string;
      }
      case 'date':
        return typeof raw === 'string' && raw.length ? raw : ((fallback as string) ?? '');
      case 'day-toggles':
        // Stored/consumed by the backend as a comma-separated day-number string (e.g. "1,2,3,4,5").
        return raw === undefined || raw === null ? ((fallback as string) ?? '') : String(raw);
      case 'email':
      case 'tel':
      case 'password':
      case 'url':
      case 'text':
        return raw === undefined || raw === null ? ((fallback as string) ?? '') : String(raw);
      case 'textarea':
        return raw === undefined || raw === null ? ((fallback as string) ?? '') : String(raw);
      default:
        return raw ?? fallback ?? '';
    }
  }

  private prepareOutgoingValue(field: SettingsFieldConfig, value: unknown) {
    switch (field.type) {
      case 'toggle':
        return Boolean(value);
      case 'number': {
        if (value === '' || value === null || value === undefined) return null;
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      }
      case 'select': {
        const candidate = value === null || value === undefined ? '' : String(value);
        const options = field.options ?? [];
        const match = options.find((option) => option.value === candidate);
        return match ? match.value : this.defaultForField(field);
      }
      case 'date':
        return typeof value === 'string' ? value : value ? String(value) : '';
      case 'day-toggles':
        return value === null || value === undefined ? '' : String(value);
      case 'textarea':
      case 'text':
      case 'email':
      case 'tel':
      case 'password':
      case 'url':
        return value === null || value === undefined ? '' : String(value);
      default:
        return value ?? '';
    }
  }

  private startEmailCooldown(email: string) {
    this.emailCooldownSeconds.update((prev) => ({ ...prev, [email]: 60 }));
    const interval = setInterval(() => {
      const current = this.emailCooldownSeconds()[email] || 0;
      if (current <= 1) {
        clearInterval(interval);
        this.emailCooldownSeconds.update((prev) => {
          const next = { ...prev };
          delete next[email];
          return next;
        });
      } else {
        this.emailCooldownSeconds.update((prev) => ({ ...prev, [email]: current - 1 }));
      }
    }, 1000);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
