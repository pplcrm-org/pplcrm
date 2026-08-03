import type { QueryBuilderGroupNode, QueryBuilderNode } from '../../../../../../../libs/common/src';
import { ruleFieldLabel, ruleOpUsesSetWording, ruleValueLabel } from './list-rule-fields';

/**
 * Render a list's stored rule `definition` as the human "DEFINITION" sentence
 * shown in the Lists table (§8) — e.g. "Volunteer status is 'Active' and City
 * contains 'Ottawa'". Field and value labels come from list-rule-fields, the
 * same source the rule builder's pickers use. Static lists with a hand-picked
 * membership (no rules) read as "Hand-picked members"; an empty rule set reads
 * as "Everyone".
 */

const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  equals: 'equals',
  notEquals: 'does not equal',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  empty: 'is empty',
  notempty: 'is not empty',
};

/**
 * On a status field the picker offers "is set" / "is not set" rather than "is
 * empty" — a volunteer status that is absent means "not a volunteer", not "an
 * empty string". The sentence has to use the same words.
 */
const CHOICE_OP_LABELS: Record<string, string> = {
  isEmpty: 'is not set',
  empty: 'is not set',
  isNotEmpty: 'is set',
  notempty: 'is set',
};

const VALUELESS_OPS = new Set(['isEmpty', 'isNotEmpty', 'empty', 'notempty']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function opLabel(field: string, op: string): string {
  if (ruleOpUsesSetWording(field) && CHOICE_OP_LABELS[op]) return CHOICE_OP_LABELS[op];
  return OP_LABELS[op] ?? op;
}

function describeNode(node: QueryBuilderNode, seatLabel: string | null): string {
  if (node.kind === 'rule') {
    const label = ruleFieldLabel(node.field, seatLabel);
    const op = opLabel(node.field, node.op);
    if (VALUELESS_OPS.has(node.op)) return `${label} ${op}`;
    // Enum values are shown the way the picker showed them, not raw
    // ('leaning_against' → 'Leaning against').
    const value = node.value == null || String(node.value).trim() === '' ? '…' : ruleValueLabel(node.field, node.value);
    return `${label} ${op} '${value}'`;
  }
  return describeGroup(node, seatLabel);
}

function describeGroup(group: QueryBuilderGroupNode, seatLabel: string | null): string {
  if (!group.rules?.length) return 'Everyone';
  const joiner = group.conjunction === 'OR' ? ' or ' : ' and ';
  const parts = group.rules.map((rule) => describeNode(rule, seatLabel));
  return parts.join(joiner);
}

function asGroup(value: unknown): QueryBuilderGroupNode | null {
  if (!isRecord(value)) return null;
  if (value['kind'] !== 'group' || !Array.isArray(value['rules'])) return null;
  const conjunction = value['conjunction'] === 'OR' ? 'OR' : 'AND';
  return { kind: 'group', id: String(value['id'] ?? 'root'), conjunction, rules: value['rules'] as QueryBuilderNode[] };
}

/**
 * Human sentence for a list's rule definition; `null` inputs read as hand-picked.
 *
 * `seatLabel` is the active campaign's word for the seat it contests (Ward, Riding, Congressional
 * district). Pass it so a rule on the single-valued electoral field reads in the same words the
 * rule builder offered. Omitting it falls back to the neutral "Electoral area".
 */
export function describeListDefinition(definition: unknown, seatLabel: string | null = null): string {
  if (!isRecord(definition)) return 'Hand-picked members';
  const group = asGroup(definition['advancedFilterModel']);
  if (!group) return 'Hand-picked members';
  if (!group.rules.length) return 'Everyone';
  return describeGroup(group, seatLabel);
}
