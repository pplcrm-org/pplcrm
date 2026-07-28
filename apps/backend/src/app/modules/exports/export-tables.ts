import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';

/**
 * Export entity key (what the UI asks for, `exportEntitySchema`) -> the table the job actually
 * reads. Several differ: `users` lives in `authusers`, `forms` in `web_forms`, `volunteer` in
 * `volunteer_events`, and `issues` is `tags` filtered by type.
 *
 * Typed as `keyof Models`, which is what caught the second half of this bug: `newsletters` was
 * mapped to `marketing_emails`, a table that no longer exists, so that export could never have
 * succeeded regardless of the allow-list.
 *
 * This map and the allow-list below live together on purpose. They used to be in two files, and
 * the allow-list had been written with *entity keys* while the job checks it against the *mapped
 * table name* — so five of the thirteen export entities (lists, newsletters, users, volunteer,
 * forms) validated at the boundary, created a `data_exports` row, queued a job, and then failed in
 * the worker with "Invalid export entity". The user just saw an export that never arrived.
 * Deriving the allow-list from the map makes that class of drift impossible.
 */
export const EXPORT_ENTITY_TABLE: Record<string, keyof Models> = {
  persons: 'persons',
  households: 'households',
  companies: 'companies',
  tags: 'tags',
  issues: 'tags',
  tasks: 'tasks',
  lists: 'lists',
  newsletters: 'newsletters',
  teams: 'teams',
  users: 'authusers',
  volunteer: 'volunteer_events',
  forms: 'web_forms',
  workflows: 'workflows',
};

/**
 * Tables reachable by passing `table` directly rather than through an entity key. The activity
 * feed's own export does this (activity/controller.ts), and the handler has a bespoke joined
 * query for it.
 */
const DIRECT_TABLES: readonly (keyof Models)[] = ['user_activity'];

/** Every table an export job is permitted to read. */
export const ALLOWED_EXPORT_TABLES: ReadonlySet<string> = new Set<string>([
  ...Object.values(EXPORT_ENTITY_TABLE),
  ...DIRECT_TABLES,
]);
