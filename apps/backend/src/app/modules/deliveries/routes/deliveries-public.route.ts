import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

import { DeliveriesController } from '../controller';
import { DELIVERY_SKIP_REASONS } from '../../../../../../../libs/common/src';
import { isRateLimited } from '../../../lib/rate-limiter';

const controller = new DeliveriesController();

// Per-IP fixed-window rate limit — a volunteer taps fast, but a scraper shouldn't hammer tokens.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
/** Delegates to the shared limiter so these counters are swept instead of growing forever. */
function rateLimited(ip: string): boolean {
  return isRateLimited(`deliveries-public:${ip}`, RATE_MAX, RATE_WINDOW_MS);
}

// Uniform "not active" body — never distinguish expired vs revoked vs nonexistent (spec §6/§7).
const NOT_ACTIVE = { error: "This route link isn't active. Ask your organizer for a new one." };

// Client-generated idempotency key (crypto.randomUUID() is 36 chars).
const OP_ID_MIN = 8;
const OP_ID_MAX = 100;

function isValidAction(value: unknown): value is 'deliver' | 'skip' | 'defer' | 'undo' {
  return value === 'deliver' || value === 'skip' || value === 'defer' || value === 'undo';
}

function isValidReason(value: unknown): value is (typeof DELIVERY_SKIP_REASONS)[number] {
  return typeof value === 'string' && (DELIVERY_SKIP_REASONS as readonly string[]).includes(value);
}

/** The verified device session accompanying the capability token (companion access layer). */
function sessionTokenOf(req: FastifyRequest): string | null {
  const header = req.headers['x-companion-session'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

/** Narrow an unknown thrown value to an HTTP status without leaking internals. */
function statusOf(err: unknown): number {
  if (err && typeof err === 'object') {
    const rec = err as { status?: unknown; statusCode?: unknown };
    if (typeof rec.status === 'number') return rec.status;
    if (typeof rec.statusCode === 'number') return rec.statusCode;
  }
  return 500;
}

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * 401 (verify this device) and 403 (waiting for approval) must reach the
 * companion gate so it can render the right screen; everything else stays a
 * uniform 404 so dead/unknown tokens are indistinguishable.
 */
function sendPublicError(reply: FastifyReply, err: unknown, log: (err: unknown, msg: string) => void, msg: string) {
  const status = statusOf(err);
  if (status === 401 || status === 403) {
    return reply.status(status).send({ error: messageOf(err, msg) });
  }
  log(err, msg);
  return reply.status(404).send(NOT_ACTIVE);
}

const deliveriesPublicRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET the volunteer-safe route payload (first name + address only).
  fastify.get('/r/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    try {
      const payload = await controller.getPublicRoute(String(token), sessionTokenOf(req));
      if (!payload) return reply.status(404).send(NOT_ACTIVE);
      return reply.status(200).send(payload);
    } catch (err) {
      return sendPublicError(reply, err, (e, m) => fastify.log.error(e, m), 'Failed to load public delivery route');
    }
  });

  // POST a volunteer action against a single stop. Every write is attributed "via volunteer link".
  fastify.post('/r/:token/stops/:stopId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token, stopId } = req.params as { token: string; stopId: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isValidAction(body['action'])) return reply.status(400).send({ error: 'Unknown action.' });
    const reason = isValidReason(body['reason']) ? body['reason'] : null;
    // Optional idempotency key — reject malformed values instead of silently applying twice.
    const rawOpId = body['op_id'];
    if (rawOpId != null && (typeof rawOpId !== 'string' || rawOpId.length < OP_ID_MIN || rawOpId.length > OP_ID_MAX)) {
      return reply.status(400).send({ error: 'Invalid op_id.' });
    }
    const opId = typeof rawOpId === 'string' ? rawOpId : null;
    try {
      const payload = await controller.publicStopAction(
        String(token),
        String(stopId),
        body['action'],
        reason,
        sessionTokenOf(req),
        opId,
      );
      if (!payload) return reply.status(404).send(NOT_ACTIVE);
      return reply.status(200).send(payload);
    } catch (err) {
      return sendPublicError(
        reply,
        err,
        (e, m) => fastify.log.error(e, m),
        'Failed to apply public delivery stop action',
      );
    }
  });

  done();
};

export default deliveriesPublicRoute;
