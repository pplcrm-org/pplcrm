import type { PcIconNameType } from '@icons/icons.index';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { effectivePlanKey, isPrivilegedRole, planAllowsFeature } from '@common';

import { AuthService } from '../auth/auth-service';
import { SidebarItems, sidebarLabel, type ISidebarItem } from '../layout/sidebar/sidebar-items';
import { ThemeService } from '../layout/theme/theme-service';
import { CUSTOM_SECTIONS, SETTINGS_SECTIONS, WORKSPACE_NAV_GROUPS } from '../experiences/settings/settings.config';
import { BugReportDialogService } from './bug-report-dialog.service';
import { OrgModeService } from './org-mode.service';

/** A single command-palette action. `run` performs it; the palette closes afterward. */
export interface CommandAction {
  id: string;
  /** Verb + noun, sentence case — the same label the UI uses for this action. */
  label: string;
  icon: PcIconNameType;
  /** Extra words to match against (not shown), e.g. synonyms. */
  keywords?: string;
  run: () => void;
}

/**
 * Central registry + open-state for the command palette (⌘⇧K, and ⌘K on pages
 * with no grid). Navigation actions are GENERATED, never hand-listed:
 *
 *  - "Go to …" comes from `SidebarItems` — the same single source the sidebar and
 *    the g-chord table read — filtered by the same rules the sidebar applies
 *    (adminOnly by role, module visibility by org mode, the inbox plan gate) and
 *    labelled with the same per-mode words, so a church workspace offers
 *    "Go to Visitation" while a campaign offers "Go to Canvassing".
 *  - "Workspace settings → …" comes from `WORKSPACE_NAV_GROUPS` + the two section
 *    registries in settings.config.ts, for admins and owners only (the /workspace
 *    pages are adminOnly).
 *
 * New screens can still call {@link register} to add one-off actions.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly bugReportDialog = inject(BugReportDialogService);
  private readonly auth = inject(AuthService);
  private readonly orgMode = inject(OrgModeService);

  private readonly _isOpen = signal(false);
  public readonly isOpen = this._isOpen.asReadonly();

  private readonly _extra = signal<CommandAction[]>([]);

  /** "Go to …" for every route the sidebar (or its g-chords) would let this user reach. */
  private readonly navActions = computed<CommandAction[]>(() => {
    const user = this.auth.getUserSignal()();
    const privileged = isPrivilegedRole(user?.role);
    const visibilities = this.orgMode.moduleVisibilities();
    const terms = this.orgMode.terms();
    const inboxAllowed = planAllowsFeature(effectivePlanKey(user?.tenant_plan, user?.tenant_demo_mode_at), 'inbox');

    const flat: ISidebarItem[] = [];
    for (const item of SidebarItems) {
      flat.push(item);
      if (item.children) flat.push(...item.children);
    }

    const actions: CommandAction[] = [];
    for (const item of flat) {
      const route = item.route;
      // Entries without a route or an icon are structure (headings, the hidden '/'
      // alias), not destinations. `hidden` items stay IN: Households, Companies and
      // the Task board are deliberately chord-only, and the palette is the other
      // keyboard path to them.
      if (!route || !item.icon) continue;
      if (item.type === 'subheading' || item.type === 'bookmark') continue;
      if (item.adminOnly && !privileged) continue;
      const state = item.moduleId ? visibilities.get(item.moduleId) : undefined;
      if (state === 'offByMode' || state === 'offByUser') continue;
      if (route === '/inbox' && !inboxAllowed) continue;
      actions.push({
        id: `goto-${route}`,
        label: `Go to ${sidebarLabel(item, terms)}`,
        icon: item.icon,
        // The mode-neutral name stays matchable, so "canvassing" still finds
        // church mode's "Go to Visitation".
        keywords: `${item.name} navigate open`,
        run: () => this.go(route),
      });
    }
    return actions;
  });

  /** "Workspace settings → …" deep links, admins and owners only. */
  private readonly settingsActions = computed<CommandAction[]>(() => {
    const user = this.auth.getUserSignal()();
    if (!isPrivilegedRole(user?.role)) return [];

    const byId = new Map<string, { title: string; icon: PcIconNameType }>();
    for (const s of SETTINGS_SECTIONS) byId.set(s.id, { title: s.title, icon: s.icon });
    for (const s of CUSTOM_SECTIONS) byId.set(s.id, { title: s.title, icon: s.icon });

    const actions: CommandAction[] = [];
    for (const group of WORKSPACE_NAV_GROUPS) {
      for (const id of group.ids) {
        const meta = byId.get(id);
        if (!meta) continue;
        actions.push({
          id: `workspace-${id}`,
          label: `Workspace settings → ${meta.title}`,
          icon: meta.icon,
          keywords: `settings configure workspace admin ${id.replace(/-/g, ' ')}`,
          run: () => this.go(`/workspace/${id}`),
        });
      }
    }
    return actions;
  });

  /** Actions that DO something rather than go somewhere. */
  private readonly core: CommandAction[] = [
    {
      id: 'create-newsletter',
      label: 'Create newsletter',
      icon: 'plus',
      keywords: 'new campaign send',
      run: () => this.go('/newsletters/add'),
    },
    {
      id: 'report-bug',
      label: 'Report a bug',
      icon: 'bug-ant',
      keywords: 'issue problem feedback broken error crash',
      run: () => this.bugReportDialog.open(),
    },
    {
      id: 'toggle-theme',
      label: 'Toggle dark mode',
      icon: 'moon',
      keywords: 'light theme appearance',
      run: () => this.theme.toggleTheme(),
    },
    {
      id: 'open-settings',
      label: 'Open settings',
      icon: 'cog-6-tooth',
      keywords: 'preferences account notifications',
      run: () => this.go('/settings/notifications'),
    },
  ];

  /** All registered actions: navigation first, then workspace sections, then the rest. */
  public readonly actions = computed<CommandAction[]>(() => [
    ...this.navActions(),
    ...this.settingsActions(),
    ...this.core,
    ...this._extra(),
  ]);

  public open(): void {
    this._isOpen.set(true);
  }

  public close(): void {
    this._isOpen.set(false);
  }

  public toggle(): void {
    this._isOpen.update((v) => !v);
  }

  /** Register additional actions (e.g. from a newly-loaded screen). Ignores duplicate ids. */
  public register(actions: CommandAction[]): void {
    this._extra.update((existing) => {
      const seen = new Set(existing.map((a) => a.id));
      return [...existing, ...actions.filter((a) => !seen.has(a.id))];
    });
  }

  private go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
