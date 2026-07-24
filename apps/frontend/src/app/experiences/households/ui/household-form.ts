import { Component, OnInit, inject, input, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { form, validateStandardSchema } from '@angular/forms/signals';
import { Router, RouterModule } from '@angular/router';
import { UpdateHouseholdsType, UpdateHouseholdsObj } from '../../../../../../../libs/common/src';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { AddressAutocomplete } from '@uxcommon/components/address-autocomplete/address-autocomplete';
import { Tags } from '@experiences/tags/ui/tags';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { Textarea as PcTextarea } from '@uxcommon/components/textarea/textarea';
import { DetailHeader as PcDetailHeader } from '@uxcommon/components/detail-header/detail-header';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { AddressFormGroup as PcAddressFormGroup } from '@uxcommon/components/address-form-group/address-form-group';
import { GeocodeChip } from '@uxcommon/components/geocode-chip/geocode-chip';

import type { Selectable } from 'kysely';
import { HouseholdsService } from '../services/households-service';
import { Households, AddressType } from '../../../../../../../libs/common/src/lib/kysely.models';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { PersonsService } from '../../persons/services/persons-service';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

@Component({
  selector: 'pc-household-form',
  imports: [
    PcTextarea,
    AddressAutocomplete,
    Tags,
    Icon,
    RouterModule,
    PcDetailHeader,
    PcCard,
    PcAddressFormGroup,
    GeocodeChip,
    DatePipe,
  ],
  templateUrl: './household-form.html',
})
export class HouseholdForm implements OnInit {
  private readonly alertSvc = inject(AlertService);
  private readonly householdsSvc = inject(HouseholdsService);
  private readonly tagOptionsSvc = inject(TagOptionsService);
  private readonly router = inject(Router);
  private readonly dialogSvc = inject(ConfirmDialogService);
  private readonly personsSvc = inject(PersonsService);

  private _loading = createLoadingGate();

  /** Disables Save immediately on click — the loading gate stays false for its first
   *  300ms by design, which would leave a double-click window. */
  protected readonly saving = signal(false);

  protected readonly household = signal<Selectable<Households> | null>(null);

  /** Member count for the Overview rail — loaded alongside the household (§6). */
  protected readonly peopleCount = signal(0);

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => {
    const households: PcBreadcrumb = { label: 'Households', route: '/households' };
    const id = this.household()?.id;
    if (id) {
      return [households, { label: 'Household', route: ['/households', String(id)] }, { label: 'Edit' }];
    }
    return [households, { label: 'New household' }];
  });

  protected addressVerified = false;

  /** Signals so pc-tags' two-way binding propagates new array references back here. */
  protected readonly tags = signal<string[]>([]);

  protected readonly issues = signal<string[]>([]);

  protected readonly payload = signal({
    formatted_address: '',
    type: '',
    lat: 0,
    lng: 0,
    street_num: '',
    street1: '',
    street2: '',
    apt: '',
    city: '',
    state: '',
    country: '',
    zip: '',
    home_phone: '',
    notes: '',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, UpdateHouseholdsObj);
  });

  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  protected readonly addressString = computed(() => {
    const raw = this.payload();

    // If formatted_address is present (e.g. populated via Google Places autocomplete)
    if (raw.formatted_address) {
      return raw.formatted_address;
    }

    const parts: string[] = [];

    const streetParts = [raw.apt ? `Apt ${raw.apt}` : null, raw.street_num, raw.street1, raw.street2].filter(Boolean);

    const locationParts = [raw.city, raw.state, raw.zip, raw.country].filter(Boolean);

    if (streetParts.length) {
      parts.push(streetParts.join(' ').trim());
    }
    if (locationParts.length) {
      parts.push(locationParts.join(', ').trim());
    }

    return parts.join(', ').trim();
  });

  protected id = input<string>();
  protected isLoading = this._loading.visible;

  public mode = input<'new' | 'edit'>('edit');
  protected readonly isNewMode = computed(() => this.mode() === 'new' || !this.id());

  public handleAddressChange(address: AddressType) {
    const end = this._loading.begin();
    try {
      if (!address || !address.street1) {
        this.alertSvc.showError('Please select the correct address from the list or leave it blank');
        return;
      }
      this.payload.update((prev) => ({
        ...prev,
        formatted_address: address.formatted_address ?? '',
        type: address.type ?? '',
        lat: address.lat ?? 0,
        lng: address.lng ?? 0,
        street_num: address.street_num ?? '',
        street1: address.street1 ?? '',
        street2: address.street2 ?? '',
        apt: address.apt ?? '',
        city: address.city ?? '',
        state: address.state ?? '',
        country: address.country ?? '',
        zip: address.zip ?? '',
      }));
      this.form.street1().markAsDirty();
      this.addressVerified = true;
    } finally {
      end();
    }
  }

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    await this.loadHousehold();
    if (this.isNewMode()) {
      const state = window.history.state;
      if (state && state.cloneData) {
        const data = state.cloneData;
        this.payload.set({
          formatted_address: data.formatted_address ?? '',
          type: data.type ?? '',
          lat: data.lat ?? 0,
          lng: data.lng ?? 0,
          street_num: data.street_num ?? '',
          street1: data.street1 ?? '',
          street2: data.street2 ?? '',
          apt: data.apt ?? '',
          city: data.city ?? '',
          state: data.state ?? '',
          country: data.country ?? '',
          zip: data.zip ?? '',
          home_phone: data.home_phone ?? '',
          notes: data.notes ?? '',
        });
      }
    }
  }

  protected async applyEdit(input: { key: string; value: string; changed: boolean }) {
    if (input.changed) {
      const row = { [input.key]: input.value };
      this.update(row);
    }
  }

  protected async deleteHousehold() {
    const id = this.id();
    if (!id) return;
    const end = this._loading.begin();
    try {
      // Fetch people belonging to this household
      const people = (await this.personsSvc.getByHouseholdId(id, { columns: ['id'] })) as Array<{ id: string }>;
      const personIds = people.map((p) => p.id);
      const peopleCount = personIds.length;

      if (peopleCount > 0) {
        // Show the 3-option warning dialog
        const choice = await this.dialogSvc.choose<'delete-people' | 'keep-people'>({
          title: 'Households have people',
          message: `1 household(s) being deleted contain ${peopleCount} person(s).\nWhat would you like to do with those people?`,
          variant: 'warning',
          choices: [
            { label: 'Delete people too', value: 'delete-people', variant: 'danger' },
            { label: 'Keep people, just remove their address', value: 'keep-people', variant: 'warning' },
          ],
          cancelText: 'Cancel',
        });

        if (!choice) return; // Handled (user clicked Cancel, so do nothing)

        if (choice === 'keep-people') {
          for (const pid of personIds) {
            await this.personsSvc.removeHousehold(pid);
          }
        } else if (choice === 'delete-people') {
          await this.personsSvc.deleteMany(personIds);
        }
      } else {
        const confirmed = await this.dialogSvc.confirm({
          title: 'Delete Household',
          message: 'Are you sure you want to delete this household? This action cannot be undone.',
          variant: 'danger',
          confirmText: 'Delete',
        });
        if (!confirmed) return;
      }

      await this.householdsSvc.delete(id);
      this.householdsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Household deleted');
      await this.router.navigate(['/households']);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to delete household';
      this.alertSvc.showError(message);
    } finally {
      end();
    }
  }

  public canDeactivate(): Promise<boolean> {
    return this.unsavedChanges.confirmDiscardIfDirty(this.addressString() || 'this household');
  }

  protected save(done?: () => void) {
    if (this.saving()) return;
    const raw = this.payload();
    const data: UpdateHouseholdsType = {
      home_phone: raw.home_phone,
      street_num: raw.street_num,
      street1: raw.street1,
      street2: raw.street2,
      apt: raw.apt,
      city: raw.city,
      state: raw.state,
      zip: raw.zip,
      country: raw.country,
      notes: raw.notes,
      formatted_address: raw.formatted_address || null,
      type: raw.type || null,
      lat: raw.lat || null,
      lng: raw.lng || null,
    };
    if (!this.id()) {
      this.saving.set(true);
      const end = this._loading.begin();
      return this.householdsSvc
        .add(data)
        .then(async (result) => {
          this.alertSvc.showSuccess('Household added successfully.');
          this.householdsSvc.triggerRefresh();
          // Mark the form pristine so the deactivate guard doesn't prompt
          // "Leave without saving?" on the post-save navigation.
          this.form().reset();
          done?.();
          await this.router.navigate(['/households', result.id]);
        })
        .catch((err: unknown) => {
          this.alertSvc.showError(getUserErrorMessage(err, 'Could not add the household. Please try again.'));
        })
        .finally(() => {
          end();
          this.saving.set(false);
        });
    }
    return this.update(data, done);
  }

  protected async tagAdded(tag: string) {
    const id = this.id();
    if (!id) return;
    try {
      await this.householdsSvc.attachTag(id, tag, 'tag');
      await this.tagOptionsSvc.invalidate('tag');
    } catch (err) {
      console.error('Failed to attach tag:', err);
    }
  }

  protected async tagRemoved(tag: string) {
    const id = this.id();
    if (!id) return;
    try {
      await this.householdsSvc.detachTag(id, tag, 'tag');
      await this.tagOptionsSvc.invalidate('tag');
    } catch (err) {
      console.error('Failed to detach tag:', err);
    }
  }

  protected async issueAdded(issue: string) {
    const id = this.id();
    if (!id) return;
    try {
      await this.householdsSvc.attachTag(id, issue, 'issue');
      await this.tagOptionsSvc.invalidate('issue');
    } catch (err) {
      console.error('Failed to attach issue:', err);
    }
  }

  protected async issueRemoved(issue: string) {
    const id = this.id();
    if (!id) return;
    try {
      await this.householdsSvc.detachTag(id, issue, 'issue');
      await this.tagOptionsSvc.invalidate('issue');
    } catch (err) {
      console.error('Failed to detach issue:', err);
    }
  }

  private async getTags() {
    const id = this.id();
    if (!this.household() || !id) {
      return;
    }
    this.tags.set(await this.householdsSvc.getTags(id, 'tag'));
    this.issues.set(await this.householdsSvc.getTags(id, 'issue'));
  }

  private async loadHousehold() {
    const id = this.id();
    if (!id) return;

    const end = this._loading.begin();

    try {
      this.household.set((await this.householdsSvc.getById(id)) as Selectable<Households>);
      await this.getTags();
      this.refreshForm();
      try {
        this.peopleCount.set(await this.householdsSvc.getPeopleCount(id));
      } catch {
        this.peopleCount.set(0);
      }
    } finally {
      end();
    }
  }

  private refreshForm() {
    const household = this.household();
    if (!household) return;

    this.payload.set({
      formatted_address: household.formatted_address ?? '',
      type: household.type ?? '',
      lat: household.lat ?? 0,
      lng: household.lng ?? 0,
      street_num: household.street_num ?? '',
      street1: household.street1 ?? '',
      street2: household.street2 ?? '',
      apt: household.apt ?? '',
      city: household.city ?? '',
      state: household.state ?? '',
      country: household.country ?? '',
      zip: household.zip ?? '',
      home_phone: household.home_phone ?? '',
      notes: household.notes ?? '',
    });
    this.form().reset();
  }

  private update(data: Partial<UpdateHouseholdsType>, done?: () => void) {
    const id = this.id();
    if (!id) {
      return;
    }

    this.saving.set(true);
    const end = this._loading.begin();
    void this.householdsSvc
      .update(id, data)
      .then(() => {
        this.alertSvc.showSuccess('Household updated successfully.');
        this.form().reset();
        this.householdsSvc.triggerRefresh();
        if (done) {
          done();
        }
      })
      .catch((err: unknown) => {
        this.alertSvc.showError(getUserErrorMessage(err, 'Could not save the household. Please try again.'));
      })
      .finally(() => {
        end();
        this.saving.set(false);
      });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
