import { Injectable, computed, inject } from '@angular/core';

import {
  DEFAULT_ORG_MODE,
  MODULE_VISIBILITY_SETTINGS_KEY,
  OPTIONAL_MODULES,
  ORG_MODE_SETTINGS_KEY,
  ORG_MODE_TERMS,
  isOrgMode,
  moduleVisibility,
  parseModuleOverrides,
  type ModuleId,
  type ModuleVisibility,
  type OrgMode,
  type TermKey,
} from '@common';

import { AuthService } from '../auth/auth-service';
import { SettingsService } from '../experiences/settings/services/settings-service';

/**
 * Resolves the tenant's organization mode, the wording it implies, and which optional
 * modules belong in the sidebar.
 *
 * Two sources, in this order:
 *
 *  1. The settings snapshot, when it holds the key. Freshest — `SettingsService.upsert()`
 *     replaces the snapshot synchronously on return, so a mode change is visible on the
 *     next tick without waiting for a session refresh.
 *  2. The session user, otherwise. `provideAppInitializer` awaits `auth.init()` before the
 *     router activates, so this is populated ahead of the first sidebar paint.
 *
 * Reading the snapshot alone would flicker on every cold load (nothing calls
 * `settings.load()` at boot — only individual pages do, ad hoc), and would stay wrong
 * forever on pages that never load it. In steady state both sources hold the same value,
 * so the snapshot arriving later resolves to the same string and nothing moves.
 */
@Injectable({ providedIn: 'root' })
export class OrgModeService {
  private readonly auth = inject(AuthService);
  private readonly settings = inject(SettingsService);

  private readonly user = this.auth.getUserSignal();

  public readonly mode = computed<OrgMode>(() => {
    const fromSnapshot = this.settings.snapshotSignal()[ORG_MODE_SETTINGS_KEY];
    if (isOrgMode(fromSnapshot)) return fromSnapshot;

    const fromSession = this.user()?.tenant_org_mode;
    return isOrgMode(fromSession) ? fromSession : DEFAULT_ORG_MODE;
  });

  /** The wording table for the current mode — feed straight to `sidebarLabel()`. */
  public readonly terms = computed<Record<TermKey, string>>(() => ORG_MODE_TERMS[this.mode()]);

  /** Explicit user decisions only; absent modules fall through to the mode's default. */
  public readonly overrides = computed<Partial<Record<ModuleId, boolean>>>(() => {
    const fromSnapshot = this.settings.snapshotSignal()[MODULE_VISIBILITY_SETTINGS_KEY];
    if (fromSnapshot != null) return parseModuleOverrides(fromSnapshot);

    return this.user()?.tenant_module_overrides ?? {};
  });

  /** Per-module resolution including WHO turned it off. The sidebar dims both off
   *  states the same way; the Workspace → Modules page uses the distinction to say
   *  "default for <mode>" vs "you turned this off". */
  public readonly moduleVisibilities = computed<ReadonlyMap<ModuleId, ModuleVisibility>>(() => {
    const mode = this.mode();
    const overrides = this.overrides();
    return new Map(OPTIONAL_MODULES.map((id) => [id, moduleVisibility(mode, id, overrides)]));
  });

  public readonly enabledModules = computed<ReadonlySet<ModuleId>>(
    () => new Set([...this.moduleVisibilities()].filter(([, state]) => state === 'on').map(([id]) => id)),
  );

  public term(key: TermKey): string {
    return this.terms()[key];
  }

  public isEnabled(id: ModuleId): boolean {
    return this.enabledModules().has(id);
  }

  /**
   * Persist a new mode and/or module overrides.
   *
   * Refreshes the session afterwards so its mirrored copy doesn't go stale — without
   * it, the next cold load would paint the previous mode before the snapshot arrived.
   * Same reason `GoLiveService.selectFreePlan()` re-reads the user after saving.
   */
  public async save(next: { mode?: OrgMode; overrides?: Partial<Record<ModuleId, boolean>> }): Promise<void> {
    const entries = [];
    if (next.mode) entries.push({ key: ORG_MODE_SETTINGS_KEY, value: next.mode });
    if (next.overrides) entries.push({ key: MODULE_VISIBILITY_SETTINGS_KEY, value: next.overrides });
    if (!entries.length) return;

    await this.settings.upsert(entries);
    await this.auth.getCurrentUser().catch(() => undefined);
  }
}
