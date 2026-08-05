import { Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';
import {
  DONATION_METHODS,
  DONATION_METHOD_LABELS,
  STRIPE_CONNECT_COUNTRIES,
  type DonationMethod,
} from '../../../../../../../libs/common/src';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { DonationsService } from '../../../services/api/donations-service';
import { WorkspaceCurrencyService } from '../../../shared/services/currency.service';
import { PersonsService } from '../../persons/services/persons-service';

type DonorSearchResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  /** Household address fields when the search row carries them — prefills the address block. */
  street_num?: string | null;
  street1?: string | null;
  apt?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
};

/**
 * Today in the viewer's own timezone, as "YYYY-MM-DD". Built from the local calendar parts rather
 * than `toISOString()`, which returns the UTC day and would call a gift entered at 9pm in Toronto
 * tomorrow's.
 */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Fig. 15 "Record donation" dialog — records an offline gift (cash, check, bank transfer, or a
 * card payment taken outside Stripe checkout) against a donor. Distinct from the "Collect
 * donation" flow on the person page, which redirects to Stripe Checkout for a real card charge.
 */
@Component({
  selector: 'pc-record-donation-dialog',
  imports: [Icon, FormField, ModalShell],
  templateUrl: './record-donation-dialog.html',
})
export class RecordDonationDialog {
  private readonly donationsSvc = inject(DonationsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly alertSvc = inject(AlertService);
  private readonly context = inject(CampaignContextService);
  private readonly money = inject(WorkspaceCurrencyService);

  /**
   * Campaigns §15 — a manually recorded gift joins the fund the recorder is working in, the same
   * way every other record they create does. Named in the dialog so it is never a surprise.
   */
  protected readonly fundName = computed(() => this.context.activeCampaign()?.name ?? 'the office fund');

  private readonly dlgRef = viewChild.required<ModalShell>('dlg');
  private readonly _loading = createLoadingGate();

  public readonly saved = output<void>();

  protected readonly methods = DONATION_METHODS;
  protected readonly methodLabels = DONATION_METHOD_LABELS;

  protected readonly donorSearch = signal('');
  protected readonly donorResults = signal<DonorSearchResult[]>([]);
  protected readonly selectedDonor = signal<DonorSearchResult | null>(null);
  protected readonly isSearching = signal(false);
  protected readonly touchedDonor = signal(false);

  protected readonly amount = signal<number | null>(null);
  /** Signal form over the amount — required, and at least one cent (mirrors the input's min/step). */
  protected readonly amountForm = form(this.amount, (a) => {
    required(a);
    min(a, 0.01);
  });

  protected readonly method = signal<DonationMethod>('card');
  protected readonly submitting = signal(false);
  protected readonly isLoading = this._loading.visible;

  /**
   * The day the money was received, not the day it was typed in. A cheque dropped off on
   * December 31st and entered in January belongs to December's tax year on the receipt, so the
   * field defaults to today and accepts any earlier date.
   */
  protected readonly giftDate = signal(todayIso());
  /** Recomputed each time the dialog opens, so a tab left open overnight still refuses tomorrow. */
  protected readonly latestGiftDate = signal(todayIso());

  protected readonly giftDateError = computed<string | null>(() => {
    const value = this.giftDate().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter the date this gift was received, as YYYY-MM-DD.';
    if (value > this.latestGiftDate()) return 'A gift cannot be dated in the future. Use today or an earlier date.';
    return null;
  });

  // Donor mailing address — required (no gift without an address; receipts must print one).
  // Prefilled from the donor's household when the search row carries it; staff can edit.
  protected readonly street = signal('');
  protected readonly apt = signal('');
  protected readonly city = signal('');
  protected readonly province = signal('');
  protected readonly postal = signal('');
  protected readonly country = signal('');
  protected readonly touchedAddress = signal(false);

  /**
   * The workspace's own country, resolved once from the residency context and reused on every
   * later open. It replaces a hardcoded "Canada" that was wrong for every other workspace, and it
   * only fills the field while that field is still blank — the donor's own address always wins.
   * Left blank when the workspace has no country recorded, so staff type it rather than be handed
   * a country the receipt would then print.
   */
  private readonly workspaceCountry = signal('');

  protected readonly addressInvalid = (): boolean =>
    this.touchedAddress() &&
    !(
      this.street().trim() &&
      this.city().trim() &&
      this.province().trim() &&
      this.postal().trim() &&
      this.country().trim()
    );

  private addressComplete(): boolean {
    return Boolean(
      this.street().trim() &&
      this.city().trim() &&
      this.province().trim() &&
      this.postal().trim() &&
      this.country().trim(),
    );
  }

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly donorInvalid = () => this.touchedDonor() && !this.selectedDonor();
  protected readonly amountInvalid = () => this.amountForm().invalid() && this.amountForm().touched();
  public open(): void {
    this.resetForm();
    void this.context.ensureLoaded();
    void this.applyWorkspaceCountry();
    this.dlgRef().show();
  }

  /** Seeds the country field from the workspace's own country; see {@link workspaceCountry}. */
  private async applyWorkspaceCountry(): Promise<void> {
    if (!this.workspaceCountry()) {
      try {
        const ctx = await this.donationsSvc.getResidencyContext();
        const code = (ctx.country ?? '').trim().toUpperCase();
        this.workspaceCountry.set(STRIPE_CONNECT_COUNTRIES.find((c) => c.code === code)?.name ?? '');
      } catch {
        // Leave it blank — an unreachable setting is no reason to guess a country onto a receipt.
        return;
      }
    }
    const name = this.workspaceCountry();
    if (name && !this.country().trim()) this.country.set(name);
  }

  public close(): void {
    this.dlgRef().close();
  }

  protected initials(p: DonorSearchResult): string {
    return `${(p.first_name ?? '').charAt(0)}${(p.last_name ?? '').charAt(0)}`.toUpperCase() || '?';
  }

  protected onDonorSearchChange(value: string): void {
    this.donorSearch.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.donorResults.set([]);
      return;
    }
    this.isSearching.set(true);
    this.searchTimer = setTimeout(() => void this.executeSearch(value), 250);
  }

  private async executeSearch(value: string): Promise<void> {
    try {
      const result = await this.personsSvc.getAllWithAddress({ searchStr: value, startRow: 0, endRow: 10 });
      const rows = (result as { rows?: unknown[] })?.rows ?? [];
      this.donorResults.set(
        rows.map((raw) => {
          const p = raw as DonorSearchResult & { id: string };
          return {
            id: String(p.id),
            first_name: p.first_name,
            last_name: p.last_name,
            email: p.email,
            street_num: p.street_num,
            street1: p.street1,
            apt: p.apt,
            city: p.city,
            state: p.state,
            zip: p.zip,
            country: p.country,
          };
        }),
      );
    } catch {
      this.donorResults.set([]);
    } finally {
      this.isSearching.set(false);
    }
  }

  protected selectDonor(p: DonorSearchResult): void {
    this.selectedDonor.set(p);
    this.donorSearch.set('');
    this.donorResults.set([]);
    // Prefill the mailing address from the donor's household; leave staff edits alone otherwise.
    const streetLine = [p.street_num, p.street1].filter(Boolean).join(' ');
    if (streetLine) this.street.set(streetLine);
    if (p.apt) this.apt.set(p.apt);
    if (p.city) this.city.set(p.city);
    if (p.state) this.province.set(p.state);
    if (p.zip) this.postal.set(p.zip);
    if (p.country) this.country.set(p.country);
  }

  protected clearDonor(): void {
    this.selectedDonor.set(null);
    this.donorSearch.set('');
    this.donorResults.set([]);
  }

  protected donorName(p: DonorSearchResult): string {
    return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || 'this donor';
  }

  protected async submit(): Promise<void> {
    this.touchedDonor.set(true);
    this.touchedAddress.set(true);
    this.amountForm().markAsTouched();
    const donor = this.selectedDonor();
    const amt = this.amount();
    if (!donor || amt === null || amt <= 0 || this.amountForm().invalid() || !this.addressComplete()) return;
    // Refused here as well as on the server so the recorder is told before the round-trip.
    if (this.giftDateError()) return;

    this.submitting.set(true);
    const end = this._loading.begin();
    const campaignId = this.context.activeCampaignId();
    try {
      await this.donationsSvc.recordDonation({
        personId: donor.id,
        amountCents: Math.round(amt * 100),
        method: this.method(),
        // Omitted when no context has loaded — the backend then files the gift under the office.
        ...(campaignId ? { campaign_id: campaignId } : {}),
        gift_date: this.giftDate().trim(),
        address: {
          street: this.street().trim(),
          apt: this.apt().trim() || null,
          city: this.city().trim(),
          state: this.province().trim(),
          zip: this.postal().trim(),
          country: this.country().trim(),
        },
      });
      this.alertSvc.showSuccess(`Saved. ${this.money.formatUnits(amt)} from ${this.donorName(donor)} recorded`);
      this.saved.emit();
      this.close();
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Failed to record donation');
    } finally {
      this.submitting.set(false);
      end();
    }
  }

  /** Applies a method choice from the select, narrowing the raw DOM string to DonationMethod. */
  protected setMethod(value: string): void {
    const match = this.methods.find((m) => m === value);
    if (match) this.method.set(match);
  }

  private resetForm(): void {
    this.donorSearch.set('');
    this.donorResults.set([]);
    this.selectedDonor.set(null);
    this.touchedDonor.set(false);
    this.amount.set(null);
    this.amountForm().reset();
    this.method.set('card');
    this.latestGiftDate.set(todayIso());
    this.giftDate.set(todayIso());
    this.submitting.set(false);
    this.street.set('');
    this.apt.set('');
    this.city.set('');
    this.province.set('');
    this.postal.set('');
    this.country.set(this.workspaceCountry());
    this.touchedAddress.set(false);
  }
}
