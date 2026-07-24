import type { PcIconNameType } from '@icons/icons.index';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ThemeService } from '../layout/theme/theme-service';
import { BugReportDialogService } from './bug-report-dialog.service';

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
 * Central registry + open-state for the command palette (⌘⇧K). Core navigation and app
 * actions are seeded here so every screen can reach them; new screens call {@link register}
 * to make their actions appear automatically.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly bugReportDialog = inject(BugReportDialogService);

  private readonly _isOpen = signal(false);
  public readonly isOpen = this._isOpen.asReadonly();

  private readonly _extra = signal<CommandAction[]>([]);

  private readonly core: CommandAction[] = [
    {
      id: 'goto-dashboard',
      label: 'Go to Dashboard',
      icon: 'presentation-chart-line',
      keywords: 'home summary',
      run: () => this.go('/dashboard'),
    },
    {
      id: 'goto-people',
      label: 'Go to People',
      icon: 'identification',
      keywords: 'contacts persons',
      run: () => this.go('/people'),
    },
    { id: 'goto-inbox', label: 'Go to Inbox', icon: 'envelope', keywords: 'email mail', run: () => this.go('/inbox') },
    {
      id: 'goto-newsletters',
      label: 'Go to Newsletters',
      icon: 'megaphone',
      keywords: 'campaigns broadcast',
      run: () => this.go('/newsletters'),
    },
    {
      id: 'goto-workspace',
      label: 'Go to Workspace settings',
      icon: 'cog-6-tooth',
      keywords: 'configuration workspace admin',
      run: () => this.go('/workspace'),
    },
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
      keywords: 'preferences account',
      run: () => this.go('/settings'),
    },
  ];

  /** All registered actions, core first. */
  public readonly actions = computed<CommandAction[]>(() => [...this.core, ...this._extra()]);

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
