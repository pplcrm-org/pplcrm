import type { Kysely } from 'kysely';

import { planAllowsFeature } from '@common';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { getFreshInboxPurgeStatus, inboxPurgeStillDue } from '../../../modules/billing/inbox-purge';
import { EmailIngesterService } from '../../../modules/emails/services/email-ingester.service';
import { CRON_JOBS } from '../cron-registry';
import { scheduleNextRun } from '../reschedule';

/**
 * Nightly: permanently delete the synced shared-inbox mail of workspaces whose
 * `inbox_purge_scheduled_at` deadline (set 30 days after a downgrade to Free — see
 * modules/billing/inbox-purge.ts) has passed. Also removes the Gmail/Microsoft OAuth grants:
 * a workspace without the inbox feature should not keep standing access to a customer mailbox.
 *
 * The plan/demo/schedule status is re-read fresh from the database per tenant, immediately
 * before anything is destroyed (see `getFreshInboxPurgeStatus` in modules/billing/inbox-purge.ts)
 * — the candidate list below is scanned once at the start of the run, and this cron can take
 * minutes to work through it, so an upgrade landing mid-run must never cost a paying workspace
 * its mail.
 */
export async function handlePurgeDowngradedInboxes(db: Kysely<Models>): Promise<void> {
  try {
    // NOTE: unscoped by design — the cron scans every tenant for a due purge deadline. This scan
    // is only used to build the candidate list; every tenant is re-checked fresh (see below)
    // immediately before anything is destroyed, so a stale row here can never cause a bad purge.
    // eslint-disable-next-line local/no-unscoped-db-query
    const due = await db
      .selectFrom('tenants')
      .select(['id'])
      .where('inbox_purge_scheduled_at', '<=', new Date())
      .execute();

    for (const tenant of due) {
      const tenantId = String(tenant.id);
      try {
        // Fresh re-check, right before destroying anything: `due` was scanned once at the start
        // of this run, and this cron can take minutes to work through the tenant list (each
        // purge is itself chunked). An upgrade that lands in that window calls
        // `syncInboxPurgeSchedule`, which nulls `inbox_purge_scheduled_at` — but nothing about
        // the `due` snapshot would ever notice that, so re-reading here is the only thing that
        // stops a paying customer's mail from being deleted.
        const status = await getFreshInboxPurgeStatus(db, tenantId);
        if (!status) continue; // tenant no longer exists

        if (planAllowsFeature(status.subscription_plan, 'inbox') || status.demo_mode_at != null) {
          await db.updateTable('tenants').set({ inbox_purge_scheduled_at: null }).where('id', '=', tenantId).execute();
          logger.info(`[inbox-purge] skipped tenant ${tenantId}: plan regained the inbox before the deadline`);
          continue;
        }

        if (!inboxPurgeStillDue(status)) {
          // Schedule is null (cleared by a concurrent upgrade) or still in the future (a later
          // re-downgrade pushed a new deadline in) — nothing to clear, a future run picks it up
          // if and when it becomes due again.
          logger.info(`[inbox-purge] skipped tenant ${tenantId}: purge no longer due as of the fresh re-check`);
          continue;
        }

        // The prefix only matters for provider-scoped ingestion; the tenant-wide purge ignores it.
        const ingester = new EmailIngesterService(db, 'google');
        const { deletedEmails, stoppedEarly } = await ingester.purgeAllTenantEmails(tenantId);

        if (stoppedEarly) {
          // purgeAllTenantEmails re-checks on every chunk and broke out of its own loop because
          // the tenant is no longer due (already logged the reason there). Treat this exactly
          // like the earlier skip branches: do NOT delete the OAuth grants or touch the schedule
          // column — the tenant may still need that mailbox connection.
          logger.info(
            `[inbox-purge] tenant ${tenantId}: purge stopped early after removing ${deletedEmails} emails; leaving mailbox connections and any remaining mail in place`,
          );
          continue;
        }

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
