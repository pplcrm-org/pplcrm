import type { FastifyPluginCallback } from 'fastify';
import { sql } from 'kysely';

import { env } from '../env';
import { BaseRepository } from './lib/base.repo';
import emailsApiRoute from './modules/emails/routes/emails-api.route';
import msSyncCallbackRoute from './modules/ms-sync/ms-callback.route';
import googleSyncCallbackRoute from './modules/google-sync/google-callback.route';
import filesRoute from './modules/files/routes/files.route';
import exportsDownloadRoute from './modules/exports/routes/exports-download.route';
import importsDownloadRoute from './modules/imports/routes/imports-download.route';
import webFormsPublicRoute from './modules/web-forms/routes/web-forms-public.route';
import volunteerEventsPublicRoute from './modules/volunteer-events/routes/volunteer-events-public.route';
import eventsPublicRoute from './modules/events/routes/events-public.route';
import billingWebhookRoute from './modules/billing/routes/billing-webhook.route';
import newslettersWebhookRoute from './modules/newsletters/routes/newsletters-webhook.route';
import unsubscribeRoute from './modules/newsletters/routes/unsubscribe.route';
import tenantApprovalRoute from './modules/auth/routes/tenant-approval.route';
import postmarkWebhookRoute from './modules/mail/routes/postmark-webhook.route';
import donationsWebhookRoute from './modules/donations/routes/donations-webhook.route';
import zapierInboundRoute from './modules/zapier/zapier-inbound.route';
import canvassPublicRoute from './modules/canvassing/routes/canvass-public.route';
import deliveriesPublicRoute from './modules/deliveries/routes/deliveries-public.route';
import companionPublicRoute from './modules/companion-access/routes/companion-public.route';
import donorPortalPublicRoute from './modules/donor-portal/routes/donor-portal-public.route';

// A worker heartbeat older than this = the in-process job worker is wedged (the ops watchdog
// beats every 5 minutes; 20 = 3-4 missed cycles plus slack for retry backoff).
const WORKER_HEARTBEAT_STALE_MS = 20 * 60 * 1000;

/** How long a /healthz result is reused. Short enough to stay a live readiness signal,
 *  long enough that probe traffic cannot drive DB load (finding M3). */
const HEALTH_CACHE_MS = 5000;
let healthCache: { ok: boolean; at: number } | null = null;

function readHealthCache(): boolean | null {
  if (!healthCache || Date.now() - healthCache.at > HEALTH_CACHE_MS) return null;
  return healthCache.ok;
}

function writeHealthCache(ok: boolean): void {
  healthCache = { ok, at: Date.now() };
}

export const routes: FastifyPluginCallback = (fastify, _opts, done) => {
  // --- Public REST routes (No Auth required) ---

  // Register public web forms submission REST routes
  fastify.register(webFormsPublicRoute, { prefix: '/api/forms' });

  // Register public volunteer events REST routes
  fastify.register(volunteerEventsPublicRoute, { prefix: '/api/events' });

  // Register public Canvass Companion REST routes (tokenised, no account — §13.4)
  fastify.register(canvassPublicRoute, { prefix: '/api/canvass' });

  // Register public RSVP event pages REST routes
  fastify.register(eventsPublicRoute, { prefix: '/api/event-pages' });

  // Register public volunteer delivery-route pages (token is the credential, §14)
  fastify.register(deliveriesPublicRoute, { prefix: '/api/deliveries' });

  // Companion access layer: verify + approve gate for both volunteer companions
  fastify.register(companionPublicRoute, { prefix: '/api/companion' });

  // Donor self-service portal (/g/:token pages; the token is the credential)
  fastify.register(donorPortalPublicRoute, { prefix: '/api/donor-portal' });

  // Register Stripe billing webhook route
  fastify.register(billingWebhookRoute, { prefix: '/api/billing' });

  // Register Stripe donations webhook route
  fastify.register(donationsWebhookRoute, { prefix: '/api/donations' });

  // Register SendGrid newsletters event webhook route
  fastify.register(newslettersWebhookRoute, { prefix: '/api/newsletters' });

  // One-click unsubscribe for automation emails (signed token, no session)
  fastify.register(unsubscribeRoute, { prefix: '/api/unsubscribe' });

  // Closed-beta gate: the ops approve/decline link mailed on every new signup
  fastify.register(tenantApprovalRoute, { prefix: '/api/tenant-approval' });

  // Register Postmark transactional bounce/spam-complaint webhook route
  fastify.register(postmarkWebhookRoute, { prefix: '/api/postmark' });

  // Register Zapier inbound action routes (API key auth handled inside route)
  fastify.register(zapierInboundRoute, { prefix: '/api/zapier' });

  // Microsoft OAuth2 callback (must be a REST route — browser is redirected here by Microsoft)
  fastify.register(msSyncCallbackRoute, { prefix: '/auth/ms' });

  // Google OAuth2 callback (must be a REST route — browser is redirected here by Google)
  fastify.register(googleSyncCallbackRoute, { prefix: '/auth/google' });

  // Register exports download REST route (auth handled inside route via query token)
  fastify.register(exportsDownloadRoute, { prefix: '/api/exports' });

  // Register imports download REST routes — retained source file + skipped-rows CSV (spec §17)
  fastify.register(importsDownloadRoute, { prefix: '/api/imports' });

  // Register email attachments REST routes (auth handled inside route via token/query token)
  fastify.register(emailsApiRoute, { prefix: '/api/emails' });

  // Register files download REST route (auth handled inside route via token/query token)
  fastify.register(filesRoute, { prefix: '/api/files' });

  // Root health check — cheap liveness ping (process is up); does NOT touch Postgres.
  fastify.get('/', (_req, res) => res.send({ message: 'API healthy.' }));

  // Readiness probe — verifies Postgres is reachable so an orchestrator can gate traffic/restarts.
  // Returns 503 (not 200) when the DB is down; body is intentionally minimal (no error details).
  // `build` is the commit SHA baked into the image (env.buildSha, 'dev' outside CI images) — the
  // CI smoke test matches it against the SHA it just deployed, because in single-revision
  // Container Apps a failed rollover leaves the OLD revision answering 200 here. The SHA is
  // static per process, so the 5-second result cache below never makes it stale.
  fastify.get('/healthz', async (_req, res) => {
    // Result cached briefly (finding M3): this is unauthenticated and was one DB round-trip
    // per request, so anyone could turn it into a query generator. A few seconds of staleness
    // is irrelevant to an orchestrator probing every 10-30s.
    const cached = readHealthCache();
    if (cached !== null) {
      return cached
        ? res.send({ status: 'ok', build: env.buildSha })
        : res.code(503).send({ status: 'unavailable', build: env.buildSha });
    }
    try {
      await sql`select 1`.execute(BaseRepository.dbInstance);
      writeHealthCache(true);
      return res.send({ status: 'ok', build: env.buildSha });
    } catch {
      writeHealthCache(false);
      return res.code(503).send({ status: 'unavailable', build: env.buildSha });
    }
  });

  // Job-worker dead-man's switch, probed by the external availability test (NOT wired into the
  // container's readiness probe — a jammed queue must not pull the API from ingress). The ops
  // watchdog cron updates ops_heartbeats every 5 minutes; a beat older than 20 minutes (3-4
  // missed cycles plus slack) means the in-process worker is wedged even though HTTP is fine.
  // Missing row/table (fresh DB, migration not applied yet) also reports stale — the safe
  // direction, and the reason for the catch.
  fastify.get('/healthz/worker', async (_req, res) => {
    try {
      const row = await BaseRepository.dbInstance
        .selectFrom('ops_heartbeats')
        .select('beat_at')
        .where('name', '=', 'ops_watchdog')
        .executeTakeFirst();
      const stale = !row || Date.now() - new Date(row.beat_at).getTime() > WORKER_HEARTBEAT_STALE_MS;
      return stale ? res.code(503).send({ status: 'stale' }) : res.send({ status: 'ok' });
    } catch {
      return res.code(503).send({ status: 'stale' });
    }
  });

  done();
};
