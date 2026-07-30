import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { PcTabOption, TabBar } from '@uxcommon/components/tabs/tabs';

import { DeliveriesRoutesService } from '../services/deliveries-routes-service';

/**
 * Surface switcher for the two halves of Deliveries (spec §14): the requests pool
 * (`/deliveries`) and the planned routes (`/deliveries/routes`). Rendered in the header of
 * both list pages so each is always one click from the other — otherwise the routes list is
 * only reachable by opening a single route from the Route column. Uses the house tab bar's
 * `underline` variant (design §4), the same look the People / Households / Companies grain
 * tabs use, because this pair switches surfaces rather than filtering one. Pills below it on
 * the requests page stay pills: they filter this surface. The active state is driven purely
 * by the router (no JS state).
 *
 * Routes carries a count of the routes a volunteer is currently out delivering ("numbers before
 * clicks", design §1) — the one thing about the other surface an organizer wants to know without
 * going there. It counts `in_progress` only, so the tooltip spells that out: a bare number beside
 * "Routes" would otherwise read as the total number of routes.
 */
@Component({
  selector: 'pc-deliveries-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TabBar],
  template: `<pc-tab-bar [tabs]="tabs()" variant="underline" label="Deliveries views" />`,
})
export class DeliveriesNav implements OnInit {
  private readonly routesSvc = inject(DeliveriesRoutesService);

  /** null until the count lands (and if it never does), so the tab never flashes a placeholder 0. */
  private readonly inProgress = signal<number | null>(null);

  protected readonly tabs = computed<PcTabOption[]>(() => {
    const live = this.inProgress();
    const routes: PcTabOption = { id: 'routes', label: 'Routes', route: '/deliveries/routes' };
    // Nothing out for delivery is not news — the badge appears only when there is something to report.
    if (live != null && live > 0) {
      routes.badge = live;
      routes.tooltip = `${live} route${live === 1 ? '' : 's'} in progress`;
    }
    return [{ id: 'requests', label: 'Requests', route: '/deliveries', exact: true }, routes];
  });

  public ngOnInit(): void {
    void this.refresh();
  }

  /** Re-read the count after the host page did something that can change a route's status. */
  public async refresh(): Promise<void> {
    try {
      const counts = await this.routesSvc.getStatusCounts();
      this.inProgress.set(counts['in_progress'] ?? 0);
    } catch {
      // A count on a tab is orientation, not the page's job: if it can't be read, show no
      // badge and stay quiet rather than toasting over whatever the user came here to do.
      this.inProgress.set(null);
    }
  }
}
