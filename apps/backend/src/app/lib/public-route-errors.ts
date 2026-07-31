import { isAppErrorLike } from '../errors/to-trpc-errors';

/**
 * Error → client-message allowlist for the public, unauthenticated REST routes
 * (canvass companion, deliveries volunteer page, companion access gate).
 *
 * Only the app's own error family (AppError subclasses — recognised structurally
 * via {@link isAppErrorLike}, so duplicate ESM module instances under the dev
 * server can't defeat the check) carries deliberate, client-safe messages.
 * Anything else — a Kysely/Postgres error naming constraints or columns, a
 * TypeError — gets the caller-supplied fallback so internals never reach an
 * unauthenticated caller. This mirrors what `toTRPCError` already does for the
 * authenticated tRPC surface. Callers keep logging the full error server-side.
 */
export function publicMessageOf(err: unknown, fallback: string): string {
  if (isAppErrorLike(err) && err.message) return err.message;
  return fallback;
}
