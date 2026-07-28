import type { FastifyPluginCallback } from 'fastify';
import { TRPCError } from '@trpc/server';

import { EventsController } from '../controller';
import { resolveTenantById, resolveTenantFromRequest } from '../../../lib/public-tenant';
import { checkKeyedSubmissionRateLimit, tenantIdFromOptionalApiKey } from '../../../lib/validate-api-key';
import { checkRateLimit } from '../../../lib/rate-limiter';
import { AppError } from '../../../errors/app-errors';

const ctrl = new EventsController();

/** Read-only config fetch: high enough that a human refreshing never notices, low enough to scrape. */
const PUBLIC_EVENT_CONFIG_MAX = 60;
const PUBLIC_EVENT_CONFIG_WINDOW_MS = 60_000;

function getStatusFromError(err: unknown): number {
  if (err instanceof TRPCError) {
    switch (err.code) {
      case 'BAD_REQUEST':
        return 400;
      case 'UNAUTHORIZED':
        return 401;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
        return 409;
      case 'TOO_MANY_REQUESTS':
        return 429;
      default:
        return 500;
    }
  }
  // AppError carries `status`; Fastify/HTTP errors carry `statusCode`. Reading only the latter
  // reported a thrown TooManyRequestsError as a 500.
  if (err instanceof AppError) return err.status;
  const statusCode = (err as { statusCode?: unknown })?.statusCode;
  return typeof statusCode === 'number' ? statusCode : 500;
}

/**
 * JSON API behind the public /e/:slug SPA page (registered outside the app shell, like /f/:slug).
 * The tenant is identified by its subdomain — the `?t=` param the SPA passes, or the Host header —
 * and every event lookup is tenant-scoped. The server-rendered HTML pages this file used to carry
 * are gone; the SPA owns presentation.
 */
const eventsPublicRoute: FastifyPluginCallback = (fastify, _, done) => {
  // Event config for the SPA page: event details + tickets + live capacity.
  fastify.get<{ Params: { slug: string } }>('/e/:slug', async (req, reply) => {
    const { slug } = req.params;
    try {
      // Every other public surface throttles; this one resolves a tenant from the subdomain and
      // runs an event + tickets + live-capacity query, so it was the one unthrottled way to make
      // the backend do real work anonymously. Generous enough that a page refresh never trips it.
      checkRateLimit(`public-event-config:${req.ip}`, PUBLIC_EVENT_CONFIG_MAX, PUBLIC_EVENT_CONFIG_WINDOW_MS);

      const tenant = await resolveTenantFromRequest(req);
      if (!tenant) {
        return reply.status(404).send({ error: 'Event not found.' });
      }
      const result = await ctrl.getPublicEventConfig(tenant.id, String(slug));
      return reply.status(200).send(result);
    } catch (err) {
      const status = getStatusFromError(err);
      // Never leak internal detail on a public endpoint; NOT_FOUND is the only expected miss.
      if (status >= 500) fastify.log.error(err, 'Failed to load public event');
      return reply.status(status === 404 ? 404 : status).send({ error: 'Event not found.' });
    }
  });

  // RSVP submission from the SPA page (JSON body).
  fastify.post<{ Params: { slug: string }; Body: Record<string, string> }>('/rsvp/:slug', async (req, reply) => {
    const { slug } = req.params;
    // req.ip is derived from X-Forwarded-For per the trusted-proxy config; never
    // read the raw header, which a client can spoof to defeat rate limiting.
    const clientIp = req.ip;

    try {
      // Optional workspace API key (server-side integrations): the key identifies the tenant
      // and swaps the anonymous per-IP limit for a per-tenant one.
      const keyTenantId = await tenantIdFromOptionalApiKey(req);
      if (keyTenantId) checkKeyedSubmissionRateLimit(keyTenantId, 'rsvp');

      const tenant = keyTenantId ? await resolveTenantById(keyTenantId) : await resolveTenantFromRequest(req);
      if (!tenant) {
        return reply.status(404).send({ error: 'Event not found.' });
      }
      await ctrl.rsvpPublic(tenant.id, String(slug), req.body || {}, clientIp, {
        skipIpRateLimit: keyTenantId != null,
      });
      return reply.status(200).send({ success: true });
    } catch (err) {
      fastify.log.error(err);
      const status = getStatusFromError(err);
      // Client errors carry user-actionable copy; 5xx detail must not leak to the public.
      const message =
        status < 500 && err instanceof Error && err.message ? err.message : 'An unexpected error occurred.';
      return reply.status(status).send({ error: message });
    }
  });

  done();
};

export default eventsPublicRoute;
