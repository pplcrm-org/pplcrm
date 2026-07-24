import { timingSafeEqual } from 'crypto';
import type { FastifyPluginCallback } from 'fastify';

import { BaseRepository } from '../../../lib/base.repo';
import { env } from '../../../../env';

const db = new BaseRepository('tenants').db;

const TOKEN_HEADER = 'x-postmark-webhook-token';

/** Hard-failure bounce types — the address is dead, not temporarily unavailable. */
const HARD_BOUNCE_TYPES = new Set(['HardBounce', 'BadEmailAddress']);

/** Shape of a Postmark bounce/spam webhook payload (inbound/untrusted — all optional). */
interface PostmarkEvent {
  RecordType?: string;
  Type?: string;
  Email?: string;
  BouncedAt?: string;
  Metadata?: Record<string, unknown>;
}

function tokenMatches(header: string | undefined): boolean {
  const expected = env.postmarkWebhookToken;
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Postmark bounce/spam-complaint webhook for the transactional (Postmark) mail stream.
 * Authenticated with a shared token Postmark is configured to send in a custom header
 * (POSTMARK_WEBHOOK_TOKEN). Sends carry `Metadata.tenant_id` (transactional-mail.service), so a
 * hard bounce or complaint suppresses the address for that tenant — the same
 * `email_suppressions` list the newsletter sendability query honours.
 */
const postmarkWebhookRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post('/webhook', async (req, reply) => {
    if (!tokenMatches(req.headers[TOKEN_HEADER] as string | undefined)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = req.body as PostmarkEvent | PostmarkEvent[] | null;
    const events = Array.isArray(body) ? body : body ? [body] : [];

    let processed = 0;
    for (const ev of events) {
      const recordType = ev?.RecordType ?? '';
      const email = (ev?.Email ?? '').toLowerCase().trim();
      if (!email) continue;

      const isHardBounce = recordType === 'Bounce' && HARD_BOUNCE_TYPES.has(ev?.Type ?? '');
      const isSpamComplaint = recordType === 'SpamComplaint';
      if (!isHardBounce && !isSpamComplaint) continue;

      const reason = isSpamComplaint ? 'spam_complaint' : 'hard_bounce';
      const occurredAt = ev?.BouncedAt ? new Date(ev.BouncedAt) : new Date();
      const tenantId = ev?.Metadata?.['tenant_id'] != null ? String(ev.Metadata['tenant_id']) : null;

      req.log.warn({ email, reason, tenantId, postmarkType: ev?.Type }, 'Postmark delivery failure event');

      if (!tenantId || !/^\d+$/.test(tenantId)) continue; // no tenant context — logged above, nothing to suppress

      try {
        await db
          .insertInto('email_suppressions')
          // Store lowercased so suppression checks (case-insensitive) match mixed-case person addresses.
          .values({ tenant_id: tenantId, email: email.toLowerCase(), reason, occurred_at: occurredAt })
          .onConflict((oc) => oc.columns(['tenant_id', 'email', 'reason']).doNothing())
          .execute();
        processed++;
      } catch (err) {
        req.log.error(err, `Failed to record Postmark suppression for ${email}`);
      }
    }

    return reply.code(200).send({ success: true, processed });
  });

  done();
};

export default postmarkWebhookRoute;
