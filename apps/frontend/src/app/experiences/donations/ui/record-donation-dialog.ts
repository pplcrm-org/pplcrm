import { Component, inject, output, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { DONATION_METHODS, DONATION_METHOD_LABELS, type DonationMethod } from '../../../../../../../libs/common/src';
import { DonationsService } from '../../../services/api/donations-service';
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

  // Donor mailing address — required (no gift without an address; receipts must print one).
  // Prefilled from the donor's household when the search row carries it; staff can edit.
  protected readonly street = signal('');
  protected readonly apt = signal('');
  protected readonly city = signal('');
  protected readonly province = signal('');
  protected readonly postal = signal('');
  protected readonly country = signal('Canada');
  protected readonly touchedAddress = signal(false);

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
    this.dlgRef().show();
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

    this.submitting.set(true);
    const end = this._loading.begin();
    try {
      await this.donationsSvc.recordDonation({
        personId: donor.id,
        amountCents: Math.round(amt * 100),
        method: this.method(),
        address: {
          street: this.street().trim(),
          apt: this.apt().trim() || null,
          city: this.city().trim(),
          state: this.province().trim(),
          zip: this.postal().trim(),
          country: this.country().trim(),
        },
      });
      this.alertSvc.showSuccess(`Saved. $${amt.toFixed(2)} from ${this.donorName(donor)} recorded`);
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
    this.submitting.set(false);
    this.street.set('');
    this.apt.set('');
    this.city.set('');
    this.province.set('');
    this.postal.set('');
    this.country.set('Canada');
    this.touchedAddress.set(false);
  }
}
