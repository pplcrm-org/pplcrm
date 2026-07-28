import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { BreadcrumbsService } from '@uxcommon/components/breadcrumbs/breadcrumbs.service';
import type { TermKey } from '@common';

import { OrgModeService } from './org-mode.service';

/**
 * A route's `data.breadcrumb`: a single label (linked to that route's own URL),
 * or a pre-built trail for flat routes that conceptually nest (e.g. /imports/new).
 */
export type RouteBreadcrumbData = string | PcBreadcrumb[] | { term: TermKey };

/** A `data.breadcrumb` whose label is worded by the tenant's organization mode. */
function isTermCrumb(raw: unknown): raw is { term: TermKey } {
  return (
    !!raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { term?: unknown }).term === 'string'
  );
}

/**
 * Publishes a default breadcrumb trail for every navigation, built from
 * `data.breadcrumb` on the matched route configs — so the navbar strip is never
 * empty and never shows the previous page's stale trail (route-reuse pages are
 * detached, not destroyed, so a clear-on-destroy never fires for them).
 *
 * Pages that own a richer trail (detail views via `pc-detail-header`, tab pages
 * like Import/export) still win: their effects flush after NavigationEnd and
 * overwrite the default.
 *
 * Started once by the Dashboard shell (the only layout that renders the navbar).
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbDefaultsService {
  private readonly router = inject(Router);
  private readonly breadcrumbs = inject(BreadcrumbsService);
  private readonly orgMode = inject(OrgModeService);
  private started = false;

  public start(): void {
    if (this.started) return;
    this.started = true;
    // The shell is constructed during route activation, before the first
    // NavigationEnd of the session fires — but publish once up front anyway so a
    // late start (e.g. in tests) still seeds the strip.
    this.publishFromSnapshot();
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.publishFromSnapshot();
    });
  }

  private publishFromSnapshot(): void {
    const crumbs: PcBreadcrumb[] = [];
    let url = '';
    let node: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    while (node) {
      const segment = node.url.map((s) => s.path).join('/');
      if (segment) url += `/${segment}`;
      // Read the route's own config — snapshot.data inherits from component-less
      // parent routes, which would duplicate ancestor labels down the chain.
      const raw: unknown = node.routeConfig?.data?.['breadcrumb'];
      if (typeof raw === 'string') {
        crumbs.push({ label: raw, route: url });
      } else if (Array.isArray(raw)) {
        crumbs.push(...(raw as PcBreadcrumb[]));
      } else if (isTermCrumb(raw)) {
        crumbs.push({ label: this.orgMode.term(raw.term), route: url });
      }
      node = node.firstChild;
    }
    this.breadcrumbs.setCrumbs(crumbs);
  }
}
