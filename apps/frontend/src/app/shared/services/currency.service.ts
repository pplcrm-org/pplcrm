import { computed, inject, Service } from '@angular/core';
import { type WorkspaceCurrency, formatMoney, toWorkspaceCurrency } from '@common';

import { SettingsService } from '../../experiences/settings/services/settings-service';

/**
 * Resolves the workspace transaction currency (Workspace → Organization) and formats money with
 * it. The sibling of {@link DateFormatService}, and for the same reason: money and dates are both
 * workspace facts, not viewer preferences.
 *
 * Before this existed, donations were charged in hardcoded `cad` while every grid formatted the
 * same numbers as `USD` — the app quoted one currency and billed another.
 */
@Service()
export class WorkspaceCurrencyService {
  private readonly settings = inject(SettingsService);

  /** The configured ISO-4217 code, falling back to the project default. */
  public readonly currency = computed<WorkspaceCurrency>(() =>
    toWorkspaceCurrency(this.settings.snapshotSignal()['organization.currency']),
  );

  /** Format a minor-unit (cents) amount in the workspace currency. */
  public format(amountCents: number | null | undefined): string {
    return formatMoney(amountCents ?? 0, this.currency());
  }

  /** Format a major-unit (dollars) amount — for totals already divided down. */
  public formatUnits(amount: number | null | undefined): string {
    return formatMoney(Math.round((amount ?? 0) * 100), this.currency());
  }
}
