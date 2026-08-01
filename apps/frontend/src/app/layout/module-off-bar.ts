import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Icon } from '@icons/icon';

import type { ModuleId } from '@common';

import { OrgModeService } from '../services/org-mode.service';
import { SidebarItems, sidebarLabel, type ISidebarItem } from './sidebar/sidebar-items';

/** A sidebar entry known to own an optional module and to be routable. */
type ModuleNavItem = ISidebarItem & { moduleId: ModuleId; route: string };

/** Every entry that belongs to an optional module, flattened once. */
const MODULE_ITEMS: readonly ModuleNavItem[] = SidebarItems.flatMap((item) => [item, ...(item.children ?? [])]).filter(
  (item): item is ModuleNavItem => !!item.moduleId && !!item.route,
);

/**
 * Explains a page that isn't in the sidebar.
 *
 * A module the tenant's organization mode leaves off is hidden from the nav but stays
 * fully routable — bookmarks, shared links and help-article deep links must not 404, and
 * hiding a module is a default rather than a permission. That leaves a gap: someone who
 * follows an old link lands on a working page they can't find again. This strip closes it
 * and points at the switch, per "disclosure over suppression" (design §2).
 *
 * Mounted once in the shell, so it covers every optional module with no per-page work.
 */
@Component({
  selector: 'pc-module-off-bar',
  imports: [Icon, RouterLink],
  template: `
    @if (offItem(); as item) {
      <div
        class="flex items-center justify-between gap-4 border-b border-base-300 bg-base-200 px-4 py-2 text-xs sm:text-sm"
      >
        <div class="flex min-w-0 items-center gap-2">
          <pc-icon name="eye-slash" [size]="5" class="shrink-0 text-base-content/60"></pc-icon>
          <span class="truncate text-base-content/80">
            @if (dimmedInSidebar()) {
              {{ label(item) }} is turned off for this workspace, so it is dimmed in the sidebar. Everything here still
              works.
            } @else {
              {{ label(item) }} is turned off for this workspace, so it isn't in the sidebar. Everything here still
              works.
            }
          </span>
        </div>
        <a routerLink="/workspace/modules" class="btn btn-xs shrink-0 sm:btn-sm"> Turn it back on </a>
      </div>
    }
  `,
})
export class ModuleOffBar {
  private readonly router = inject(Router);
  private readonly orgMode = inject(OrgModeService);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The optional-module entry owning the current URL, when its module is off. */
  protected readonly offItem = computed<ModuleNavItem | null>(() => {
    const path = (this.currentUrl().split(/[?#]/)[0] ?? '').replace(/\/$/, '');
    const enabled = this.orgMode.enabledModules();
    const match = MODULE_ITEMS.find((item) => path === item.route || path.startsWith(`${item.route}/`));
    return match && !enabled.has(match.moduleId) ? match : null;
  });

  /** True when the current off module still shows (dimmed) in the sidebar, i.e. it is
   *  off by the mode's default rather than by an explicit user override. */
  protected readonly dimmedInSidebar = computed<boolean>(() => {
    const item = this.offItem();
    return !!item && this.orgMode.moduleVisibilities().get(item.moduleId) === 'offByMode';
  });

  protected label(item: ISidebarItem): string {
    return sidebarLabel(item, this.orgMode.terms());
  }
}
