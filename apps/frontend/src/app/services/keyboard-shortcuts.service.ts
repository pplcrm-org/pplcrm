import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { SidebarItems, sidebarLabel, type ISidebarItem } from '../layout/sidebar/sidebar-items';
import { MOD_KEY_LABEL, SHIFT_KEY_LABEL } from '../shared/platform-keys';
import { OrgModeService } from './org-mode.service';

/** A single documented shortcut, rendered as a row in the help overlay. */
export interface ShortcutRow {
  /** Key caps rendered left-to-right, e.g. ['g', 'i'] or ['⌘', 'K']. */
  keys: string[];
  label: string;
}

/** A titled group of shortcut rows in the help overlay. */
export interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

/** Milliseconds allowed between `g` and the second key of a navigation chord. */
const SEQUENCE_WINDOW_MS = 1500;

/** Prefix key that opens a navigation chord (Gmail-style "go to"). */
const NAV_PREFIX = 'g';

/**
 * App-wide keyboard shortcuts: the Gmail-style `g`-then-key navigation chords
 * (sourced from {@link SidebarItems} so the sidebar hints and the key handler
 * never drift apart) plus the `?` shortcuts-help overlay.
 *
 * The dashboard shell forwards `window:keydown` here. Per-page shortcuts (e.g.
 * the Inbox) handle their own single keys locally; this service only owns the
 * global chords and help overlay so the two never collide.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private readonly router = inject(Router);
  private readonly orgMode = inject(OrgModeService);

  private readonly _helpVisible = signal(false);
  /** True while the shortcuts-help overlay is open. */
  public readonly helpVisible = this._helpVisible.asReadonly();

  private readonly _prefixArmed = signal(false);
  /** True in the brief window after `g`, while waiting for the second chord key. */
  public readonly prefixArmed = this._prefixArmed.asReadonly();

  private prefixTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flattened navigation entries that carry a shortcut, in sidebar order. */
  private readonly navItems: readonly ISidebarItem[] = this.flatten(SidebarItems).filter(
    (item) => !!item.shortcut && !!item.route,
  );

  /** Map from the second chord key to its destination route. */
  private readonly navByKey: ReadonlyMap<string, string> = new Map(
    this.navItems.map((item) => [item.shortcut as string, item.route as string]),
  );

  /** All documented shortcuts, grouped for the help overlay. */
  public readonly sections = computed<ShortcutSection[]>(() => [
    {
      title: 'General',
      rows: [
        { keys: [MOD_KEY_LABEL, 'K'], label: 'Filter this page (opens search everywhere else)' },
        { keys: [MOD_KEY_LABEL, SHIFT_KEY_LABEL, 'K'], label: 'Search pages, people, addresses and help' },
        { keys: ['g', '…'], label: 'Go to… (then a section key below)' },
        { keys: ['?'], label: 'Show this shortcuts list' },
        { keys: ['Esc'], label: 'Close dialog / overlay' },
      ],
    },
    {
      title: 'Go to',
      // Display, not identity: an entry with a `termKey` is worded by the tenant's
      // organization mode, and this is already a computed so it tracks a mode change.
      rows: this.navItems.map((item) => ({
        keys: [NAV_PREFIX, item.shortcut as string],
        label: sidebarLabel(item, this.orgMode.terms()),
      })),
    },
    {
      title: 'Inbox',
      rows: [
        { keys: ['c'], label: 'Compose' },
        { keys: ['r'], label: 'Reply' },
        { keys: ['a'], label: 'Reply all' },
        { keys: ['f'], label: 'Forward' },
        { keys: ['e'], label: 'Mark done' },
        { keys: ['s'], label: 'Star / unstar' },
        { keys: ['Shift', 'i'], label: 'Mark as read' },
        { keys: ['Shift', 'u'], label: 'Mark as unread' },
        { keys: ['#'], label: 'Delete' },
        { keys: ['j'], label: 'Next email' },
        { keys: ['k'], label: 'Previous email' },
        { keys: ['Enter'], label: 'Open / expand' },
        { keys: ['u'], label: 'Back to list' },
      ],
    },
  ]);

  public openHelp(): void {
    this.disarmPrefix();
    this._helpVisible.set(true);
  }

  public closeHelp(): void {
    this._helpVisible.set(false);
  }

  public toggleHelp(): void {
    this._helpVisible.update((v) => !v);
  }

  /**
   * Global keydown entry point. Owns the `?` help toggle and the `g`-then-key
   * navigation chords; ignores everything typed into an editable element or
   * combined with a command/alt/ctrl modifier.
   */
  public handleKeydown(event: KeyboardEvent): void {
    // The help overlay only listens for its own dismissal.
    if (this._helpVisible()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeHelp();
      }
      return;
    }

    if (this.isTypingTarget(event.target)) {
      this.disarmPrefix();
      return;
    }

    // `?` (Shift+/) opens help regardless of an armed prefix.
    if (event.key === '?') {
      event.preventDefault();
      this.disarmPrefix();
      this.toggleHelp();
      return;
    }

    // Never interpret a chord while a command/ctrl/alt modifier is held — those
    // belong to the browser or to Cmd+K search.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      this.disarmPrefix();
      return;
    }

    // Second key of a `g` chord: navigate if it maps to a section.
    if (this._prefixArmed()) {
      const route = this.navByKey.get(event.key.toLowerCase());
      this.disarmPrefix();
      if (route) {
        event.preventDefault();
        void this.router.navigateByUrl(route);
      }
      return;
    }

    // First key: arm the prefix and wait for the destination key.
    if (event.key.toLowerCase() === NAV_PREFIX) {
      event.preventDefault();
      this.armPrefix();
    }
  }

  private armPrefix(): void {
    this._prefixArmed.set(true);
    if (this.prefixTimer) clearTimeout(this.prefixTimer);
    this.prefixTimer = setTimeout(() => this.disarmPrefix(), SEQUENCE_WINDOW_MS);
  }

  private disarmPrefix(): void {
    if (this.prefixTimer) {
      clearTimeout(this.prefixTimer);
      this.prefixTimer = null;
    }
    if (this._prefixArmed()) this._prefixArmed.set(false);
  }

  /** True when the event originates from a field the user is typing into. */
  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return target.getAttribute('role') === 'textbox';
  }

  private flatten(items: readonly ISidebarItem[]): ISidebarItem[] {
    return items.flatMap((item) => (item.children ? [item, ...this.flatten(item.children)] : [item]));
  }
}
