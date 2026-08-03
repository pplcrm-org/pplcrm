import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormField, form, max, min } from '@angular/forms/signals';
import { ActivatedRoute } from '@angular/router';
import {
  CA_PROVINCES,
  RECEIPT_REGIMES,
  RECEIPT_REGIME_IDS,
  STRIPE_CONNECT_COUNTRIES,
  US_STATES,
  isJurisdictionId,
  receiptRegimeHintForCampaign,
  type CampaignReceiptRegimeHint,
  type ReceiptRegimeId,
  type StripeConnectCountry,
} from '@common';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { Table } from '@uxcommon/components/table/table';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { DonationReceiptsService } from '../../../services/api/donation-receipts-service';
import { DonationsService } from '../../../services/api/donations-service';
import { TokenService } from '../../../services/api/token-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { FilesService } from '../../files/services/files.service';
import { SettingsService } from '../services/settings-service';

/** Where donations are processed and payment data stored, derived from the Stripe Connect state. */
export interface ProcessingNotice {
  heading: string;
  body: string;
}

export interface ResidencyContext {
  country: string | null;
  residencyAcknowledged: boolean;
}

/** Mirror of the backend's `donations.getStripeConnectStatus` result. */
export interface StripeConnectStatus {
  connected: boolean;
  accountId: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  requirementsDue: string[];
  isMockMode: boolean;
}

export interface TaxCreditTier {
  limit: number;
  rate: number;
}

export interface DonationPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  limit_amount: number;
  is_active: boolean;
}

@Component({
  selector: 'pc-donations-settings',
  imports: [FormField, Icon, Table, StatusBadge],
  templateUrl: './donations-settings.html',
  styleUrl: './donations-settings.css',
})
export class DonationsSettingsComponent implements OnInit {
  private readonly settingsSvc = inject(SettingsService);
  private readonly alerts = inject(AlertService);
  private readonly tokenSvc = inject(TokenService);
  private readonly donationsSvc = inject(DonationsService);
  private readonly receiptsSvc = inject(DonationReceiptsService);
  private readonly filesSvc = inject(FilesService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly route = inject(ActivatedRoute);
  /** Supplies the active campaign's declared office, which drives the receipting hint below. */
  private readonly campaignCtx = inject(CampaignContextService);

  private readonly _loading = createLoadingGate();

  // Stripe Connect: no tenant-held keys — the tenant onboards on Stripe and we track status only.
  protected readonly stripeStatus = signal<StripeConnectStatus | null>(null);
  protected readonly isConnectingStripe = signal(false);
  protected readonly isOpeningStripeDashboard = signal(false);
  protected readonly stripeConnectCountries = STRIPE_CONNECT_COUNTRIES;
  protected readonly stripeCountry = signal<StripeConnectCountry>('US');

  // "Configured" reflects what is actually persisted: a connected account exists (mock mode
  // doesn't count).
  protected readonly stripeConfigured = computed(() => {
    const status = this.stripeStatus();
    return !!status?.connected && !status.isMockMode;
  });

  // Residency gate: donations stay paused until the tenant confirms residency restrictions once.
  protected readonly residencyAcknowledged = signal(false);
  protected readonly residencyContext = signal<ResidencyContext | null>(null);

  protected readonly donationLimit = signal(1000);
  protected readonly restrictResidency = signal(false);
  protected readonly taxCreditTiers = signal<TaxCreditTier[]>([]);

  // ── Receipts (CRA charitable / Canadian political regimes) ──────────────────
  protected readonly receiptRegimes = RECEIPT_REGIME_IDS.map((id) => RECEIPT_REGIMES[id]);
  protected readonly receiptRegime = signal<'' | ReceiptRegimeId>('');
  protected readonly receiptOrgName = signal('');
  protected readonly receiptOrgAddress = signal('');
  protected readonly receiptRegNumber = signal('');
  protected readonly receiptSignatoryName = signal('');
  protected readonly receiptSignatoryTitle = signal('');
  protected readonly receiptSignatureFileId = signal('');
  protected readonly receiptNumberPrefix = signal('R');
  protected readonly receiptPlaceOfIssue = signal('');
  protected readonly receiptAgentName = signal('');
  protected readonly receiptElectoralDistrict = signal('');
  protected readonly receiptPollingDay = signal('');
  protected readonly uploadingSignature = signal(false);
  protected readonly previewingReceipt = signal(false);

  /** The chosen regime's data file — drives which fields show and the counsel caveat. */
  protected readonly regimeSpec = computed(() => {
    const id = this.receiptRegime();
    return id ? RECEIPT_REGIMES[id] : null;
  });
  protected readonly regimeIsExternal = computed(() => this.regimeSpec()?.issuance === 'external');

  /**
   * What the active campaign's declared office can say about receipting. A hint shown beside the
   * picker, never a value put into it.
   *
   * The regime is a statement about how the ORGANIZATION is registered, not about which seat it
   * contests: a Toronto campaign's gifts might be receipted by a registered provincial constituency
   * association, by a federal riding association, or not by this workspace at all. Selecting one on
   * the workspace's behalf would print wrong legal wording on a tax document, and it would do it
   * silently, because a pre-selected field looks answered.
   *
   * Null means the campaign's office says nothing useful (a province with no regime modelled, a
   * municipal race, or no campaign jurisdiction declared), and nothing is shown.
   */
  protected readonly receiptRegimeHint = computed<CampaignReceiptRegimeHint | null>(() => {
    const campaign = this.campaignCtx.activeCampaign();
    const jurisdiction = campaign?.jurisdiction;
    if (!isJurisdictionId(jurisdiction)) return null;
    return receiptRegimeHintForCampaign(jurisdiction, campaign?.office_region ?? null);
  });

  /** The suggested regime's own label, for naming it in the hint. Null unless one is suggested. */
  protected readonly suggestedRegimeLabel = computed<string | null>(() => {
    const hint = this.receiptRegimeHint();
    return hint?.kind === 'suggested' ? RECEIPT_REGIMES[hint.regime].label : null;
  });

  // Donation periods
  protected readonly donationPeriods = signal<DonationPeriod[]>([]);
  protected readonly showAddPeriod = signal(false);
  protected readonly newPeriodName = signal('');
  protected readonly newPeriodStartDate = signal('');
  protected readonly newPeriodEndDate = signal('');
  protected readonly newPeriodLimit = signal<number | null>(1000);
  /** Binds the period-limit number input; native number parsing yields null when cleared. */
  protected readonly newPeriodLimitForm = form(this.newPeriodLimit, (p) => {
    min(p, 1);
  });
  protected readonly isSavingPeriod = signal(false);

  // New multi-country autocomplete & states checkboxes
  protected readonly selectedCountries = signal<string[]>([]);
  protected readonly selectedRegions = signal<string[]>([]);

  protected readonly countrySearch = signal('');
  protected readonly showCountryDropdown = signal(false);

  protected readonly allCountries = [
    { code: 'CA', name: 'Canada' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'AU', name: 'Australia' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'FR', name: 'France' },
    { code: 'DE', name: 'Germany' },
    { code: 'IN', name: 'India' },
    { code: 'IT', name: 'Italy' },
    { code: 'ES', name: 'Spain' },
    { code: 'NL', name: 'Netherlands' },
  ];

  /**
   * Canadian provinces and US states now come from the shared jurisdictions module, which is also
   * what the campaign office picker reads. They used to be two private arrays here, and this page
   * was the only place in the repository that held them; a campaign in Alberta and a donation
   * residency rule for Alberta must agree on the code and the name, so there is one list.
   *
   * The country list and the German, French and Indian region lists below are deliberately NOT
   * shared. Donation residency accepts money from many more countries than pplCRM models elections
   * in, so those lists belong to this page alone.
   */
  protected readonly canadaProvinces = CA_PROVINCES;
  protected readonly usStates = US_STATES;

  protected readonly germanyStates = [
    { code: 'DE-BW', name: 'Baden-Württemberg' },
    { code: 'DE-BY', name: 'Bavaria' },
    { code: 'DE-BE', name: 'Berlin' },
    { code: 'DE-BB', name: 'Brandenburg' },
    { code: 'DE-HB', name: 'Bremen' },
    { code: 'DE-HH', name: 'Hamburg' },
    { code: 'DE-HE', name: 'Hesse' },
    { code: 'DE-MV', name: 'Mecklenburg-Vorpommern' },
    { code: 'DE-NI', name: 'Lower Saxony' },
    { code: 'DE-NW', name: 'North Rhine-Westphalia' },
    { code: 'DE-RP', name: 'Rhineland-Palatinate' },
    { code: 'DE-SL', name: 'Saarland' },
    { code: 'DE-SN', name: 'Saxony' },
    { code: 'DE-ST', name: 'Saxony-Anhalt' },
    { code: 'DE-SH', name: 'Schleswig-Holstein' },
    { code: 'DE-TH', name: 'Thuringia' },
  ];

  protected readonly franceRegions = [
    { code: 'FR-ARA', name: 'Auvergne-Rhône-Alpes' },
    { code: 'FR-BFC', name: 'Bourgogne-Franche-Comté' },
    { code: 'FR-BRE', name: 'Brittany' },
    { code: 'FR-CVL', name: 'Centre-Val de Loire' },
    { code: 'FR-COR', name: 'Corsica' },
    { code: 'FR-GES', name: 'Grand Est' },
    { code: 'FR-HDF', name: 'Hauts-de-France' },
    { code: 'FR-IDF', name: 'Île-de-France' },
    { code: 'FR-NOR', name: 'Normandy' },
    { code: 'FR-NAQ', name: 'Nouvelle-Aquitaine' },
    { code: 'FR-OCC', name: 'Occitania' },
    { code: 'FR-PDL', name: 'Pays de la Loire' },
    { code: 'FR-PAC', name: "Provence-Alpes-Côte d'Azur" },
  ];

  protected readonly indiaStates = [
    { code: 'IN-AP', name: 'Andhra Pradesh' },
    { code: 'IN-AR', name: 'Arunachal Pradesh' },
    { code: 'IN-AS', name: 'Assam' },
    { code: 'IN-BR', name: 'Bihar' },
    { code: 'IN-CG', name: 'Chhattisgarh' },
    { code: 'IN-GA', name: 'Goa' },
    { code: 'IN-GJ', name: 'Gujarat' },
    { code: 'IN-HR', name: 'Haryana' },
    { code: 'IN-HP', name: 'Himachal Pradesh' },
    { code: 'IN-JH', name: 'Jharkhand' },
    { code: 'IN-KA', name: 'Karnataka' },
    { code: 'IN-KL', name: 'Kerala' },
    { code: 'IN-MP', name: 'Madhya Pradesh' },
    { code: 'IN-MH', name: 'Maharashtra' },
    { code: 'IN-MN', name: 'Manipur' },
    { code: 'IN-ML', name: 'Meghalaya' },
    { code: 'IN-MZ', name: 'Mizoram' },
    { code: 'IN-NL', name: 'Nagaland' },
    { code: 'IN-OD', name: 'Odisha' },
    { code: 'IN-PB', name: 'Punjab' },
    { code: 'IN-RJ', name: 'Rajasthan' },
    { code: 'IN-SK', name: 'Sikkim' },
    { code: 'IN-TN', name: 'Tamil Nadu' },
    { code: 'IN-TG', name: 'Telangana' },
    { code: 'IN-TR', name: 'Tripura' },
    { code: 'IN-UP', name: 'Uttar Pradesh' },
    { code: 'IN-UT', name: 'Uttarakhand' },
    { code: 'IN-WB', name: 'West Bengal' },
    { code: 'IN-DL', name: 'Delhi (UT)' },
    { code: 'IN-JK', name: 'Jammu and Kashmir (UT)' },
    { code: 'IN-LA', name: 'Ladakh (UT)' },
    { code: 'IN-PY', name: 'Puducherry (UT)' },
  ];

  // Tiers editing inputs
  protected readonly newLimit = signal<number | null>(null);
  protected readonly newLimitForm = form(this.newLimit, (p) => {
    min(p, 1);
  });
  protected readonly newRate = signal<number | null>(null);
  protected readonly newRateForm = form(this.newRate, (p) => {
    min(p, 0);
    max(p, 100);
  });

  protected readonly isSaving = signal(false);

  protected readonly tenantId = computed(() => {
    const token = this.tokenSvc.getAuthToken();
    if (!token) return '';
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]!));
        return String(payload.tenant_id || '');
      }
    } catch (e) {
      console.error('Failed to parse auth token payload', e);
    }
    return '';
  });

  protected readonly availableCountriesToSelect = computed(() => {
    const search = this.countrySearch().toLowerCase().trim();
    const selected = new Set(this.selectedCountries());
    return this.allCountries.filter(
      (c) => !selected.has(c.code) && (c.name.toLowerCase().includes(search) || c.code.toLowerCase().includes(search)),
    );
  });

  // Where donations are processed and where donor payment data is stored — driven by whether the
  // tenant's Stripe account is actually connected.
  protected readonly processingNotice = computed<ProcessingNotice>(() => {
    if (this.stripeConfigured()) {
      return {
        heading: 'Donations are processed in the United States',
        body: 'Donations are processed by Stripe (United States). Donor payment data is stored in the US.',
      };
    }
    return {
      heading: 'Connect Stripe to accept donations',
      body: 'Donations are processed by Stripe. Connect your Stripe account below to start accepting donations.',
    };
  });

  protected readonly isCanadaSelected = computed(() => this.selectedCountries().includes('CA'));
  protected readonly isUsaSelected = computed(() => this.selectedCountries().includes('US'));
  protected readonly isGermanySelected = computed(() => this.selectedCountries().includes('DE'));
  protected readonly isFranceSelected = computed(() => this.selectedCountries().includes('FR'));
  protected readonly isIndiaSelected = computed(() => this.selectedCountries().includes('IN'));

  // Plain-language calculation summary
  protected readonly taxCreditSummary = computed(() => {
    const sorted = [...this.taxCreditTiers()].sort((a, b) => a.limit - b.limit);
    if (sorted.length === 0) {
      return ['No tax credit tiers defined. Donations will not receive any tax credit.'];
    }

    const lines: string[] = [];
    let previousLimit = 0;

    for (let i = 0; i < sorted.length; i++) {
      const tier = sorted[i]!;
      const ratePct = Math.round(tier.rate * 100);

      if (i === 0) {
        lines.push(`${ratePct}% credit on the first $${tier.limit} donated.`);
      } else {
        const range = `$${previousLimit + 1} to $${tier.limit}`;
        lines.push(`${ratePct}% credit on the next $${tier.limit - previousLimit} donated (amounts from ${range}).`);
      }
      previousLimit = tier.limit;
    }

    lines.push(`0% credit on any amounts exceeding $${previousLimit}.`);
    return lines;
  });

  ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    // Handle the Stripe-hosted onboarding return redirect (same pattern as the mailbox connects).
    const params = this.route.snapshot.queryParamMap;
    if (params.has('stripe_connected')) {
      this.alerts.showSuccess('Stripe onboarding complete. Verifying your account status…');
    } else if (params.has('stripe_refresh')) {
      this.alerts.showError('Stripe onboarding was interrupted — resume it below when you are ready.');
    }

    // The receipting hint reads the active campaign's declared office, so the context has to be
    // loaded. A failure here costs the hint only; every setting on the page still works.
    try {
      await this.campaignCtx.ensureLoaded();
    } catch (err) {
      console.error('Failed to load campaign context for the receipting hint', err);
    }

    await this.settingsSvc.load();
    this.loadValues();
    await this.loadStripeStatus();
    await this.loadPeriods();
    await this.loadResidencyContext();
  }

  private async loadStripeStatus(): Promise<void> {
    const end = this._loading.begin();
    try {
      const status = await this.donationsSvc.getStripeConnectStatus();
      this.stripeStatus.set(status);
    } catch {
      // non-fatal — the card falls back to its "not connected" state
    } finally {
      end();
    }
  }

  private async loadResidencyContext(): Promise<void> {
    const end = this._loading.begin();
    try {
      const ctx = await this.donationsSvc.getResidencyContext();
      this.residencyContext.set(ctx);
      // Default the Connect country select to the org's country when it's one Stripe supports.
      const match = this.stripeConnectCountries.find((c) => c.code === ctx.country);
      if (match) {
        this.stripeCountry.set(match.code);
      }
    } catch {
      // non-fatal — the disclaimers simply stay in their fail-safe (shown) state
    } finally {
      end();
    }
  }

  private async loadPeriods() {
    try {
      const periods = await this.donationsSvc.getDonationPeriods();
      this.donationPeriods.set(periods as any);
    } catch {
      // non-fatal — periods table may not exist yet if migration hasn't run
    }
  }

  protected async addPeriod() {
    const name = this.newPeriodName().trim();
    const start = this.newPeriodStartDate().trim();
    const limit = Number(this.newPeriodLimit());

    if (!name) {
      this.alerts.showError('Period name is required');
      return;
    }
    if (!start) {
      this.alerts.showError('Start date is required');
      return;
    }
    if (!limit || limit <= 0) {
      this.alerts.showError('Limit amount must be greater than 0');
      return;
    }

    const endDate = this.newPeriodEndDate().trim() || null;
    if (endDate && endDate <= start) {
      this.alerts.showError('End date must be after start date');
      return;
    }

    this.isSavingPeriod.set(true);
    try {
      await this.donationsSvc.createDonationPeriod({
        name,
        start_date: start,
        end_date: endDate,
        limit_amount: limit * 100,
      });
      this.alerts.showSuccess(`Donation period "${name}" created`);
      this.newPeriodName.set('');
      this.newPeriodStartDate.set('');
      this.newPeriodEndDate.set('');
      this.newPeriodLimit.set(1000);
      this.showAddPeriod.set(false);
      await this.loadPeriods();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to create donation period');
    } finally {
      this.isSavingPeriod.set(false);
    }
  }

  protected async togglePeriodActive(period: DonationPeriod) {
    try {
      await this.donationsSvc.updateDonationPeriod({ id: period.id, is_active: !period.is_active });
      await this.loadPeriods();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to update period');
    }
  }

  protected async deletePeriod(period: DonationPeriod) {
    const confirmed = await this.dialogs.confirm({
      title: `Delete period "${period.name}"?`,
      message: 'This cannot be undone. Existing donations collected during this period will not be affected.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await this.donationsSvc.deleteDonationPeriod(period.id);
      this.alerts.showSuccess('Period deleted');
      await this.loadPeriods();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to delete period');
    }
  }

  protected formatDate(dateStr: string | null): string {
    if (!dateStr) return 'No end date';
    return new Date(dateStr).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /** Regime select change — narrow the raw DOM string to a known regime id (or none). */
  protected setReceiptRegime(value: string): void {
    this.receiptRegime.set(RECEIPT_REGIME_IDS.includes(value as ReceiptRegimeId) ? (value as ReceiptRegimeId) : '');
  }

  /** Upload the signatory's signature image; the file id is stored as a receipts.* setting. */
  protected async onSignatureSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.alerts.showError('Choose an image file (PNG or JPEG works best).');
      return;
    }
    this.uploadingSignature.set(true);
    try {
      // entityId '0': the signature belongs to workspace settings, not a record — the files
      // service tracks liveness through the receipts.signature_file_id setting itself.
      const registered = await this.filesSvc.uploadFileDirectly(file, {
        entityType: 'receipt_signature',
        entityId: '0',
      });
      this.receiptSignatureFileId.set(String(registered?.id ?? ''));
      this.alerts.showSuccess('Signature uploaded. Save the configuration to apply it.');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to upload the signature');
    } finally {
      this.uploadingSignature.set(false);
    }
  }

  protected clearSignature(): void {
    this.receiptSignatureFileId.set('');
  }

  /** Open a SPECIMEN-watermarked sample PDF rendered from the saved settings. */
  protected async previewReceipt(): Promise<void> {
    this.previewingReceipt.set(true);
    try {
      const { pdfBase64 } = await this.receiptsSvc.previewReceipt();
      const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Save the configuration first');
    } finally {
      this.previewingReceipt.set(false);
    }
  }

  protected isPeriodActive(period: DonationPeriod): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return period.is_active && period.start_date <= today && (!period.end_date || period.end_date >= today);
  }

  private loadValues() {
    this.donationLimit.set(this.settingsSvc.getValue<number>('donations.limit', 1000));
    this.restrictResidency.set(this.settingsSvc.getValue<boolean>('donations.restrict_residency', false));
    this.residencyAcknowledged.set(this.settingsSvc.getValue<boolean>('donations.residency_acknowledged', false));

    // Load countries
    const countriesStr = this.settingsSvc.getValue<string>('donations.allowed_countries', 'CA');
    const parsedCountries = countriesStr
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    this.selectedCountries.set(parsedCountries);

    // Load regions (provinces / states)
    const regionsStr = this.settingsSvc.getValue<string>('donations.allowed_regions', 'ON');
    const parsedRegions = regionsStr
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    this.selectedRegions.set(parsedRegions);

    // Receipts
    const regime = this.settingsSvc.getValue<string>('receipts.regime', '');
    this.receiptRegime.set(RECEIPT_REGIME_IDS.includes(regime as ReceiptRegimeId) ? (regime as ReceiptRegimeId) : '');
    this.receiptOrgName.set(this.settingsSvc.getValue<string>('receipts.org_legal_name', ''));
    this.receiptOrgAddress.set(this.settingsSvc.getValue<string>('receipts.org_address', ''));
    this.receiptRegNumber.set(this.settingsSvc.getValue<string>('receipts.registration_number', ''));
    this.receiptSignatoryName.set(this.settingsSvc.getValue<string>('receipts.signatory_name', ''));
    this.receiptSignatoryTitle.set(this.settingsSvc.getValue<string>('receipts.signatory_title', ''));
    this.receiptSignatureFileId.set(this.settingsSvc.getValue<string>('receipts.signature_file_id', ''));
    this.receiptNumberPrefix.set(this.settingsSvc.getValue<string>('receipts.number_prefix', 'R'));
    this.receiptPlaceOfIssue.set(this.settingsSvc.getValue<string>('receipts.place_of_issue', ''));
    this.receiptAgentName.set(this.settingsSvc.getValue<string>('receipts.agent_name', ''));
    this.receiptElectoralDistrict.set(this.settingsSvc.getValue<string>('receipts.electoral_district', ''));
    this.receiptPollingDay.set(this.settingsSvc.getValue<string>('receipts.polling_day', ''));

    // Load tax tiers
    const tiersRaw = this.settingsSvc.getValue<any>('donations.tax_credit_tiers', []);
    let parsedTiers: TaxCreditTier[] = [];
    if (typeof tiersRaw === 'string') {
      try {
        parsedTiers = JSON.parse(tiersRaw);
      } catch {
        parsedTiers = [];
      }
    } else if (Array.isArray(tiersRaw)) {
      parsedTiers = tiersRaw;
    }
    this.taxCreditTiers.set(parsedTiers.sort((a, b) => a.limit - b.limit));
  }

  protected selectCountry(country: { code: string; name: string }) {
    this.selectedCountries.update((list) => [...list, country.code]);
    this.countrySearch.set('');
    this.showCountryDropdown.set(false);
  }

  protected removeCountry(code: string) {
    this.selectedCountries.update((list) => list.filter((c) => c !== code));
    // Clean up regions for removed countries
    if (code === 'CA') {
      const provinceCodes = new Set(this.canadaProvinces.map((p) => p.code));
      this.selectedRegions.update((list) => list.filter((r) => !provinceCodes.has(r)));
    } else if (code === 'US') {
      const stateCodes = new Set(this.usStates.map((s) => s.code));
      this.selectedRegions.update((list) => list.filter((r) => !stateCodes.has(r)));
    } else if (code === 'DE') {
      const stateCodes = new Set(this.germanyStates.map((s) => s.code));
      this.selectedRegions.update((list) => list.filter((r) => !stateCodes.has(r)));
    } else if (code === 'FR') {
      const regionCodes = new Set(this.franceRegions.map((r) => r.code));
      this.selectedRegions.update((list) => list.filter((r) => !regionCodes.has(r)));
    } else if (code === 'IN') {
      const stateCodes = new Set(this.indiaStates.map((s) => s.code));
      this.selectedRegions.update((list) => list.filter((r) => !stateCodes.has(r)));
    }
  }

  protected toggleRegion(code: string) {
    this.selectedRegions.update((list) => (list.includes(code) ? list.filter((r) => r !== code) : [...list, code]));
  }

  protected getCountryName(code: string): string {
    const found = this.allCountries.find((c) => c.code === code);
    return found ? found.name : code;
  }

  protected addTier() {
    const limit = this.newLimit();
    const rateInput = this.newRate();

    if (limit === null || limit <= 0) {
      this.alerts.showError('Limit must be greater than 0');
      return;
    }
    if (rateInput === null || rateInput < 0 || rateInput > 100) {
      this.alerts.showError('Rate must be between 0% and 100%');
      return;
    }

    const rate = rateInput / 100;

    const current = this.taxCreditTiers();
    if (current.some((t) => t.limit === limit)) {
      this.alerts.showError('A tier with this limit already exists');
      return;
    }

    const updated = [...current, { limit, rate }].sort((a, b) => a.limit - b.limit);
    this.taxCreditTiers.set(updated);

    this.newLimit.set(null);
    this.newRate.set(null);
  }

  protected removeTier(index: number) {
    const updated = this.taxCreditTiers().filter((_, i) => i !== index);
    this.taxCreditTiers.set(updated);
  }

  protected reset() {
    this.loadValues();
    this.alerts.showSuccess('Settings reset to saved values');
  }

  /** Start (or resume) Stripe-hosted Connect onboarding — redirect-and-return, like the mailbox
   * connects. Stripe brings the user back to this page with ?stripe_connected / ?stripe_refresh. */
  protected async connectStripe() {
    this.isConnectingStripe.set(true);
    try {
      const { url } = await this.donationsSvc.startStripeOnboarding(this.stripeCountry());
      window.location.href = url;
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to start Stripe onboarding');
      this.isConnectingStripe.set(false);
    }
  }

  /** Open the campaign's Stripe Express dashboard (login links are single-use, so fetch fresh). */
  protected async openStripeDashboard() {
    this.isOpeningStripeDashboard.set(true);
    try {
      const { url } = await this.donationsSvc.createStripeLoginLink();
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to open the Stripe dashboard');
    } finally {
      this.isOpeningStripeDashboard.set(false);
    }
  }

  /** Forget the Stripe connection. The campaign's Stripe account itself is theirs and is not
   * deleted. */
  protected async removeStripeConfig() {
    const confirmed = await this.dialogs.confirm({
      title: 'Remove Stripe connection?',
      message:
        'Donations will stop until you reconnect Stripe. Your Stripe account is not deleted — reconnecting later starts a fresh onboarding.',
      confirmText: 'Remove connection',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await this.donationsSvc.disconnectStripe();
      await this.loadStripeStatus();
      this.alerts.showSuccess('Stripe connection removed');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to remove Stripe connection');
    }
  }

  protected async save() {
    this.isSaving.set(true);
    try {
      // Stripe holds no keys — its connection is managed by the Connect onboarding buttons, not
      // this save.
      const entries = [
        { key: 'donations.limit', value: Number(this.donationLimit()) },
        { key: 'donations.restrict_residency', value: this.restrictResidency() },
        { key: 'donations.allowed_countries', value: this.selectedCountries().join(',') },
        { key: 'donations.allowed_regions', value: this.selectedRegions().join(',') },
        { key: 'donations.tax_credit_tiers', value: JSON.stringify(this.taxCreditTiers()) },
        // Saving the residency card — restricting or allowing everyone — is the explicit choice that
        // lifts the "donations paused" gate, so record the acknowledgment alongside it.
        { key: 'donations.residency_acknowledged', value: true },
        // Receipts: issuer details are snapshotted onto each receipt at issue time, so editing
        // these never rewrites an already-issued receipt.
        { key: 'receipts.regime', value: this.receiptRegime() },
        { key: 'receipts.org_legal_name', value: this.receiptOrgName().trim() },
        { key: 'receipts.org_address', value: this.receiptOrgAddress().trim() },
        { key: 'receipts.registration_number', value: this.receiptRegNumber().trim() },
        { key: 'receipts.signatory_name', value: this.receiptSignatoryName().trim() },
        { key: 'receipts.signatory_title', value: this.receiptSignatoryTitle().trim() },
        { key: 'receipts.signature_file_id', value: this.receiptSignatureFileId() },
        { key: 'receipts.number_prefix', value: this.receiptNumberPrefix().trim() || 'R' },
        { key: 'receipts.place_of_issue', value: this.receiptPlaceOfIssue().trim() },
        { key: 'receipts.agent_name', value: this.receiptAgentName().trim() },
        { key: 'receipts.electoral_district', value: this.receiptElectoralDistrict().trim() },
        { key: 'receipts.polling_day', value: this.receiptPollingDay().trim() },
      ];

      await this.settingsSvc.upsert(entries);
      this.residencyAcknowledged.set(true);
      this.residencyContext.update((ctx) => (ctx ? { ...ctx, residencyAcknowledged: true } : ctx));
      this.alerts.showSuccess('Donations configuration saved successfully');
    } catch (err) {
      this.alerts.showError(
        err instanceof Error && err.message ? err.message : 'Failed to save donations configuration',
      );
    } finally {
      this.isSaving.set(false);
    }
  }
}
