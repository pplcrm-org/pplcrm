import { Component, computed, inject, signal } from '@angular/core';
import { CompaniesService } from '@experiences/companies/services/companies-service';
import { HouseholdsService } from '@experiences/households/services/households-service';
import { PersonsService } from '@experiences/persons/services/persons-service';
import { PcTabOption, TabBar } from '@uxcommon/components/tabs/tabs';

/**
 * The People grain tabs (spec §5): one row under the grid header that switches the
 * grid between the three grains of the same dataset — People · Households · Companies —
 * with per-grain totals in the labels (tabular-nums). Rendered on all three grid pages
 * via the datagrid's `[pcGridBelowHeader]` projection slot; deep links to each grain's
 * detail/edit routes are untouched.
 *
 * This row is the reference look for surface-switching tabs, so it renders through the
 * shared bar's `underline` variant rather than its own markup — Forms and Deliveries use
 * the same variant and can no longer drift from it.
 *
 * Counts load once per instantiation; until a count arrives the label renders without
 * a number (never a fake or stale one).
 */
@Component({
  selector: 'pc-grain-tabs',
  imports: [TabBar],
  host: { class: '-mt-1 mb-2 block' },
  template: ` <pc-tab-bar [tabs]="tabs()" variant="underline" label="People, households and companies" /> `,
})
export class GrainTabs {
  private readonly personsSvc = inject(PersonsService);
  private readonly householdsSvc = inject(HouseholdsService);
  private readonly companiesSvc = inject(CompaniesService);

  private readonly formatter = new Intl.NumberFormat();

  private readonly peopleCount = signal<number | null>(null);
  private readonly householdsCount = signal<number | null>(null);
  private readonly companiesCount = signal<number | null>(null);

  protected readonly tabs = computed<PcTabOption[]>(() => [
    this.tab('people', 'People', '/people', this.peopleCount()),
    this.tab('households', 'Households', '/households', this.householdsCount()),
    this.tab('companies', 'Companies', '/companies', this.companiesCount()),
  ]);

  constructor() {
    void this.loadCounts();
  }

  /** Re-query the per-grain totals (e.g. after a delete on the hosting grid). */
  public reloadCounts(): void {
    void this.loadCounts();
  }

  /** A grain option; the badge is omitted (not zeroed) until that count arrives. */
  private tab(id: string, label: string, route: string, count: number | null): PcTabOption {
    return count === null
      ? { id, label, route, exact: true }
      : { id, label, route, exact: true, badge: this.formatter.format(count) };
  }

  private async loadCounts(): Promise<void> {
    // Each count fails independently; a failed count simply leaves that label bare.
    const [people, households, companies] = await Promise.allSettled([
      this.personsSvc.count(),
      this.householdsSvc.count(),
      this.companiesSvc.count(),
    ]);
    if (people.status === 'fulfilled') this.peopleCount.set(people.value);
    if (households.status === 'fulfilled') this.householdsCount.set(households.value);
    if (companies.status === 'fulfilled') this.companiesCount.set(companies.value);
  }
}
