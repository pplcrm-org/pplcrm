import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { fingerprintFull, fingerprintStreet } from '../../address-normalize';
import { geocodeAndMapHousehold } from '../../gis/geocoding';
import { logger } from '../../../logger';
import { ActivityController } from '../../../modules/activity/controller';
import { ListsController } from '../../../modules/lists/controller';
import { DuplicateMaintenanceService } from '../../../modules/persons/services/duplicate-maintenance.service';
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

  logger.info(
    {
      prunedCompletedJobs: prunedCompletedJobs.toString(),
      prunedFailedJobs: prunedFailedJobs.toString(),
      prunedWebhooks: prunedWebhooks.toString(),
      prunedSessions: prunedSessions.toString(),
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
