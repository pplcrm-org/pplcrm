import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { jobPayloadSchema, legacyImportJobSchema } from './job-payloads';
import { handleCheckAllUsageLimits, handleCheckUsageLimits, handleZapierTrigger } from './handlers/billing.handlers';
import { handlePerformScheduledDeletions } from './handlers/deletions.handlers';
import { handleExportCsv } from './handlers/export.handlers';
import { handleImportJob } from './handlers/import.handlers';
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
import { handleGoogleSync, handleMsSync, handleScheduleSyncJobs } from './handlers/sync.handlers';
import {
  handleDetectLapsedSupporters,
  handleDetectTaskSlaBreaches,
  handleProcessDripWorkflows,
} from './handlers/workflows.handlers';
import { handleSendAutomationEmail } from './handlers/automation-mail.handlers';

export { checkDueTasks } from './handlers/notifications.handlers';

const typeProbeSchema = z.looseObject({ type: z.unknown() });

/**
 * Background job dispatcher. Parses the raw queue payload against the typed
 * job schemas and routes it to the matching domain handler in `./handlers/`.
 */
export async function executeJob(payload: unknown, db: Kysely<Models>, jobId?: string): Promise<void> {
  const typed = jobPayloadSchema.safeParse(payload);

  if (!typed.success) {
    // CSV imports are queued without a `type` discriminator (legacy shape).
    const legacyImport = legacyImportJobSchema.safeParse(payload);
    if (legacyImport.success) {
      await handleImportJob(legacyImport.data, db);
      return;
    }

    const probe = typeProbeSchema.safeParse(payload);
    const typeLabel = probe.success && probe.data.type !== undefined ? String(probe.data.type) : 'unknown';
    throw new Error(`Unsupported background job type: ${typeLabel}`);
  }

  const job = typed.data;
  switch (job.type) {
    case 'refresh_list':
      await handleRefreshList(job);
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
    default: {
      const _exhaustive: never = job;
      throw new Error(`Unsupported background job type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
