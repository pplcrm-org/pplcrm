import type { QueryBuilderGroupNode } from './schemas/core.schema';

/**
 * Built-in lists (§8) — the two segments every campaign context always has.
 *
 * They are ordinary smart lists in every respect except that the product owns
 * them: `lists.system_key` is set, which makes them undeletable and
 * unrenameable, and `ensureSystemLists()` re-creates any that go missing. They
 * are deliberately NOT part of the demo dataset, so exiting demo mode leaves
 * them standing (with the demo people gone, they simply read zero).
 *
 * Shared here so the backend seeder, the frontend copy, and the specs all agree
 * on one definition of "All Subscribers" / "All Volunteers".
 */

export const SYSTEM_LIST_KEYS = ['all_subscribers', 'all_volunteers'] as const;

export type SystemListKey = (typeof SYSTEM_LIST_KEYS)[number];

export interface SystemListDef {
  key: SystemListKey;
  name: string;
  description: string;
  object: 'people';
  /** The rule tree stored under `definition.advancedFilterModel`. */
  rules: QueryBuilderGroupNode;
}

/**
 * "Subscribed" here is the campaign_subscriptions status, resolved against the
 * list's own campaign context — the same three-layer consent model newsletters
 * send against (§15). "A volunteer" is any non-NULL `volunteer_status`, which
 * is what every other volunteer surface means by it.
 */
export const SYSTEM_LISTS: readonly SystemListDef[] = [
  {
    key: 'all_subscribers',
    name: 'All Subscribers',
    description:
      'Everyone who has opted in to email in this context. Built in — refreshes itself and can’t be deleted.',
    object: 'people',
    rules: {
      kind: 'group',
      id: 'system-all-subscribers',
      conjunction: 'AND',
      rules: [{ kind: 'rule', id: 'subscribed', field: 'subscription_status', op: 'eq', value: 'subscribed' }],
    },
  },
  {
    key: 'all_volunteers',
    name: 'All Volunteers',
    description:
      'Everyone with a volunteer standing, whatever its stage. Built in — refreshes itself and can’t be deleted.',
    object: 'people',
    rules: {
      kind: 'group',
      id: 'system-all-volunteers',
      conjunction: 'AND',
      rules: [{ kind: 'rule', id: 'is-volunteer', field: 'volunteer_status', op: 'isNotEmpty' }],
    },
  },
] as const;

/** The stored `lists.definition` document for a built-in list. */
export function systemListDefinition(def: SystemListDef): {
  advancedFilterModel: QueryBuilderGroupNode;
  tags: string[];
} {
  return { advancedFilterModel: def.rules, tags: [] };
}
