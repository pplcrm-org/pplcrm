import type { Kysely, Transaction } from 'kysely';

import { INBOX_PURGE_DELAY_DAYS, planAllowsFeature } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * (lib/jobs/handlers/inbox-purge.handlers.ts), which re-checks the plan before destroying
 * anything.
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

  const hasInbox = planAllowsFeature(tenant.subscription_plan, 'inbox');

  if (hasInbox || tenant.demo_mode_at != null) {
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
