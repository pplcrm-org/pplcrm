import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

import {
  CompanionClaimSegmentObj,
  CompanionLocationPingObj,
  CompanionResultsObj,
} from '../../../../../../../libs/common/src';
import { CanvassingController } from '../controller';
import { isRateLimited } from '../../../lib/rate-limiter';
import { publicMessageOf as messageOf } from '../../../lib/public-route-errors';

/**
 * Public Canvass Companion API (§13.4 / COMPANION-APPS-PLAN.md §5 B3) — the
 * volunteer-facing surface behind the companion access layer.
 *
 * Two credentials on every data request: the assignment TOKEN (in the path)
 * scopes WHAT may be touched — one turf, its doors, nothing else — and the
 * X-Companion-Session header proves WHO is touching it (a verified, admin-
 * approved device; see modules/companion-access). The token resolves the
 * tenant, exactly like the tokenised-access model of the public form pages;
 * every read/write is then scoped to the resolved tenant + turf inside the
 * controller.
 */

const controller = new CanvassingController();

// Per-IP fixed-window rate limit (same shape as deliveries-public.route.ts).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
/** Delegates to the shared limiter so these counters are swept instead of growing forever. */
function rateLimited(ip: string): boolean {
  return isRateLimited(`canvass-public:${ip}`, RATE_MAX, RATE_WINDOW_MS);
}

/** Narrow an unknown thrown value to an HTTP status without leaking internals. */
function statusOf(err: unknown): number {
  if (err && typeof err === 'object') {
    const candidate =
      (err as { status?: unknown; statusCode?: unknown }).status ??
      (err as { status?: unknown; statusCode?: unknown }).statusCode;
    if (typeof candidate === 'number') return candidate;
  }
  return 500;
}

function sessionTokenOf(req: FastifyRequest): string | null {
  const header = req.headers['x-companion-session'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

const canvassPublicRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // The full spec-§3 turf payload for a verified companion device.
  fastify.get('/t/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    try {
      const turf = await controller.getCompanionTurf(String(token), sessionTokenOf(req));
      return reply.status(200).send(turf);
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to load this turf.') });
    }
  });

  // Batched, idempotent results sync — the offline queue drains through here.
  fastify.post('/t/:token/results', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionResultsObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid results payload.' });
    try {
      const result = await controller.postCompanionResults(String(token), sessionTokenOf(req), parsed.data.ops);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to record these results.') });
    }
  });

  // ---- session-first (no capability link) ----------------------------------
  // The link bootstraps the device; from there the session identifies the volunteer
  // and the turf id names the work. Turf tokens are hashed, so the turfs a volunteer
  // already holds can never be listed back to them as links — these routes are how
  // switching turfs is possible at all.

  // Which turfs this volunteer can walk, and (when roaming is allowed) claim.
  fastify.get('/my-turfs', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    try {
      return reply.status(200).send(await controller.getMyTurfs(sessionTokenOf(req)));
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to load your turfs.') });
    }
  });

  // Self-claim. Refused server-side when the volunteer may not roam — the picker
  // hiding the option is a courtesy, not the control.
  fastify.post('/claim', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const body = req.body as { turf_id?: unknown } | null;
    const turfId = body?.turf_id;
    if (typeof turfId !== 'string' || !turfId.trim()) {
      return reply.status(400).send({ error: 'Pick a turf to start on.' });
    }
    try {
      return reply.status(200).send(await controller.claimTurf(sessionTokenOf(req), turfId.trim()));
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to start on that turf.') });
    }
  });

  fastify.get('/turf/:turfId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { turfId } = req.params as { turfId: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    try {
      const turf = await controller.getCompanionTurfBySession(sessionTokenOf(req), String(turfId));
      return reply.status(200).send(turf);
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to load this turf.') });
    }
  });

  // Advisory street claims — "I'm on Scott Blvd", so the rest of the group can split the
  // turf. Session-first only: every claiming device already holds a session, and there is
  // nothing here a capability link needs to reach. Nothing downstream treats a claim as
  // permission, so a failure here costs the group a label and never a knock.
  fastify.post('/turf/:turfId/segment', async (req: FastifyRequest, reply: FastifyReply) => {
    const { turfId } = req.params as { turfId: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionClaimSegmentObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid street.' });
    try {
      return reply.status(200).send(await controller.claimSegment(sessionTokenOf(req), String(turfId), parsed.data));
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to update your street.') });
    }
  });

  // One location broadcast while a shift is open — or {denied:true} when the browser
  // permission is off, so the live board can say "Location off". Fire-and-forget on the
  // client; a lost or duplicated ping costs one dot on a trail that is purged at midnight.
  fastify.post('/turf/:turfId/location', async (req: FastifyRequest, reply: FastifyReply) => {
    const { turfId } = req.params as { turfId: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionLocationPingObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid location payload.' });
    try {
      return reply
        .status(200)
        .send(await controller.postLocationPing(sessionTokenOf(req), String(turfId), parsed.data));
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to record your location.') });
    }
  });

  // The volunteer tapped Finish. Called by the companion BEFORE it revokes the device
  // session, so the shift's end time is the tap, not a 30-minute timeout later.
  fastify.post('/shift/end', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    try {
      return reply.status(200).send(await controller.finishCompanionShift(sessionTokenOf(req)));
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to end your shift.') });
    }
  });

  fastify.post('/turf/:turfId/results', async (req: FastifyRequest, reply: FastifyReply) => {
    const { turfId } = req.params as { turfId: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionResultsObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid results payload.' });
    try {
      const result = await controller.postCompanionResultsBySession(
        sessionTokenOf(req),
        String(turfId),
        parsed.data.ops,
      );
      return reply.status(200).send(result);
    } catch (err: unknown) {
      fastify.log.error(err);
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to record these results.') });
    }
  });

  done();
};

export default canvassPublicRoute;
