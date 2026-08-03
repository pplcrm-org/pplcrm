import { describe, expect, it } from 'vitest';

import { describeListDefinition } from './list-definition';
import {
  ANY_ELECTORAL_AREA_FIELD,
  ELECTORAL_AREA_FIELD,
  RULE_FIELD_LABELS,
  ruleFieldLabel,
  ruleOpUsesSetWording,
} from './list-rule-fields';

/**
 * The rule builder drops any rule whose field the backend cannot map, silently, so the two
 * electoral fields have to stay spelled exactly as the backend's column mapping spells them
 * (`households.repo.ts` and `persons.repo.ts`). These assertions are the tripwire for a rename.
 */
describe('electoral rule fields', () => {
  it('uses the exact field names the backend column mapping resolves', () => {
    expect(ELECTORAL_AREA_FIELD).toBe('electoral_area');
    expect(ANY_ELECTORAL_AREA_FIELD).toBe('any_electoral_area');
  });

  it('offers neutral labels when no campaign jurisdiction is declared', () => {
    expect(RULE_FIELD_LABELS[ELECTORAL_AREA_FIELD]).toBe('Electoral area');
    expect(ruleFieldLabel(ELECTORAL_AREA_FIELD)).toBe('Electoral area');
    expect(ruleFieldLabel(ANY_ELECTORAL_AREA_FIELD)).toBe('Any electoral boundary');
  });

  it("names the single-valued field with the campaign's own word", () => {
    expect(ruleFieldLabel(ELECTORAL_AREA_FIELD, 'Riding')).toBe('Riding');
    expect(ruleFieldLabel(ELECTORAL_AREA_FIELD, 'Congressional district')).toBe('Congressional district');
  });

  it('never applies the campaign word to the all-levels field', () => {
    // It spans a federal riding, a city ward and a precinct at the same time, so no single word
    // is true of it.
    expect(ruleFieldLabel(ANY_ELECTORAL_AREA_FIELD, 'Riding')).toBe('Any electoral boundary');
  });

  it('reads an absent boundary as "not set" rather than "empty"', () => {
    expect(ruleOpUsesSetWording(ELECTORAL_AREA_FIELD)).toBe(true);
    expect(ruleOpUsesSetWording(ANY_ELECTORAL_AREA_FIELD)).toBe(true);
    // A free-text field genuinely can be an empty string, so it keeps the original wording.
    expect(ruleOpUsesSetWording('city')).toBe(false);
  });
});

describe('the saved definition sentence', () => {
  const definitionWith = (field: string, op: string, value: string) => ({
    advancedFilterModel: {
      kind: 'group',
      id: 'root',
      conjunction: 'AND',
      rules: [{ kind: 'rule', id: 'r1', field, op, value }],
    },
  });

  it("describes an electoral rule in the campaign's own word", () => {
    const sentence = describeListDefinition(definitionWith(ELECTORAL_AREA_FIELD, 'equals', 'Ward 4'), 'Ward');
    expect(sentence).toBe("Ward equals 'Ward 4'");
  });

  it('falls back to neutral wording when no campaign word is supplied', () => {
    const sentence = describeListDefinition(definitionWith(ELECTORAL_AREA_FIELD, 'equals', 'Ward 4'));
    expect(sentence).toBe("Electoral area equals 'Ward 4'");
  });

  it('describes an all-levels rule as a contains test', () => {
    const sentence = describeListDefinition(
      definitionWith(ANY_ELECTORAL_AREA_FIELD, 'contains', 'Precinct 12'),
      'Ward',
    );
    expect(sentence).toBe("Any electoral boundary contains 'Precinct 12'");
  });

  it('says "is not set" for an absent boundary', () => {
    const sentence = describeListDefinition(definitionWith(ELECTORAL_AREA_FIELD, 'isEmpty', ''), 'Ward');
    expect(sentence).toBe('Ward is not set');
  });
});
