import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';

import { GENERIC_SIGNIN_ERROR } from '@common';

import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  PreconditionFailedError,
  TooManyRequestsError,
  UnauthorizedError,
} from './app/errors/app-errors';
import { isAppErrorLike, toTRPCError } from './app/errors/to-trpc-errors';
import { publicProcedure, router } from './trpc';

/**
 * The central error-mapping seam. The client force-signs-the-user-out on ANY
 * UNAUTHORIZED, so a permission denial that maps to 401 instead of 403 logs the
 * user out instead of telling them "you can't do that" — until now that was
 * pinned only endpoint-by-endpoint. This spec pins the seam itself:
 *
 * 1. toTRPCError: every AppError subclass → its tRPC code (ForbiddenError must
 *    be FORBIDDEN, never UNAUTHORIZED), plus the structural (duck-typed)
 *    recognition that survives duplicate ESM module instances.
 * 2. errorMappingMiddleware (via publicProcedure + createCaller): a resolver
 *    throw surfaces to the caller with the AppError's intended code, not the
 *    generic 500 tRPC v11 wraps it in.
 * 3. The errorFormatter from trpc.ts (extracted from the shared initTRPC config
 *    via router()._def._config — the very function production runs): the
 *    sign-in collapse to GENERIC_SIGNIN_ERROR, production 500-message
 *    redaction, Zod → BAD_REQUEST stamping, and AppError `data` forwarding
 *    (e.g. retryAfterSec).
 *
 * Mode toggling: both toTRPCError and the formatter read process.env.NODE_ENV at
 * call time, so production behavior is tested with vi.stubEnv per test and
 * vi.unstubAllEnvs() in afterEach — nothing leaks across tests or files.
 * The formatter is called directly with a hand-built default shape (the
 * assertions only touch fields the formatter itself reads/writes: message,
 * data.path, data.code); the HTTP transport layer that builds the real default
 * shape is not under test here.
 */

// ---- the production errorFormatter, extracted from the shared tRPC config ----

interface ShapeLike {
  message: string;
  code: number;
  data: Record<string, unknown>;
}

const formatterHost = router({});
const errorFormatter = (formatterHost as any)._def._config.errorFormatter as (opts: {
  shape: ShapeLike;
  error: TRPCError;
}) => ShapeLike;

/** Mimic tRPC's default error shape closely enough for the fields our formatter reads. */
function shapeFor(error: TRPCError, path?: string): ShapeLike {
  return {
    message: error.message,
    code: -32600,
    data: { code: error.code, httpStatus: 500, ...(path !== undefined ? { path } : {}) },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('toTRPCError: AppError subclass → tRPC code', () => {
  it.each([
    [new BadRequestError('bad'), 'BAD_REQUEST'],
    [new UnauthorizedError('who are you'), 'UNAUTHORIZED'],
    [new ForbiddenError('not yours'), 'FORBIDDEN'],
    [new NotFoundError('missing'), 'NOT_FOUND'],
    [new ConflictError('duplicate'), 'CONFLICT'],
    [new PreconditionFailedError('stale'), 'PRECONDITION_FAILED'],
    [new TooManyRequestsError('slow down'), 'TOO_MANY_REQUESTS'],
    [new InternalError('boom'), 'INTERNAL_SERVER_ERROR'],
  ])('%s maps to %s', (err, expectedCode) => {
    const mapped = toTRPCError(err);
    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped.code).toBe(expectedCode);
    expect(mapped.cause).toBe(err);
  });

  it('NEVER maps a permission denial to UNAUTHORIZED (the client would force-sign-out)', () => {
    const mapped = toTRPCError(new ForbiddenError('You can only work in your assigned campaign.'));
    expect(mapped.code).toBe('FORBIDDEN');
    expect(mapped.code).not.toBe('UNAUTHORIZED');
  });

  it('passes an existing TRPCError through unchanged (same instance)', () => {
    const original = new TRPCError({ code: 'FORBIDDEN', message: 'already mapped' });
    expect(toTRPCError(original)).toBe(original);
  });

  it('recognizes a duck-typed AppError (duplicate ESM module instance) and keeps its code', () => {
    // Under the dev server app-errors can be evaluated twice; instanceof then fails.
    const foreign = Object.assign(new Error('not yours'), { status: 403, code: 'FORBIDDEN' });
    const mapped = toTRPCError(foreign);
    expect(mapped.code).toBe('FORBIDDEN');
  });

  it('maps an unknown error to INTERNAL_SERVER_ERROR with the generic message (+cause in dev)', () => {
    const mapped = toTRPCError(new Error('relation "persons" violates fk_tenant'));
    expect(mapped.code).toBe('INTERNAL_SERVER_ERROR');
    // NODE_ENV=test keeps the cause suffix for debuggability.
    expect(mapped.message).toBe(
      'Something went wrong, please try again (Cause: relation "persons" violates fk_tenant)',
    );
  });

  it('production: an unknown error message is fully redacted — no cause suffix', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const mapped = toTRPCError(new Error('relation "persons" violates fk_tenant'));
    expect(mapped.code).toBe('INTERNAL_SERVER_ERROR');
    expect(mapped.message).toBe('Something went wrong, please try again');
    expect(mapped.message).not.toContain('persons');
  });

  it('dev: an AppError with a cause gets the "(Cause: ...)" suffix; production keeps only its own message', () => {
    const withCause = new NotFoundError('No such turf', undefined, { cause: new Error('row vanished') });
    expect(toTRPCError(withCause).message).toBe('No such turf (Cause: row vanished)');

    vi.stubEnv('NODE_ENV', 'production');
    expect(toTRPCError(withCause).message).toBe('No such turf');
  });

  it('forwards AppError data on the cause so the formatter can surface it (retryAfterSec)', () => {
    const err = new TooManyRequestsError('slow down', { retryAfterSec: 42 });
    const mapped = toTRPCError(err);
    expect(mapped.code).toBe('TOO_MANY_REQUESTS');
    expect((mapped.cause as TooManyRequestsError).data).toEqual({ retryAfterSec: 42 });
  });
});

describe('isAppErrorLike', () => {
  it('accepts a real AppError subclass', () => {
    expect(isAppErrorLike(new ForbiddenError('x'))).toBe(true);
  });

  it('accepts a structural match (Error with numeric status + string code)', () => {
    expect(isAppErrorLike(Object.assign(new Error('x'), { status: 404, code: 'NOT_FOUND' }))).toBe(true);
  });

  it('rejects a plain Error and a non-Error object with the right fields', () => {
    expect(isAppErrorLike(new Error('x'))).toBe(false);
    expect(isAppErrorLike({ status: 403, code: 'FORBIDDEN' })).toBe(false);
  });
});

describe('errorMappingMiddleware (publicProcedure end-to-end via createCaller)', () => {
  // tRPC v11 resolves a downstream throw into { ok: false, error } with the original
  // as .cause on a generic INTERNAL error — the middleware must remap AppErrors.
  let toThrow: unknown;
  const testRouter = router({
    boom: publicProcedure.query(() => {
      throw toThrow;
    }),
  });
  const caller = testRouter.createCaller({} as any);

  async function codeOf(err: unknown): Promise<string> {
    toThrow = err;
    try {
      await caller.boom();
    } catch (thrown) {
      return (thrown as TRPCError).code;
    }
    throw new Error('expected the procedure to throw');
  }

  it('a ForbiddenError thrown in a resolver surfaces as FORBIDDEN, not UNAUTHORIZED or 500', async () => {
    expect(await codeOf(new ForbiddenError('Viewers are not allowed to make changes.'))).toBe('FORBIDDEN');
  });

  it('an UnauthorizedError surfaces as UNAUTHORIZED (reserved for authentication failures)', async () => {
    expect(await codeOf(new UnauthorizedError())).toBe('UNAUTHORIZED');
  });

  it('a NotFoundError surfaces as NOT_FOUND', async () => {
    expect(await codeOf(new NotFoundError('gone'))).toBe('NOT_FOUND');
  });

  it('a TooManyRequestsError surfaces as TOO_MANY_REQUESTS', async () => {
    expect(await codeOf(new TooManyRequestsError('later'))).toBe('TOO_MANY_REQUESTS');
  });

  it('a raw Error stays INTERNAL_SERVER_ERROR', async () => {
    expect(await codeOf(new Error('driver blew up'))).toBe('INTERNAL_SERVER_ERROR');
  });
});

describe('errorFormatter: sign-in collapse', () => {
  it('collapses UNAUTHORIZED on the signIn path to GENERIC_SIGNIN_ERROR', () => {
    const error = new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid password for user' });
    const out = errorFormatter({ shape: shapeFor(error, 'signIn'), error });
    expect(out.message).toBe(GENERIC_SIGNIN_ERROR);
  });

  it('collapses NOT_FOUND on a namespaced auth.signIn path (user enumeration guard)', () => {
    const error = new TRPCError({ code: 'NOT_FOUND', message: 'No user with that email' });
    const out = errorFormatter({ shape: shapeFor(error, 'auth.signIn'), error });
    expect(out.message).toBe(GENERIC_SIGNIN_ERROR);
  });

  it('collapses an InvalidCredentialsError cause on signIn even when the code is 500', () => {
    const cause = Object.assign(new Error('bcrypt mismatch'), { name: 'InvalidCredentialsError' });
    const error = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'bcrypt mismatch', cause });
    // Path can also arrive on the error object itself — the formatter checks there first.
    (error as any).path = 'signIn';
    const out = errorFormatter({ shape: shapeFor(error), error });
    expect(out.message).toBe(GENERIC_SIGNIN_ERROR);
  });

  it('collapses BAD_REQUEST (malformed credentials input) on signIn', () => {
    const error = new TRPCError({ code: 'BAD_REQUEST', message: 'email: Invalid email' });
    const out = errorFormatter({ shape: shapeFor(error, 'signIn'), error });
    expect(out.message).toBe(GENERIC_SIGNIN_ERROR);
  });

  it('does NOT collapse UNAUTHORIZED on other paths — the real message survives', () => {
    const error = new TRPCError({ code: 'UNAUTHORIZED', message: 'Session expired' });
    const out = errorFormatter({ shape: shapeFor(error, 'persons.getAll'), error });
    expect(out.message).toBe('Session expired');
  });

  it('does NOT collapse NOT_FOUND on other paths', () => {
    const error = new TRPCError({ code: 'NOT_FOUND', message: 'Person not found' });
    const out = errorFormatter({ shape: shapeFor(error, 'persons.getById'), error });
    expect(out.message).toBe('Person not found');
  });
});

describe('errorFormatter: production message sanitization', () => {
  it('production: an INTERNAL_SERVER_ERROR message is replaced with the generic one', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const error = new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'duplicate key value violates unique constraint "uq_esup_email_reason"',
    });
    const out = errorFormatter({ shape: shapeFor(error, 'persons.add'), error });
    expect(out.message).toBe('Something went wrong, please try again');
    expect(out.message).not.toContain('uq_esup_email_reason');
  });

  it('dev/test: the raw 500 message is kept for debuggability', () => {
    const error = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'raw driver message' });
    const out = errorFormatter({ shape: shapeFor(error, 'persons.add'), error });
    expect(out.message).toBe('raw driver message');
  });

  it('production: a non-500 code keeps its (deliberate, client-safe) message', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const error = new TRPCError({ code: 'FORBIDDEN', message: 'Only admins or owners can perform this action.' });
    const out = errorFormatter({ shape: shapeFor(error, 'users.update'), error });
    expect(out.message).toBe('Only admins or owners can perform this action.');
  });
});

describe('errorFormatter: Zod and AppError metadata', () => {
  it('stamps a ZodError cause as BAD_REQUEST with isZodError', () => {
    const parsed = z.object({ email: z.email() }).safeParse({ email: 'nope' });
    if (parsed.success) throw new Error('expected the sample input to fail Zod validation');
    const zodError: ZodError = parsed.error;
    expect(zodError).toBeInstanceOf(ZodError);
    const error = new TRPCError({ code: 'BAD_REQUEST', message: zodError.message, cause: zodError });
    const out = errorFormatter({ shape: shapeFor(error, 'persons.add'), error });
    expect(out.data['code']).toBe('BAD_REQUEST');
    expect(out.data['isZodError']).toBe(true);
  });

  it('forwards AppError data (retryAfterSec) into shape.data for the client', () => {
    const appError = new TooManyRequestsError('Too many attempts', { retryAfterSec: 42 });
    const error = toTRPCError(appError);
    const out = errorFormatter({ shape: shapeFor(error, 'auth.requestOtp'), error });
    expect(out.data['retryAfterSec']).toBe(42);
    // The default shape's own fields are preserved alongside.
    expect(out.data['code']).toBe('TOO_MANY_REQUESTS');
  });

  it('does not invent data when the cause carries none', () => {
    const error = toTRPCError(new NotFoundError('gone'));
    const out = errorFormatter({ shape: shapeFor(error, 'lists.getById'), error });
    expect(out.data['retryAfterSec']).toBeUndefined();
  });
});
