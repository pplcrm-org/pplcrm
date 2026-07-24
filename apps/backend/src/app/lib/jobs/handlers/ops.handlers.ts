import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { logger } from '../../../logger';
import type { MailAttachment } from '../../mail/transactional-mail.service';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { StorageService } from '../../storage.service';
import type { JobPayloadOf } from '../job-payloads';
import { FIVE_MINUTES_MS, scheduleNextRun } from '../reschedule';

const mailService = new TransactionalEmailService();

const HEARTBEAT_NAME = 'ops_watchdog';
// First run (or lost details) looks back this far for failures.
const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;
// Oldest eligible pending job older than this = the queue is jammed/backlogged.
const BACKLOG_ALERT_MS = 15 * 60 * 1000;
// Identical digests within this window are suppressed (mainly repeats of a persistent backlog).
const ALERT_SUPPRESSION_MS = 6 * 60 * 60 * 1000;

// details is untyped jsonb; parse defensively and fall back to {} on any historical shape.
const heartbeatDetailsSchema = z
  .object({
    last_checked_at: z.string().optional(),
    last_alert_fingerprint: z.string().optional(),
    last_alerted_at: z.string().optional(),
  })
  .catch({});

interface FailureGroup {
  key: string;
  count: number;
  sample_error: string;
}

/**
 * Ops watchdog — the "who tells the operator" half of observability (the Azure availability
 * probes are the "is it up" half; see infra/azure/main.bicep).
 *
 * Every cycle it:
 *   1. digests NEW failures since the last cycle (failed background_jobs / webhook_events, a
 *      backlogged queue, newly sending-paused tenants) and emails them to OPS_ALERT_EMAIL;
 *   2. updates the `ops_heartbeats` row that `GET /healthz/worker` reads — the dead-man beat.
 *      The beat happens ONLY when a full claim→execute→complete cycle works, which is exactly
 *      what makes the external probe catch a wedged worker while the API stays healthy.
 *
 * All queries here are cross-tenant by design (this is a platform-level operator digest, not a
 * tenant surface) — lib/jobs/handlers is outside the local/no-unscoped-db-query rule's scope.
 */
export async function handleOpsWatchdog(db: Kysely<Models>): Promise<void> {
  const now = new Date();

  const row = await db
    .selectFrom('ops_heartbeats')
    .select('details')
    .where('name', '=', HEARTBEAT_NAME)
    .executeTakeFirst();
  const details = heartbeatDetailsSchema.parse(row?.details ?? {});
  const watermark = details.last_checked_at
    ? new Date(details.last_checked_at)
    : new Date(now.getTime() - DEFAULT_LOOKBACK_MS);

  // Newly dead-lettered background jobs since the last cycle, grouped by job type.
  const failedJobs: FailureGroup[] = await db
    .selectFrom('background_jobs')
    .select([
      sql<string>`coalesce(payload->>'type', 'unknown')`.as('key'),
      sql<number>`count(*)::int`.as('count'),
      sql<string>`max(left(coalesce(error, ''), 300))`.as('sample_error'),
    ])
    .where('status', '=', 'failed')
    .where('updated_at', '>', watermark)
    .groupBy(sql`coalesce(payload->>'type', 'unknown')`)
    .execute();

  // Newly failed Stripe webhook events (drained by webhook-worker.ts).
  const failedWebhooks: FailureGroup[] = await db
    .selectFrom('webhook_events')
    .select([
      'type as key',
      sql<number>`count(*)::int`.as('count'),
      sql<string>`max(left(coalesce(error, ''), 300))`.as('sample_error'),
    ])
    .where('status', '=', 'failed')
    .where('updated_at', '>', watermark)
    .groupBy('type')
    .execute();

  // Queue health: oldest job that is eligible to run but still pending.
  const backlog = await db
    .selectFrom('background_jobs')
    .select(sql<Date | null>`min(run_at)`.as('oldest_run_at'))
    .where('status', '=', 'pending')
    .where('run_at', '<=', now)
    .executeTakeFirst();
  const backlogAgeMs = backlog?.oldest_run_at ? now.getTime() - new Date(backlog.oldest_run_at).getTime() : 0;
  const backlogged = backlogAgeMs > BACKLOG_ALERT_MS;

  // Tenants tripped into sending-pause since the last cycle (see pplcrm-sending-guards).
  const newlyPausedTenants = await db
    .selectFrom('tenants')
    .select(['id', 'name', 'sending_paused_at'])
    .where('sending_paused_at', '>', watermark)
    .execute();

  const sections: string[] = [];
  if (failedJobs.length > 0) {
    sections.push(formatFailureSection('Failed background jobs', failedJobs));
  }
  if (failedWebhooks.length > 0) {
    sections.push(formatFailureSection('Failed webhook events', failedWebhooks));
  }
  if (backlogged) {
    sections.push(
      `Queue backlog: the oldest runnable pending job has been waiting ${Math.round(backlogAgeMs / 60000)} minutes.`,
    );
  }
  if (newlyPausedTenants.length > 0) {
    const lines = newlyPausedTenants.map((t) => `  - ${t.name} (tenant ${t.id})`);
    sections.push(`Tenants newly paused from sending:\n${lines.join('\n')}`);
  }

  let alertFingerprint = details.last_alert_fingerprint;
  let alertedAt = details.last_alerted_at;
  if (sections.length > 0) {
    // Fingerprint on the *categories* of trouble, not counts — a persistent backlog shouldn't
    // re-alert every 5 minutes, but a new failure category should alert immediately.
    const fingerprint = [
      ...failedJobs.map((g) => `job:${g.key}`),
      ...failedWebhooks.map((g) => `webhook:${g.key}`),
      backlogged ? 'backlog' : '',
      ...newlyPausedTenants.map((t) => `paused:${t.id}`),
    ]
      .filter(Boolean)
      .sort()
      .join('|');
    const suppressed =
      fingerprint === details.last_alert_fingerprint &&
      details.last_alerted_at != null &&
      now.getTime() - new Date(details.last_alerted_at).getTime() < ALERT_SUPPRESSION_MS;

    if (suppressed) {
      logger.info({ fingerprint }, 'Ops watchdog: findings unchanged, alert suppressed');
    } else if (env.opsAlertEmail == null) {
      logger.warn({ sections }, 'Ops watchdog found problems but OPS_ALERT_EMAIL is not set — no email sent');
    } else {
      const body = sections.join('\n\n');
      logger.warn({ sections }, 'Ops watchdog: sending problem digest');
      // Send directly (not via the mail queue): if the queue is the sick component, the alert
      // would sit behind the very backlog it is reporting.
      await mailService.sendMail({
        to: env.opsAlertEmail,
        subject: `pplCRM ops: ${summarize(failedJobs, failedWebhooks, backlogged, newlyPausedTenants.length)}`,
        text: body,
        html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(body)}</pre>`,
      });
      alertFingerprint = fingerprint;
      alertedAt = now.toISOString();
    }
  }

  // The dead-man beat — reached only when the whole cycle above succeeded. Upsert so a missing
  // row (fresh DB) heals itself rather than failing the cron forever.
  const newDetails = JSON.stringify({
    last_checked_at: now.toISOString(),
    last_alert_fingerprint: alertFingerprint,
    last_alerted_at: alertedAt,
  });
  await db
    .insertInto('ops_heartbeats')
    .values({ name: HEARTBEAT_NAME, beat_at: now, details: newDetails })
    .onConflict((oc) => oc.column('name').doUpdateSet({ beat_at: now, details: newDetails }))
    .execute();

  await scheduleNextRun(db, 'ops_watchdog', FIVE_MINUTES_MS);
}

// Postmark's total-message cap is 10 MB; leave headroom for the body + inline logo.
const MAX_SCREENSHOT_ATTACH_BYTES = 7 * 1024 * 1024;

/**
 * Email a user-submitted bug report to the operator (see modules/bug-reports). Sent to
 * OPS_ALERT_EMAIL with the Postmark from-address as the fallback — a bug report must not be
 * silently dropped just because the ops alert address isn't configured. The screenshot is
 * attached to the email itself: the blob is private and the operator has no tenant session,
 * so an attachment is the only zero-auth way for them to see it.
 */
export async function handleSendBugReportEmail(
  payload: JobPayloadOf<'send-bug-report-email'>,
  db: Kysely<Models>,
): Promise<void> {
  const report = await db
    .selectFrom('bug_reports')
    .selectAll()
    .where('tenant_id', '=', payload.tenant_id)
    .where('id', '=', payload.bugReportId)
    .executeTakeFirst();
  if (!report) {
    logger.warn({ bugReportId: payload.bugReportId }, 'Bug report email: report row not found, skipping');
    return;
  }

  const reporter = await db
    .selectFrom('authusers')
    .select(['email', 'first_name', 'last_name', 'role', 'campaign_id'])
    .where('tenant_id', '=', payload.tenant_id)
    .where('id', '=', report.created_by)
    .executeTakeFirst();
  const tenant = await db.selectFrom('tenants').select(['name']).where('id', '=', payload.tenant_id).executeTakeFirst();

  const attachments: MailAttachment[] = [];
  let screenshotNote = 'none';
  if (report.screenshot_file_id) {
    const file = await db
      .selectFrom('files')
      .select(['filename', 'mime_type', 'size_bytes', 'storage_key'])
      .where('tenant_id', '=', payload.tenant_id)
      .where('id', '=', report.screenshot_file_id)
      .executeTakeFirst();
    if (!file) {
      screenshotNote = 'referenced upload no longer exists';
    } else if (Number(file.size_bytes ?? 0) > MAX_SCREENSHOT_ATTACH_BYTES) {
      screenshotNote = `too large to attach (${file.filename}, ${file.size_bytes} bytes, storage key ${file.storage_key})`;
    } else {
      try {
        const data = await new StorageService().download(file.storage_key);
        attachments.push({
          name: file.filename || 'screenshot.png',
          contentBase64: data.toString('base64'),
          contentType: file.mime_type ?? 'application/octet-stream',
        });
        screenshotNote = `attached (${file.filename})`;
      } catch (err) {
        logger.error({ err, bugReportId: payload.bugReportId }, 'Bug report email: screenshot download failed');
        screenshotNote = `download failed (storage key ${file.storage_key})`;
      }
    }
  }

  const reporterName = [reporter?.first_name, reporter?.last_name].filter(Boolean).join(' ') || 'unknown';
  const body = [
    `Reference: BR-${report.id}`,
    `Tenant: ${tenant?.name ?? 'unknown'} (${payload.tenant_id})`,
    `Reporter: ${reporterName} <${reporter?.email ?? 'unknown'}> — role ${reporter?.role ?? 'unknown'}, campaign ${reporter?.campaign_id ?? 'none'}`,
    `Submitted: ${new Date(report.created_at).toISOString()}`,
    `Page: ${report.page_url ?? 'not captured'}`,
    `Browser: ${report.user_agent ?? 'not captured'}`,
    `Viewport: ${report.viewport ?? 'not captured'}`,
    `Screenshot: ${screenshotNote}`,
    '',
    'Description:',
    report.description,
  ].join('\n');

  await mailService.sendMail({
    to: env.opsAlertEmail ?? env.postmarkFromEmail,
    subject: `pplCRM bug report BR-${report.id} (tenant ${payload.tenant_id})`,
    text: body,
    html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(body)}</pre>`,
    attachments,
  });
}

function formatFailureSection(title: string, groups: FailureGroup[]): string {
  const lines = groups.map(
    (g) => `  - ${g.key}: ${g.count} failed. Last error: ${g.sample_error || '(none recorded)'}`,
  );
  return `${title}:\n${lines.join('\n')}`;
}

function summarize(
  failedJobs: FailureGroup[],
  failedWebhooks: FailureGroup[],
  backlogged: boolean,
  pausedCount: number,
): string {
  const parts: string[] = [];
  const jobCount = failedJobs.reduce((sum, g) => sum + g.count, 0);
  const webhookCount = failedWebhooks.reduce((sum, g) => sum + g.count, 0);
  if (jobCount > 0) parts.push(`${jobCount} failed job${jobCount === 1 ? '' : 's'}`);
  if (webhookCount > 0) parts.push(`${webhookCount} failed webhook${webhookCount === 1 ? '' : 's'}`);
  if (backlogged) parts.push('queue backlog');
  if (pausedCount > 0) parts.push(`${pausedCount} tenant${pausedCount === 1 ? '' : 's'} paused`);
  return parts.join(', ');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
