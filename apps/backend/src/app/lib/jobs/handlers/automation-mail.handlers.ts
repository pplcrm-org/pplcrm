import type { Kysely } from 'kysely';

import { env } from '../../../../env';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { NewsletterEmailService } from '../../mail/newsletter-mail.service';
import { hasPaymentHold, loadSendingTenant, logAutomationSend } from '../../../modules/newsletters/send-guards';
import { resolveAutomationSendConsent } from '../../../modules/workflows/automation-consent';

const mailService = new NewsletterEmailService();

/** Longest run error text kept — the automations screens show it inline. */
const MAX_RUN_ERROR_LENGTH = 500;

/**
 * Settle the `workflow_runs` row this delivery job belongs to.
 *
 * The drip worker writes the row as 'pending' when it queues the job, because at that moment
 * nothing has been sent. This is the only place that knows what actually happened, so it is the
 * only place that writes the terminal state: 'success' once the mail provider accepted the
 * message, 'skipped' when the send is deliberately dropped, 'failed' when it did not go out.
 * A retry that finally succeeds overwrites an earlier 'failed', which is why this is a plain
 * update rather than one guarded to the pending state.
 */
async function settleRun(
  db: Kysely<Models>,
  tenantId: string,
  workflowRunId: string,
  status: 'success' | 'skipped' | 'failed',
  error: string | null,
): Promise<void> {
  await db
    .updateTable('workflow_runs')
    .set({ status, error: error === null ? null : error.substring(0, MAX_RUN_ERROR_LENGTH) })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', workflowRunId)
    .execute();
}

export interface SendAutomationEmailPayload {
  tenantId: string;
  workflowRunId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
  /** The workflow's message class, carried in the payload so the delivery-time consent re-check
   * applies the same branch without joining back to workflows. Legacy jobs (field absent) were
   * enqueued before the two-class split, when every automation email followed today's
   * relationship rules — so absent is read as 'relationship' to keep in-flight mail behaving
   * as it did when it was queued. */
  messageClass?: 'relationship' | 'marketing';
  /** Set on jobs enqueued since quota moved to delivery-time metering — this handler logs the
   * send after SendGrid accepts it. Legacy jobs (flag absent) were metered at enqueue time. */
  meterOnSend?: boolean;
}

/**
 * Delivers one automation send_email step through SendGrid — the same path (tenant identity,
 * subuser, tracking) as newsletters, because automation emails are the tenant's mail to their
 * supporters; Postmark is reserved for pplCRM-to-user mail. The workflow_run_id custom arg lets
 * the event webhook stamp opens/clicks back onto the run, which is what step conditions
 * ("only send if the previous email wasn't opened") and exit goals read.
 *
 * Consent, caps, and the verified-domain gate were all enforced by the drip worker before this
 * job was enqueued; this handler only resolves identity and hands the message to SendGrid.
 *
 * Whatever happens, the run row ends up saying it honestly: the delivery below settles it to
 * 'success' or 'skipped', and anything thrown is recorded as 'failed' before being re-thrown so
 * the worker can still retry. A retry that succeeds overwrites the 'failed'; a job that runs out
 * of attempts leaves it there, which is what the automations screens should show.
 */
export async function handleSendAutomationEmail(
  db: Kysely<Models>,
  payload: SendAutomationEmailPayload,
): Promise<void> {
  try {
    await deliverAutomationEmail(db, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await settleRun(db, payload.tenantId, payload.workflowRunId, 'failed', message);
    throw err;
  }
}

async function deliverAutomationEmail(db: Kysely<Models>, payload: SendAutomationEmailPayload): Promise<void> {
  const { tenantId } = payload;

  const settingsRows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('tenant_id', '=', tenantId)
    .where('key', 'in', [
      'communications.sendgrid_api_key',
      'communications.sendgrid_subuser_username',
      'communications.default_from_name',
      'communications.default_from_email',
      'communications.reply_to',
      'communications.footer_disclaimer',
      'communications.verified_emails',
      'organization.address',
    ])
    .execute();

  const settingsMap: Record<string, string> = {};
  let verifiedEmails: string[] = [];
  for (const row of settingsRows) {
    if (typeof row.value === 'string') {
      settingsMap[row.key] = row.value;
    } else if (row.key === 'communications.verified_emails' && Array.isArray(row.value)) {
      verifiedEmails = (row.value as unknown[]).map((e) => String(e).toLowerCase().trim());
    }
  }

  const sendgridApiKey = settingsMap['communications.sendgrid_api_key'];
  const sendingTenant = await loadSendingTenant(db, tenantId);
  const freeTierSubuser = sendingTenant.plan === 'free' && !sendgridApiKey ? env.sendgridFreeTierSubuser : undefined;
  const subuserUsername = settingsMap['communications.sendgrid_subuser_username'] || freeTierSubuser;
  const fromName = settingsMap['communications.default_from_name'] || 'pplCRM Team';
  // The drip worker's verified-domain gate ran before enqueueing, so a permitted send always
  // has this set; fail loudly rather than send from the platform domain if it was bypassed.
  const fromEmail = settingsMap['communications.default_from_email'];
  if (!fromEmail) {
    throw new Error(`Automation email for run ${payload.workflowRunId}: no verified From address`);
  }

  // Delivery-time re-checks. The drip worker enforced consent/caps/pause when it ENQUEUED this job,
  // but that can be hours before delivery (retry backoff, queue depth). Re-check here so a tenant
  // paused/suspended by a tripwire or payment hold in the meantime doesn't keep sending, and a
  // recipient who unsubscribed/bounced/was marked DNC after enqueue isn't emailed anyway. Drop the
  // send (return, don't throw) rather than retry — the block is intentional, not a transient failure.
  if (sendingTenant.suspended_at || sendingTenant.sending_paused_at || hasPaymentHold(sendingTenant)) {
    logger.warn(
      { tenantId, workflowRunId: payload.workflowRunId },
      'Tenant sending blocked at delivery time — dropping queued automation email',
    );
    await settleRun(
      db,
      tenantId,
      payload.workflowRunId,
      'skipped',
      'Sending was blocked for this workspace when the email came up for delivery, so it was not sent.',
    );
    return;
  }
  const run = await db
    .selectFrom('workflow_runs')
    .select('person_id')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', payload.workflowRunId)
    .executeTakeFirst();
  if (run?.person_id) {
    const consent = await resolveAutomationSendConsent(
      db,
      tenantId,
      {
        id: String(run.person_id),
        email: payload.to,
      },
      payload.messageClass ?? 'relationship',
      // The goodbye carve-out has to be recognisable here too. This re-check runs hours after the
      // step queued the email, by which time the person has unsubscribed from everything — which
      // is exactly the state the carve-out exists for. The run id lets the consent module find the
      // enrollment behind this email and exclude this very run from its once-per-person test.
      { workflowRunId: payload.workflowRunId },
    );
    if (!consent.ok) {
      logger.info(
        { tenantId, workflowRunId: payload.workflowRunId, reason: consent.reason },
        'Recipient no longer consents at delivery time — dropping queued automation email',
      );
      await settleRun(db, tenantId, payload.workflowRunId, 'skipped', consent.reason);
      return;
    }
  }

  const replyToRaw = (settingsMap['communications.reply_to'] || '').toLowerCase().trim();
  const replyTo = replyToRaw && verifiedEmails.includes(replyToRaw) ? replyToRaw : undefined;

  const footer = buildAutomationFooter(
    payload.unsubscribeUrl,
    settingsMap['organization.address'],
    settingsMap['communications.footer_disclaimer'],
  );

  const delivered = await mailService.sendNewsletter({
    fromName,
    fromEmail,
    replyTo,
    recipients: [{ email: payload.to, listUnsubscribeUrl: payload.unsubscribeUrl }],
    subject: payload.subject,
    html: payload.html + footer.html,
    text: payload.text + footer.text,
    sendgridApiKey,
    subuserUsername,
    tenantId,
    customArgs: { workflow_run_id: payload.workflowRunId },
    // The footer carries the app's own HMAC unsubscribe link (flips every campaign
    // subscription), so SendGrid's subscription tracking stays off — which also means
    // SendGrid won't add List-Unsubscribe headers; the RFC 8058 pair rides on the recipient
    // above. The token has no campaignId, so the route stops every campaign, matching the
    // footer link in this same email.
    subscriptionTracking: false,
  });

  // Nothing accepted means the address was empty or a duplicate inside this single-recipient
  // request — retrying cannot change that, so record it and stop rather than throw.
  if (delivered === 0) {
    await settleRun(
      db,
      tenantId,
      payload.workflowRunId,
      'failed',
      'The mail provider accepted no recipient for this email, so it was not sent.',
    );
    return;
  }

  await settleRun(db, tenantId, payload.workflowRunId, 'success', null);

  // Meter the send only after SendGrid accepted it — a job that fails (and exhausts its
  // retries) must not consume the tenant's allowance. Legacy jobs without `meterOnSend` were
  // already metered at enqueue time; logging them again would double-count.
  if (payload.meterOnSend) {
    await logAutomationSend(db, tenantId);
  }
}

/**
 * Mandatory automation-email footer, appended server-side so it cannot be omitted: org address,
 * tenant disclaimer, and the per-recipient unsubscribe link (CAN-SPAM/CASL).
 */
export function buildAutomationFooter(
  unsubscribeUrl: string,
  address?: string,
  disclaimer?: string,
): { html: string; text: string } {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  const addr = (address || '').trim();
  if (addr) {
    htmlParts.push(`<div>${esc(addr).replace(/\n/g, '<br>')}</div>`);
    textParts.push(addr);
  }

  const disc = (disclaimer || '').trim();
  if (disc) {
    htmlParts.push(`<div>${esc(disc).replace(/\n/g, '<br>')}</div>`);
    textParts.push(disc);
  }

  htmlParts.push(`<div><a href="${esc(unsubscribeUrl)}">Unsubscribe</a></div>`);
  textParts.push(`Unsubscribe: ${unsubscribeUrl}`);

  const html = `<hr style="margin-top:24px"><div style="font-size:12px;color:#888;margin-top:8px">${htmlParts.join('')}</div>`;
  const text = `\n\n----\n${textParts.join('\n')}`;

  return { html, text };
}
