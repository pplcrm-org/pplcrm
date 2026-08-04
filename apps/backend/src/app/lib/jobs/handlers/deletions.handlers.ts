import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { StorageService } from '../../storage.service';
import { tombstoneAuthUser } from '../../tombstone-user';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { CRON_JOBS } from '../cron-registry';
import { scheduleNextRun } from '../reschedule';

const mailService = new TransactionalEmailService({ defaultAudience: 'account' });

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
  // Boundary layers and their polygons. Children first: boundary_features and household_districts
  // both point at boundary_sets, and household_districts also points at households.
  'boundary_features',
  'household_districts',
  'boundary_sets',
  'bug_reports',
  'companion_organizer_tokens',
  'campaign_join_codes',
  'campaign_person_facts',
  'campaign_subscriptions',
  'companies',
  'companion_approval_tokens',
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
  'donation_receipt_items',
  'donation_receipts',
  'receipt_counters',
  'receipt_statement_runs',
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
  // The address-to-coordinates memo. It deliberately survives HOUSEHOLD deletion, because that is
  // the whole defence against paying twice for a re-imported file — but it must not survive
  // WORKSPACE deletion, which is a promise to remove the workspace's data.
  'geocode_cache',
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
  'turf_segment_claims',
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
    await scheduleNextRun(db, 'perform_scheduled_deletions', CRON_JOBS.perform_scheduled_deletions);
  }
}

/** Exported for tests; production entry is handlePerformScheduledDeletions (adds the reschedule). */
export async function performScheduledDeletions(db: Kysely<Models>): Promise<void> {
  const now = new Date();

  // Each user/tenant is deleted in its own transaction wrapped in its own try/catch so one failure
  // (an FK we missed, a locked row, a transient DB error) rolls back only that record and the loop
  // continues — a single bad row must never abort the cron and freeze every other pending deletion.
  const failures: string[] = [];

  const expiredUsers = await db
    .selectFrom('authusers')
    .select(['id', 'tenant_id'])
    .where('deletion_scheduled_at', '<=', now)
    .where('deleted_at', 'is', null)
    .execute();

  for (const user of expiredUsers) {
    const userId = String(user.id);
    try {
      // Tombstone, not hard delete: ~61 NO ACTION FKs (createdby_id etc.) reference authusers, so
      // a DELETE 23503s for anyone who ever acted in the app — which used to make this loop re-fail
      // the same users silently every day, forever. The identity is scrubbed in place and the row
      // stays; authored content remains with the tenant, attributed to "Deleted user".
      const avatarBlobKey = await db
        .transaction()
        .execute((trx) => tombstoneAuthUser(trx, { tenantId: String(user.tenant_id), userId, updatedbyId: userId }));

      // After commit, never before: a blob deleted inside the transaction would be gone even if
      // the transaction then rolled back and its `files` row came back.
      if (avatarBlobKey) {
        try {
          await new StorageService().delete(avatarBlobKey);
        } catch (err) {
          logger.error({ err, userId }, 'Failed to delete avatar blob for a tombstoned user');
        }
      }
    } catch (err) {
      failures.push(`user ${userId}`);
      logger.error({ err, userId }, 'Failed to tombstone scheduled user; continuing with remaining deletions');
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

      // Receipt PDFs are the one per-feature blob set the wipe removes from storage ("delete
      // means deleted"): collect the keys BEFORE the rows vanish, delete blobs after commit
      // (avatar-tombstone ordering — a blob deleted inside the trx would be gone on rollback).
      const receiptBlobKeys = (
        await db
          .selectFrom('donation_receipts')
          .innerJoin('files', 'files.id', 'donation_receipts.file_id')
          .select('files.storage_key')
          .where('donation_receipts.tenant_id', '=', tenantId)
          .where('files.tenant_id', '=', tenantId)
          .where('donation_receipts.file_id', 'is not', null)
          .execute()
      ).map((row) => row.storage_key);

      // Uploaded import files are the second per-feature blob set the wipe removes. Every import
      // writer (persons.service.ts, and the households/companies/tasks controllers) builds exactly
      // two keys, both with the tenant id as a path segment:
      //   imports/source/<tenantId>/<importId>.csv    — the retained original upload
      //   imports/payloads/<tenantId>/<importId>.json — the normalized rows the import job reads
      // Same ordering rule as the receipt PDFs above: read the keys while the rows still exist,
      // delete the blobs only after the transaction commits.
      const importSourcePrefix = `imports/source/${tenantId}/`;
      const importPayloadPrefix = `imports/payloads/${tenantId}/`;
      const importRows = await db
        .selectFrom('data_imports')
        .select(['source_file_key', sql<string | null>`metadata->>'storage_key'`.as('payload_key')])
        .where('tenant_id', '=', tenantId)
        .execute();
      const importBlobKeys: string[] = [];
      for (const row of importRows) {
        for (const key of [row.source_file_key, row.payload_key]) {
          if (typeof key !== 'string' || key.length === 0) continue;
          // Belt and braces on the most destructive handler in the codebase: the rows are already
          // scoped to this tenant, so a key that does not sit under this tenant's own import
          // prefixes is corrupt data. Leaving a stray blob behind is recoverable; deleting another
          // tenant's file is not.
          if (!key.startsWith(importSourcePrefix) && !key.startsWith(importPayloadPrefix)) {
            logger.warn({ tenantId, key }, 'Skipping an import blob key outside this tenant import prefixes');
            continue;
          }
          importBlobKeys.push(key);
        }
      }

      logger.info(`Hard-deleting tenant ${tenantId} (deletion_scheduled_at <= now)…`);
      await db.transaction().execute((trx) => wipeTenant(trx, tenantId));
      logger.info(`Tenant ${tenantId} fully hard-deleted.`);

      for (const key of receiptBlobKeys) {
        try {
          await new StorageService().delete(key);
        } catch (err) {
          logger.error({ err, tenantId, key }, 'Failed to delete a receipt PDF blob for a wiped tenant');
        }
      }

      for (const key of importBlobKeys) {
        try {
          await new StorageService().delete(key);
        } catch (err) {
          logger.error({ err, tenantId, key }, 'Failed to delete an import file blob for a wiped tenant');
        }
      }
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

  if (failures.length > 0) {
    logger.error({ failures }, `Scheduled deletions completed with ${failures.length} failure(s)`);
    // Rethrow so the worker retries and then marks the job 'failed' — the ops digest only reports
    // failed jobs, and a swallowed failure here is invisible forever (the pre-2026-07-24 user-branch
    // bug). The next daily run is already scheduled by handlePerformScheduledDeletions' finally, and
    // re-running is idempotent: succeeded deletions no longer match the framing queries.
    throw new Error(`Scheduled deletions failed for: ${failures.join(', ')}`);
  }
}
