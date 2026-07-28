import type { Kysely } from 'kysely';
import type { Models } from '../../../../../libs/common/src/lib/kysely.models';
import { BadRequestError } from '../errors/app-errors';

/**
 * `assigned_to` / assignee lookups against `authusers`.
 *
 * Two things make this its own module rather than an inline query at each callsite:
 *
 * 1. **The FK does not scope by tenant.** `fk_tasks_assigned_to` references `authusers(id)`
 *    and is not composite with `tenant_id`, so Postgres will happily store an `assigned_to`
 *    belonging to another tenant on `tasks`, `persons` and `emails`. Nothing else validates it.
 * 2. **`authusers` is on the `local/no-unscoped-db-query` ignore list**, so the lint rule that
 *    normally catches a missing `.where('tenant_id', ...)` is silent here. Row-level security
 *    still blocks the read on the tRPC path, but that degrades an unscoped lookup to a silently
 *    missing notification rather than an error — the app layer needs its own scope.
 *
 * Use {@link assertAssigneeInTenant} on the write path (prevention) and
 * {@link findAssigneeForNotification} on the notify path (defence in depth).
 */

/** The assignee fields every "you were assigned X" notification needs. */
export interface AssigneeNotificationTarget {
  email: string | null;
  first_name: string | null;
  profile_preferences: unknown;
}

/**
 * Reject an `assigned_to` that is not a member of this tenant, before it is written.
 * A null/undefined assignee is "unassigned" and always allowed.
 */
export async function assertAssigneeInTenant(
  db: Kysely<Models>,
  tenantId: string,
  assignedTo: string | null | undefined,
): Promise<void> {
  if (assignedTo == null || assignedTo === '') return;

  const member = await db
    .selectFrom('authusers')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', assignedTo)
    .executeTakeFirst();

  if (!member) {
    throw new BadRequestError('That assignee is not a member of this workspace.');
  }
}

/**
 * Load the assignee's notification details, scoped to the tenant. Returns undefined when the
 * assignee is not a member, in which case the caller simply sends nothing.
 */
export async function findAssigneeForNotification(
  db: Kysely<Models>,
  tenantId: string,
  assignedTo: string,
): Promise<AssigneeNotificationTarget | undefined> {
  return db
    .selectFrom('authusers')
    .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
    .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
    .where('authusers.tenant_id', '=', tenantId)
    .where('authusers.id', '=', assignedTo)
    .executeTakeFirst();
}
