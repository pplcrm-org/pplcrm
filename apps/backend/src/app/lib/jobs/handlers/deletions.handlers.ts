import type { Kysely, Transaction } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { DAY_MS, scheduleNextRun } from '../reschedule';

const mailService = new TransactionalEmailService();

const COMPLETED_JOB_RETENTION_DAYS = 7;

/**
 * Every tenant-scoped table, ordered children-before-parents, that a full tenant wipe must clear.
 * A table left out of this list holds NO-ACTION foreign keys into rows the wipe deletes later, which
 * aborts the whole delete transaction with a 23503 — that is exactly how the pre-2026-07-24 handler
 * silently stopped deleting any tenant that had ever used donations, canvassing, deliveries or
 * newsletter templates. The order is a topological sort of the schema's FK graph (only NO ACTION /
 * RESTRICT edges constrain the order; CASCADE / SET NULL edges do not).
 *
 * `deletions.handlers.spec.ts` asserts this list stays in sync with every live `tenant_id` table —
 * those in schema.sql AND those created by dated migrations (minus tables a later migration drops,
 * and the identity tables handled explicitly below) — so a new table can never silently reintroduce
 * the bug. Do NOT reorder casually — keep children before their parents.
 *
 * Deliberately excluded (handled explicitly in the identity block after this loop): `authusers`,
 * `profiles`, `sessions`, `passkeys` (identity), and `tenants` itself (the final delete).
 */
export const TENANT_SCOPED_TABLES = [
  'background_jobs',
  'bug_reports',
  'campaign_person_facts',
  'campaign_subscriptions',
  'companies',
  'companion_ops',
  'companion_sessions',
  'companion_volunteers',
  'data_exports',
  'data_imports',
  'delivery_requests',
  'delivery_route_stops',
  'delivery_routes',
  'dismissed_duplicate_groups',
  'donation_periods',
  'donation_pledges',
  'donations',
  'email_attachments',
  'email_bodies',
  'email_comments',
  'email_drafts',
  'email_headers',
  'email_read_states',
  'email_recipients',
  'email_suppressions',
  'email_trash',
  'emails',
  'event_registrations',
  'event_ticket_types',
  'events',
  'files',
  'form_submissions',
  'google_oauth_tokens',
  'lists',
  'map_campaigns_users',
  'map_households_tags',
  'map_lists_households',
  'map_lists_persons',
  'map_newsletters_lists',
  'map_peoples_tags',
  'map_teams_lists',
  'map_teams_persons',
  'map_web_forms_lists',
  'ms_oauth_tokens',
  'newsletter_content_checks',
  'newsletter_events',
  'newsletter_send_log',
  'newsletter_templates',
  'newsletters',
  'notifications',
  'person_connections',
  'person_newsletter_engagements',
  'persons',
  'potential_duplicates',
  'settings',
  'tags',
  'task_attachments',
  'task_comments',
  'task_subtasks',
  'tasks',
  'teams',
  'turf_assignments',
  'turf_households',
  'turf_knocks',
  'turfs',
  'user_activity',
  'volunteer_events',
  'volunteer_shifts',
  'web_forms',
  'webhook_events',
  'workflow_enrollments',
  'workflow_runs',
  'workflow_steps',
  'workflows',
  'workspace_api_keys',
  'zapier_subscriptions',
  'households',
  'campaigns',
] as const;

/** Identity tables wiped explicitly, in this order, after every content table for the tenant is gone. */
async function wipeTenant(trx: Transaction<Models>, tenantId: string): Promise<void> {
  for (const table of TENANT_SCOPED_TABLES) {
    await trx.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
  }

  // Null out BOTH authusers FKs on tenants before deleting authusers (admin_id AND createdby_id —
  // missing either aborts the whole wipe with a 23503).
  await trx.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await trx.deleteFrom('passkeys').where('tenant_id', '=', tenantId).execute();
  await trx.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
  await trx.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
  await trx.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await trx.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

export async function handlePerformScheduledDeletions(db: Kysely<Models>): Promise<void> {
  // The reschedule lives in the finally: even if the framing queries below throw, the cron chain
  // must never die — the worker's rescheduleCronJobOnFailure is only a backstop, not the plan.
  try {
    await performScheduledDeletions(db);
  } finally {
    await scheduleNextRun(db, 'perform_scheduled_deletions', DAY_MS);
  }
}

async function performScheduledDeletions(db: Kysely<Models>): Promise<void> {
  const now = new Date();

  // Each user/tenant is deleted in its own transaction wrapped in its own try/catch so one failure
  // (an FK we missed, a locked row, a transient DB error) rolls back only that record and the loop
  // continues — a single bad row must never abort the cron and freeze every other pending deletion.
  const failures: string[] = [];

  const expiredUsers = await db
    .selectFrom('authusers')
    .select('id')
    .where('deletion_scheduled_at', '<=', now)
    .execute();

  for (const user of expiredUsers) {
    const userId = String(user.id);
    try {
      await db.transaction().execute(async (trx) => {
        // notifications/passkeys/email_drafts/task_comments cascade from authusers; profiles + sessions
        // are removed explicitly. Content the member authored (createdby_id etc.) stays with the tenant
        // and is NOT reassigned here — see the note in handlePerformScheduledDeletions' doc comment.
        await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
        await trx.deleteFrom('profiles').where('auth_id', '=', userId).execute();
        await trx.deleteFrom('authusers').where('id', '=', userId).execute();
      });
    } catch (err) {
      failures.push(`user ${userId}`);
      logger.error({ err, userId }, 'Failed to hard-delete scheduled user; continuing with remaining deletions');
    }
  }

  const expiredTenants = await db
    .selectFrom('tenants')
    .select('id')
    .where('deletion_scheduled_at', '<=', now)
    .execute();

  for (const tenant of expiredTenants) {
    const tenantId = String(tenant.id);

    // Capture owner emails before deletion — the whole tenant (background_jobs included) is wiped
    // inside the transaction, so read this first.
    let ownerUsers: { email: string | null; first_name: string | null }[] = [];
    try {
      ownerUsers = await db
        .selectFrom('authusers')
        .select(['email', 'first_name'])
        .where('tenant_id', '=', tenantId)
        .where('role', '=', 'owner')
        .execute();

      logger.info(`Hard-deleting tenant ${tenantId} (deletion_scheduled_at <= now)…`);
      await db.transaction().execute((trx) => wipeTenant(trx, tenantId));
      logger.info(`Tenant ${tenantId} fully hard-deleted.`);
    } catch (err) {
      failures.push(`tenant ${tenantId}`);
      logger.error({ err, tenantId }, 'Failed to hard-delete scheduled tenant; continuing with remaining deletions');
      continue;
    }

    // Send confirmation emails after the transaction commits (outside the wiped tenant scope).
    for (const owner of ownerUsers) {
      if (owner.email) {
        try {
          await mailService.sendMail({
            to: owner.email,
            subject: 'Your account data has been permanently deleted',
            text: `Hi ${owner.first_name},\n\nAll data associated with your pplCRM account has been permanently and securely deleted as requested. You will not be billed going forward.\n\nThank you for using pplCRM.`,
            html: `<h2>Account data deleted</h2>
<p>Hi ${owner.first_name},</p>
<p>All data associated with your pplCRM account has been permanently and securely deleted as requested. You will not be billed going forward.</p>
<p>Thank you for using pplCRM. If you ever wish to return, you are always welcome to create a new account.</p>`,
          });
        } catch (err) {
          // The tenant is already gone; a failed confirmation email must not fail the run.
          logger.error({ err, tenantId }, 'Failed to send tenant-deletion confirmation email');
        }
      }
    }
  }

  // Permanently delete completed background jobs older than 7 days to prevent unbounded table growth
  const retentionCutoff = new Date(Date.now() - COMPLETED_JOB_RETENTION_DAYS * DAY_MS);
  await db
    .deleteFrom('background_jobs')
    .where('status', '=', 'completed')
    .where('updated_at', '<=', retentionCutoff)
    .execute();

  if (failures.length > 0) {
    logger.error({ failures }, `Scheduled deletions completed with ${failures.length} failure(s); will retry next run`);
  }
}
