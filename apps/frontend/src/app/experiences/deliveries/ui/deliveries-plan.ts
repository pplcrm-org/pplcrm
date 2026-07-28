import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AddressAutocomplete } from '@uxcommon/components/address-autocomplete/address-autocomplete';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { Icon } from '@icons/icon';

import { DeliveriesRequestsService, type DeliveryPlanPreview } from '../services/deliveries-requests-service';

/**
 * Plan routes page (spec §4.2). Preview is a pure computation that writes nothing; commit creates
 * all routes atomically. Ineligible requests and leftovers are always narrated with an exit.
 */
@Component({
  selector: 'pc-deliveries-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AddressAutocomplete, StatusBadge, Icon],
  templateUrl: './deliveries-plan.html',
})
export class DeliveriesPlan implements OnInit {
  private readonly svc = inject(DeliveriesRequestsService);
  private readonly alerts = inject(AlertService);
  private readonly router = inject(Router);
  protected readonly loading = createLoadingGate();

  protected readonly startAddress = signal('');
  protected readonly drivers = signal<number | null>(null);
  protected readonly serviceMinutes = signal(5);
  protected readonly avgSpeed = signal(30);
  protected readonly includeReturn = signal(false);
  protected readonly advancedOpen = signal(false);

  protected readonly preview = signal<DeliveryPlanPreview | null>(null);
  protected readonly committing = signal(false);

  protected readonly routeCount = computed(() => this.preview()?.routes.length ?? 0);

  public ngOnInit(): void {
    // Seed from the workspace planning defaults (Workspace → Deliveries). The Advanced panel
    // still overrides them for this one run without writing anything back.
    void this.svc.getRouteDefaults().then((d) => {
      if (d.start_address) this.startAddress.set(d.start_address);
      this.serviceMinutes.set(d.serviceMinutes);
      this.avgSpeed.set(d.avgSpeedKmh);
      this.includeReturn.set(d.includeReturnLeg);
      this.drivers.set(d.drivers);
    });
  }

  /** Empty or zero reads as "as many as needed" (null), matching the placeholder. */
  protected onDriversInput(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.drivers.set(value ? value : null);
  }

  protected onServiceMinutesInput(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.serviceMinutes.set(Number.isNaN(value) ? 0 : value);
  }

  protected onAvgSpeedInput(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.avgSpeed.set(Number.isNaN(value) ? 0 : value);
  }

  protected async runPreview(): Promise<void> {
    if (!this.startAddress().trim()) {
      this.alerts.showError('Enter a start address first');
      return;
    }
    const end = this.loading.begin();
    try {
      const result = await this.svc.previewPlan(this.planInput());
      this.preview.set(result);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      end();
    }
  }

  protected startOver(): void {
    this.preview.set(null);
  }

  protected async commit(): Promise<void> {
    const p = this.preview();
    if (!p || p.routes.length === 0 || this.committing()) return;
    this.committing.set(true);
    try {
      const result = await this.svc.commitPlan({
        ...this.planInput(),
        routes: p.routes.map((r) => ({ request_ids: r.stops.map((s) => s.request_id) })),
      });
      this.alerts.showSuccess(`${result.created} route${result.created === 1 ? '' : 's'} created`);
      if (result.skipped.length > 0) {
        this.alerts.showInfo(
          `${result.skipped.length} request${result.skipped.length === 1 ? '' : 's'} were planned by someone else and were skipped`,
        );
      }
      await this.router.navigate(['/deliveries/routes']);
    } catch (err) {
      this.alerts.showError(err instanceof Error ? err.message : 'Could not create routes');
    } finally {
      this.committing.set(false);
    }
  }

  private planInput() {
    return {
      start_address: this.startAddress().trim(),
      drivers: this.drivers(),
      service_minutes: this.serviceMinutes(),
      avg_speed_kmh: this.avgSpeed(),
      include_return_leg: this.includeReturn(),
    };
  }
}
