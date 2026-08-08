import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { jobPayloadSchema, legacyImportJobSchema } from './job-payloads';
import { handleCheckAllUsageLimits, handleCheckUsageLimits, handleZapierTrigger } from './handlers/billing.handlers';
import { handleMatchBoundaries, handleSweepUnmatchedBoundaries } from './handlers/boundaries.handlers';
import { handlePerformScheduledDeletions } from './handlers/deletions.handlers';
import { handleMaterializeDemoAttachments } from './handlers/demo.handlers';
import { handleExportCsv } from './handlers/export.handlers';
import { handleImportCsvJob, handleLegacyImportJob } from './handlers/import.handlers';
import { handleTriggerListJoined } from './handlers/lists.handlers';
import { handleTriggerContactCreated, handleTriggerTagAdded } from './handlers/triggers.handlers';
import {
  handleCleanupActivities,
  handlePruneRetention,
  handleEnrichCompanyGoogle,
  handleGeocodeHousehold,
  handleRecomputeAddressFingerprints,
  handleRecomputeAllDuplicates,
  handleRefreshCompaniesGoogle,
  handleRefreshList,
} from './handlers/maintenance.handlers';
import {
  handleProcessScheduledNewsletters,
  handlePruneNewsletterEvents,
  handleSendNewsletter,
} from './handlers/newsletter.handlers';
import {
  handleCheckDueTasks,
  handleProcessMentions,
  handleSendEventRegistrationConfirmation,
  handleSendEventReminder,
  handleSendFormNotifications,
  handleSendShiftReminder,
  handleSendSms,
  handleSendSubscriptionConfirmation,
  handleSendTransactionalEmail,
  handleSendWebformNotifications,
} from './handlers/notifications.handlers';
import { handleOpsWatchdog, handleSendBugReportEmail } from './handlers/ops.handlers';
import {
  handleBackfillDonationAcknowledgements,
  handleIssueDonationAcknowledgement,
  handleRenderReceiptPdf,
  handleRunYearEndStatements,
} from './handlers/receipts.handlers';
import { handlePurgeDowngradedInboxes } from './handlers/inbox-purge.handlers';
import { handleGoogleSync, handleMsSync, handleScheduleSyncJobs } from './handlers/sync.handlers';
import {
  handleDetectLapsedSupporters,
  handleDetectTaskSlaBreaches,
  handleProcessDripWorkflows,
} from './handlers/workflows.handlers';
import { handleSendAutomationEmail } from './handlers/automation-mail.handlers';

export { checkDueTasks } from './handlers/notifications.handlers';

// `type` is `.optional()` deliberately: with a bare `z.unknown()` Zod 4 treats the key as
// required, so a payload carrying no `type` at all failed this probe outright. That was harmless
// while the only consumer was the error label (both paths produce 'unknown'), but the legacy
// import drain below has to be able to tell "no type key" apart from "probe failed".
const typeProbeSchema = z.looseObject({ type: z.unknown().optional() });

/**
 * Background job dispatcher. Parses the raw queue payload against the typed
 * job schemas and routes it to the matching domain handler in `./handlers/`.
 */
export async function executeJob(payload: unknown, db: Kysely<Models>, jobId?: string): Promise<void> {
  const typed = jobPayloadSchema.safeParse(payload);

  if (!typed.success) {
    const probe = typeProbeSchema.safeParse(payload);
    const typeLabel = probe.success && probe.data.type !== undefined ? String(probe.data.type) : 'unknown';

    // ONE-RELEASE DRAIN SHIM — delete with `legacyImportJobSchema` and `handleLegacyImportJob`.
    // Imports queued before 2026-08-05 carry no `type` at all and are recognised by their shape
    // (`import_id` + `storage_key`). Without this branch such a row throws below, retries to
    // exhaustion, dead-letters, and the member's import is marked failed. The `type === undefined`
    // guard keeps this from swallowing a genuinely unknown, discriminated payload.
    if (probe.success && probe.data.type === undefined) {
      const legacyImport = legacyImportJobSchema.safeParse(payload);
      if (legacyImport.success) {
        await handleLegacyImportJob(legacyImport.data, db);
        return;
      }
    }

    // Unrecognized payload (e.g. a job type retired in a newer deploy). Throwing is the correct
    // terminal path: the worker retries with backoff up to the row's max_attempts, then
    // dead-letters it as status='failed' with this message stored on the row.
    throw new Error(`Unsupported background job type: ${typeLabel}`);
  }

  const job = typed.data;
  switch (job.type) {
    case 'issue-donation-acknowledgement':
      await handleIssueDonationAcknowledgement(job);
      break;
    case 'backfill-donation-acknowledgements':
      await handleBackfillDonationAcknowledgements(job, db);
      break;
    case 'render-receipt-pdf':
      await handleRenderReceiptPdf(job, db);
      break;
    case 'run-year-end-statements':
      await handleRunYearEndStatements(job, db);
      break;
    case 'refresh_list':
      await handleRefreshList(job);
      break;
    case 'trigger_list_joined':
      await handleTriggerListJoined(job);
      break;
    case 'trigger_contact_created':
      await handleTriggerContactCreated(job);
      break;
    case 'trigger_tag_added':
      await handleTriggerTagAdded(job);
      break;
    case 'enrich_company_google':
      await handleEnrichCompanyGoogle(job, db);
      break;
    case 'refresh_companies_google':
      await handleRefreshCompaniesGoogle(job, db);
      break;
    case 'cleanup_activities':
      await handleCleanupActivities(db);
      break;
    case 'prune_retention':
      await handlePruneRetention(db);
      break;
    case 'recompute_all_duplicates':
      await handleRecomputeAllDuplicates(db);
      break;
    case 'recompute_address_fingerprints':
      await handleRecomputeAddressFingerprints(job, db);
      break;
    case 'geocode_household':
      await handleGeocodeHousehold(job, db);
      break;
    case 'match_boundaries':
      await handleMatchBoundaries(job, db, jobId);
      break;
    case 'sweep_unmatched_boundaries':
      await handleSweepUnmatchedBoundaries(db);
      break;
    case 'materialize_demo_attachments':
      await handleMaterializeDemoAttachments(job, db);
      break;
    case 'schedule_sync_jobs':
      await handleScheduleSyncJobs(db);
      break;
    case 'google_sync':
      await handleGoogleSync(job, db);
      break;
    case 'ms_sync':
      await handleMsSync(job, db);
      break;
    case 'send-form-notifications':
      await handleSendFormNotifications(job, db);
      break;
    case 'send-shift-reminder':
      await handleSendShiftReminder(job, db);
      break;
    case 'send-webform-notifications':
      await handleSendWebformNotifications(job, db);
      break;
    case 'send-event-registration-confirmation':
      await handleSendEventRegistrationConfirmation(job, db);
      break;
    case 'send-event-reminder':
      await handleSendEventReminder(job, db);
      break;
    case 'send-transactional-email':
      await handleSendTransactionalEmail(job);
      break;
    case 'send-sms':
      await handleSendSms(job);
      break;
    case 'send-subscription-confirmation':
      await handleSendSubscriptionConfirmation(job);
      break;
    case 'check_due_tasks':
      await handleCheckDueTasks(db);
      break;
    case 'process_mentions':
      await handleProcessMentions(job, db);
      break;
    case 'ops_watchdog':
      await handleOpsWatchdog(db);
      break;
    case 'send-bug-report-email':
      await handleSendBugReportEmail(job, db);
      break;
    case 'send-newsletter':
      await handleSendNewsletter(job, db, jobId);
      break;
    case 'prune_newsletter_events':
      await handlePruneNewsletterEvents(db);
      break;
    case 'process_scheduled_newsletters':
      await handleProcessScheduledNewsletters(db);
      break;
    case 'process_drip_workflows':
      await handleProcessDripWorkflows(db);
      break;
    case 'send-automation-email':
      await handleSendAutomationEmail(db, job);
      break;
    case 'detect_lapsed_supporters':
      await handleDetectLapsedSupporters(db);
      break;
    case 'detect_task_sla_breaches':
      await handleDetectTaskSlaBreaches(db);
      break;
    case 'perform_scheduled_deletions':
      await handlePerformScheduledDeletions(db);
      break;
    case 'purge_downgraded_inboxes':
      await handlePurgeDowngradedInboxes(db);
      break;
    case 'zapier_trigger':
      await handleZapierTrigger(job);
      break;
    case 'check_usage_limits':
      await handleCheckUsageLimits(job, db);
      break;
    case 'check_all_usage_limits':
      await handleCheckAllUsageLimits(db);
      break;
    case 'export_csv':
      await handleExportCsv(job, db);
      break;
    case 'import_csv':
      // The job row's own id lets the handler tell its own 'processing' row apart from a rival
      // job for the same import before it enqueues the next segment.
      await handleImportCsvJob(job, db, { jobId });
      break;
    default: {
      const _exhaustive: never = job;
      throw new Error(`Unsupported background job type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
