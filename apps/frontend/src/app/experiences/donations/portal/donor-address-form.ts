import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { form, required } from '@angular/forms/signals';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Input as PcInput } from '@uxcommon/components/input/input';

import { DonorPortalAddress, DonorPortalApiService, isDeadLinkError } from './donor-portal-api';

/**
 * The donor's mailing address — the donation address shape (street/apt/city/state/zip/country),
 * deliberately NOT pc-address-form-group. This address decides whether the year-end run can issue
 * a real tax receipt, which is why the helper line says exactly what it is used for.
 */
@Component({
  selector: 'pc-donor-address-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PcInput],
  template: `
    <form class="pc-panel flex flex-col gap-3 p-5" (submit)="$event.preventDefault(); save()" novalidate>
      <div>
        <p class="pc-eyebrow">Mailing address</p>
        <p class="text-xs text-base-content/60">Used on your donation receipts.</p>
      </div>

      @if (addressShared()) {
        <p class="text-xs text-base-content/60">
          Others in our records share this address. Saving a change here updates it for you only.
        </p>
      }

      <pc-input id="street" label="Street address" [formField]="form.street"></pc-input>
      <pc-input id="apt" label="Apartment or unit (optional)" [formField]="form.apt"></pc-input>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <pc-input id="city" label="City" [formField]="form.city"></pc-input>
        <pc-input id="state" label="Province or state" [formField]="form.state"></pc-input>
        <pc-input id="zip" label="Postal or ZIP code" [formField]="form.zip"></pc-input>
        <pc-input id="country" label="Country" [formField]="form.country"></pc-input>
      </div>

      <div class="flex justify-end pt-1">
        <button type="submit" class="btn btn-primary btn-sm" [disabled]="saving()">
          @if (saving()) {
            <span class="loading loading-spinner loading-xs"></span>
          }
          Save address
        </button>
      </div>
    </form>
  `,
})
export class DonorAddressForm implements OnInit {
  readonly token = input.required<string>();
  readonly address = input.required<DonorPortalAddress | null>();
  readonly addressShared = input.required<boolean>();

  /** The backend answered 404 mid-session: the link died under us — the page flips to dead. */
  readonly linkDead = output<void>();

  private readonly api = inject(DonorPortalApiService);
  private readonly alerts = inject(AlertService);

  protected readonly saving = signal(false);

  protected readonly payload = signal<DonorPortalAddress>({
    street: '',
    apt: '',
    city: '',
    state: '',
    zip: '',
    country: '',
  });

  protected readonly form = form(this.payload, (p) => {
    required(p.street);
    required(p.city);
    required(p.state);
    required(p.zip);
    required(p.country);
  });

  public ngOnInit(): void {
    const address = this.address();
    if (address) this.payload.set({ ...address });
  }

  protected async save(): Promise<void> {
    this.form().markAsTouched();
    if (this.form().invalid()) return;

    this.saving.set(true);
    try {
      const p = this.payload();
      await this.api.saveAddress(this.token(), {
        street: p.street.trim(),
        apt: p.apt.trim(),
        city: p.city.trim(),
        state: p.state.trim(),
        zip: p.zip.trim(),
        country: p.country.trim(),
      });
      this.form().reset();
      this.alerts.showSuccess('Address saved.');
    } catch (err) {
      if (isDeadLinkError(err)) {
        this.linkDead.emit();
        return;
      }
      this.alerts.showError('We could not save your address. Try again.');
    } finally {
      this.saving.set(false);
    }
  }
}
