import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

import { DonorPortalController } from '../controller';
import { isRateLimited } from '../../../lib/rate-limiter';
import { checkDurableRateLimit } from '../../../lib/durable-rate-limiter';
import { publicMessageOf as messageOf } from '../../../lib/public-route-errors';
import { resolveTenantFromRequest } from '../../../lib/public-tenant';

const controller = new DonorPortalController();

// Per-IP fixed-window rate limit — donors click, scrapers hammer.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
function rateLimited(ip: string): boolean {
  return isRateLimited(`donor-portal:${ip}`, RATE_MAX, RATE_WINDOW_MS);
}

// Uniform "not active" body — never distinguish expired vs revoked vs nonexistent.
const NOT_ACTIVE = { error: "This link isn't active. Request a new one from your organization's giving page." };

/** Money-moving actions (cancel, amount, card): a tight durable budget per donor. */
function moneyLimitKey(tenantId: string, personId: string): string {
  return `donor-portal-money:${tenantId}:${personId}`;
}
/** Remaining writes (address, preferences, cross-sell): a looser durable budget. */
function writeLimitKey(tenantId: string, personId: string): string {
  return `donor-portal-write:${tenantId}:${personId}`;
}
const MONEY_LIMIT = 10;
const WRITE_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;

/** Narrow an unknown thrown value to an HTTP status without leaking internals. */
function statusOf(err: unknown): number {
  if (err && typeof err === 'object') {
    const rec = err as { status?: unknown; statusCode?: unknown };
    if (typeof rec.status === 'number') return rec.status;
    if (typeof rec.statusCode === 'number') return rec.statusCode;
  }
  return 500;
}

/**
 * 400 (a validation/eligibility message written for the donor), 412 (a precondition message,
 * e.g. "Stripe did not confirm the cancellation") and 429 (rate limit) reach the page with
 * their own copy; everything else stays a uniform 404 so dead/unknown tokens — and internal
 * failures — are indistinguishable from missing ones.
 */
function sendPublicError(reply: FastifyReply, err: unknown, log: (err: unknown, msg: string) => void, msg: string) {
  const status = statusOf(err);
  if (status === 400 || status === 412 || status === 429) {
    return reply.status(status).send({ error: messageOf(err, msg) });
  }
  log(err, msg);
  return reply.status(404).send(NOT_ACTIVE);
}

const donorPortalPublicRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // Personal pages — keep every one of them out of search indexes.
  fastify.addHook('onRequest', (_req, reply, hookDone) => {
    reply.header('X-Robots-Tag', 'noindex');
    hookDone();
  });

  /** Resolve the bearer token or answer the uniform 404. Returns null after replying. */
  async function resolveOr404(req: FastifyRequest, reply: FastifyReply, token: string) {
    if (rateLimited(req.ip)) {
      await reply.status(429).send({ error: 'Too many requests. Please slow down.' });
      return null;
    }
    const link = await controller.resolveToken(String(token));
    if (!link) {
      await reply.status(404).send(NOT_ACTIVE);
      return null;
    }
    return link;
  }

  // The page's one read: everything the donor sees.
  fastify.get<{ Params: { token: string } }>('/:token', async (req, reply) => {
    const link = await resolveOr404(req, reply, req.params.token);
    if (!link) return reply;
    try {
      const summary = await controller.getSummary(link);
      controller.touchLastUsed(link);
      return await reply.status(200).send(summary);
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to load the giving page');
    }
  });

  // Signed, short-lived PDF link for one of the donor's OWN receipts.
  fastify.get<{ Params: { token: string; receiptId: string } }>(
    '/:token/receipts/:receiptId/download',
    async (req, reply) => {
      const link = await resolveOr404(req, reply, req.params.token);
      if (!link) return reply;
      try {
        const result = await controller.receiptDownload(link, String(req.params.receiptId));
        if (!result) return await reply.status(404).send(NOT_ACTIVE);
        return await reply.status(200).send(result);
      } catch (err) {
        return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to prepare the receipt download');
      }
    },
  );

  fastify.post<{ Params: { token: string; pledgeId: string } }>(
    '/:token/pledges/:pledgeId/cancel',
    async (req, reply) => {
      const link = await resolveOr404(req, reply, req.params.token);
      if (!link) return reply;
      try {
        await checkDurableRateLimit(moneyLimitKey(link.tenant_id, link.person_id), MONEY_LIMIT, HOUR_MS);
        const result = await controller.cancelPledge(link, String(req.params.pledgeId));
        if (!result) return await reply.status(404).send(NOT_ACTIVE);
        return await reply.status(200).send(result);
      } catch (err) {
        return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to cancel the monthly gift');
      }
    },
  );

  fastify.post<{ Params: { token: string; pledgeId: string } }>(
    '/:token/pledges/:pledgeId/amount',
    async (req, reply) => {
      const link = await resolveOr404(req, reply, req.params.token);
      if (!link) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const amount = Number(body['monthly_amount_cents']);
      try {
        await checkDurableRateLimit(moneyLimitKey(link.tenant_id, link.person_id), MONEY_LIMIT, HOUR_MS);
        const result = await controller.changePledgeAmount(link, String(req.params.pledgeId), amount);
        if (!result) return await reply.status(404).send(NOT_ACTIVE);
        return await reply.status(200).send(result);
      } catch (err) {
        return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to change the monthly amount');
      }
    },
  );

  fastify.post<{ Params: { token: string; pledgeId: string } }>(
    '/:token/pledges/:pledgeId/card',
    async (req, reply) => {
      const link = await resolveOr404(req, reply, req.params.token);
      if (!link) return reply;
      try {
        await checkDurableRateLimit(moneyLimitKey(link.tenant_id, link.person_id), MONEY_LIMIT, HOUR_MS);
        const result = await controller.startCardUpdate(link, String(req.params.pledgeId), String(req.params.token));
        if (!result) return await reply.status(404).send(NOT_ACTIVE);
        return await reply.status(200).send(result);
      } catch (err) {
        return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to start the card update');
      }
    },
  );

  fastify.post<{ Params: { token: string } }>('/:token/card/confirm', async (req, reply) => {
    const link = await resolveOr404(req, reply, req.params.token);
    if (!link) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId = typeof body['session_id'] === 'string' ? body['session_id'].trim() : '';
    if (!sessionId || sessionId.length > 200) return reply.status(400).send({ error: 'Invalid session id.' });
    try {
      await checkDurableRateLimit(moneyLimitKey(link.tenant_id, link.person_id), MONEY_LIMIT, HOUR_MS);
      const result = await controller.confirmCardUpdate(link, sessionId);
      if (!result) return await reply.status(404).send(NOT_ACTIVE);
      return await reply.status(200).send(result);
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to confirm the card update');
    }
  });

  fastify.post<{ Params: { token: string } }>('/:token/address', async (req, reply) => {
    const link = await resolveOr404(req, reply, req.params.token);
    if (!link) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const field = (key: string): string => (typeof body[key] === 'string' ? String(body[key]).slice(0, 200) : '');
    try {
      await checkDurableRateLimit(writeLimitKey(link.tenant_id, link.person_id), WRITE_LIMIT, HOUR_MS);
      const result = await controller.updateAddress(link, {
        street: field('street'),
        apt: field('apt'),
        city: field('city'),
        state: field('state'),
        zip: field('zip'),
        country: field('country'),
      });
      return await reply.status(200).send(result);
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to save the address');
    }
  });

  fastify.post<{ Params: { token: string; campaignId: string } }>(
    '/:token/subscriptions/:campaignId',
    async (req, reply) => {
      const link = await resolveOr404(req, reply, req.params.token);
      if (!link) return reply;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const status = body['status'];
      if (status !== 'subscribed' && status !== 'unsubscribed') {
        return reply.status(400).send({ error: 'Unknown status.' });
      }
      try {
        await checkDurableRateLimit(writeLimitKey(link.tenant_id, link.person_id), WRITE_LIMIT, HOUR_MS);
        const result = await controller.setSubscription(link, String(req.params.campaignId), status);
        if (!result) return await reply.status(404).send(NOT_ACTIVE);
        return await reply.status(200).send(result);
      } catch (err) {
        return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to update email preferences');
      }
    },
  );

  fastify.post<{ Params: { token: string } }>('/:token/volunteer-interest', async (req, reply) => {
    const link = await resolveOr404(req, reply, req.params.token);
    if (!link) return reply;
    try {
      await checkDurableRateLimit(writeLimitKey(link.tenant_id, link.person_id), WRITE_LIMIT, HOUR_MS);
      const result = await controller.expressVolunteerInterest(link);
      return await reply.status(200).send(result);
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to record volunteer interest');
    }
  });

  fastify.post<{ Params: { token: string } }>('/:token/yard-sign', async (req, reply) => {
    const link = await resolveOr404(req, reply, req.params.token);
    if (!link) return reply;
    try {
      await checkDurableRateLimit(writeLimitKey(link.tenant_id, link.person_id), WRITE_LIMIT, HOUR_MS);
      const result = await controller.requestYardSign(link);
      return await reply.status(200).send(result);
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to request a yard sign');
    }
  });

  /**
   * "Email me my link." Always answers 200 {ok:true} whether or not the email matches a donor —
   * the lookup happens only inside the background job, so the response body AND timing are
   * identical and the endpoint cannot be used to probe who has donated.
   */
  fastify.post('/request-link', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
    if (!email || email.length > 320 || !email.includes('@')) {
      return reply.status(400).send({ error: 'Enter a valid email address.' });
    }
    try {
      const tenant = await resolveTenantFromRequest(req);
      if (!tenant) return await reply.status(404).send(NOT_ACTIVE);
      await checkDurableRateLimit(`donor-portal-req-ip:${req.ip}`, 10, HOUR_MS);
      await checkDurableRateLimit(`donor-portal-req:${tenant.id}:${email}`, 3, 24 * HOUR_MS);
      await controller.enqueueRequestLink(tenant.id, email);
      return await reply.status(200).send({ ok: true });
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to process the link request');
    }
  });

  done();
};

export default donorPortalPublicRoute;
