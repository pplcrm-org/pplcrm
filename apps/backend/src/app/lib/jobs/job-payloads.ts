import { z } from 'zod';
import { getAllOptions } from '../../../../../../libs/common/src';
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

/**
 * The full validated grid-options shape (`getAllOptions`), not a hand-picked subset. The queue
 * mutation stores the whole options object the grid sent, and the export handler applies the
 * grid's filters to decide which rows the file contains. The previous subset here silently
 * STRIPPED `filterModel`/`tags`/`issues`/`advancedFilterModel`/`listId` at the dispatcher's
 * safeParse — which is how a filtered grid export came back containing the whole table.
 *
 * Built from the base schema's `.shape` rather than `.extend()`: the five overrides loosen
 * existing keys to `nullish` for historical payloads that carried nulls, which Zod's
 * extend/safeExtend refuse (the base carries a refinement, and loosening types the key `never`).
 * The dropped page-span refinement is enforced at the tRPC queue boundary and again by
 * `resolvePageWindow`'s clamps, so nothing is lost at this third layer.
 */
const exportOptionsSchema = z.object({
  ...getAllOptions.unwrap().shape,
  userId: idSchema.nullish(),
  entity: z.string().nullish(),
  activity: z.string().nullish(),
  searchStr: z.string().nullish(),
  sortModel: z.array(exportSortSchema).nullish(),
});

export const jobPayloadSchema = z.discriminatedUnion('type', [
  // ── Donation receipts ───────────────────────────────────────────────────
  // Acknowledge a gift the moment it commits (outbox insert in recordSuccessfulDonation). Enqueued
  // for EVERY successful gift; unlike a tax receipt it depends on no workspace configuration.
  z.object({
    type: z.literal('issue-donation-acknowledgement'),
    tenant_id: idSchema,
    donation_id: idSchema,
    user_id: idSchema,
  }),
  // Render an acknowledgement/receipt/statement PDF, store it via the files service, email it to
  // the donor. Attachments only exist on the direct sendMail path, so this MUST run in the worker.
  z.object({
    type: z.literal('render-receipt-pdf'),
    tenant_id: idSchema,
    receipt_id: idSchema,
    email: z.boolean().default(true),
    user_id: idSchema.nullish(),
  }),
  // Donor portal: look up the address typed into the public "email me my link" page and, when it
  // matches a person, mint + email a giving-portal link. The lookup lives HERE, not in the route,
  // so the route's answer is identical for matching and non-matching addresses (no donor probing).
  z.object({
    type: z.literal('send-donor-portal-link'),
    tenant_id: idSchema,
    email: z.string(),
  }),
  // Donor portal: a pledge was cancelled — notify the workspace's admins/owners (bell + email,
  // each behind the donor_pledge_cancelled preference pair). source 'portal' = the donor did it
  // on their giving page; 'stripe' = the cancellation arrived via webhook.
  z.object({
    type: z.literal('notify-donor-pledge-cancelled'),
    tenant_id: idSchema,
    pledge_id: idSchema,
    source: z.enum(['portal', 'stripe']),
  }),
  // One-time sweep over gifts recorded before acknowledgements existed. Stores each PDF and sends
  // NO email — a donor should not receive a receipt for a gift from months ago. `cursor` carries
  // the keyset resume point on continuation.
  z.object({
    type: z.literal('backfill-donation-acknowledgements'),
    tenant_id: idSchema,
    user_id: idSchema,
    cursor: idSchema.nullish(),
  }),
  // Year-end giving statement batch; cursor carries the keyset resume point on continuation.
  z.object({
    type: z.literal('run-year-end-statements'),
    tenant_id: idSchema,
    run_id: idSchema,
    user_id: idSchema,
    year: z.number().int(),
    cursor: idSchema.nullish(),
  }),
  // ── Lists / companies / maintenance ─────────────────────────────────────
  z.object({
    type: z.literal('refresh_list'),
    tenant_id: idSchema,
    list_id: idSchema,
    user_id: idSchema,
  }),
  /**
   * Fire the `list_joined` automation trigger for people just added to a static list. Enqueued
   * inside the list-creation transaction, one row per chunk of person ids: evaluating the trigger
   * once per member sequentially inside the HTTP request meant thousands of awaited round trips on
   * a large list.
   */
  z.object({
    type: z.literal('trigger_list_joined'),
    tenant_id: idSchema,
    list_id: idSchema,
    person_ids: z.array(idSchema),
  }),
  /**
   * Fire the `contact_created` automation trigger for people a CSV import just inserted. Enqueued
   * inside each import chunk's transaction (≤ IMPORT_TRIGGER_JOB_CHUNK_SIZE ids per job), so a
   * rolled-back chunk discards its jobs: firing once per person inline in the import job added
   * minutes at 100k rows. Only newly-inserted persons — merged persons are not new contacts.
   */
  z.object({
    type: z.literal('trigger_contact_created'),
    tenant_id: idSchema,
    person_ids: z.array(idSchema),
  }),
  /**
   * Fire the `tag_added` automation trigger for person/tag pairs a CSV import actually created
   * (the `.returning()`-confirmed new map_peoples_tags rows only — pairs the contact already had
   * never re-fire). Same in-transaction chunked enqueue as trigger_contact_created.
   */
  z.object({
    type: z.literal('trigger_tag_added'),
    tenant_id: idSchema,
    pairs: z.array(
      z.object({
        person_id: idSchema,
        tag_id: idSchema,
        tag_name: z.string().default(''),
      }),
    ),
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
  /**
   * Nightly sweep writing every tenant's dashboard-statistics snapshot (dashboard_stats_snapshots).
   * Parameterless cron — seeded at boot like the other CRON_JOBS entries.
   */
  z.object({ type: z.literal('refresh_dashboard_stats') }),
  /**
   * One tenant's snapshot on demand: the dashboard's Refresh button, and the first view of a
   * workspace that has no snapshot yet. A SEPARATE type from the cron sweep on purpose — cron
   * chain continuation (scheduleNextRun) coalesces on `payload->>'type'`, so a pending manual
   * refresh sharing the sweep's type would silently stop the nightly chain.
   */
  z.object({ type: z.literal('refresh_dashboard_stats_tenant'), tenant_id: idSchema }),
  z.object({
    type: z.literal('recompute_address_fingerprints'),
    tenant_id: idSchema.nullish(),
  }),
  z.object({
    type: z.literal('geocode_household'),
    household_id: idSchema,
    tenant_id: idSchema,
  }),
  /**
   * Re-match households against boundary polygons. Pure processor work: it re-reads coordinates
   * already on file and calls no paid service, which is why it may run promptly while geocoding is
   * metered across days. Enqueued whenever a boundary set is created, drawn into, uploaded, edited
   * or deleted, inside that write's own transaction.
   *
   * `set_id` null means every set the workspace's active campaigns require. `scope` 'unmatched'
   * limits the pass to households that hold no row for the target sets, which is what the nightly
   * sweep wants; 'all' re-matches everything, which is what a changed map wants. `cursor` is the
   * keyset resume point — one pass handles a fixed batch and re-queues itself with the last
   * household id it saw, so a large workspace never holds a transaction open across a long loop.
   */
  z.object({
    type: z.literal('match_boundaries'),
    tenant_id: idSchema,
    set_id: idSchema.nullish(),
    scope: z.enum(['all', 'unmatched']).default('all'),
    cursor: idSchema.nullish(),
  }),
  /** Nightly: re-match anything still unmatched, for every workspace holding a boundary set. */
  z.object({ type: z.literal('sweep_unmatched_boundaries') }),
  /**
   * Hourly: for every tenant whose local midnight has passed, close canvass shifts still
   * open from yesterday and DELETE yesterday's location pings. The Live tab's privacy
   * contract — no coordinate persists past the day — is enforced here.
   */
  z.object({ type: z.literal('purge_canvass_pings') }),
  /**
   * Materialize the demo inbox's attachment payloads (build the bytes, upload, link a `files`
   * row). Enqueued in the signup transaction rather than uploaded inline: blob I/O in the
   * signup path adds latency, makes a storage outage a signup problem, and strands blobs if
   * the transaction rolls back. Until it runs the rows exist as metadata-only, which is a
   * state the UI already handles.
   */
  z.object({
    type: z.literal('materialize_demo_attachments'),
    tenant_id: idSchema,
    user_id: idSchema,
  }),

  // ── External account sync ───────────────────────────────────────────────
  z.object({ type: z.literal('schedule_sync_jobs') }),
  /** Permanently delete synced inbox mail for workspaces 30+ days past a downgrade to Free
   * (the shared inbox is Grassroots+) — see billing/inbox-purge.ts for the scheduling rules. */
  z.object({ type: z.literal('purge_downgraded_inboxes') }),
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
    // Optional (not required): already-enqueued rows in the live DB predate this field and
    // would fail a required check at claim time. Tighten once old rows have drained.
    tenantId: z.string().optional(),
  }),
  z.object({
    type: z.literal('send-webform-notifications'),
    formId: idSchema,
    email: z.string(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    notes: z.string().nullish(),
    // Optional (not required): already-enqueued rows in the live DB predate this field and
    // would fail a required check at claim time. Tighten once old rows have drained.
    tenantId: z.string().optional(),
  }),
  z.object({
    type: z.literal('send-event-registration-confirmation'),
    registrationId: idSchema,
    // Optional (not required): already-enqueued rows in the live DB predate this field and
    // would fail a required check at claim time. Tighten once old rows have drained.
    tenantId: z.string().optional(),
  }),
  z.object({
    type: z.literal('send-event-reminder'),
    registrationId: idSchema,
    // Optional (not required): already-enqueued rows in the live DB predate this field and
    // would fail a required check at claim time. Tighten once old rows have drained.
    tenantId: z.string().optional(),
  }),
  z.object({
    type: z.literal('send-transactional-email'),
    to: z.string(),
    subject: z.string().nullish(),
    text: z.string().nullish(),
    html: z.string().nullish(),
    tenant_id: idSchema.nullish(),
    // Optional: rows enqueued before the anti-abuse gate landed carry no audience, and a
    // required check would fail them at claim time. Missing = the restricted default.
    audience: z.enum(['account', 'staff', 'contact']).nullish(),
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
    // The enqueue site already sends this; it was simply not declared, so the handler
    // could not attribute the message to a tenant (see the C5 attribution note).
    // Optional so rows enqueued before this landed still parse at claim time.
    tenantId: idSchema.nullish(),
  }),
  z.object({ type: z.literal('check_due_tasks') }),
  // @mentions in a task/email comment -> in-app notification + email, per mentioned user's
  // preferences. Queued rather than run inline: processMentions sends SMTP, so awaiting it would
  // put mail latency on the comment request, and firing it detached lost every mention still in
  // flight when the process shut down.
  z.object({
    type: z.literal('process_mentions'),
    tenant_id: idSchema,
    commentText: z.string(),
    commentLink: z.string(),
    authorId: idSchema,
  }),
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
  z.object({ type: z.literal('detect_date_arrivals') }),
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

  // ── Imports ──────────────────────────────────────────────────────────────
  /**
   * Upload-based CSV import: the browser PUT the raw file to blob storage (a write SAS from
   * `imports.getUploadUrl`), and the mutation enqueued this job instead of shipping rows in its
   * body. The handler streams the blob twice — once to count and validate rows, once to insert —
   * applying `mapping` (stringified 0-based column index → import field key) to each record.
   */
  z.object({
    type: z.literal('import_csv'),
    import_id: idSchema,
    tenant_id: idSchema,
    user_id: idSchema,
    source: z.enum(['persons', 'households', 'companies', 'tasks']),
    storage_key: z.string(),
    mapping: z.record(z.string(), z.string()),
    campaign_id: idSchema.nullish(),
    tags: z.array(z.string()).nullish(),
    file_name: z.string().nullish(),
    // Persons only — how rows whose email matches an existing person are handled.
    duplicate_decision: z.enum(['merge', 'skip', 'import_new']).nullish(),
    // Persons only — static list every imported/merged person is added to.
    list_name: z.string().nullish(),
  }),

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
 * ONE-RELEASE DRAIN SHIM — delete together with `handleLegacyImportJob` in
 * `handlers/import.handlers.ts` and its route in `job-handlers.ts`.
 *
 * Before 2026-08-05 the four `<entity>.import` mutations shipped their rows in the request body,
 * wrote them to blob storage as a pre-mapped NDJSON payload, and queued a job with NO `type`
 * discriminator — it was recognised by the presence of `import_id` + `storage_key` instead. That
 * request path and its handler were both deleted in 3047c19a, on the assumption the queue had
 * already drained. It had not been verified empty: any such row still in `background_jobs` now
 * fails `jobPayloadSchema`, throws 'Unsupported background job type: unknown', retries to
 * exhaustion, dead-letters, and the stale sweep marks the member's import failed.
 *
 * REMOVAL CONDITION: no `background_jobs` row older than the 2026-08-05 deploy remains in
 * 'pending' or 'processing' with a payload that has `import_id` and `storage_key` but no `type`.
 * Job retention prunes completed rows after 7 days and failed rows after 30, so one release with
 * this shim in place is enough; verify with a query before deleting it.
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
  duplicate_decision: z.enum(['merge', 'skip', 'import_new']).nullish(),
  list_name: z.string().nullish(),
  client_skip_reasons: z
    .array(z.object({ row: z.number(), email: z.string().optional(), reason: z.string() }))
    .nullish(),
});

export type LegacyImportJobPayload = z.infer<typeof legacyImportJobSchema>;
