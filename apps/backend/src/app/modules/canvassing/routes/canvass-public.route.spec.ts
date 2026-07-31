import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../errors/app-errors';
import { CanvassingController } from '../controller';
import canvassPublicRoute from './canvass-public.route';

/**
 * Regression spec for the unauthenticated Canvass Companion REST surface
 * (mounted at /api/canvass in routes.ts).
 *
 * The contract under test: handlers answer with the deliberate, client-safe
 * message of an AppError subclass, and with the route's generic fallback for
 * anything else — a raw Kysely/Postgres error (constraint/table names) or a
 * TypeError must never reach an unauthenticated caller verbatim.
 *
 * The controller is mocked at the prototype, so no rows are seeded; the route
 * plumbing (statusOf/messageOf + reply shape) is what runs for real.
 */

const VALID_RESULTS_BODY = {
  ops: [
    {
      op_id: 'spec-op-0000000001',
      type: 'door_outcome',
      payload: { household_id: '123', outcome: 'no_answer' },
    },
  ],
};

describe('canvass-public.route error sanitization', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(canvassPublicRoute);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a plain Error (simulated DB failure) with the fallback message, not the raw message', async () => {
    const rawDbMessage = 'insert or update on table "turf_knocks" violates foreign key constraint "fk_tenant"';
    vi.spyOn(CanvassingController.prototype, 'getCompanionTurf').mockRejectedValue(new Error(rawDbMessage));

    const res = await app.inject({ method: 'GET', url: '/t/some-token' });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toBe('Unable to load this turf.');
    expect(body.error).not.toContain('turf_knocks');
  });

  it('passes an AppError subclass message through, with its status', async () => {
    vi.spyOn(CanvassingController.prototype, 'getCompanionTurf').mockRejectedValue(
      new NotFoundError('This canvassing link is invalid or has been retired.'),
    );

    const res = await app.inject({ method: 'GET', url: '/t/some-token' });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('This canvassing link is invalid or has been retired.');
  });

  it('sanitizes unexpected errors on the results sync handler too', async () => {
    vi.spyOn(CanvassingController.prototype, 'postCompanionResults').mockRejectedValue(
      new TypeError("Cannot read properties of undefined (reading 'tenant_id')"),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/t/some-token/results',
      payload: VALID_RESULTS_BODY,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toBe('Unable to record these results.');
    expect(body.error).not.toContain('tenant_id');
  });
});
