import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { ISidebarItem } from '../sidebar/sidebar-items';
import { SidebarService } from '../sidebar/sidebar-service';

/**
 * Pin button for the navbar: pins the sidebar item matching the current route
 * into the PINS section. Extracted from the retired URL-segment breadcrumb bar;
 * page orientation is now handled by pc-breadcrumbs inside each page header.
 *
 * Sidebar pins hold sections (People, Inbox…), not records. On a record page
 * (/people/amira-hassan) the button dims and both the tooltip and a toast
 * explain that only main pages can be pinned — the icon stays present (§1
 * disclosure over suppression) rather than vanishing.
 */
@Component({
  selector: 'pc-favourite-toggle',
  imports: [Icon],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm tooltip tooltip-bottom"
        [attr.aria-label]="tooltip()"
        [attr.data-tip]="tooltip()"
        (mouseenter)="hovered.set(true)"
        (mouseleave)="hovered.set(false)"
        (click)="onClick()"
      >
        <!--
          The hover colour is swapped wholesale rather than bound per-class: Angular class
          bindings cannot apply variant classes (hover:*), so the old
          [class.hover:text-base-400] binding was silently dead and a non-pinnable star still
          lit up on hover, advertising an action it would refuse (§2, no misleading affordances).
        -->
        <pc-icon
          [name]="iconName()"
          [size]="5"
          [class]="pinnable() ? 'text-base-content/60 hover:text-primary' : 'text-base-content/60 opacity-40'"
          [class.text-primary]="favourite() && pinnable()"
        ></pc-icon>
      </button>
    }
  `,
})
export class FavouriteToggle {
  private readonly router = inject(Router);
  private readonly sidebarSvc = inject(SidebarService);
  private readonly alertSvc = inject(AlertService);

  private readonly navigationUrl = computed(() => {
    const navigation = this.router.currentNavigation();
    if (navigation) {
      const finalUrl = navigation.finalUrl ?? navigation.initialUrl;
      return finalUrl.toString();
    }
    return this.router.url;
  });

  private currentItem?: ISidebarItem;
  protected readonly favourite = signal(false);
  protected readonly hovered = signal(false);
  protected readonly pinnable = signal(false);
  protected readonly visible = signal(false);
  protected readonly itemName = signal('');

  protected readonly iconName = computed(() => {
    if (!this.pinnable()) return 'bookmark';
    if (this.favourite()) return this.hovered() ? 'bookmark-slash' : 'bookmark-filled';
    return this.hovered() ? 'bookmark-plus' : 'bookmark';
  });

  protected readonly tooltip = computed(() => {
    if (!this.pinnable()) return `Only main pages can be pinned. Open ${this.itemName()} to pin it`;
    return this.favourite() ? `Unpin ${this.itemName()} from the sidebar` : `Pin ${this.itemName()} to the sidebar`;
  });

  constructor() {
    effect(() => this.handleNavigationChange(this.navigationUrl()));
  }

  protected onClick(): void {
    if (!this.pinnable()) {
      // Record page: narrate the reason instead of silently doing nothing.
      this.alertSvc.showInfo(`Only main pages can be pinned. Open ${this.itemName()} to pin it.`);
      return;
    }
    if (!this.currentItem?.route) return;

    const next = this.sidebarSvc.toggleFavourite(this.currentItem.route);
    this.favourite.set(next);
    this.currentItem.favourite = next;
    // Narrate both directions (§1).
    if (next) this.alertSvc.showSuccess(`Pinned ${this.itemName()} to the sidebar.`);
    else this.alertSvc.showInfo(`Removed ${this.itemName()} from your pins.`);
  }

  private handleNavigationChange(url: string): void {
    const item = this.sidebarSvc.findItemForUrl(url);
    const exact = !!item?.route && this.normalizePath(url) === this.normalizePath(item.route);
    this.currentItem = exact ? item : undefined;
    this.favourite.set(exact && !!item?.favourite);
    this.pinnable.set(exact);
    // Show the (dimmed) control whenever the URL maps to a known section, so a
    // record page still explains why it can't be pinned; hide only on unknown routes.
    this.visible.set(!!item?.route);
    this.itemName.set(item?.name ?? '');
  }

  private normalizePath(route: string): string {
    const path = (route.split('?')[0] ?? '').split('#')[0] ?? '';
    const trimmed = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
    return trimmed || '/';
  }
}
