import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { TRPCError } from '@trpc/server';

import { VolunteerEventsController } from '../controller';
import { resolveTenantById, resolveTenantFromRequest } from '../../../lib/public-tenant';
import { checkKeyedSubmissionRateLimit, tenantIdFromOptionalApiKey } from '../../../lib/validate-api-key';
import { checkRateLimit } from '../../../lib/rate-limiter';
import { AppError } from '../../../errors/app-errors';

const ctrl = new VolunteerEventsController();

/** Read-only config fetches: high enough that a human refreshing never notices. */
const PUBLIC_READ_MAX = 60;
const PUBLIC_READ_WINDOW_MS = 60_000;

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
 * JSON API behind the public volunteer pages — the /volunteer listing and /v/:slug signup SPA
 * routes (registered outside the app shell, like /f/:slug). The tenant is identified by its
 * subdomain — the `?t=` param the SPA passes, or the Host header — and every lookup is
 * tenant-scoped. This replaces the server-rendered HTML pages and the HMAC-derived org slug.
 */
const volunteerEventsPublicRoute: FastifyPluginCallback = (fastify, _, done) => {
  // Upcoming public volunteer events for the tenant's /volunteer listing page.
  fastify.get('/org', async (req: FastifyRequest, reply) => {
    try {
      checkRateLimit(`public-volunteer-listing:${req.ip}`, PUBLIC_READ_MAX, PUBLIC_READ_WINDOW_MS);
      const tenant = await resolveTenantFromRequest(req);
      if (!tenant) {
        return reply.status(404).send({ error: 'Organization not found.' });
      }
      const result = await ctrl.getPublicEventListing(tenant.id);
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, 'Failed to load public volunteer events');
      return reply.status(getStatusFromError(err)).send({ error: 'Failed to load volunteer events.' });
    }
  });

  // Volunteer-event config for the /v/:slug SPA page: event details + live signup count.
  fastify.get('/v/:slug', async (req: FastifyRequest<{ Params: { slug: string } }>, reply) => {
    const { slug } = req.params;
    try {
      checkRateLimit(`public-volunteer-event:${req.ip}`, PUBLIC_READ_MAX, PUBLIC_READ_WINDOW_MS);
      const tenant = await resolveTenantFromRequest(req);
      if (!tenant) {
        return reply.status(404).send({ error: 'Event not found.' });
      }
      const result = await ctrl.getPublicEventConfig(tenant.id, String(slug));
      return reply.status(200).send(result);
    } catch (err) {
      const status = getStatusFromError(err);
      if (status >= 500) fastify.log.error(err, 'Failed to load public volunteer event');
      return reply.status(status).send({ error: 'Event not found.' });
    }
  });

  // Volunteer signup from the SPA page (JSON body).
  fastify.post(
    '/signup/:slug',
    async (req: FastifyRequest<{ Params: { slug: string }; Body: Record<string, string> }>, reply) => {
      const { slug } = req.params;
      // req.ip is derived from X-Forwarded-For per the trusted-proxy config; never
      // read the raw header, which a client can spoof to defeat rate limiting.
      const clientIp = req.ip;

      try {
        // Optional workspace API key (server-side integrations): the key identifies the tenant
        // and swaps the anonymous per-IP limit for a per-tenant one.
        const keyTenantId = await tenantIdFromOptionalApiKey(req);
        if (keyTenantId) checkKeyedSubmissionRateLimit(keyTenantId, 'signup');

        const tenant = keyTenantId ? await resolveTenantById(keyTenantId) : await resolveTenantFromRequest(req);
        if (!tenant) {
          return reply.status(404).send({ error: 'Event not found.' });
        }
        await ctrl.signupVolunteerPublic(tenant.id, String(slug), req.body || {}, clientIp, {
          skipIpRateLimit: keyTenantId != null,
        });
        return reply.status(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        const status = getStatusFromError(err);
        // Client errors carry user-actionable copy; 5xx detail must not leak to the public.
        const message =
          status < 500 && err instanceof Error && err.message
            ? err.message
            : 'An unexpected error occurred during signup.';
        return reply.status(status).send({ error: message });
      }
    },
  );

  done();
};

export default volunteerEventsPublicRoute;
