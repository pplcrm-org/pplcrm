import type { Kysely, Selectable, Transaction } from 'kysely';

import { INBOX_PURGE_DELAY_DAYS, effectivePlanKey, planAllowsFeature } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';

const DAY_MS = 24 * 60 * 60 * 1000;

export type FreshInboxPurgeStatus = Pick<
  Selectable<Models['tenants']>,
  'subscription_plan' | 'demo_mode_at' | 'inbox_purge_scheduled_at'
>;

/**
 * Keep `tenants.inbox_purge_scheduled_at` consistent with the tenant's plan. Called from every
 * code path that writes `subscription_plan` (Stripe webhooks, selectFreePlan, the mock-mode
 * plan switches), so the schedule can never drift from the plan:
 *
 *  - Plan lacks the shared inbox (Free) and the workspace has synced mail or a connected
 *    mailbox → schedule the purge `INBOX_PURGE_DELAY_DAYS` out, unless one is already pending
 *    (a second downgrade event must not push the deadline back).
 *  - Plan includes the inbox (upgrade, or re-upgrade inside the window) → clear the schedule;
 *    nothing is deleted.
 *  - Demo workspaces are never scheduled: their inbox is seeded sample data, part of the free
 *    test drive, and is removed by the go-live flow instead.
 *
 * The actual deletion runs in the `purge_downgraded_inboxes` cron
 * (lib/jobs/handlers/inbox-purge.handlers.ts), which re-reads this same status fresh (see
 * `getFreshInboxPurgeStatus` below) immediately before destroying anything.
 */
export async function syncInboxPurgeSchedule(
  db: Kysely<Models> | Transaction<Models>,
  tenantId: string,
): Promise<void> {
  const tenant = await db
    .selectFrom('tenants')
    .select(['subscription_plan', 'demo_mode_at', 'inbox_purge_scheduled_at'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  if (!tenant) return;

  const hasInbox = planAllowsFeature(effectivePlanKey(tenant.subscription_plan, tenant.demo_mode_at), 'inbox');

  if (hasInbox) {
    if (tenant.inbox_purge_scheduled_at != null) {
      await db.updateTable('tenants').set({ inbox_purge_scheduled_at: null }).where('id', '=', tenantId).execute();
      logger.info(`[inbox-purge] cleared scheduled inbox purge for tenant ${tenantId} (plan includes the inbox)`);
    }
    return;
  }

  if (tenant.inbox_purge_scheduled_at != null) return; // already pending — never extend the deadline

  const hasMail = await db
    .selectFrom('emails')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .limit(1)
    .executeTakeFirst();
  const hasGoogle = hasMail
    ? undefined
    : await db
        .selectFrom('google_oauth_tokens')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .limit(1)
        .executeTakeFirst();
  const hasMs =
    hasMail || hasGoogle
      ? undefined
      : await db
          .selectFrom('ms_oauth_tokens')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .limit(1)
          .executeTakeFirst();
  if (!hasMail && !hasGoogle && !hasMs) return; // nothing to purge

  const purgeAt = new Date(Date.now() + INBOX_PURGE_DELAY_DAYS * DAY_MS);
  await db.updateTable('tenants').set({ inbox_purge_scheduled_at: purgeAt }).where('id', '=', tenantId).execute();
  logger.info(
    `[inbox-purge] tenant ${tenantId} downgraded below the shared inbox — synced mail purge scheduled for ${purgeAt.toISOString()}`,
  );
}

/**
 * Fresh, single-row read of the tenant's plan/demo/schedule status, straight from the database.
 *
 * Used by the `purge_downgraded_inboxes` cron (lib/jobs/handlers/inbox-purge.handlers.ts)
 * immediately before it destroys a tenant's mail. The cron's own due-tenant scan happens once at
 * the start of the run and the purge itself is chunked and can take minutes per tenant, so by the
 * time a given tenant's turn comes up its plan may have changed — an upgrade calls
 * `syncInboxPurgeSchedule` above, which nulls `inbox_purge_scheduled_at`, but nothing makes the
 * cron's in-memory snapshot notice that. Re-reading here, right before the destructive call,
 * closes that window.
 */
export async function getFreshInboxPurgeStatus(
  db: Kysely<Models> | Transaction<Models>,
  tenantId: string,
): Promise<FreshInboxPurgeStatus | undefined> {
  return db
    .selectFrom('tenants')
    .select(['subscription_plan', 'demo_mode_at', 'inbox_purge_scheduled_at'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
}

/**
 * True only if, as of right now, the tenant should still have its synced mail destroyed: the plan
 * still excludes the shared inbox, the workspace is not a demo, and `inbox_purge_scheduled_at` is
 * set and has passed. Reuses `planAllowsFeature` so the "does this plan include the inbox" rule
 * lives in exactly one place.
 */
export function inboxPurgeStillDue(status: FreshInboxPurgeStatus): boolean {
  if (planAllowsFeature(status.subscription_plan, 'inbox') || status.demo_mode_at != null) return false;
  if (status.inbox_purge_scheduled_at == null) return false;
  return status.inbox_purge_scheduled_at <= new Date();
}
