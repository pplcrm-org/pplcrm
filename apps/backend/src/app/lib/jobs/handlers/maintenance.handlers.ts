import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { fingerprintFull, fingerprintStreet } from '../../address-normalize';
import { geocodeAndMapHousehold } from '../../gis/geocoding';
import { logger } from '../../../logger';
import { ActivityController } from '../../../modules/activity/controller';
import { ListsController } from '../../../modules/lists/controller';
import { DuplicateMaintenanceService } from '../../../modules/persons/services/duplicate-maintenance.service';
import { purgeUnreferencedFiles } from '../../file-references';
import { StorageService } from '../../storage.service';
import { CRON_JOBS } from '../cron-registry';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

export async function handleRefreshList(payload: JobPayloadOf<'refresh_list'>): Promise<void> {
  const listsController = new ListsController();
  await listsController.executeListRefresh(payload.tenant_id, payload.list_id, payload.user_id);
}

export async function handleEnrichCompanyGoogle(
  payload: JobPayloadOf<'enrich_company_google'>,
  db: Kysely<Models>,
): Promise<void> {
  const { CompaniesEnrichmentService } =
    await import('../../../modules/companies/services/companies-enrichment.service');
  const enrichmentSvc = new CompaniesEnrichmentService(db);
  await enrichmentSvc.enrichCompany(payload.company_id, payload.tenant_id, payload.force ?? false);
}

export async function handleRefreshCompaniesGoogle(
  payload: JobPayloadOf<'refresh_companies_google'>,
  db: Kysely<Models>,
): Promise<void> {
  const { CompaniesEnrichmentService } =
    await import('../../../modules/companies/services/companies-enrichment.service');
  const enrichmentSvc = new CompaniesEnrichmentService(db);
  await enrichmentSvc.queueUnenrichedCompanies(payload.tenant_id ?? undefined);

  // Only the global (cron-style) run reschedules itself.
  if (!payload.tenant_id) {
    await scheduleNextRun(db, 'refresh_companies_google', CRON_JOBS.refresh_companies_google);
  }
}

export async function handleCleanupActivities(db: Kysely<Models>): Promise<void> {
  const activityController = new ActivityController();
  await activityController.deleteOldActivities();

  await scheduleNextRun(db, 'cleanup_activities', CRON_JOBS.cleanup_activities);
}

// P-3 (schema review 2026-07-06, §5): retention for the append-mostly tables
// that otherwise grow without bound. user_activity and newsletter_events already
// have their own prune jobs (cleanup_activities / prune_newsletter_events); this
// covers the remaining three. Deletes run in bounded batches so a large backlog
// never takes a long lock or a huge WAL spike.
const RETENTION_BATCH = 5000;
const COMPLETED_JOBS_RETENTION_DAYS = 7;
// Failed jobs are the only dead-letter record of what went wrong — kept far longer than
// completed jobs so there's still something to diagnose against days (or weeks) after the fact.
const FAILED_JOBS_RETENTION_DAYS = 30;
const WEBHOOK_EVENTS_RETENTION_DAYS = 90;
const EXPIRED_SESSION_GRACE_DAYS = 30;
/**
 * How long a finished export stays downloadable.
 *
 * 30 days is not a new decision — it is the number the product already states in three places and
 * had never enforced: the privacy policy ("Export files are downloadable for 30 days, then
 * removed"), the Help Center article on exporting, and the Exports page itself, which greys a row
 * out with "Expired (30d)" once it passes that age while the file stayed downloadable forever.
 * Changing it means changing all three — see the `pplcrm-website-claims` skill.
 */
const DATA_EXPORT_RETENTION_DAYS = 30;
/**
 * How long a synced message that left the mailbox folder upstream is kept when nobody in the CRM
 * ever acted on it.
 *
 * Such a message is now DETACHED rather than deleted (it used to be hard-deleted, which destroyed
 * the team's comments along with it — see EmailIngesterService.detachMessage). Keeping every
 * archived message forever would trade one bug for another: an active mailbox archives constantly,
 * and each row drags a body blob and its attachments along. So rows that carry nothing the CRM
 * added are pruned after this window; rows that carry anything are kept indefinitely.
 */
const DETACHED_EMAIL_RETENTION_DAYS = 90;
/**
 * How long the original file a member uploaded to an import stays in blob storage.
 *
 * 90 days is not a new decision — it is the number the product already publishes in three places
 * and had never enforced: the privacy policy ("Import source files are kept for 90 days so you can
 * audit an import, then removed"), the Help Center article on importing, and the import writer's
 * own comment in persons.service.ts. Nothing ever deleted the blob, so every uploaded contact list
 * sat in storage forever. Changing the number means changing all of those — see the
 * `pplcrm-website-claims` skill.
 */
const IMPORT_SOURCE_FILE_RETENTION_DAYS = 90;
// Chunk size for the keyset-paginated address-fingerprint recompute below.
const ADDRESS_FINGERPRINT_PAGE_SIZE = 1000;

async function deleteInBatches(runOnce: () => Promise<bigint>): Promise<bigint> {
  let total = 0n;
  for (;;) {
    const deleted = await runOnce();
    total += deleted;
    if (deleted < BigInt(RETENTION_BATCH)) break;
  }
  return total;
}

/**
 * Delete expired export files and the rows that point at them.
 *
 * Nothing pruned `data_exports` before this: every CSV a workspace ever generated sat in blob
 * storage indefinitely, and each one is a full extract of the records the requester selected.
 *
 * The blob is deleted FIRST, and the row only after that succeeds, because the row holds the only
 * copy of the storage key — dropping it first would orphan the file permanently, with nothing left
 * to find it by. A blob delete that fails leaves its row in place so the next daily run retries it,
 * and the loop moves on to the remaining rows rather than abandoning the batch. `StorageService`
 * uses `deleteIfExists`, so an already-missing blob is a success, not a failure that wedges a row
 * forever.
 *
 * NOTE: intentionally cross-tenant — this is scheduled platform maintenance with no caller, the
 * same as the other sweeps in this job, and it selects only the row id and its storage key.
 *
 * Exported so its spec can exercise it alone. Calling `handlePruneRetention` in a test would also
 * sweep background jobs, webhook events and sessions across every tenant in the shared test
 * database, and would enqueue the next cron run.
 */
export async function pruneExpiredExports(db: Kysely<Models>): Promise<{ rows: number; blobFailures: number }> {
  const storageService = new StorageService();
  let rowsDeleted = 0;
  let blobFailures = 0;

  for (;;) {
    const expired = await sql<{ id: string; storage_key: string | null }>`
      SELECT id, storage_key FROM data_exports
      WHERE created_at < now() - make_interval(days => ${DATA_EXPORT_RETENTION_DAYS})
      ORDER BY id
      LIMIT ${RETENTION_BATCH}
    `.execute(db);

    if (expired.rows.length === 0) break;

    let progressed = 0;
    for (const row of expired.rows) {
      if (row.storage_key) {
        try {
          await storageService.delete(row.storage_key);
        } catch (err) {
          blobFailures++;
          logger.error({ err, exportId: row.id }, `Failed to delete expired export blob ${row.storage_key}`);
          continue;
        }
      }

      const res = await sql`DELETE FROM data_exports WHERE id = ${row.id}`.execute(db);
      rowsDeleted += Number(res.numAffectedRows ?? 0n);
      progressed++;
    }

    // Every row in this batch failed its blob delete, so re-selecting would return the same rows
    // forever. Stop and let tomorrow's run retry.
    if (progressed === 0) break;
    if (expired.rows.length < RETENTION_BATCH) break;
  }

  return { rows: rowsDeleted, blobFailures };
}

/**
 * Delete the retained original upload of every import past its retention window.
 *
 * Nothing pruned these before: every CSV a member ever fed the import wizard stayed in blob
 * storage indefinitely, while the privacy policy said they are removed after 90 days. Each one is
 * a full contact extract, so this is the same class of file the export sweep above removes.
 *
 * Only the blob and the pointer to it go — the `data_imports` row STAYS, because it is the import
 * history a workspace reads to see what was loaded and when. The blob is deleted FIRST and the
 * column nulled only after that succeeds, because the column holds the only copy of the storage
 * key; nulling first would orphan the file permanently. A blob delete that fails leaves its key in
 * place so the next daily run retries it, and the loop moves on to the remaining rows.
 * `StorageService` uses `deleteIfExists`, so an already-missing blob is a success.
 *
 * `source_file_size` is deliberately left alone: it describes the upload that happened, which is
 * still true history, and the History page gates the download button on `source_file_key`.
 *
 * NOTE: intentionally cross-tenant — this is scheduled platform maintenance with no caller, the
 * same as the other sweeps in this job, and it selects only the row id and its storage key.
 *
 * Exported so its spec can exercise it alone, for the same reason as the sweeps around it.
 */
export async function pruneExpiredImportSourceFiles(db: Kysely<Models>): Promise<{
  rows: number;
  blobFailures: number;
}> {
  const storageService = new StorageService();
  let rowsCleared = 0;
  let blobFailures = 0;

  for (;;) {
    const expired = await sql<{ id: string; source_file_key: string }>`
      SELECT id, source_file_key FROM data_imports
      WHERE source_file_key IS NOT NULL
        AND processed_at < now() - make_interval(days => ${IMPORT_SOURCE_FILE_RETENTION_DAYS})
      ORDER BY id
      LIMIT ${RETENTION_BATCH}
    `.execute(db);

    if (expired.rows.length === 0) break;

    let progressed = 0;
    for (const row of expired.rows) {
      try {
        await storageService.delete(row.source_file_key);
      } catch (err) {
        blobFailures++;
        logger.error({ err, importId: row.id }, `Failed to delete expired import source blob ${row.source_file_key}`);
        continue;
      }

      const res = await sql`UPDATE data_imports SET source_file_key = NULL WHERE id = ${row.id}`.execute(db);
      rowsCleared += Number(res.numAffectedRows ?? 0n);
      progressed++;
    }

    // Every row in this batch failed its blob delete, so re-selecting would return the same rows
    // forever. Stop and let tomorrow's run retry.
    if (progressed === 0) break;
    if (expired.rows.length < RETENTION_BATCH) break;
  }

  return { rows: rowsCleared, blobFailures };
}

/**
 * Delete detached synced messages that nobody in the CRM ever touched, once they are past the
 * retention window.
 *
 * A detached message is one the provider stopped listing in the folder it was synced from — the
 * user archived it, moved it, or a rule filed it. The sync keeps the row instead of destroying it,
 * because the row may carry work: internal comments, an assignee, a closed/reopened status, a
 * favourite flag. This sweep only removes the ones that carry none of that, so nothing a person
 * wrote or decided is ever pruned, however old it gets.
 *
 * The email's child rows (bodies, headers, recipients, attachments, read states, trash provenance)
 * go with it through `ON DELETE CASCADE`. Storage is not covered by the cascade, so the attachment
 * `files` rows and the body blobs are cleaned up here, in the same order the other email delete
 * paths use: capture the references first, delete the rows, then purge storage — a failed blob
 * delete leaks bytes, whereas purging first would leave a permanently broken download if the row
 * delete then failed. `purgeUnreferencedFiles` is the shared check that an attachment file is not
 * also somebody's avatar, person photo or newsletter image.
 *
 * Exported so its spec can exercise it alone; calling `handlePruneRetention` in a test would also
 * sweep jobs, webhooks, sessions and exports across every tenant in the shared test database.
 */
export async function pruneDetachedEmails(db: Kysely<Models>): Promise<{ rows: number }> {
  const storageService = new StorageService();
  let rowsDeleted = 0;

  for (;;) {
    // NOTE: intentionally cross-tenant — scheduled platform maintenance with no caller, the same as
    // the other sweeps in this job. It returns only row ids and the tenant each belongs to, and
    // every follow-up query below is scoped by the tenant_id it returned.
    const candidates = await sql<{ id: string; tenant_id: string }>`
      SELECT e.id, e.tenant_id
        FROM emails e
       WHERE e.detached_at IS NOT NULL
         AND e.detached_at < now() - make_interval(days => ${DETACHED_EMAIL_RETENTION_DAYS})
         AND e.assigned_to IS NULL
         AND e.is_favourite = false
         AND (e.status IS NULL OR e.status <> 'closed')
         AND NOT EXISTS (
               SELECT 1 FROM email_comments c
                WHERE c.email_id = e.id AND c.tenant_id = e.tenant_id)
       ORDER BY e.id
       LIMIT ${RETENTION_BATCH}
    `.execute(db);

    if (candidates.rows.length === 0) break;

    const idsByTenant = new Map<string, string[]>();
    for (const row of candidates.rows) {
      const tenantId = String(row.tenant_id);
      const ids = idsByTenant.get(tenantId) ?? [];
      ids.push(String(row.id));
      idsByTenant.set(tenantId, ids);
    }

    for (const [tenantId, emailIds] of idsByTenant) {
      const attachmentFiles = await db
        .selectFrom('email_attachments')
        .select('file_id')
        .distinct()
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .where('file_id', 'is not', null)
        .execute();
      const fileIds = attachmentFiles.map((r) => String(r.file_id)).filter((id) => id !== 'null');

      const bodies = await db
        .selectFrom('email_bodies')
        .select('storage_key')
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .where('storage_key', 'is not', null)
        .execute();
      const bodyKeys = bodies.map((r) => String(r.storage_key)).filter((k) => k !== 'null');

      const res = await db
        .deleteFrom('emails')
        .where('tenant_id', '=', tenantId)
        .where('id', 'in', emailIds)
        .executeTakeFirst();
      rowsDeleted += Number(res.numDeletedRows ?? 0n);

      await purgeUnreferencedFiles(db, storageService, tenantId, fileIds);

      for (const key of bodyKeys) {
        try {
          await storageService.delete(key);
        } catch (err) {
          logger.error({ err }, `Failed to delete pruned email body blob ${key}`);
        }
      }
    }

    if (candidates.rows.length < RETENTION_BATCH) break;
  }

  return { rows: rowsDeleted };
}

export async function handlePruneRetention(db: Kysely<Models>): Promise<void> {
  // Completed background jobs older than the retention window — this is the sole owner of
  // routine background_jobs pruning (the scheduled-deletions handler used to also prune
  // completed jobs on its own overlapping schedule; that's been removed in favor of this job).
  const prunedCompletedJobs = await deleteInBatches(async () => {
    const res = await sql`
      DELETE FROM background_jobs
      WHERE ctid IN (
        SELECT ctid FROM background_jobs
        WHERE status = 'completed'
          AND updated_at < now() - make_interval(days => ${COMPLETED_JOBS_RETENTION_DAYS})
        LIMIT ${RETENTION_BATCH})
    `.execute(db);
    return res.numAffectedRows ?? 0n;
  });

  // Failed jobs are the only dead-letter record of what went wrong, so they get a much longer
  // window than completed jobs. The currently-'processing' retention job itself is never matched.
  const prunedFailedJobs = await deleteInBatches(async () => {
    const res = await sql`
      DELETE FROM background_jobs
      WHERE ctid IN (
        SELECT ctid FROM background_jobs
        WHERE status = 'failed'
          AND updated_at < now() - make_interval(days => ${FAILED_JOBS_RETENTION_DAYS})
        LIMIT ${RETENTION_BATCH})
    `.execute(db);
    return res.numAffectedRows ?? 0n;
  });

  // Processed Stripe/webhook events past their retention window, plus failed ones — failed rows
  // may have a NULL processed_at (they never reached 'processed'), so fall back to updated_at,
  // which trg_webhook_events_updated_at bumps on every status change.
  const prunedWebhooks = await deleteInBatches(async () => {
    const res = await sql`
      DELETE FROM webhook_events
      WHERE ctid IN (
        SELECT ctid FROM webhook_events
        WHERE (status = 'processed'
                AND processed_at < now() - make_interval(days => ${WEBHOOK_EVENTS_RETENTION_DAYS}))
           OR (status = 'failed'
                AND updated_at < now() - make_interval(days => ${WEBHOOK_EVENTS_RETENTION_DAYS}))
        LIMIT ${RETENTION_BATCH})
    `.execute(db);
    return res.numAffectedRows ?? 0n;
  });

  // Long-expired sessions (revocation/sign-out handles the live ones; this sweeps
  // the rows that just linger). NULL expires_at means non-expiring — left alone.
  const prunedSessions = await deleteInBatches(async () => {
    const res = await sql`
      DELETE FROM sessions
      WHERE ctid IN (
        SELECT ctid FROM sessions
        WHERE expires_at IS NOT NULL
          AND expires_at < now() - make_interval(days => ${EXPIRED_SESSION_GRACE_DAYS})
        LIMIT ${RETENTION_BATCH})
    `.execute(db);
    return res.numAffectedRows ?? 0n;
  });

  // Expired export files. Deleting the row alone would leave the CSV in blob storage forever, so
  // this one sweeps the blob too — see pruneExpiredExports.
  const prunedExports = await pruneExpiredExports(db);

  // Retained original uploads past the published 90-day window. The import row itself stays —
  // only the file and the key pointing at it go. See pruneExpiredImportSourceFiles.
  const prunedImportSources = await pruneExpiredImportSourceFiles(db);

  // Synced messages that left the mailbox folder upstream long ago and that nobody in the CRM ever
  // commented on, assigned, closed or starred — see pruneDetachedEmails.
  const prunedDetachedEmails = await pruneDetachedEmails(db);

  logger.info(
    {
      prunedCompletedJobs: prunedCompletedJobs.toString(),
      prunedFailedJobs: prunedFailedJobs.toString(),
      prunedWebhooks: prunedWebhooks.toString(),
      prunedSessions: prunedSessions.toString(),
      prunedExports: prunedExports.rows,
      exportBlobDeleteFailures: prunedExports.blobFailures,
      prunedImportSourceFiles: prunedImportSources.rows,
      importSourceBlobDeleteFailures: prunedImportSources.blobFailures,
      prunedDetachedEmails: prunedDetachedEmails.rows,
    },
    'Retention prune complete',
  );

  await scheduleNextRun(db, 'prune_retention', CRON_JOBS.prune_retention);
}

export async function handleRecomputeAllDuplicates(db: Kysely<Models>): Promise<void> {
  const lastJob = await db
    .selectFrom('background_jobs')
    .select(['updated_at'])
    .where('status', '=', 'completed')
    .where(sql`payload->>'type'`, '=', 'recompute_all_duplicates')
    .orderBy('updated_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  const tenants = await db.selectFrom('tenants').select('id').execute();
  const maintenanceSvc = new DuplicateMaintenanceService();
  const lastRunTime = lastJob?.updated_at ? new Date(lastJob.updated_at) : null;

  // Collapse the old "did anything change" probe — 3 queries × every tenant — into 3 queries
  // total, run once, each returning the distinct tenants with a row changed since the last run.
  // `null` means "no prior run", i.e. recompute unconditionally for every tenant (original
  // behavior when lastRunTime was falsy).
  let tenantsToRecompute: Set<string> | null = null;
  if (lastRunTime) {
    tenantsToRecompute = new Set<string>();
    for (const table of ['persons', 'households', 'companies'] as const) {
      // NOTE: unscoped by design — this cron probe returns only the DISTINCT tenant_ids with a
      // row changed since the last sweep (no business data), to decide which tenants to recompute.
      // eslint-disable-next-line local/no-unscoped-db-query
      const changedTenants = await db
        .selectFrom(table)
        .select('tenant_id')
        .where('updated_at', '>', lastRunTime)
        .groupBy('tenant_id')
        .execute();
      for (const row of changedTenants) {
        tenantsToRecompute.add(String(row.tenant_id));
      }
    }
  }

  for (const tenant of tenants) {
    const tenantId = String(tenant.id);
    if (tenantsToRecompute && !tenantsToRecompute.has(tenantId)) continue;

    try {
      await maintenanceSvc.recomputeAllDuplicates(tenantId);
    } catch (tenantErr) {
      logger.error({ err: tenantErr }, `Failed to recompute duplicates for tenant ${tenant.id}`);
    }
  }

  await scheduleNextRun(db, 'recompute_all_duplicates', CRON_JOBS.recompute_all_duplicates);
}

export async function handleRecomputeAddressFingerprints(
  payload: JobPayloadOf<'recompute_address_fingerprints'>,
  db: Kysely<Models>,
): Promise<void> {
  const tenantIds: string[] = [];
  if (payload.tenant_id) {
    tenantIds.push(payload.tenant_id);
  } else {
    const tenants = await db.selectFrom('tenants').select('id').execute();
    for (const tenant of tenants) {
      tenantIds.push(String(tenant.id));
    }
  }

  for (const tenantId of tenantIds) {
    try {
      await recomputeTenantAddressFingerprints(tenantId, db);
    } catch (tenantErr) {
      logger.error({ err: tenantErr }, `Failed to recompute address fingerprints for tenant ${tenantId}`);
    }
  }

  // Schedule next run if periodic/cron-like (no tenant_id)
  if (!payload.tenant_id) {
    await scheduleNextRun(db, 'recompute_address_fingerprints', CRON_JOBS.recompute_address_fingerprints);
  }
}

export async function handleGeocodeHousehold(
  payload: JobPayloadOf<'geocode_household'>,
  db: Kysely<Models>,
): Promise<void> {
  await geocodeAndMapHousehold(payload.household_id, payload.tenant_id, db);
}

/** One page of households, keyset-paginated by id, carrying only the columns the fingerprint
 *  helpers need (the previous version loaded every column of every household into memory).
 *  Return type is inferred: the row shape follows the Kysely model's column types exactly. */
async function fetchHouseholdFingerprintPage(db: Kysely<Models>, tenantId: string, cursorId: string | null) {
  let query = db
    .selectFrom('households')
    .select([
      'id',
      'street_num',
      'street1',
      'street2',
      'apt',
      'city',
      'state',
      'zip',
      'country',
      'address_fp_street',
      'address_fp_full',
    ])
    .where('tenant_id', '=', tenantId)
    .orderBy('id', 'asc')
    .limit(ADDRESS_FINGERPRINT_PAGE_SIZE);

  if (cursorId !== null) {
    query = query.where('id', '>', cursorId);
  }

  return query.execute();
}

async function recomputeTenantAddressFingerprints(tenantId: string, db: Kysely<Models>): Promise<void> {
  let cursorId: string | null = null;

  for (;;) {
    const households = await fetchHouseholdFingerprintPage(db, tenantId, cursorId);
    if (households.length === 0) break;

    const changed: { id: string; fpStreet: string | null; fpFull: string | null }[] = [];
    for (const hh of households) {
      const fp_street = fingerprintStreet({
        street_num: hh.street_num,
        street1: hh.street1,
        street2: hh.street2,
      });
      const fp_full = fingerprintFull({
        apt: hh.apt,
        street_num: hh.street_num,
        street1: hh.street1,
        street2: hh.street2,
        city: hh.city,
        state: hh.state,
        zip: hh.zip,
        country: hh.country,
      });

      if (hh.address_fp_street !== fp_street || hh.address_fp_full !== fp_full) {
        changed.push({ id: hh.id, fpStreet: fp_street, fpFull: fp_full });
      }
    }

    // One round trip per chunk (not per row): batch every changed row in this page into a
    // single UPDATE ... FROM (VALUES ...) statement.
    if (changed.length > 0) {
      const values = sql.join(changed.map((c) => sql`(${c.id}::bigint, ${c.fpStreet}::text, ${c.fpFull}::text)`));

      await sql`
        UPDATE households AS h
        SET address_fp_street = v.fp_street,
            address_fp_full = v.fp_full,
            updated_at = now()
        FROM (VALUES ${values}) AS v(id, fp_street, fp_full)
        WHERE h.id = v.id AND h.tenant_id = ${tenantId}
      `.execute(db);
    }

    const lastRow = households[households.length - 1];
    // Unreachable: the `households.length === 0` check above guarantees an element exists here;
    // this guard exists only to satisfy noUncheckedIndexedAccess.
    if (!lastRow) break;
    cursorId = lastRow.id;
    if (households.length < ADDRESS_FINGERPRINT_PAGE_SIZE) break;
  }

  const maintenanceSvc = new DuplicateMaintenanceService();
  await maintenanceSvc.recomputeAllDuplicates(tenantId);
}
