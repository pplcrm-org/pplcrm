import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';

import {
  CompanionAccessQueryObj,
  CompanionApprovalDecisionObj,
  CompanionJoinStartObj,
  CompanionVerifyConfirmObj,
  CompanionVerifyStartObj,
} from '../../../../../../../libs/common/src';
import { CompanionAccessController } from '../controller';
import { isRateLimited } from '../../../lib/rate-limiter';

/**
 * Public companion access API (COMPANION-APPS-PLAN.md §4 A2) — the verify +
 * approve gate in front of both volunteer companions. No account: the
 * capability token names the assignment, and these endpoints establish WHO is
 * holding it. The device session they mint is carried on data requests via the
 * X-Companion-Session header.
 */

const controller = new CompanionAccessController();

// Per-IP fixed-window rate limit (same shape as deliveries-public.route.ts).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
/** Delegates to the shared limiter so these counters are swept instead of growing forever. */
function rateLimited(ip: string): boolean {
  return isRateLimited(`companion-public:${ip}`, RATE_MAX, RATE_WINDOW_MS);
}

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

const companionPublicRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // What should the gate render for this link (+ optional device session)?
  fastify.get('/access', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionAccessQueryObj.safeParse(req.query);
    if (!parsed.success) return reply.status(200).send({ state: 'dead' });
    try {
      const payload = await controller.getAccess(parsed.data.kind, parsed.data.token ?? null, sessionTokenOf(req));
      return reply.status(200).send(payload);
    } catch (err: unknown) {
      fastify.log.error(err, 'Failed to resolve companion access');
      // Uniform dead state — never leak why a link failed.
      return reply.status(200).send({ state: 'dead' });
    }
  });

  // Send a one-time code to the volunteer's email or SMS on file.
  fastify.post('/verify/start', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionVerifyStartObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request.' });
    try {
      const result = await controller.verifyStart(parsed.data.kind, parsed.data.token, parsed.data.channel);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      fastify.log.error(err, 'Failed to start companion verification');
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to send a code right now.') });
    }
  });

  // Confirm the code; mint the device session.
  fastify.post('/verify/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionVerifyConfirmObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter the 6-digit code.' });
    try {
      const result = await controller.verifyConfirm(
        parsed.data.kind,
        parsed.data.token,
        parsed.data.code,
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      );
      return reply.status(200).send(result);
    } catch (err: unknown) {
      fastify.log.error(err, 'Failed to confirm companion verification');
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to verify that code.') });
    }
  });

  // ---- QR join ------------------------------------------------------------
  // The one public endpoint that can write into `persons`. Every refusal answers with
  // the controller's single uniform message, so this cannot be probed for which codes
  // exist or who is already in the database.
  fastify.post('/join/start', async (req: FastifyRequest, reply: FastifyReply) => {
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionJoinStartObj.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Check the details you entered.' });
    }
    try {
      return reply.status(200).send(await controller.joinStart(parsed.data, req.ip));
    } catch (err: unknown) {
      fastify.log.error(err, 'Failed to start a companion join');
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to join right now.') });
    }
  });

  // ---- approve by text ----------------------------------------------------
  // The admin taps a link from an SMS with no session in hand, so the token is the
  // credential. GET shows who is asking; POST is the decision.
  fastify.get('/approve/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    try {
      return reply.status(200).send(await controller.getApprovalRequest(String(token)));
    } catch (err: unknown) {
      fastify.log.error(err, 'Failed to resolve a companion approval request');
      // Uniform dead state, exactly like /access — never leak why a link failed.
      return reply.status(200).send({ state: 'dead' });
    }
  });

  fastify.post('/approve/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    if (rateLimited(req.ip)) return reply.status(429).send({ error: 'Too many requests. Please slow down.' });
    const parsed = CompanionApprovalDecisionObj.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request.' });
    try {
      return reply.status(200).send(await controller.actOnApprovalRequest(String(token), parsed.data.decision));
    } catch (err: unknown) {
      fastify.log.error(err, 'Failed to act on a companion approval request');
      return reply.status(statusOf(err)).send({ error: messageOf(err, 'Unable to record that decision.') });
    }
  });

  done();
};

export default companionPublicRoute;
