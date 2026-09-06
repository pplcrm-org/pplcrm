import { describe, expect, it } from 'vitest';

import {
  CANVASS_UNIVERSE_LABELS,
  CANVASS_UNIVERSE_PRESETS,
  LIST_BACKED_UNIVERSE_PRESETS,
  universeListDescription,
  universeListName,
  universeListRules,
} from './canvass-universes';

describe('canvass universe presets', () => {
  it('every preset has a label, and every list-backed preset has a name, description and rules', () => {
    for (const preset of CANVASS_UNIVERSE_PRESETS) {
      expect(CANVASS_UNIVERSE_LABELS[preset]).toBeTruthy();
    }
    for (const preset of LIST_BACKED_UNIVERSE_PRESETS) {
      expect(universeListName(preset, 30)).toBeTruthy();
      expect(universeListDescription(preset, 30)).toBeTruthy();
      expect(universeListRules(preset, 30).kind).toBe('group');
    }
  });

  it('"everyone" is deliberately not list-backed — it means no list at all', () => {
    expect(LIST_BACKED_UNIVERSE_PRESETS).not.toContain('everyone');
    expect(CANVASS_UNIVERSE_PRESETS).toContain('everyone');
  });

  it('supporters = support_level strong OR leaning', () => {
    const rules = universeListRules('supporters', 30);
    expect(rules.conjunction).toBe('OR');
    expect(rules.rules).toEqual([
      expect.objectContaining({ field: 'support_level', op: 'eq', value: 'strong' }),
      expect.objectContaining({ field: 'support_level', op: 'eq', value: 'leaning' }),
    ]);
  });

  it('untouched = never knocked (last_knock_days is not set)', () => {
    const rules = universeListRules('untouched', 30);
    expect(rules.rules).toEqual([expect.objectContaining({ field: 'last_knock_days', op: 'isEmpty' })]);
  });

  it('not_recent = never knocked OR knocked more than X days ago, with X in the name', () => {
    const rules = universeListRules('not_recent', 14);
    expect(rules.conjunction).toBe('OR');
    expect(rules.rules).toEqual([
      expect.objectContaining({ field: 'last_knock_days', op: 'isEmpty' }),
      expect.objectContaining({ field: 'last_knock_days', op: 'gt', value: 14 }),
    ]);
    expect(universeListName('not_recent', 14)).toBe('Not canvassed in 14 days');
    // Different windows are different lists — the name is the reuse key.
    expect(universeListName('not_recent', 30)).not.toBe(universeListName('not_recent', 14));
  });

  it('fixed-name presets do not vary with the days argument', () => {
    expect(universeListName('supporters', 7)).toBe(universeListName('supporters', 90));
    expect(universeListName('untouched', 7)).toBe(universeListName('untouched', 90));
  });
});
