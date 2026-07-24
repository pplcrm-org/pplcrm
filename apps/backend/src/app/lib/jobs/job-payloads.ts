import { z } from 'zod';
import type { ZapierEventType } from '../../modules/zapier/zapier.service';

/**
 * IDs are strings in the database, but historical job payloads may carry them
 * as numbers (JSON round-trip of bigint columns). Normalize to string.
 */
const idSchema = z.union([z.string(), z.number()]).transform(String);

/** Must stay in sync with ZapierEventType in modules/zapier/zapier.service.ts (enforced by `satisfies`). */
const ZAPIER_EVENT_TYPES = [
  'person_created',
  'person_updated',
  'person_deleted',
  'person_tag_added',
  'person_tag_removed',
] as const satisfies readonly ZapierEventType[];

const exportSortSchema = z.object({
  colId: z.string().nullish(),
  sort: z.string().nullish(),
});

const exportOptionsSchema = z.object({
  userId: idSchema.nullish(),
  entity: z.string().nullish(),
  activity: z.string().nullish(),
  searchStr: z.string().nullish(),
  sortModel: z.array(exportSortSchema).nullish(),
});

export const jobPayloadSchema = z.discriminatedUnion('type', [
  // ── Lists / companies / maintenance ─────────────────────────────────────
  z.object({
    type: z.literal('refresh_list'),
    tenant_id: idSchema,
    list_id: idSchema,
    user_id: idSchema,
  }),
  z.object({
    type: z.literal('enrich_company_google'),
    company_id: idSchema,
    tenant_id: idSchema,
    // A user-triggered "Re-check Google" re-runs the lookup even when the
    // company was already enriched; the auto-queue on first load does not.
    force: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('refresh_companies_google'),
    tenant_id: idSchema.nullish(),
  }),
  z.object({ type: z.literal('cleanup_activities') }),
  z.object({ type: z.literal('prune_retention') }),
  z.object({ type: z.literal('recompute_all_duplicates') }),
  z.object({
    type: z.literal('recompute_address_fingerprints'),
    tenant_id: idSchema.nullish(),
  }),
  z.object({
    type: z.literal('geocode_household'),
    household_id: idSchema,
    tenant_id: idSchema,
  }),

  // ── External account sync ───────────────────────────────────────────────
  z.object({ type: z.literal('schedule_sync_jobs') }),
  z.object({
    type: z.literal('google_sync'),
    tenantId: idSchema,
    campaignId: idSchema,
    requestedBy: z.string().default('system'),
  }),
  z.object({
    type: z.literal('ms_sync'),
    tenantId: idSchema,
    campaignId: idSchema,
    requestedBy: z.string().default('system'),
  }),

  // ── Notifications & transactional email ─────────────────────────────────
  z.object({
    type: z.literal('send-form-notifications'),
    eventId: idSchema,
    tenantId: idSchema,
    email: z.string(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    mobile: z.string().nullish(),
    notes: z.string().nullish(),
  }),
  z.object({
    type: z.literal('send-shift-reminder'),
    shiftId: idSchema,
  }),
  z.object({
    type: z.literal('send-webform-notifications'),
    formId: idSchema,
    email: z.string(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    notes: z.string().nullish(),
  }),
  z.object({
    type: z.literal('send-event-registration-confirmation'),
    registrationId: idSchema,
  }),
  z.object({
    type: z.literal('send-event-reminder'),
    registrationId: idSchema,
  }),
  z.object({
    type: z.literal('send-transactional-email'),
    to: z.string(),
    subject: z.string().nullish(),
    text: z.string().nullish(),
    html: z.string().nullish(),
    tenant_id: idSchema.nullish(),
    notificationSettingsLink: z.boolean().nullish(),
  }),
  z.object({
    type: z.literal('send-sms'),
    to: z.string(),
    body: z.string(),
  }),
  z.object({
    type: z.literal('send-subscription-confirmation'),
    email: z.string(),
    firstName: z.string().nullish(),
    confirmUrl: z.string(),
  }),
  z.object({ type: z.literal('check_due_tasks') }),
  // Ops watchdog: cron that digests failed jobs/webhooks + queue backlog to the ops email and
  // writes the dead-man heartbeat behind GET /healthz/worker.
  z.object({ type: z.literal('ops_watchdog') }),
  // User-submitted bug report → ops email. Carries only the report id; the handler composes
  // the message and pulls the screenshot from storage (never the image in the payload).
  z.object({
    type: z.literal('send-bug-report-email'),
    bugReportId: idSchema,
    tenant_id: idSchema,
  }),

  // ── Newsletters ──────────────────────────────────────────────────────────
  z.object({
    type: z.literal('send-newsletter'),
    tenantId: idSchema,
    newsletterId: idSchema,
    userId: idSchema,
    offset: z.number().nullish(),
    deliveredCount: z.number().nullish(),
    // Keyset cursor (last email sent). Present on resume/continuation jobs; absent on a fresh send.
    cursor: z.string().nullish(),
  }),
  z.object({ type: z.literal('prune_newsletter_events') }),
  z.object({ type: z.literal('process_scheduled_newsletters') }),

  // ── Workflows & deletions ────────────────────────────────────────────────
  z.object({ type: z.literal('process_drip_workflows') }),
  // Automation send_email delivery. Goes through SendGrid (the user-triggered mail path —
  // Postmark is reserved for pplCRM-to-user mail) with the workflow_run_id as a custom arg so
  // the event webhook can stamp opens/clicks back onto the run for step/exit conditions.
  z.object({
    type: z.literal('send-automation-email'),
    tenantId: idSchema,
    workflowRunId: idSchema,
    to: z.string(),
    subject: z.string(),
    html: z.string(),
    text: z.string(),
    unsubscribeUrl: z.string(),
    // Present on jobs enqueued since quota moved to delivery-time metering: the handler logs
    // the send into newsletter_send_log only when this is set (and the send succeeded). Absent
    // on legacy jobs, which were already metered at enqueue time.
    meterOnSend: z.boolean().optional(),
  }),
  z.object({ type: z.literal('detect_lapsed_supporters') }),
  z.object({ type: z.literal('detect_task_sla_breaches') }),
  z.object({ type: z.literal('perform_scheduled_deletions') }),

  // ── Billing & integrations ───────────────────────────────────────────────
  z.object({
    type: z.literal('zapier_trigger'),
    tenant_id: idSchema,
    event_type: z.enum(ZAPIER_EVENT_TYPES),
    data: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('check_usage_limits'),
    tenant_id: idSchema,
  }),
  z.object({ type: z.literal('check_all_usage_limits') }),

  // ── Exports ──────────────────────────────────────────────────────────────
  z.object({
    type: z.literal('export_csv'),
    export_id: idSchema,
    tenant_id: idSchema,
    table: z.string().nullish(),
    entity: z.string().nullish(),
    options: exportOptionsSchema.default({}),
    columns: z.array(z.string()).nullish(),
    user_id: idSchema.nullish(),
    file_name: z.string().nullish(),
  }),
]);

export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type JobType = JobPayload['type'];
export type JobPayloadOf<K extends JobType> = Extract<JobPayload, { type: K }>;

/**
 * CSV imports are queued without a `type` discriminator (legacy shape) and are
 * matched by the presence of `import_id` + `storage_key` instead.
 */
export const legacyImportJobSchema = z.object({
  import_id: idSchema,
  storage_key: z.string(),
  tenant_id: idSchema,
  user_id: idSchema,
  source: z.string().nullish(),
  skipped: z.union([z.string(), z.number()]).nullish(),
  campaign_id: idSchema.nullish(),
  tags: z.array(z.string()).nullish(),
  file_name: z.string().nullish(),
  // §17 CSV import wizard — see PersonsService.importRows/processImportRows.
  duplicate_decision: z.enum(['merge', 'skip', 'import_new']).nullish(),
  list_name: z.string().nullish(),
  client_skip_reasons: z
    .array(z.object({ row: z.number(), email: z.string().optional(), reason: z.string() }))
    .nullish(),
});

export type LegacyImportJobPayload = z.infer<typeof legacyImportJobSchema>;
