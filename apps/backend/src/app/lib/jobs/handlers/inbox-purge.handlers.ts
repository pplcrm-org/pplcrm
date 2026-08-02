import type { Kysely } from 'kysely';

import { planAllowsFeature } from '@common';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { EmailIngesterService } from '../../../modules/emails/services/email-ingester.service';
import { CRON_JOBS } from '../cron-registry';
import { scheduleNextRun } from '../reschedule';

/**
 * Nightly: permanently delete the synced shared-inbox mail of workspaces whose
 * `inbox_purge_scheduled_at` deadline (set 30 days after a downgrade to Free — see
 * modules/billing/inbox-purge.ts) has passed. Also removes the Gmail/Microsoft OAuth grants:
 * a workspace without the inbox feature should not keep standing access to a customer mailbox.
 *
 * The plan is re-checked per tenant before anything is destroyed — an upgrade clears the
 * schedule, but a stale row must never cost a paying workspace its mail.
 */
export async function handlePurgeDowngradedInboxes(db: Kysely<Models>): Promise<void> {
  try {
    // NOTE: unscoped by design — the cron scans every tenant for a due purge deadline.
    // eslint-disable-next-line local/no-unscoped-db-query
    const due = await db
      .selectFrom('tenants')
      .select(['id', 'subscription_plan', 'demo_mode_at'])
      .where('inbox_purge_scheduled_at', '<=', new Date())
      .execute();

    for (const tenant of due) {
      const tenantId = String(tenant.id);
      try {
        // Defense in depth: upgrades (and demo workspaces) should never reach here, but a stale
        // schedule row must not destroy an entitled workspace's inbox.
        if (planAllowsFeature(tenant.subscription_plan, 'inbox') || tenant.demo_mode_at != null) {
          await db.updateTable('tenants').set({ inbox_purge_scheduled_at: null }).where('id', '=', tenantId).execute();
          logger.info(`[inbox-purge] skipped tenant ${tenantId}: plan regained the inbox before the deadline`);
          continue;
        }

        // The prefix only matters for provider-scoped ingestion; the tenant-wide purge ignores it.
        const ingester = new EmailIngesterService(db, 'google');
        const { deletedEmails } = await ingester.purgeAllTenantEmails(tenantId);
        await db.deleteFrom('google_oauth_tokens').where('tenant_id', '=', tenantId).execute();
        await db.deleteFrom('ms_oauth_tokens').where('tenant_id', '=', tenantId).execute();
        // Cleared only after everything above succeeded — a crash mid-purge resumes tomorrow.
        await db.updateTable('tenants').set({ inbox_purge_scheduled_at: null }).where('id', '=', tenantId).execute();
        logger.info(
          `[inbox-purge] purged ${deletedEmails} synced emails (and mailbox connections) for downgraded tenant ${tenantId}`,
        );
      } catch (err) {
        logger.error({ err }, `[inbox-purge] failed to purge inbox for tenant ${tenantId}`);
      }
    }
  } finally {
    await scheduleNextRun(db, 'purge_downgraded_inboxes', CRON_JOBS.purge_downgraded_inboxes);
  }
}
