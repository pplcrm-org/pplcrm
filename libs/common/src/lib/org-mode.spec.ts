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
   * The regression guard. `office` is the default mode, so an existing workspace and
   * a plain signup both land on it — its wording and its module set must stay
   * byte-identical to what shipped before modes existed. If one of these fails,
   * introducing a mode changed the product for everyone who never asked for one.
   */
  describe('the default mode is today’s product', () => {
    it('uses the shipped sidebar strings', () => {
      expect(ORG_MODE_TERMS[DEFAULT_ORG_MODE]).toEqual({
        'nav.canvassing': 'Canvassing',
        'nav.deliveries': 'Deliveries',
        'nav.donations': 'Donations',
      });
    });

    it('leaves every optional module on', () => {
      for (const id of OPTIONAL_MODULES) {
        expect(ORG_MODE_MODULE_DEFAULTS[DEFAULT_ORG_MODE][id], id).toBe(true);
      }
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
