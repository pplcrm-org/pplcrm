import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { DeliveriesRequestsService } from '../../deliveries/services/deliveries-requests-service';

/**
 * Workspace → Deliveries. The planning defaults the Plan routes page starts from.
 *
 * These live in `deliveries.route_defaults` and were previously reachable only from the Advanced
 * panel on the Plan routes page — an admin browsing Workspace would never have found them. Both
 * surfaces read and write the same key; this one sets the starting point, the plan page overrides
 * it for a single run.
 */
@Component({
  selector: 'pc-deliveries-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-5">
      @if (loadFailed()) {
        <div class="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5">
          <span class="text-xs leading-relaxed text-base-content/80">
            Couldn't load your saved delivery planning defaults. The values below are placeholders, not your stored
            settings — saving is disabled until this page reloads successfully.
          </span>
        </div>
      }
      <fieldset class="space-y-4" [disabled]="saving() || loadFailed()">
        <div class="grid gap-x-5 gap-y-4 md:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium text-base-content/70">Minutes per stop</span>
            <input
              class="input input-bordered focus:input-primary w-full bg-base-200/30"
              type="number"
              min="0"
              max="60"
              [value]="serviceMinutes()"
              (input)="serviceMinutes.set(readNumber($event, 0))"
            />
            <span class="text-xs text-base-content/50">How long a volunteer spends at each door.</span>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium text-base-content/70">Average speed (km/h)</span>
            <input
              class="input input-bordered focus:input-primary w-full bg-base-200/30"
              type="number"
              min="1"
              max="120"
              [value]="avgSpeedKmh()"
              (input)="avgSpeedKmh.set(readNumber($event, 1))"
            />
            <span class="text-xs text-base-content/50">Used to estimate drive time between stops.</span>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs font-medium text-base-content/70">Drivers</span>
            <input
              class="input input-bordered focus:input-primary w-full bg-base-200/30"
              type="number"
              min="1"
              max="50"
              placeholder="As many as needed"
              [value]="drivers() ?? ''"
              (input)="drivers.set(readOptionalNumber($event))"
            />
            <span class="text-xs text-base-content/50">Leave empty to let planning decide.</span>
          </label>

          <label class="flex flex-col gap-1 md:col-span-2">
            <span class="text-xs font-medium text-base-content/70">Return to start</span>
            <span class="flex cursor-pointer items-center gap-3 py-1">
              <input
                type="checkbox"
                class="toggle toggle-primary toggle-md"
                [checked]="includeReturnLeg()"
                (change)="includeReturnLeg.set(!includeReturnLeg())"
              />
              <span class="text-xs font-normal text-base-content/70">
                Count the drive back to the start address in each route's estimate.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div class="flex items-center gap-2 border-t border-base-200 pt-4">
        <button type="button" class="btn btn-primary btn-sm" [disabled]="saving() || loadFailed()" (click)="save()">
          @if (saving()) {
            <span class="loading loading-spinner loading-xs"></span>
          }
          Save settings
        </button>
        <span class="text-xs text-base-content/50">
          Applies to new plans. Routes you already created keep the settings they were planned with.
        </span>
      </div>
    </div>
  `,
})
export class DeliveriesSettingsComponent implements OnInit {
  private readonly svc = inject(DeliveriesRequestsService);
  private readonly alerts = inject(AlertService);

  protected readonly loading = createLoadingGate();
  protected readonly saving = signal(false);
  /** True when the stored route defaults failed to load — the fields below are showing this
   *  component's own fallback values, not the tenant's real settings, so Save must not be
   *  allowed to write them over what's actually stored (§deliveries-settings). */
  protected readonly loadFailed = signal(false);

  protected readonly serviceMinutes = signal(5);
  protected readonly avgSpeedKmh = signal(30);
  protected readonly includeReturnLeg = signal(false);
  protected readonly drivers = signal<number | null>(null);

  public ngOnInit(): void {
    void this.load();
  }

  protected readNumber(event: Event, min: number): number {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    return Number.isNaN(value) ? min : value;
  }

  /** Empty reads as "as many as needed" (null), matching the placeholder. */
  protected readOptionalNumber(event: Event): number | null {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    return Number.isNaN(value) || value <= 0 ? null : value;
  }

  private async load(): Promise<void> {
    const end = this.loading.begin();
    try {
      const defaults = await this.svc.getRouteDefaults();
      this.serviceMinutes.set(defaults.serviceMinutes);
      this.avgSpeedKmh.set(defaults.avgSpeedKmh);
      this.includeReturnLeg.set(defaults.includeReturnLeg);
      this.drivers.set(defaults.drivers);
    } catch {
      // The fields still show this component's own fallback values (not the tenant's stored
      // ones) — say so and block Save so it can't write them over the real settings.
      this.loadFailed.set(true);
      this.alerts.showError("Couldn't load your delivery planning defaults. The values shown here are not saved.");
    } finally {
      end();
    }
  }

  protected async save(): Promise<void> {
    if (this.loadFailed()) return;
    this.saving.set(true);
    try {
      await this.svc.setRouteDefaults({
        serviceMinutes: this.serviceMinutes(),
        avgSpeedKmh: this.avgSpeedKmh(),
        includeReturnLeg: this.includeReturnLeg(),
        drivers: this.drivers(),
      });
      this.alerts.showSuccess('Delivery planning defaults saved');
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Unable to save the planning defaults';
      this.alerts.showError(message);
    } finally {
      this.saving.set(false);
    }
  }
}
