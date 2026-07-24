import type { ExpressionBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { logger } from '../../../logger';
import { ConflictError } from '../../../errors/app-errors';
import type { NewsletterAttachment, NewsletterRecipient } from '../../mail/newsletter-mail.service';
import { NewsletterEmailService } from '../../mail/newsletter-mail.service';
import {
  extractMergeTokens,
  htmlToPlainText,
  renderNewsletterHtml,
  resolveMergeSubstitutions,
} from '../../mail/newsletter-render';
import { UserActivityRepo } from '../../user-activity.repo';
import type { JobPayloadOf } from '../job-payloads';
import { DAY_MS, FIVE_MINUTES_MS, scheduleNextRun } from '../reschedule';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { FilesRepo } from '../../../modules/files/repositories/files.repo';
import { StorageService } from '../../storage.service';
import { getPlanDef } from '@common';
import { getPlanLimits } from '../../../modules/billing/usage-limits';
import {
  hasPaymentHold,
  loadSendingTenant,
  logNewsletterBatch,
  remainingSendAllowance,
} from '../../../modules/newsletters/send-guards';

const scheduledSendMailService = new TransactionalEmailService();

const NEWSLETTER_BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1000;
// How long a rate-capped send waits before its continuation job retries (rolling windows free
// up gradually, so a short fixed delay converges without busy-waiting a worker slot).
const RATE_CAP_DEFER_MS = 15 * 60 * 1000;

export async function handleSendNewsletter(
  payload: JobPayloadOf<'send-newsletter'>,
  db: Kysely<Models>,
  jobId?: string,
): Promise<void> {
  const newsletterMailSvc = new NewsletterEmailService();
  const { tenantId, newsletterId, userId } = payload;

  // 1. Fetch newsletter to get settings, targets, segments, and content
  const newsletter = await db
    .selectFrom('newsletters')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('id', '=', newsletterId)
    .executeTakeFirst();

  if (!newsletter) {
    logger.warn(`Newsletter ${newsletterId} not found.`);
    return;
  }

  // Defense in depth: only a newsletter the kickoff actually claimed should be sent by this job.
  // The atomic claim in sendNewsletter already guarantees one job per send, but if a duplicate job
  // ever appears (a stale requeue, a hand-inserted row), refuse to send one that is already 'sent'
  // or was reverted to draft/archived — never re-blast an audience off a stray job.
  const SENDABLE_STATUSES = ['queuing', 'sending', 'paused'];
  if (!SENDABLE_STATUSES.includes(String(newsletter.status))) {
    logger.warn(
      { tenantId, newsletterId, status: newsletter.status },
      'Skipping send job for a newsletter that is not in a sendable state',
    );
    return;
  }

  // 2. Build the recipient query using NewslettersController
  const { NewslettersController } = await import('../../../modules/newsletters/controller');
  const controller = new NewslettersController();
  const baseQuery = await controller.buildRecipientQuery(tenantId, newsletter);

  // 3. Count total recipients
  let offset = payload.offset ?? 0;
  let deliveredCount = payload.deliveredCount ?? 0;
  // Keyset cursor: the last email address sent. Recipients are walked in ascending email order with
  // `WHERE email > cursor` instead of OFFSET, so unsubscribes/new sign-ups landing mid-send can't
  // shift the window and skip or double-send a boundary recipient. `offset` is kept only as a
  // progress counter (and the loop's upper bound), never as the pagination key.
  let cursor: string | null = payload.cursor ?? null;

  const countResult = await baseQuery
    .select(({ fn }: ExpressionBuilder<Models, 'persons'>) => fn.count(sql`DISTINCT persons.email`).as('count'))
    .executeTakeFirst();
  const totalRecipients = Number(countResult?.count || 0);

  if (offset === 0) {
    // Preflight TOCTOU guard: the send-time content gate ran against whatever content was stored
    // when `send` was called, but the worker reads the content fresh here — so re-score the actual
    // content about to go out. If it was swapped for something in the blocked band after the gate,
    // refuse to send it and revert to draft rather than blasting unscored content.
    const { newsletterPreflight } = await import('../../../modules/newsletters/preflight.service');
    try {
      await newsletterPreflight.assertNewsletterContentSendable(db, tenantId, {
        id: newsletterId,
        subject: newsletter.subject ?? null,
        html_content: newsletter.html_content ?? null,
        plain_text_content: newsletter.plain_text_content ?? null,
      });
    } catch (err) {
      logger.warn(
        { err, tenantId, newsletterId },
        'Newsletter content failed the send-time re-check — reverting to draft instead of sending',
      );
      await db
        .updateTable('newsletters')
        .set({ status: 'draft', send_offset: null, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', newsletterId)
        .execute();
      return;
    }

    await db
      .updateTable('newsletters')
      .set({
        status: 'sending',
        total_recipients: totalRecipients,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', newsletterId)
      .execute();
  }

  // Load communications/settings from database
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
      'organization.name',
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
  // Free-tier traffic on the platform key defaults to the shared free-tier subuser so its
  // sending reputation is isolated from paying customers'. A tenant-specific whitelabel
  // subuser (or a tenant-owned API key) always wins — its domain auth lives there.
  const sendingTenant = await loadSendingTenant(db, tenantId);
  const freeTierSubuser = sendingTenant.plan === 'free' && !sendgridApiKey ? env.sendgridFreeTierSubuser : undefined;
  const subuserUsername = settingsMap['communications.sendgrid_subuser_username'] || freeTierSubuser;
  const fromName = settingsMap['communications.default_from_name'] || 'pplCRM Team';
  // A newsletter is the tenant's mail to their own supporters, so it must send from the tenant's own
  // verified-domain address — never a pplCRM address. assertTenantMaySendNewsletter (the verified-
  // domain gate) runs before this job is enqueued, so a permitted broadcast always has this set; fail
  // loudly rather than silently send from the platform domain if that gate is ever bypassed.
  const fromEmail = settingsMap['communications.default_from_email'];
  if (!fromEmail) {
    throw new Error(`Newsletter ${newsletterId}: no verified From address (send-guard invariant violated)`);
  }

  // Reply-to is only honored when it has been verified (mirrors settings save-time validation).
  const replyToRaw = (settingsMap['communications.reply_to'] || '').toLowerCase().trim();
  const replyTo = replyToRaw && verifiedEmails.includes(replyToRaw) ? replyToRaw : undefined;

  // Mandatory footer appended server-side so it cannot be removed from the editor: org name and
  // address, tenant disclaimer, and a SendGrid-substituted unsubscribe link.
  const footer = buildNewsletterFooter(
    settingsMap['organization.name'],
    settingsMap['organization.address'],
    settingsMap['communications.footer_disclaimer'],
  );

  // Render the stored editor HTML into email-ready HTML once (block-JSON stripped, relative image
  // URLs made absolute against APP_URL, preview text injected as a hidden preheader). Merge tokens
  // are left in the content and resolved per-recipient via SendGrid substitutions below.
  const renderedHtml = renderNewsletterHtml(newsletter.html_content || '', {
    baseUrl: env.appUrl,
    previewText: newsletter.preview_text,
  });
  const mergeTokens = extractMergeTokens(newsletter.subject, renderedHtml, newsletter.plain_text_content);
  const finalHtml = renderedHtml + footer.html;
  // Always send a text/plain part — HTML-only email is a spam-filter signal. When the composer
  // didn't provide one, derive it from the rendered HTML.
  const finalText = (newsletter.plain_text_content || htmlToPlainText(renderedHtml)) + footer.text;

  const attachments = await buildNewsletterAttachments(db, tenantId, newsletterId);

  // Keyset walk: loop until a batch yields no more recipients (see the empty-batch break below).
  // `offset`/`totalRecipients` are progress display only — they must NOT bound the loop, or a resume
  // after the audience shrank ahead of the cursor would stop early and skip the remaining recipients.
  for (;;) {
    // Re-check the tenant's blocked state every batch so an abuse tripwire (fired by the
    // SendGrid webhook while this send is in flight) or a payment hold (subscription going
    // past_due mid-send) stops the send mid-stream, not just the next one. The resume point
    // is stored on the newsletter for a supervised restart.
    const tenantNow = await loadSendingTenant(db, tenantId);
    if (tenantNow.suspended_at || tenantNow.sending_paused_at || hasPaymentHold(tenantNow)) {
      logger.warn(
        { tenantId, newsletterId, offset, deliveredCount },
        'Tenant sending is blocked — pausing newsletter mid-send',
      );
      await db
        .updateTable('newsletters')
        .set({
          status: 'paused',
          send_offset: offset,
          send_cursor: cursor,
          delivered_count: deliveredCount,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', newsletterId)
        .execute();
      return;
    }

    // Per-tenant send-rate cap (hourly, plus the free-tier warm-up daily cap): trim the batch
    // to what's still allowed; when nothing is, hand the remainder to a continuation job and
    // free this worker slot instead of sleeping on it.
    const allowance = await remainingSendAllowance(db, tenantNow, new Date());
    if (allowance <= 0) {
      logger.info(
        { tenantId, newsletterId, offset, deliveredCount },
        'Per-tenant send cap reached — deferring remainder of newsletter send',
      );
      await db
        .updateTable('newsletters')
        .set({ send_offset: offset, send_cursor: cursor, delivered_count: deliveredCount, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', newsletterId)
        .execute();
      await db
        .insertInto('background_jobs')
        .values({
          tenant_id: tenantId,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'send-newsletter',
            newsletterId,
            tenantId,
            userId,
            offset,
            deliveredCount,
            cursor,
          }),
          run_at: new Date(Date.now() + RATE_CAP_DEFER_MS),
          max_attempts: 3,
        })
        .execute();
      return;
    }

    // Query a chunk of recipients using keyset pagination (WHERE email > cursor), NOT OFFSET, so a
    // recipient added/removed between batches can't shift the window. distinctOn(email) yields
    // exactly one row per address (matching the COUNT(DISTINCT email) total) while still carrying
    // the person fields the merge tokens need.
    let chunkQuery = baseQuery
      .select(['persons.email', 'persons.first_name', 'persons.last_name', 'persons.mobile', 'persons.home_phone'])
      .distinctOn('persons.email')
      .orderBy('persons.email', 'asc')
      .limit(Math.min(NEWSLETTER_BATCH_SIZE, allowance));
    if (cursor !== null) {
      chunkQuery = chunkQuery.where('persons.email', '>', cursor);
    }
    const chunkRows = await chunkQuery.execute();

    const seen = new Set<string>();
    const recipients: NewsletterRecipient[] = [];
    for (const r of chunkRows) {
      const email = r.email?.trim();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        email,
        substitutions: mergeTokens.length
          ? resolveMergeSubstitutions(mergeTokens, {
              email,
              firstName: r.first_name,
              lastName: r.last_name,
              phone: r.mobile || r.home_phone,
            })
          : undefined,
      });
    }

    if (recipients.length === 0) {
      break;
    }

    const batchDelivered = await newsletterMailSvc.sendNewsletter({
      fromName,
      fromEmail,
      replyTo,
      recipients,
      subject: newsletter.subject || 'Newsletter',
      html: finalHtml,
      text: finalText,
      sendgridApiKey,
      subuserUsername,
      newsletterId,
      tenantId,
      attachments,
    });

    deliveredCount += batchDelivered;
    offset += chunkRows.length;
    // Advance the keyset cursor to the last (max) email this batch sent. recipients is non-empty
    // here (length === 0 breaks above) and ordered ascending, so its final element is the
    // correct resume point — hence the non-null assertion.
    cursor = recipients[recipients.length - 1]!.email;

    // Meter the batch — this row is what the warm-up and hourly caps SUM over.
    await logNewsletterBatch(db, tenantId, newsletterId, batchDelivered);

    // Update progress in the background job payload (no recipients array!)
    if (jobId) {
      await db
        .updateTable('background_jobs')
        .set({
          payload: JSON.stringify({
            type: 'send-newsletter',
            newsletterId,
            tenantId,
            userId,
            offset,
            deliveredCount,
            cursor,
          }),
          updated_at: new Date(),
        })
        .where('id', '=', jobId)
        .execute();
    }

    // Add a small delay between batches to respect rate limits
    if (offset < totalRecipients) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Update newsletter status to 'sent'
  await db
    .updateTable('newsletters')
    .set({
      status: 'sent',
      delivered_count: deliveredCount,
      send_offset: null,
      send_cursor: null,
      send_date: new Date(),
      updatedby_id: userId,
      updated_at: new Date(),
    })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', newsletterId)
    .execute();

  // Log user activity
  const userActivity = new UserActivityRepo();
  await userActivity.log({
    tenant_id: tenantId,
    user_id: userId,
    activity: 'send',
    entity: 'newsletters',
    entity_id: newsletterId,
    quantity: totalRecipients,
    metadata: { recipientsCount: totalRecipients, deliveredCount },
  });

  const { queueUsageLimitCheck } = await import('../../../modules/billing/usage-limits');
  await queueUsageLimitCheck(tenantId, db);
}

// Send-log rows meter the monthly plan allowance over the tenant's billing cycle (sendWindow in
// send-guards.ts), and a cycle can span a 31-day month — 32 days keeps every row of the longest
// possible cycle alive (plus a day of slack) so the meter never undercounts near renewal.
const SEND_LOG_RETENTION_DAYS = 32;

export async function handlePruneNewsletterEvents(db: Kysely<Models>): Promise<void> {
  await pruneNewsletterEvents(db);
  await scheduleNextRun(db, 'prune_newsletter_events', DAY_MS);
}

// Event types that warrant keeping a per-newsletter engagement record.
// Delivery-only events (delivered, deferred, processed) are not stored.
const ENGAGEMENT_EVENT_TYPES = new Set(['open', 'click', 'unsubscribe', 'group_unsubscribe', 'bounce', 'spamreport']);

async function pruneNewsletterEvents(db: Kysely<Models>): Promise<void> {
  const tenants: { id: string; subscription_plan: string | null }[] = await db
    .selectFrom('tenants')
    .select(['id', 'subscription_plan'])
    .execute();

  for (const tenant of tenants) {
    try {
      const planKey = getPlanDef(tenant.subscription_plan)?.key ?? 'free';
      const retentionDays =
        planKey === 'movement' || planKey === 'enterprise' ? 90 : planKey === 'grassroots' ? 30 : 15;

      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const tenantId = String(tenant.id);

      // Send-log rows only feed the rolling-window send caps (24h max) — prune with the events.
      await db
        .deleteFrom('newsletter_send_log')
        .where('tenant_id', '=', tenantId)
        .where('created_at', '<', new Date(Date.now() - SEND_LOG_RETENTION_DAYS * DAY_MS))
        .execute();

      // Fetch events older than the retention window that are engagement events.
      const expiringEvents: {
        newsletter_id: string;
        email: string;
        event_type: string;
        timestamp: Date;
      }[] = await db
        .selectFrom('newsletter_events')
        .select(['newsletter_id', 'email', 'event_type', 'timestamp'])
        .where('tenant_id', '=', tenantId)
        .where('created_at', '<', cutoff)
        .execute();

      // Group by (newsletter_id, email) to produce one upsert per recipient.
      const grouped = new Map<
        string,
        {
          newsletter_id: string;
          email: string;
          open_count: number;
          click_count: number;
          has_unsubscribed: boolean;
          hard_bounced: boolean;
          soft_bounced: boolean;
          first_opened_at: Date | null;
          last_opened_at: Date | null;
          first_clicked_at: Date | null;
          last_clicked_at: Date | null;
          bounced_at: Date | null;
          unsubscribed_at: Date | null;
        }
      >();

      for (const ev of expiringEvents) {
        if (!ENGAGEMENT_EVENT_TYPES.has(ev.event_type)) continue;

        const key = `${ev.newsletter_id}::${ev.email}`;
        let agg = grouped.get(key);
        if (!agg) {
          agg = {
            newsletter_id: ev.newsletter_id,
            email: ev.email,
            open_count: 0,
            click_count: 0,
            has_unsubscribed: false,
            hard_bounced: false,
            soft_bounced: false,
            first_opened_at: null,
            last_opened_at: null,
            first_clicked_at: null,
            last_clicked_at: null,
            bounced_at: null,
            unsubscribed_at: null,
          };
          grouped.set(key, agg);
        }
        const ts = new Date(ev.timestamp);

        if (ev.event_type === 'open') {
          agg.open_count++;
          if (!agg.first_opened_at || ts < agg.first_opened_at) agg.first_opened_at = ts;
          if (!agg.last_opened_at || ts > agg.last_opened_at) agg.last_opened_at = ts;
        } else if (ev.event_type === 'click') {
          agg.click_count++;
          if (!agg.first_clicked_at || ts < agg.first_clicked_at) agg.first_clicked_at = ts;
          if (!agg.last_clicked_at || ts > agg.last_clicked_at) agg.last_clicked_at = ts;
        } else if (ev.event_type === 'unsubscribe' || ev.event_type === 'group_unsubscribe') {
          agg.has_unsubscribed = true;
          if (!agg.unsubscribed_at || ts < agg.unsubscribed_at) agg.unsubscribed_at = ts;
        } else if (ev.event_type === 'bounce') {
          // SendGrid bounce events don't carry a sub-type in this table;
          // treat all as hard bounce (the webhook handler can refine this).
          agg.hard_bounced = true;
          if (!agg.bounced_at) agg.bounced_at = ts;
        } else if (ev.event_type === 'spamreport') {
          agg.has_unsubscribed = true;
          if (!agg.unsubscribed_at || ts < agg.unsubscribed_at) agg.unsubscribed_at = ts;
        }
      }

      // Upsert aggregated rows, then delete the raw events.
      if (grouped.size > 0) {
        await db.transaction().execute(async (trx) => {
          for (const row of grouped.values()) {
            await trx
              .insertInto('person_newsletter_engagements')
              .values({
                tenant_id: tenantId,
                newsletter_id: row.newsletter_id,
                email: row.email,
                open_count: row.open_count,
                click_count: row.click_count,
                has_unsubscribed: row.has_unsubscribed,
                hard_bounced: row.hard_bounced,
                soft_bounced: row.soft_bounced,
                first_opened_at: row.first_opened_at,
                last_opened_at: row.last_opened_at,
                first_clicked_at: row.first_clicked_at,
                last_clicked_at: row.last_clicked_at,
                bounced_at: row.bounced_at,
                unsubscribed_at: row.unsubscribed_at,
              })
              .onConflict((oc) =>
                oc.columns(['tenant_id', 'newsletter_id', 'email']).doUpdateSet((eb) => ({
                  open_count: sql`person_newsletter_engagements.open_count + ${eb.ref('excluded.open_count')}`,
                  click_count: sql`person_newsletter_engagements.click_count + ${eb.ref('excluded.click_count')}`,
                  has_unsubscribed: sql`person_newsletter_engagements.has_unsubscribed OR excluded.has_unsubscribed`,
                  hard_bounced: sql`person_newsletter_engagements.hard_bounced OR excluded.hard_bounced`,
                  soft_bounced: sql`person_newsletter_engagements.soft_bounced OR excluded.soft_bounced`,
                  first_opened_at: sql`LEAST(person_newsletter_engagements.first_opened_at, excluded.first_opened_at)`,
                  last_opened_at: sql`GREATEST(person_newsletter_engagements.last_opened_at, excluded.last_opened_at)`,
                  first_clicked_at: sql`LEAST(person_newsletter_engagements.first_clicked_at, excluded.first_clicked_at)`,
                  last_clicked_at: sql`GREATEST(person_newsletter_engagements.last_clicked_at, excluded.last_clicked_at)`,
                  bounced_at: sql`COALESCE(person_newsletter_engagements.bounced_at, excluded.bounced_at)`,
                  unsubscribed_at: sql`COALESCE(person_newsletter_engagements.unsubscribed_at, excluded.unsubscribed_at)`,
                })),
              )
              .execute();
          }

          await trx
            .deleteFrom('newsletter_events')
            .where('tenant_id', '=', tenantId)
            .where('created_at', '<', cutoff)
            .execute();
        });
      } else {
        // No engagement events to aggregate — still prune non-engagement events.
        await db
          .deleteFrom('newsletter_events')
          .where('tenant_id', '=', tenantId)
          .where('created_at', '<', cutoff)
          .execute();
      }
    } catch (err) {
      logger.error({ err }, `[prune_newsletter_events] Failed for tenant ${tenant.id}`);
    }
  }
}

/**
 * Fetches files attached to this newsletter (entity_type = 'newsletter') and downloads them as
 * base64 email attachments. If the tenant is at or over its storage quota, attachments are skipped
 * (the newsletter still sends, just without them) — mirrors the Storage settings quota warning.
 */
export async function buildNewsletterAttachments(
  db: Kysely<Models>,
  tenantId: string,
  newsletterId: string,
): Promise<NewsletterAttachment[] | undefined> {
  const filesRepo = new FilesRepo();
  const { rows } = await filesRepo.getAllWithCounts({
    tenant_id: tenantId,
    options: { entityType: 'newsletter', entityId: newsletterId },
  });
  if (rows.length === 0) return undefined;

  const tenant = await db
    .selectFrom('tenants')
    .select(['subscription_plan', 'subscription_quantity'])
    .where('id', '=', tenantId)
    .executeTakeFirst();
  const quotaBytes = getPlanLimits(tenant?.subscription_plan, tenant?.subscription_quantity ?? 1).storageBytes;
  const usedBytes = await filesRepo.getTotalBytes(tenantId);
  if (usedBytes >= quotaBytes) {
    logger.warn(
      `Newsletter ${newsletterId} for tenant ${tenantId} is at/over its storage quota — sending without attachments.`,
    );
    return undefined;
  }

  const storageService = new StorageService();
  const attachments: NewsletterAttachment[] = [];
  for (const file of rows as { filename: string; storage_key: string; mime_type: string | null }[]) {
    try {
      const buffer = await storageService.download(file.storage_key);
      attachments.push({
        content: buffer.toString('base64'),
        filename: file.filename,
        type: file.mime_type || undefined,
      });
    } catch (err) {
      logger.error({ err }, `Failed to download newsletter attachment ${file.storage_key}`);
    }
  }
  return attachments.length > 0 ? attachments : undefined;
}

/**
 * Fires newsletters saved as `scheduled` whose send time has arrived. The newsletter row is the
 * single source of truth — there is no future-dated job to edit or cancel; rescheduling is a
 * plain `update` of send_date and cancelling flips status back to draft. The cron calls the
 * normal `sendNewsletter` path, so demo-mode, send-guards, and the content preflight all run at
 * fire time (not at schedule time), and the `queuing` status it sets is itself the dedupe
 * against the next tick.
 *
 * A newsletter that cannot fire (preflight turned blocked, tenant paused/suspended/payment hold,
 * allowance exhausted) reverts to draft with send_date cleared — it must not silently re-fire —
 * and the scheduling user is told via an in-app notification plus an email.
 */
export async function handleProcessScheduledNewsletters(db: Kysely<Models>): Promise<void> {
  const now = new Date();
  const due = await db
    .selectFrom('newsletters')
    .select(['id', 'tenant_id', 'name', 'updatedby_id'])
    .where('status', '=', 'scheduled')
    .where('send_date', '<=', now)
    .limit(50)
    .execute();

  if (due.length > 0) {
    const { NewslettersController } = await import('../../../modules/newsletters/controller');
    const controller = new NewslettersController();

    for (const row of due) {
      const tenantId = String(row.tenant_id);
      const newsletterId = String(row.id);
      try {
        await controller.sendNewsletter(tenantId, newsletterId, String(row.updatedby_id));
        logger.info({ tenantId, newsletterId }, '[scheduled-newsletter] Fired at scheduled time');
      } catch (err) {
        // A ConflictError means a concurrent "Send now" already claimed this newsletter (it is now
        // queuing/sending). That is not a failure to fire — do NOT revert it to draft or notify the
        // user; the winning caller owns the send.
        if (err instanceof ConflictError) {
          logger.info(
            { tenantId, newsletterId },
            '[scheduled-newsletter] Already claimed by a concurrent send; skipping',
          );
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        await db
          .updateTable('newsletters')
          .set({ status: 'draft', send_date: null, updated_at: new Date() })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', newsletterId)
          .execute();
        logger.warn({ tenantId, newsletterId, reason }, '[scheduled-newsletter] Could not fire — back to draft');

        const message = `"${row.name}" was not sent at its scheduled time: ${reason} It's back in your drafts.`;
        await db
          .insertInto('notifications')
          .values({
            tenant_id: tenantId,
            user_id: String(row.updatedby_id),
            title: 'Scheduled newsletter not sent',
            message,
            type: 'warning',
            read: false,
          })
          .execute();
        const user = await db
          .selectFrom('authusers')
          .select(['email', 'first_name'])
          .where('id', '=', String(row.updatedby_id))
          .executeTakeFirst();
        if (user?.email) {
          await scheduledSendMailService.enqueueMail({
            to: user.email,
            subject: 'Your scheduled newsletter was not sent',
            text: `Hi ${user.first_name || 'there'},\n\n${message}\n\nOpen the newsletter to fix the issue and send it when you're ready.`,
            html: `<h2>Scheduled newsletter not sent</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>${message}</p>
<p>Open the newsletter to fix the issue and send it when you're ready.</p>`,
            tenant_id: tenantId,
          });
        }
      }
    }
  }

  await scheduleNextRun(db, 'process_scheduled_newsletters', FIVE_MINUTES_MS);
}

/**
 * Builds the mandatory newsletter footer appended server-side at send time (so it cannot be removed
 * from the editor). Contains the organization name and address, the tenant footer disclaimer, and a SendGrid
 * substitution tag (`<% unsubscribe %>`) that SendGrid replaces with a working unsubscribe link when
 * subscription tracking is enabled.
 */
function buildNewsletterFooter(
  orgName?: string,
  address?: string,
  disclaimer?: string,
): { html: string; text: string } {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  const name = (orgName || '').trim();
  if (name) {
    htmlParts.push(`<div style="font-weight:bold">${esc(name)}</div>`);
    textParts.push(name);
  }

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

  // SendGrid substitution tag — replaced with the recipient's unsubscribe URL.
  htmlParts.push('<div><a href="<% unsubscribe %>">Unsubscribe</a></div>');
  textParts.push('Unsubscribe: <% unsubscribe %>');

  // Always the last line: platform attribution linking to the marketing site.
  htmlParts.push(
    '<div style="margin-top:8px">powered by <a href="https://pplcrm.com" style="color:#888">pplCRM</a></div>',
  );
  textParts.push('powered by pplCRM (https://pplcrm.com)');

  const html = `<hr style="margin-top:24px"><div style="font-size:12px;color:#888;margin-top:8px">${htmlParts.join('')}</div>`;
  const text = `\n\n----\n${textParts.join('\n')}`;

  return { html, text };
}
