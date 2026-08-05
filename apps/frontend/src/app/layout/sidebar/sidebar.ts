import { Component, DestroyRef, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { isPrivilegedRole, planAllowsFeature } from '@common';
import { Icon } from '@icons/icon';
import { Swap } from '@uxcommon/components/swap/swap';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { SidebarService } from 'apps/frontend/src/app/layout/sidebar/sidebar-service';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { DuplicatesService } from '@experiences/duplicates/services/duplicates-service';
import { ISidebarItem, isSidebarRouteActive, sidebarLabel } from './sidebar-items';
import { OrgModeService } from 'apps/frontend/src/app/services/org-mode.service';
import { AnimateIfDirective } from '@uxcommon/directives/animate-if.directive';
import { TourAnchor } from '../tour/tour-anchor.directive';
import { TasksService } from '@experiences/tasks/services/tasks-service';
import { DeliveriesRequestsService } from '@experiences/deliveries/services/deliveries-requests-service';
import { VolunteerAccessService } from '@experiences/volunteer-access/services/volunteer-access-service';
import { EmailsService } from '@experiences/emails/services/emails-service';
import { EmailFoldersStore } from '@experiences/emails/services/store/email-folders.store';

@Component({
  selector: 'pc-sidebar',
  imports: [NgTemplateOutlet, Icon, RouterLink, Swap, AnimateIfDirective, TourAnchor],
  templateUrl: './sidebar.html',
  styles: [
    `
      .tooltip:before {
        z-index: 100 !important;
      }
    `,
  ],
})
export class Sidebar {
  /** Stable anchor id per nav item, so the product tour can spotlight one by route without the
   * sidebar knowing anything about the tour's contents. `/people` → `nav-people`. */
  protected tourAnchorFor(nav: { route?: string | null }): string {
    const first = (nav.route ?? '').replace(/^\//, '').split('/')[0] ?? '';
    return `nav-${first}`;
  }

  private readonly sidebarSvc = inject(SidebarService);
  private readonly auth = inject(AuthService);
  private readonly alertSvc = inject(AlertService);
  private readonly orgMode = inject(OrgModeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tasksSvc = inject(TasksService);
  private readonly duplicatesSvc = inject(DuplicatesService);
  private readonly deliveriesSvc = inject(DeliveriesRequestsService);
  private readonly volunteerAccessSvc = inject(VolunteerAccessService);
  private readonly emailsSvc = inject(EmailsService);
  private readonly emailFoldersStore = inject(EmailFoldersStore);

  /** Live SLA-breach count for the Tasks sidebar badge (spec §4). Loads once per session;
   *  a failed fetch just leaves the badge unset rather than showing a stale/fake number. */
  protected readonly taskSlaBreaches = signal<number | null>(null);

  /** Live merge-queue size for the Duplicates sidebar badge (spec §9.3). Same one-shot-per-
   *  session loading shape as `taskSlaBreaches` above. */
  protected readonly duplicatesQueueCount = signal<number | null>(null);

  /** Live approved-and-ready delivery request count for the Deliveries sidebar badge (spec §14).
   *  Same one-shot-per-session loading shape as the badges above. */
  protected readonly deliveriesReadyCount = signal<number | null>(null);

  /** Volunteers awaiting companion-access approval, for the Volunteer access badge. Unlike the
   *  badges above this one is owned by the service, so approving on the Volunteer access page
   *  drops the badge in the same beat instead of leaving a stale count until the next reload. */
  protected readonly volunteerAccessPending = this.volunteerAccessSvc.pendingApprovals;

  /** One-shot fetched fallback for the Inbox badge — covers sessions where the Inbox page
   *  (and thus its folders store) never loads. */
  private readonly inboxAssignedOpenFetched = signal<number | null>(null);

  /** Open Inbox conversations assigned to the current user, for the Inbox badge. Prefers the
   *  live "Mine" count from the email folders store — refreshed on every assign/close/delete —
   *  so reassignments in the Inbox move the badge immediately; falls back to the one-shot
   *  fetch until the store has counts. */
  protected readonly inboxAssignedOpen = computed(
    () => this.emailFoldersStore.assignedOpenCount() ?? this.inboxAssignedOpenFetched(),
  );

  // Tracks whether the viewport is >= lg (1024px) — updated via matchMedia, no RxJS
  private readonly _mql = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)') : null;
  private readonly _isLargeScreen = signal(this._mql?.matches ?? true);

  // True when the sidebar is visually in icon-only mode (either user preference or responsive CSS)
  protected readonly isEffectivelyNarrow = computed(
    () => !this.isMobileOpen() && (!this._isLargeScreen() || this.isDrawerHalf()),
  );

  /** Target URL of an in-flight navigation, null once it settles (End/Cancel/Error). Lets the
   *  clicked item light up immediately instead of waiting for resolvers/lazy chunks. */
  private readonly pendingRoute = toSignal(
    this.router.events.pipe(
      filter(
        (e) =>
          e instanceof NavigationStart ||
          e instanceof NavigationEnd ||
          e instanceof NavigationCancel ||
          e instanceof NavigationError,
      ),
      map((e) => (e instanceof NavigationStart ? e.url : null)),
    ),
    { initialValue: null },
  );

  /** URL of the last settled navigation. */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  private readonly visibilitySignals = new Map<string, WritableSignal<boolean>>();

  protected readonly items = computed(() => {
    const role = this.auth.getUser()?.role;
    const allItems = this.sidebarSvc.getItems()();
    const withBadges = this.applyBadges(allItems);
    const scoped = this.applyPlanGates(this.applyModuleVisibility(withBadges));
    // Admin-marked entries are for admins and owners only. Testing for the Editor role by name
    // left them showing for Viewers, who are then turned away by roleGuard on arrival.
    if (!isPrivilegedRole(role)) {
      return scoped
        .filter((item) => !item.adminOnly)
        .map((item) => {
          if (item.children) {
            return {
              ...item,
              children: item.children.filter((child) => !child.adminOnly),
            };
          }
          return item;
        });
    }
    return scoped;
  });

  /**
   * Apply the tenant's module visibility to the entries.
   *
   * An off module — whether off by the MODE's default or by an EXPLICIT user
   * override — stays in the sidebar, dimmed: clicking it explains and points at
   * Workspace → Modules instead of navigating, so the module stays discoverable
   * and the two off states look the same everywhere. The `g` chord keeps working
   * and the route stays resolvable — off is a default, not a permission. Pinned
   * clones keep their `moduleId` (see `cloneForFavourite`), so PINS entries get
   * the same treatment for free.
   */
  private applyModuleVisibility(items: ISidebarItem[]): ISidebarItem[] {
    const visibilities = this.orgMode.moduleVisibilities();
    const scope = (item: ISidebarItem): ISidebarItem => {
      const state = item.moduleId ? visibilities.get(item.moduleId) : undefined;
      if (state === 'offByMode' || state === 'offByUser') return { ...item, dimmed: true };
      return item;
    };
    return items.map((item) => (item.children ? { ...scope(item), children: item.children.map(scope) } : scope(item)));
  }

  /**
   * Plan-gate the shared inbox (Grassroots+; demo workspaces exempt — their seeded inbox is
   * part of the test drive). Same dimmed rendering as an off module so there is one visual
   * idiom for "present but not available", but the explanation points at Billing.
   */
  private applyPlanGates(items: ISidebarItem[]): ISidebarItem[] {
    const user = this.auth.getUser();
    const inboxLocked = !user?.tenant_demo_mode_at && !planAllowsFeature(user?.tenant_plan, 'inbox');
    if (!inboxLocked) return items;
    const scope = (item: ISidebarItem): ISidebarItem =>
      item.route === '/inbox' ? { ...item, dimmed: true, planLocked: true } : item;
    return items.map((item) => (item.children ? { ...scope(item), children: item.children.map(scope) } : scope(item)));
  }

  /** Click on a nav entry. Dimmed = the module is off (or above the plan): explain, don't navigate. */
  protected onNavClick(nav: ISidebarItem, event: Event): void {
    if (nav.planLocked) {
      event.preventDefault();
      this.alertSvc.showInfo(
        `${this.label(nav)} requires the Grassroots plan or higher. Upgrade on the Billing page to unlock it.`,
      );
      return;
    }
    if (nav.dimmed) {
      event.preventDefault();
      this.alertSvc.showInfo(
        `${this.label(nav)} is turned off for this workspace. You can turn it on in Workspace settings.`,
      );
      return;
    }
    this.closeMobile();
  }

  /** Tooltip text: the off reason for a dimmed entry (at every width — on the narrow icon
   *  rail it doubles as the only place the name appears), the label on the narrow rail. */
  protected tooltipFor(nav: ISidebarItem): string | null {
    if (nav.planLocked) return `${this.label(nav)} requires the Grassroots plan or higher`;
    if (nav.dimmed) return `${this.label(nav)} is turned off for this workspace`;
    return this.isEffectivelyNarrow() ? this.label(nav) : null;
  }

  /** Display name under the tenant's organization mode. */
  protected label(item: ISidebarItem): string {
    return sidebarLabel(item, this.orgMode.terms());
  }

  constructor() {
    if (this._mql) {
      const handler = (e: MediaQueryListEvent) => this._isLargeScreen.set(e.matches);
      this._mql.addEventListener('change', handler);
      this.destroyRef.onDestroy(() => this._mql!.removeEventListener('change', handler));
    }

    effect(() => {
      const flatItems = this.flattenItems(this.items());
      for (const item of flatItems) {
        const key = this.getItemKey(item);
        const visible = !item.hidden && !item.hiddenByFavourite;
        const existing = this.visibilitySignals.get(key);
        if (existing) {
          existing.set(visible);
        } else {
          this.visibilitySignals.set(key, signal(visible));
        }
      }
    });

    void this.loadTaskSlaBreaches();
    void this.loadDuplicatesQueueCount();
    void this.loadDeliveriesReadyCount();
    void this.loadVolunteerAccessPending();
    void this.loadInboxAssignedOpen();
  }

  /** Inbox badge fallback = open conversations assigned to the current user. One fetch per
   *  session; superseded by the folders store's live count once the Inbox loads. */
  private async loadInboxAssignedOpen(): Promise<void> {
    try {
      this.inboxAssignedOpenFetched.set(await this.emailsSvc.countAssignedOpen());
    } catch {
      // Badge just stays unset — never show a stale or fabricated count.
    }
  }

  /** Volunteer access badge = volunteers awaiting approval. One fetch per session; the
   *  Volunteer access page keeps it current from there on. */
  private async loadVolunteerAccessPending(): Promise<void> {
    try {
      await this.volunteerAccessSvc.refreshPendingCount();
    } catch {
      // Badge just stays unset — never show a stale or fabricated count.
    }
  }

  /** Deliveries badge = live approved-and-ready request count (spec §14). One fetch per session. */
  private async loadDeliveriesReadyCount(): Promise<void> {
    try {
      this.deliveriesReadyCount.set(await this.deliveriesSvc.getReadyCount());
    } catch {
      // Badge just stays unset — never show a stale or fabricated count.
    }
  }

  private async loadTaskSlaBreaches(): Promise<void> {
    try {
      this.taskSlaBreaches.set(await this.tasksSvc.countSlaBreaches());
    } catch {
      // Badge just stays unset — never show a stale or fabricated count.
    }
  }

  /** Duplicates badge = merge-queue size (spec §9.3). One fetch per session — the queue only
   *  meaningfully changes after a nightly sweep or a merge, so it isn't polled. */
  private async loadDuplicatesQueueCount(): Promise<void> {
    try {
      this.duplicatesQueueCount.set(await this.duplicatesSvc.countQueue());
    } catch {
      // Badge just stays unset — never show a stale or fabricated count.
    }
  }

  /** Stamps the live `badgeCount` onto the badge-bearing entries (Inbox, Tasks, Duplicates,
   *  Deliveries, Volunteer access) — every other item is untouched. */
  private applyBadges(items: ISidebarItem[]): ISidebarItem[] {
    const breaches = this.taskSlaBreaches();
    const duplicatesQueue = this.duplicatesQueueCount();
    const deliveriesReady = this.deliveriesReadyCount();
    const volunteerPending = this.volunteerAccessPending();
    const inboxAssigned = this.inboxAssignedOpen();
    return items.map((item) => {
      const children = item.children ? this.applyBadges(item.children) : undefined;
      if (item.route === '/inbox') {
        return { ...item, ...(children ? { children } : {}), badgeCount: inboxAssigned };
      }
      if (item.route === '/tasks') {
        return { ...item, ...(children ? { children } : {}), badgeCount: breaches };
      }
      if (item.route === '/duplicates') {
        return { ...item, ...(children ? { children } : {}), badgeCount: duplicatesQueue };
      }
      if (item.route === '/deliveries') {
        return { ...item, ...(children ? { children } : {}), badgeCount: deliveriesReady };
      }
      if (item.route === '/volunteer-access') {
        return { ...item, ...(children ? { children } : {}), badgeCount: volunteerPending };
      }
      return children ? { ...item, children } : item;
    });
  }

  protected closeMobile() {
    this.sidebarSvc.closeMobile();
  }

  private flattenItems(items: ISidebarItem[]): ISidebarItem[] {
    return items.flatMap((item) => (item.children ? [item, ...this.flattenItems(item.children)] : [item]));
  }

  private getItemKey(item: ISidebarItem): string {
    const prefix = item.parent?.type === 'bookmark' ? 'bookmark:' : '';
    return prefix + item.name + (item.route ?? '');
  }

  protected getVisibilitySignal(item: ISidebarItem): WritableSignal<boolean> {
    const key = this.getItemKey(item);
    return this.visibilitySignals.get(key) ?? signal(!item.hidden && !item.hiddenByFavourite);
  }

  protected isCollapsed(name: string): boolean {
    return this.sidebarSvc.isCollapsed(name);
  }

  /** Collapse is a text-density preference that only applies to the expanded desktop sidebar.
   *  The narrow icon rail always shows every section's icons — a collapsed section there has no
   *  visible header, so its items would be unreachable. The full-screen mobile menu likewise
   *  always shows everything: it has no chevrons, so a collapsed section would be a dead end. */
  protected isVisuallyCollapsed(name: string): boolean {
    return !this.isMobileOpen() && !this.isEffectivelyNarrow() && this.isCollapsed(name);
  }

  protected isDrawerFull() {
    return this.sidebarSvc.isFull();
  }

  protected isDrawerHalf() {
    return this.sidebarSvc.isHalf();
  }

  protected isMobileOpen() {
    return this.sidebarSvc.isMobileOpen();
  }

  /** Single source of truth for the highlighted nav item — the in-flight target while navigating,
   *  the settled URL otherwise. Deliberately not routerLinkActive: its renderer-added classes and
   *  a `[class.x]` binding on the same class fight over ownership, and the binding's stale `false`
   *  wins when navigating deeper (e.g. /people -> /people/:id), un-highlighting the section. */
  protected isNavActive(nav: ISidebarItem): boolean {
    return isSidebarRouteActive(this.pendingRoute() ?? this.currentUrl(), nav);
  }

  protected toggleCollapse(name: string) {
    this.sidebarSvc.toggleCollapsed(name);
  }

  protected toggleDrawer() {
    return this.sidebarSvc.toggleDrawer();
  }
}
