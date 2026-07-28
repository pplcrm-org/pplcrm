import type { RouterStateSnapshot } from '@angular/router';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy } from '@angular/router';

import type { ISidebarItem } from '../layout/sidebar/sidebar-items';
import { SidebarItems, sidebarLabel } from '../layout/sidebar/sidebar-items';
import { OrgModeService } from './org-mode.service';

const APP_NAME = 'pplCRM';

/**
 * Build a lookup from the first URL segment (e.g. `inbox`) to the sidebar entry that owns it,
 * so the tab title and the nav never disagree.
 *
 * Maps to the ITEM rather than to its name: an entry with a `termKey` is worded by the
 * tenant's organization mode, and this map is built once at construction — resolving the
 * string here would freeze the wording of whichever mode happened to be active first.
 */
function buildSegmentItemMap(items: ISidebarItem[]): ReadonlyMap<string, ISidebarItem> {
  const map = new Map<string, ISidebarItem>();
  const walk = (list: ISidebarItem[]): void => {
    for (const item of list) {
      if (item.route && item.type !== 'subheading' && item.type !== 'bookmark') {
        const segment = item.route.replace(/^\//, '').split('/')[0];
        if (segment && !map.has(segment)) {
          map.set(segment, item);
        }
      }
      if (item.children) {
        walk(item.children);
      }
    }
  };
  walk(items);
  return map;
}

function toTitleCase(segment: string): string {
  return segment
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Owns `document.title`. The base screen name is set by {@link AppTitleStrategy} on every
 * navigation; screens with a live count (Inbox, etc.) call {@link setCount} so the tab reads
 * `Inbox (12) — pplCRM`. Composing both in one place keeps the format in a single spot.
 */
@Injectable({ providedIn: 'root' })
export class TabTitleService {
  private readonly title = inject(Title);
  private readonly screen = signal<string>('');
  /** Live counts keyed by screen name. A plain map plus a bump signal drives recomputation. */
  private readonly counts = new Map<string, number>();
  private readonly countsVersion = signal(0);

  constructor() {
    effect(() => {
      this.countsVersion();
      const screen = this.screen();
      if (!screen) {
        this.title.setTitle(APP_NAME);
        return;
      }
      const count = this.counts.get(screen);
      const label = count == null ? screen : `${screen} (${count})`;
      this.title.setTitle(`${label} — ${APP_NAME}`);
    });
  }

  /** Set the current screen name (the part before ` — pplCRM`). */
  public setScreen(screen: string): void {
    this.screen.set(screen);
  }

  /** Set or clear (pass `null`) the live count shown beside a screen name. */
  public setCount(screen: string, count: number | null): void {
    if (count == null) {
      this.counts.delete(screen);
    } else {
      this.counts.set(screen, count);
    }
    this.countsVersion.update((n) => n + 1);
  }
}

/**
 * Derives the screen name from an explicit route `title` when present, otherwise from the URL's
 * first segment mapped through the sidebar's own labels, and hands it to {@link TabTitleService}.
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly tabTitle = inject(TabTitleService);
  private readonly orgMode = inject(OrgModeService);
  private readonly segmentItems = buildSegmentItemMap(SidebarItems);

  public override updateTitle(snapshot: RouterStateSnapshot): void {
    const explicit = this.buildTitle(snapshot);
    this.tabTitle.setScreen(explicit ?? this.deriveFromUrl(snapshot.url));
  }

  private deriveFromUrl(url: string): string {
    const path = url.split(/[?#]/)[0] ?? '';
    const segment = path.split('/').filter(Boolean)[0];
    if (!segment) {
      return 'Dashboard';
    }
    const item = this.segmentItems.get(segment);
    return item ? sidebarLabel(item, this.orgMode.terms()) : toTitleCase(segment);
  }
}
