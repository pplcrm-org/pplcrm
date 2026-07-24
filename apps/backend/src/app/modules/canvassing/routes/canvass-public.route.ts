import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

import { CompanionResultsObj } from '../../../../../../../libs/common/src';
import { CanvassingController } from '../controller';

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
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
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

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
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

  done();
};

export default canvassPublicRoute;
