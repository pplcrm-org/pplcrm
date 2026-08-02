import { signal, Service, inject, effect } from '@angular/core';
import { SettingsService } from '../../experiences/settings/services/settings-service';

/** What the user asked for; 'system' follows the OS `prefers-color-scheme`. */
export type ThemePreference = 'light' | 'dark' | 'system';

@Service()
export class ThemeService {
  private readonly theme = signal<'light' | 'dark'>('light');
  /** The user's stated preference (drives the settings segmented control). */
  private readonly preference = signal<ThemePreference>('system');
  private readonly settingsSvc = inject(SettingsService, { optional: true });

  constructor() {
    this.updateTheme();

    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
      this.updateTheme();
    });

    // Keep <html data-theme> in step with the resolved theme. app.ts already puts the
    // theme on a div inside <pc-root>, which covers everything Angular renders — but not
    // the document canvas, the scrollbars, or native form controls, which follow the root
    // element's theme and its `color-scheme`. index.html stamps a first value before the
    // bundle boots (from localStorage or the OS); this keeps that value correct
    // afterwards, including once the workspace default arrives, which index.html cannot
    // see.
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
    });

    const svc = this.settingsSvc;
    if (svc) {
      effect(() => {
        // Access the snapshot signal to trigger reactive updates
        svc.snapshotSignal();
        this.updateTheme();
      });
    }
  }

  /** The resolved theme actually applied to the UI. */
  public getTheme() {
    return this.theme();
  }

  /** The user's stated preference: 'light', 'dark', or 'system'. */
  public getPreference(): ThemePreference {
    return this.preference();
  }

  public toggleTheme() {
    this.setPreference(this.theme() === 'light' ? 'dark' : 'light');
  }

  public setPreference(pref: ThemePreference) {
    // 'system' is stored explicitly so it wins over any workspace default and
    // follows the OS live via the matchMedia listener.
    localStorage.setItem('pc-theme', pref);
    this.updateTheme();
  }

  private updateTheme() {
    // The workspace default is a *default*, not an override: it seeds users who have never
    // stated a preference and is otherwise ignored. (It used to clear `pc-theme` whenever it
    // changed, so an admin flipping the workspace theme unpinned everyone who had chosen one.)
    const defaultTheme = this.settingsSvc?.getValue<string>('appearance.theme') ?? null;

    const stored = localStorage.getItem('pc-theme');
    if (stored === 'light' || stored === 'dark') {
      this.preference.set(stored);
      this.theme.set(stored);
      return;
    }

    if (stored === 'system') {
      this.preference.set('system');
      this.theme.set(this.systemTheme());
      return;
    }

    // No personal override: follow the workspace default, else the OS. Reported
    // to the UI as 'system' since the user hasn't pinned a specific theme.
    this.preference.set('system');
    if (defaultTheme === 'light' || defaultTheme === 'dark') {
      this.theme.set(defaultTheme);
      return;
    }
    this.theme.set(this.systemTheme());
  }

  private systemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
}
