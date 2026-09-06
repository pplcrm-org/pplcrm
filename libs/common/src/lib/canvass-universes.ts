import type { QueryBuilderGroupNode } from './schemas/core.schema';

/**
 * Universe presets for turf cutting (§13) — the named one-click answers to
 * "who are we sending volunteers to?".
 *
 * The operator's rule (2026-09-05): the universe choice must be explicit and
 * discoverable — "Everyone", "All supporters", "All untouched", "Not canvassed
 * in the past X days" — never something a user has to reverse-engineer from the
 * list builder. Three of the four are ordinary smart lists the backend creates
 * on demand (`canvassing.ensureUniverseList`); "everyone" is deliberately NOT a
 * list — it means every located household in the workspace, expressed as a turf
 * with `list_id = null`.
 *
 * Shared here so the cut wizard's cards, the backend's list factory, and the
 * specs all agree on one spelling of each universe.
 */

export const CANVASS_UNIVERSE_PRESETS = ['everyone', 'supporters', 'untouched', 'not_recent'] as const;

export type CanvassUniversePreset = (typeof CANVASS_UNIVERSE_PRESETS)[number];

/** The presets that are backed by a smart list — everything except "everyone". */
export const LIST_BACKED_UNIVERSE_PRESETS = ['supporters', 'untouched', 'not_recent'] as const;

export type ListBackedUniversePreset = (typeof LIST_BACKED_UNIVERSE_PRESETS)[number];

export const CANVASS_UNIVERSE_LABELS: Record<CanvassUniversePreset, string> = {
  everyone: 'Everyone',
  supporters: 'All supporters',
  untouched: 'All untouched',
  not_recent: 'Not canvassed recently',
};

export const CANVASS_UNIVERSE_DESCRIPTIONS: Record<CanvassUniversePreset, string> = {
  everyone: 'Every household with a location on the map. No list — the whole workspace.',
  supporters: 'People identified as Strong or Leaning supporters in this campaign.',
  untouched: 'People no canvasser has ever knocked.',
  not_recent: 'People never knocked, or last knocked more than the chosen number of days ago.',
};

/** The wizard's default for "Not canvassed in the past X days". */
export const DEFAULT_NOT_RECENT_DAYS = 30;

/**
 * The name the created smart list carries — also the reuse key: asking for the
 * same preset twice returns the existing list instead of minting "All
 * supporters (2)".
 */
export function universeListName(preset: ListBackedUniversePreset, days: number): string {
  switch (preset) {
    case 'supporters':
      return 'All supporters';
    case 'untouched':
      return 'Never canvassed';
    case 'not_recent':
      return `Not canvassed in ${days} days`;
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}

export function universeListDescription(preset: ListBackedUniversePreset, days: number): string {
  switch (preset) {
    case 'supporters':
      return 'Everyone whose support level is Strong or Leaning. Created by the turf-cutting wizard.';
    case 'untouched':
      return 'Everyone with no door knock on record. Created by the turf-cutting wizard.';
    case 'not_recent':
      return `Everyone never knocked, or last knocked more than ${days} days ago. Created by the turf-cutting wizard.`;
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}

/**
 * The rule tree stored under `definition.advancedFilterModel` — the same
 * document the list builder saves, so the created list opens and edits like any
 * hand-made smart list.
 *
 * Field names must exist in the persons repo's `columnMapping` or the rule is
 * silently dropped (see list-rule-fields.ts): `support_level` maps to the
 * campaign person facts, `last_knock_days` to the computed activity stats
 * (numeric; NULL = never knocked, which `isEmpty` reads as "never").
 */
export function universeListRules(preset: ListBackedUniversePreset, days: number): QueryBuilderGroupNode {
  switch (preset) {
    case 'supporters':
      return {
        kind: 'group',
        id: 'universe-supporters',
        conjunction: 'OR',
        rules: [
          { kind: 'rule', id: 'support-strong', field: 'support_level', op: 'eq', value: 'strong' },
          { kind: 'rule', id: 'support-leaning', field: 'support_level', op: 'eq', value: 'leaning' },
        ],
      };
    case 'untouched':
      return {
        kind: 'group',
        id: 'universe-untouched',
        conjunction: 'AND',
        rules: [{ kind: 'rule', id: 'never-knocked', field: 'last_knock_days', op: 'isEmpty' }],
      };
    case 'not_recent':
      return {
        kind: 'group',
        id: 'universe-not-recent',
        conjunction: 'OR',
        rules: [
          { kind: 'rule', id: 'never-knocked', field: 'last_knock_days', op: 'isEmpty' },
          { kind: 'rule', id: 'knocked-long-ago', field: 'last_knock_days', op: 'gt', value: days },
        ],
      };
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}
