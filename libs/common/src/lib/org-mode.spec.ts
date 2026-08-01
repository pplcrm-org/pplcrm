import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ORG_MODE,
  MODULE_VISIBILITY_SETTINGS_KEY,
  ORG_MODES,
  ORG_MODE_DESCRIPTIONS,
  ORG_MODE_LABELS,
  ORG_MODE_MODULE_DEFAULTS,
  ORG_MODE_SEEDS_DEMO,
  ORG_MODE_SETTINGS_KEY,
  ORG_MODE_TERMS,
  OPTIONAL_MODULES,
  TERM_KEYS,
  isModuleEnabled,
  isOrgMode,
  moduleVisibility,
  parseModuleOverrides,
  termFor,
} from './org-mode';

describe('org-mode', () => {
  describe('totality', () => {
    it('gives every mode a non-empty string for every term key', () => {
      for (const mode of ORG_MODES) {
        for (const key of TERM_KEYS) {
          expect(ORG_MODE_TERMS[mode][key], `${mode}.${key}`).toBeTypeOf('string');
          expect(ORG_MODE_TERMS[mode][key].trim(), `${mode}.${key}`).not.toBe('');
        }
      }
    });

    it('gives every mode a boolean for every optional module', () => {
      for (const mode of ORG_MODES) {
        for (const id of OPTIONAL_MODULES) {
          expect(ORG_MODE_MODULE_DEFAULTS[mode][id], `${mode}.${id}`).toBeTypeOf('boolean');
        }
      }
    });

    it('gives every mode a label, a description, and a demo-seed decision', () => {
      for (const mode of ORG_MODES) {
        expect(ORG_MODE_LABELS[mode].trim(), mode).not.toBe('');
        expect(ORG_MODE_DESCRIPTIONS[mode].trim(), mode).not.toBe('');
        expect(ORG_MODE_SEEDS_DEMO[mode], mode).toBeTypeOf('boolean');
      }
    });
  });

  /**
   * `office` is the default mode, so an existing workspace and a plain signup both land on
   * it. It is no longer byte-identical to the pre-modes product — an office starts with
   * Donations off and calls canvassing "Door knocking" — so what is guarded here is the part
   * that still must not move for an existing workspace: the modules it can reach.
   *
   * Donations-off is safe for existing workspaces ONLY because
   * `2026-07-29-office-mode-differentiation.ts` stamps `{donations: true}` into their sparse
   * override map. Turning another default off without that backfill removes a nav entry from
   * every workspace that predates modes — assert the pairing here, not just the value.
   */
  describe('the default mode', () => {
    it('keeps every module an existing workspace uses reachable by default', () => {
      for (const id of OPTIONAL_MODULES.filter((m) => m !== 'donations')) {
        expect(ORG_MODE_MODULE_DEFAULTS[DEFAULT_ORG_MODE][id], id).toBe(true);
      }
    });

    /** The one deliberate exception — an office does not fundraise; its association does. */
    it('starts a constituency office without donations', () => {
      expect(ORG_MODE_MODULE_DEFAULTS[DEFAULT_ORG_MODE].donations).toBe(false);
    });

    /** Off by default, but still nameable — a user who turns it back on needs a label. */
    it('still names every term, including the modules it starts with off', () => {
      expect(ORG_MODE_TERMS[DEFAULT_ORG_MODE]).toEqual({
        'nav.canvassing': 'Door knocking',
        'nav.deliveries': 'Deliveries',
        'nav.donations': 'Donations',
      });
    });

    it('still seeds the demo dataset', () => {
      expect(ORG_MODE_SEEDS_DEMO[DEFAULT_ORG_MODE]).toBe(true);
    });
  });

  describe('isOrgMode', () => {
    it('accepts every declared mode', () => {
      for (const mode of ORG_MODES) expect(isOrgMode(mode)).toBe(true);
    });

    it('rejects anything else', () => {
      for (const value of ['', 'CHURCH', 'temple', 0, 1, null, undefined, {}, ['church']]) {
        expect(isOrgMode(value), JSON.stringify(value) ?? 'undefined').toBe(false);
      }
    });
  });

  describe('termFor', () => {
    it('reads the table', () => {
      expect(termFor('church', 'nav.donations')).toBe('Giving');
      expect(termFor('campaign', 'nav.donations')).toBe('Donations');
    });
  });

  describe('isModuleEnabled', () => {
    it('falls back to the mode default when there is no override', () => {
      expect(isModuleEnabled('church', 'canvassing')).toBe(false);
      expect(isModuleEnabled('campaign', 'canvassing')).toBe(true);
      expect(isModuleEnabled('church', 'canvassing', {})).toBe(false);
      expect(isModuleEnabled('church', 'canvassing', null)).toBe(false);
    });

    it('lets an explicit override win in both directions', () => {
      expect(isModuleEnabled('church', 'canvassing', { canvassing: true })).toBe(true);
      expect(isModuleEnabled('campaign', 'canvassing', { canvassing: false })).toBe(false);
    });

    it('is unaffected by an override on a different module', () => {
      expect(isModuleEnabled('church', 'canvassing', { deliveries: true })).toBe(false);
    });
  });

  /** The three-way split the sidebar renders from: on / dimmed (mode default) / hidden (user). */
  describe('moduleVisibility', () => {
    it('reports a module the mode default leaves off as offByMode', () => {
      expect(moduleVisibility('office', 'donations')).toBe('offByMode');
      expect(moduleVisibility('church', 'canvassing', {})).toBe('offByMode');
      expect(moduleVisibility('nonprofit', 'deliveries', null)).toBe('offByMode');
    });

    it('reports a module the user explicitly turned off as offByUser', () => {
      expect(moduleVisibility('campaign', 'donations', { donations: false })).toBe('offByUser');
    });

    /** Even when the override agrees with the mode default, the user's decision owns the state. */
    it('attributes the off state to the user when their override matches the default', () => {
      expect(moduleVisibility('church', 'canvassing', { canvassing: false })).toBe('offByUser');
    });

    it('reports on whether enabled by default or by override', () => {
      expect(moduleVisibility('campaign', 'canvassing')).toBe('on');
      expect(moduleVisibility('church', 'canvassing', { canvassing: true })).toBe('on');
    });

    it('is unaffected by an override on a different module', () => {
      expect(moduleVisibility('church', 'canvassing', { deliveries: true })).toBe('offByMode');
    });

    it('agrees with isModuleEnabled for every mode, module, and override shape', () => {
      const overrideShapes = [undefined, {}, { canvassing: true }, { canvassing: false }, { donations: false }];
      for (const mode of ORG_MODES) {
        for (const id of OPTIONAL_MODULES) {
          for (const overrides of overrideShapes) {
            expect(isModuleEnabled(mode, id, overrides), `${mode}.${id} ${JSON.stringify(overrides)}`).toBe(
              moduleVisibility(mode, id, overrides) === 'on',
            );
          }
        }
      }
    });
  });

  describe('parseModuleOverrides', () => {
    it('keeps only known modules with boolean values', () => {
      expect(parseModuleOverrides({ canvassing: true, deliveries: 'yes', inbox: false })).toEqual({
        canvassing: true,
      });
    });

    it('returns an empty map for anything that is not a plain object', () => {
      for (const value of [null, undefined, 'church', 7, ['canvassing']]) {
        expect(parseModuleOverrides(value)).toEqual({});
      }
    });

    /** Sparse is the contract: an untouched module must not be frozen into the map. */
    it('does not invent entries for modules the user never touched', () => {
      const parsed = parseModuleOverrides({ canvassing: false });
      expect(Object.keys(parsed)).toEqual(['canvassing']);
    });
  });

  describe('settings keys', () => {
    it('are namespaced so they cannot collide with an existing key', () => {
      expect(ORG_MODE_SETTINGS_KEY).toBe('workspace.mode');
      expect(MODULE_VISIBILITY_SETTINGS_KEY).toBe('workspace.modules');
    });
  });
});
