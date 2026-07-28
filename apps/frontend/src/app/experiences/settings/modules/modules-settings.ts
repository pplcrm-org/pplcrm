import { Component, computed, inject, signal } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';

import {
  ORG_MODES,
  ORG_MODE_DESCRIPTIONS,
  ORG_MODE_LABELS,
  ORG_MODE_MODULE_DEFAULTS,
  OPTIONAL_MODULES,
  type ModuleId,
  type OrgMode,
} from '@common';

import { OrgModeService } from '../../../services/org-mode.service';

/** What each optional module is, in one line, for the toggle row. */
const MODULE_BLURBS: Record<ModuleId, string> = {
  canvassing: 'Cut turfs, assign them, and record what happened at each door.',
  deliveries: 'Collect drop-off requests and plan volunteer routes for them.',
  donations: 'Take online gifts, track pledges, and reconcile what came in.',
  volunteerAccess: 'Approve the volunteers who use the companion apps on their phones.',
};

/** Sidebar wording per module, so a toggle row names what the user actually sees. */
const MODULE_TERM: Record<ModuleId, 'nav.canvassing' | 'nav.deliveries' | 'nav.donations' | null> = {
  canvassing: 'nav.canvassing',
  deliveries: 'nav.deliveries',
  donations: 'nav.donations',
  volunteerAccess: null,
};

const MODULE_STATIC_LABEL: Record<ModuleId, string> = {
  canvassing: 'Canvassing',
  deliveries: 'Deliveries',
  donations: 'Donations',
  volunteerAccess: 'Approvals',
};

/**
 * Workspace → Modules.
 *
 * Two settings that belong together: what kind of organization this is, and which
 * optional modules are in the sidebar. The first picks defaults for the second.
 *
 * Every module is listed whether it is on or off — a mode narrows the starting set, it
 * never takes a capability away, and a module the user cannot find is a module they
 * cannot turn back on. Each row says why it is in its current state, so "off" reads as
 * a decision rather than a missing feature (design §2, disclosure over suppression).
 */
@Component({
  selector: 'pc-modules-settings',
  imports: [Icon],
  templateUrl: './modules-settings.html',
})
export class ModulesSettings {
  private readonly orgMode = inject(OrgModeService);
  private readonly alerts = inject(AlertService);

  protected readonly modes = ORG_MODES;
  protected readonly modules = OPTIONAL_MODULES;
  protected readonly modeLabels = ORG_MODE_LABELS;
  protected readonly modeDescriptions = ORG_MODE_DESCRIPTIONS;

  protected readonly mode = this.orgMode.mode;
  protected readonly saving = signal(false);

  /** True when the user has overridden at least one module away from the mode default. */
  protected readonly hasOverrides = computed(() => Object.keys(this.orgMode.overrides()).length > 0);

  protected isEnabled(id: ModuleId): boolean {
    return this.orgMode.isEnabled(id);
  }

  protected moduleLabel(id: ModuleId): string {
    const term = MODULE_TERM[id];
    return term ? this.orgMode.term(term) : MODULE_STATIC_LABEL[id];
  }

  protected blurb(id: ModuleId): string {
    return MODULE_BLURBS[id];
  }

  /** Narrates whether the current state came from the mode or from the user. */
  protected stateNote(id: ModuleId): string {
    const on = this.isEnabled(id);
    const overridden = this.orgMode.overrides()[id] !== undefined;
    if (overridden) return on ? 'On · you turned this on' : 'Off · you turned this off';
    return on
      ? `On · default for ${this.modeLabels[this.mode()].toLowerCase()}`
      : `Off · default for ${this.modeLabels[this.mode()].toLowerCase()}`;
  }

  protected async selectMode(mode: OrgMode): Promise<void> {
    if (mode === this.mode() || this.saving()) return;
    await this.persist({ mode }, `Switched to ${this.modeLabels[mode].toLowerCase()}.`);
  }

  protected async toggleModule(id: ModuleId): Promise<void> {
    if (this.saving()) return;
    const next = { ...this.orgMode.overrides(), [id]: !this.isEnabled(id) };
    await this.persist({ overrides: next }, `${this.moduleLabel(id)} ${next[id] ? 'turned on' : 'turned off'}.`);
  }

  /** Drop every override so the mode's defaults apply again. */
  protected async resetToDefaults(): Promise<void> {
    if (this.saving() || !this.hasOverrides()) return;
    await this.persist({ overrides: {} }, `Reset to the ${this.modeLabels[this.mode()].toLowerCase()} defaults.`);
  }

  protected defaultFor(id: ModuleId): boolean {
    return ORG_MODE_MODULE_DEFAULTS[this.mode()][id];
  }

  private async persist(
    next: { mode?: OrgMode; overrides?: Partial<Record<ModuleId, boolean>> },
    success: string,
  ): Promise<void> {
    this.saving.set(true);
    try {
      await this.orgMode.save(next);
      this.alerts.showSuccess(success);
    } catch {
      this.alerts.showError("That didn't save. Please try again.");
    } finally {
      this.saving.set(false);
    }
  }
}
