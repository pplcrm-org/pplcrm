// tsco:ignore
//
import * as Sentry from '@sentry/node';
import { TRPCError, initTRPC } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context } from './context';
import { isAppErrorLike, toTRPCError } from './app/errors/to-trpc-errors';
import superjson from 'superjson';
import { logger } from './app/logger';
import { GENERIC_SIGNIN_ERROR, isPrivilegedRole } from '../../../libs/common/src';

// Shown to the client in place of any unexpected (500) error's real message in production.
const GENERIC_INTERNAL_ERROR = 'Something went wrong, please try again';

const trpc = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    logger.error({ err: error }, 'tRPC Error');
    if (error.cause) {
      logger.error({ err: error.cause }, 'tRPC Error Cause');
    }

    // In production, never let an unexpected error's raw message reach the client. AppErrors are
    // mapped to explicit non-500 codes by the errorMappingMiddleware; anything still surfacing as
    // INTERNAL_SERVER_ERROR is unexpected (a raw Kysely/Postgres error, a TypeError, etc.) and its
    // message can leak internals (e.g. a constraint/table/column name), so redact it here. tRPC v11
    // resolves a downstream throw to a result rather than rejecting, so the middleware can miss
    // non-AppError causes — this formatter is the last line that always runs. Dev/test keep the
    // real message for debuggability.
    if (process.env['NODE_ENV'] === 'production' && error.code === 'INTERNAL_SERVER_ERROR') {
      shape = { ...shape, message: GENERIC_INTERNAL_ERROR };
    }
    // Path may be on error.path, or on shape.data.path (or absent)
    const errorObj = error as unknown as Record<string, unknown>;
    const pathStr: string =
      (typeof errorObj['path'] === 'string' ? errorObj['path'] : undefined) ??
      (shape.data?.path as string | undefined) ??
      '';

    // Only unexpected 500s go to Sentry — AppErrors are mapped to non-500 codes by
    // errorMappingMiddleware before this runs, so expected domain failures stay out.
    // No-op when SENTRY_DSN is unset (see instrument.ts).
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      Sentry.captureException(error.cause ?? error, { tags: { trpcPath: pathStr } });
    }

    const isSignIn = pathStr === 'signIn' || pathStr.endsWith('.signIn') || pathStr === 'auth.signIn';

    // Zod/input → BAD_REQUEST in tRPC v10; zodError is also surfaced on shape.data
    const isZod =
      error.cause instanceof ZodError || Boolean((shape.data as Record<string, unknown> | undefined)?.['zodError']);

    const isZodOrBadRequest = isZod || error.code === 'BAD_REQUEST';

    // Collapse auth-ish cases
    const isCredsProblem =
      error.code === 'UNAUTHORIZED' ||
      error.code === 'NOT_FOUND' ||
      error.cause?.name === 'InvalidCredentialsError' ||
      (error.cause as unknown as Record<string, unknown> | undefined)?.['code'] === 'USER_NOT_FOUND';

    let finalShape = shape;
    if (isZod) {
      finalShape = {
        ...shape,
        data: {
          ...shape.data,
          code: 'BAD_REQUEST',
          isZodError: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC v11 does not export shape.data's type; see pplcrm-any-exceptions
        } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC v11 does not export the error-shape type; see pplcrm-any-exceptions
      } as any;
    }

    if (isSignIn && (isZodOrBadRequest || isCredsProblem)) {
      return { ...finalShape, message: GENERIC_SIGNIN_ERROR };
    }

    // Forward safe metadata from AppError (e.g. retryAfterSec for rate limits)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC v11 does not export error.cause's type; see pplcrm-any-exceptions
    const causeData = (error.cause as any)?.data;
    if (causeData && typeof causeData === 'object' && !Array.isArray(causeData)) {
      return { ...finalShape, data: { ...finalShape.data, ...causeData } };
    }

    return finalShape;
  },
});

export const middleware = trpc.middleware;

const errorMappingMiddleware = middleware(async (opts) => {
  // tRPC v11 middleware: a downstream throw does NOT reject `next()` — it resolves to a
  // `{ ok: false, error }` result whose `error` is already a TRPCError (default code
  // INTERNAL_SERVER_ERROR) wrapping the original throw as `.cause`. So we can't rely on
  // try/catch here; we inspect the result and remap AppErrors from the cause, preserving
  // their intended status (e.g. UnauthorizedError -> 401, not a generic 500). The try/catch
  // is kept as a safety net in case a future path throws synchronously.
  let result: Awaited<ReturnType<typeof opts.next>>;
  try {
    result = await opts.next();
  } catch (err) {
    throw toTRPCError(err);
  }

  if (!result.ok && isAppErrorLike(result.error.cause)) {
    throw toTRPCError(result.error.cause);
  }

  return result;
});

export const publicProcedure = trpc.procedure.use(errorMappingMiddleware);

export const router = trpc.router;

import { BaseRepository } from './app/lib/base.repo';
import { runWithTenant } from './app/lib/tenant-context';
import { hashToken } from './app/lib/token-hash';

/**
 * Campaigns §15 — input keys that name a campaign context. Editors/Viewers are
 * pinned to their admin-assigned campaign, so any of these keys arriving with a
 * different id is a scope violation (the UI never sends one; only a tampered
 * client would). Admin-only inputs (carry-over's source/target ids) are gated by
 * adminOrOwnerProcedure and deliberately not listed here.
 */
const CAMPAIGN_INPUT_KEYS = new Set(['campaignId', 'campaign_id']);

/** Sentinel added when a campaign key holds a shape we cannot compare — see below. */
const UNCOMPARABLE_CAMPAIGN_ID = '\u0000uncomparable';

/**
 * Recursively collect every campaign id named by the (already-deserialized) raw input.
 *
 * This runs on `getRawInput()`, i.e. BEFORE Zod validation, so it must not assume the
 * value has the shape the schema will eventually demand. Anything under a campaign key
 * that is not a plain scalar — an array, an object, null — is recorded as
 * {@link UNCOMPARABLE_CAMPAIGN_ID} so the caller denies rather than skipping it. Depth
 * exhaustion is treated the same way: an id we did not look at must not read as absent.
 */
function collectCampaignIds(value: unknown, depth = 0, out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object') return out;
  if (depth > 4) {
    // We stopped descending; if anything below named a campaign we would never see it.
    // Only flag when the subtree could still contain one.
    if (JSON.stringify(value)?.includes('ampaign')) out.add(UNCOMPARABLE_CAMPAIGN_ID);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCampaignIds(item, depth + 1, out);
    return out;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (CAMPAIGN_INPUT_KEYS.has(key)) {
      if (typeof v === 'string') {
        // An empty string is "unset", which is a legitimate way to mean "no filter".
        if (v !== '') out.add(v);
      } else if (typeof v === 'number') {
        out.add(String(v));
      } else if (v !== undefined && v !== null) {
        out.add(UNCOMPARABLE_CAMPAIGN_ID);
      }
    } else {
      collectCampaignIds(v, depth + 1, out);
    }
  }
  return out;
}

/**
 * Mutations a `viewer` may still call. Everything here is the viewer acting on their own account
 * rather than on workspace data: undoing an email change they did not request, signing out, and
 * ending their own sessions on other devices. Someone who lost a phone must be able to revoke it
 * whatever their role — the read-only restriction is about the workspace's records, not about
 * their own access to it.
 */
const VIEWER_ALLOWED_MUTATIONS = ['cancelEmailChange', 'signOut', 'revokeSession', 'revokeOtherSessions'];

const isAuthed = middleware(async (opts) => {
  const { ctx } = opts;

  if (!ctx.auth?.user_id || !ctx.auth?.tenant_id || !ctx.auth?.session_id) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  // Capture the narrowed, non-null auth so the closure below keeps the narrowing.
  const auth = ctx.auth;

  // S-1 (schema review 2026-07-06 §6): bind the tenant to the async context for
  // the remainder of the request. The runtime pool's onReserveConnection hook
  // (base.repo.ts) reads it and sets the `app.tenant_id` GUC on every connection
  // checkout, so Postgres RLS scopes every query — a backstop beneath the
  // app-level `.where('tenant_id', …)` filters. Wrapping the auth lookups too is
  // harmless (they are already tenant-scoped) and covers all downstream resolvers.
  return runWithTenant(auth.tenant_id, async () => {
    let user: { role: string | null; verified: boolean; campaign_id: string | null } | undefined;
    if (/^\d+$/.test(auth.user_id)) {
      const record = await BaseRepository.dbInstance
        .selectFrom('authusers')
        .select(['role', 'verified', 'campaign_id'])
        .where('id', '=', auth.user_id)
        .where('tenant_id', '=', auth.tenant_id)
        .executeTakeFirst();
      if (record) {
        user = {
          role: record.role,
          verified: record.verified === true || String(record.verified) === 'true',
          campaign_id: record.campaign_id != null ? String(record.campaign_id) : null,
        };
      }
    }

    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    // Enforce session revocation. The access token embeds the plaintext session_id;
    // its hash must still map to an active, unexpired row in `sessions`. Deleting the
    // session (sign-out, tenant pause/deletion, password reset, email-change confirm)
    // therefore invalidates the access token immediately instead of leaving it usable
    // until the ~30-minute JWT expiry.
    const session = await BaseRepository.dbInstance
      .selectFrom('sessions')
      .select(['id', 'expires_at'])
      .where('session_id', '=', hashToken(auth.session_id))
      .where('user_id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!session) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    if (opts.type === 'mutation' && user.role === 'viewer') {
      const isExempt = VIEWER_ALLOWED_MUTATIONS.some((name) => opts.path === name || opts.path.endsWith(`.${name}`));
      if (!isExempt) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Viewers are not allowed to make changes.',
        });
      }
    }

    // Campaigns §15 — everyone who is not an admin/owner belongs to exactly one
    // campaign (their admin-assigned one, or the office when unassigned).
    //
    // This resolves the pin for ALL such callers, not just those who happened to
    // send a campaign key. The pin is then bound to the async context below, so
    // repositories scope by it even when the request names no campaign at all —
    // previously, omitting `campaignId` disabled scoping and returned every
    // campaign's rows. A campaign key that disagrees with the pin is still a
    // cross-campaign attempt and is refused here.
    let pinnedCampaign: string | null = null;
    if (!isPrivilegedRole(user.role)) {
      pinnedCampaign = user.campaign_id;
      if (pinnedCampaign === null) {
        const office = await BaseRepository.dbInstance
          .selectFrom('campaigns')
          .select('id')
          .where('tenant_id', '=', auth.tenant_id)
          .where('kind', '=', 'office')
          .executeTakeFirst();
        pinnedCampaign = office ? String(office.id) : null;
      }

      for (const id of collectCampaignIds(await opts.getRawInput())) {
        if (id !== pinnedCampaign) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You can only work in your assigned campaign.',
          });
        }
      }
    }

    const authWithRole = {
      ...auth,
      role: user.role,
      campaign_id: pinnedCampaign,
    };

    // Re-enter the async context carrying the campaign pin, so every query issued
    // downstream is campaign-scoped without each call site having to remember.
    return runWithTenant(auth.tenant_id, () => opts.next({ ctx: { ...ctx, auth: authWithRole } }), pinnedCampaign);
  });
});

export const authProcedure = publicProcedure.use(isAuthed);

export const adminOrOwnerProcedure = authProcedure.use(async (opts) => {
  const { ctx } = opts;
  if (ctx.auth.role !== 'admin' && ctx.auth.role !== 'owner') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins or owners can perform this action.',
    });
  }
  return opts.next({ ctx });
});
