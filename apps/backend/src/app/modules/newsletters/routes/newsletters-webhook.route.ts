import { createPublicKey, createVerify } from 'crypto';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { BaseRepository } from '../../../lib/base.repo';
import { CampaignSubscriptionsRepo } from '../../campaigns/repositories/campaign-subscriptions.repo';
import { applyAutomationTripwires, applyEngagementTripwires } from '../send-guards';
import { env } from '../../../../env';
import { sql } from 'kysely';

const db = new BaseRepository('newsletters').db;
const subscriptions = new CampaignSubscriptionsRepo();

/**
 * Consent/suppression side-effects of a SendGrid event (§15):
 *  - unsubscribe → unsubscribed in the CAMPAIGN whose newsletter carried the link
 *  - bounce → global hard_bounce suppression (address is dead everywhere)
 *  - spamreport → global spam_complaint suppression
 */
async function applyConsentSideEffects(
  tenantId: string,
  newsletterId: string,
  eventType: string,
  email: string,
  occurredAt: Date,
  bounceType: string | null,
): Promise<void> {
  if (!email) return;
  if (eventType === 'unsubscribe' || eventType === 'group_unsubscribe') {
    const newsletter = await db
      .selectFrom('newsletters')
      .select(['campaign_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', newsletterId)
      .executeTakeFirst();
    if (newsletter?.campaign_id) {
      await subscriptions.unsubscribeByEmail({
        tenant_id: tenantId,
        campaign_id: String(newsletter.campaign_id),
        email,
      });
    }
  } else if (eventType === 'bounce' || eventType === 'spamreport') {
    // A SendGrid `bounce` with type 'blocked' is a SOFT failure (greylisting, transient reputation),
    // not a dead address — permanently suppressing it would silently shrink every future send off a
    // one-off incident. Only hard bounces and spam complaints suppress.
    if (eventType === 'bounce' && bounceType === 'blocked') return;
    const reason = eventType === 'bounce' ? 'hard_bounce' : 'spam_complaint';
    await db
      .insertInto('email_suppressions')
      // Store the address lowercased so suppression checks (which compare case-insensitively) match
      // persons stored with mixed-case addresses.
      .values({ tenant_id: tenantId, email: email.toLowerCase(), reason, occurred_at: occurredAt })
      .onConflict((oc) => oc.columns(['tenant_id', 'email', 'reason']).doNothing())
      .execute();
  }
}

const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/**
 * Verifies a SendGrid Signed Event Webhook request.
 * SendGrid signs `timestamp + rawBody` with an ECDSA (P-256) key; we verify it
 * against the base64-DER public verification key configured in the dashboard.
 */
function verifySendGridSignature(rawBody: string, signature?: string, timestamp?: string): boolean {
  const verificationKey = env.sendgridWebhookVerificationKey;
  if (!verificationKey || !signature || !timestamp) {
    return false;
  }

  try {
    const publicKey = createPublicKey({
      key: Buffer.from(verificationKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const verifier = createVerify('sha256');
    verifier.update(timestamp + rawBody);
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/** Shape of a single SendGrid Event Webhook payload entry (all fields optional — inbound/untrusted). */
interface SendGridEvent {
  newsletter_id?: string;
  tenant_id?: string;
  /** Present on automation send_email deliveries — engagement stamps onto this run. */
  workflow_run_id?: string;
  sg_event_id?: string;
  sg_message_id?: string;
  event?: string;
  email?: string;
  url?: string;
  ip?: string;
  useragent?: string;
  reason?: string;
  type?: string;
  timestamp?: number;
}

/**
 * Automation-email events carry workflow_run_id (no newsletter_id). Opens/clicks stamp the run
 * row — that's what step conditions ("only if the previous email wasn't opened") and sequence
 * exit goals read — and bounces/complaints suppress the address exactly like newsletter events.
 * COALESCE keeps the stamp idempotent (first engagement wins), and the tenant_id filter keeps a
 * forged/mismatched event from touching another tenant's runs. A click also stamps the open:
 * clicks are the reliable signal (Apple Mail Privacy Protection auto-opens make opens noisy).
 */
async function applyAutomationEvent(ev: SendGridEvent): Promise<void> {
  const tenantId = String(ev.tenant_id);
  const runId = String(ev.workflow_run_id);
  const eventType = ev.event || '';
  const occurredAt = ev.timestamp ? new Date(ev.timestamp * 1000) : new Date();

  if (eventType === 'open' || eventType === 'click') {
    await db
      .updateTable('workflow_runs')
      .set(
        eventType === 'click'
          ? {
              clicked_at: sql`COALESCE(clicked_at, ${occurredAt})`,
              opened_at: sql`COALESCE(opened_at, ${occurredAt})`,
            }
          : { opened_at: sql`COALESCE(opened_at, ${occurredAt})` },
      )
      .where('tenant_id', '=', tenantId)
      .where('id', '=', runId)
      .execute();
  } else if ((eventType === 'bounce' || eventType === 'spamreport') && ev.email) {
    // A SendGrid `bounce` with type 'blocked' is a SOFT failure (greylisting, transient reputation),
    // not a dead address — permanently suppressing it would silently shrink every future send off a
    // one-off incident. Only hard bounces and spam complaints suppress and stamp the tripwire.
    const isHardBounce = eventType === 'bounce' && ev.type !== 'blocked';
    if (eventType === 'spamreport' || isHardBounce) {
      const reason = eventType === 'bounce' ? 'hard_bounce' : 'spam_complaint';
      await db
        .insertInto('email_suppressions')
        // Store the address lowercased so suppression checks (which compare case-insensitively) match
        // persons stored with mixed-case addresses.
        .values({ tenant_id: tenantId, email: ev.email.toLowerCase(), reason, occurred_at: occurredAt })
        .onConflict((oc) => oc.columns(['tenant_id', 'email', 'reason']).doNothing())
        .execute();

      // Stamp the run for the automation abuse tripwires. COALESCE keeps the stamp idempotent.
      await db
        .updateTable('workflow_runs')
        .set(
          eventType === 'spamreport'
            ? { spam_reported_at: sql`COALESCE(spam_reported_at, ${occurredAt})` }
            : { bounced_at: sql`COALESCE(bounced_at, ${occurredAt})` },
        )
        .where('tenant_id', '=', tenantId)
        .where('id', '=', runId)
        .execute();
    }
  }
}

const newslettersWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post('/webhook', async (req: FastifyRequest, reply) => {
    // req.body is the raw string (see content-type parser in fastify.server.ts)
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const signature = req.headers[SIGNATURE_HEADER] as string | undefined;
    const timestamp = req.headers[TIMESTAMP_HEADER] as string | undefined;

    if (!verifySendGridSignature(rawBody, signature, timestamp)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return reply.code(400).send({ error: 'Invalid payload' });
    }

    const events: SendGridEvent[] = Array.isArray(parsedBody) ? parsedBody : [parsedBody as SendGridEvent];

    try {
      const processedNewsletters = new Set<string>();
      // Tenants whose automation sends took a bounce/complaint in this batch — the automation
      // tripwires re-evaluate for each after all events are applied.
      const automationTripwireTenants = new Set<string>();

      // Insert all events that have newsletter_id and tenant_id
      for (const ev of events) {
        if (!ev || !ev.tenant_id || !ev.sg_event_id) {
          continue;
        }

        // Automation emails: stamp engagement on the workflow run instead of newsletter stats.
        if (!ev.newsletter_id && ev.workflow_run_id) {
          try {
            await applyAutomationEvent(ev);
            if (ev.event === 'bounce' || ev.event === 'spamreport') {
              automationTripwireTenants.add(String(ev.tenant_id));
            }
          } catch (automationErr) {
            req.log.error(automationErr, `Failed to apply automation event ${ev.sg_event_id}`);
          }
          continue;
        }
        if (!ev.newsletter_id) {
          continue;
        }

        const newsletterId = ev.newsletter_id;
        const tenantId = ev.tenant_id;
        const eventType = ev.event || '';
        const email = ev.email || '';
        const sgEventId = ev.sg_event_id;
        const sgMessageId = ev.sg_message_id || null;
        const url = ev.url || null;
        const ip = ev.ip || null;
        const userAgent = ev.useragent || null;
        // Bounce diagnostics for the report: reason ("Mailbox does not exist")
        // on bounce/dropped events, type 'bounce' (hard) / 'blocked' (soft) on bounces.
        const reason = typeof ev.reason === 'string' && ev.reason ? ev.reason : null;
        const bounceType = eventType === 'bounce' && typeof ev.type === 'string' && ev.type ? ev.type : null;
        const timestamp = ev.timestamp ? new Date(ev.timestamp * 1000) : new Date();

        try {
          await db
            .insertInto('newsletter_events')
            .values({
              tenant_id: tenantId,
              newsletter_id: newsletterId,
              email,
              event_type: eventType,
              sg_event_id: sgEventId,
              sg_message_id: sgMessageId,
              url,
              ip,
              user_agent: userAgent,
              reason,
              bounce_type: bounceType,
              timestamp,
              created_at: new Date(),
            })
            .onConflict((oc) => oc.column('sg_event_id').doNothing())
            .execute();

          processedNewsletters.add(`${tenantId}:${newsletterId}`);

          await applyConsentSideEffects(
            String(tenantId),
            String(newsletterId),
            eventType,
            email,
            timestamp,
            bounceType,
          );
        } catch (insertErr) {
          req.log.error(insertErr, `Failed to insert webhook event ${sgEventId}`);
        }
      }

      // Recompute aggregates for each processed newsletter
      for (const key of processedNewsletters) {
        const [tenantId, newsletterId] = key.split(':') as [string, string];

        await db.transaction().execute(async (trx) => {
          // 1. Fetch aggregates
          const stats = await trx
            .selectFrom('newsletter_events')
            .select([
              sql<number>`COUNT(id) FILTER (WHERE event_type = 'delivered')`.as('delivered'),
              sql<number>`COUNT(id) FILTER (WHERE event_type IN ('bounce', 'dropped'))`.as('bounced'),
              sql<number>`COUNT(DISTINCT email) FILTER (WHERE event_type = 'open')`.as('unique_opens'),
              sql<number>`COUNT(DISTINCT email) FILTER (WHERE event_type = 'click')`.as('unique_clicks'),
              sql<number>`COUNT(id) FILTER (WHERE event_type = 'unsubscribe')`.as('unsubscribes'),
              sql<number>`COUNT(id) FILTER (WHERE event_type = 'spamreport')`.as('spamreports'),
              sql<Date | null>`MAX(timestamp) FILTER (WHERE event_type IN ('open', 'click'))`.as('last_engagement'),
            ])
            .where('newsletter_id', '=', newsletterId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          // 2. Fetch top links clicked
          const topLinksResult = await trx
            .selectFrom('newsletter_events')
            .select(['url'])
            .select(({ fn }) => fn.count<number>('id').as('clicks'))
            .where('newsletter_id', '=', newsletterId)
            .where('tenant_id', '=', tenantId)
            .where('event_type', '=', 'click')
            .where('url', 'is not', null)
            .groupBy('url')
            .orderBy('clicks', 'desc')
            .execute();

          const topLinks = topLinksResult.map((l) => ({
            url: l.url,
            clicks: Number(l.clicks),
          }));

          // 3. Update the newsletters table row
          const newsletter = await trx
            .selectFrom('newsletters')
            .select(['total_recipients'])
            .where('id', '=', newsletterId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          const totalRecipients = Number(newsletter?.total_recipients ?? 0);
          const uniqueOpens = Number(stats?.unique_opens ?? 0);
          const uniqueClicks = Number(stats?.unique_clicks ?? 0);

          const openRate = totalRecipients > 0 ? (uniqueOpens / totalRecipients) * 100 : 0;
          const clickRate = totalRecipients > 0 ? (uniqueClicks / totalRecipients) * 100 : 0;

          await trx
            .updateTable('newsletters')
            .set({
              delivered_count: Number(stats?.delivered ?? 0),
              bounce_count: Number(stats?.bounced ?? 0),
              unique_opens: uniqueOpens,
              unique_clicks: uniqueClicks,
              unsubscribe_count: Number(stats?.unsubscribes ?? 0),
              spam_complaint_count: Number(stats?.spamreports ?? 0),
              last_engagement_at: stats?.last_engagement || null,
              open_rate: openRate,
              click_rate: clickRate,
              top_links: JSON.stringify(topLinks),
              updated_at: new Date(),
            })
            .where('id', '=', newsletterId)
            .where('tenant_id', '=', tenantId)
            .execute();
        });

        // Abuse tripwires (§ anti-spam): a high hard-bounce rate pauses the tenant's sending, a
        // high spam-complaint rate suspends the account pending human review. Runs after the
        // aggregates so an in-flight send's worker loop sees the flag on its next batch.
        await applyEngagementTripwires(db, tenantId, newsletterId);
      }

      // Same tripwires for automation volume: newsletters and automation emails alike are
      // covered — a bad list drip-fed through workflows pauses/suspends just like a blast.
      for (const tenantId of automationTripwireTenants) {
        await applyAutomationTripwires(db, tenantId);
      }

      return reply.code(200).send({ success: true, processedCount: processedNewsletters.size });
    } catch (err) {
      req.log.error(err, 'SendGrid webhook processing error');
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  done();
};

export default newslettersWebhookRoute;
