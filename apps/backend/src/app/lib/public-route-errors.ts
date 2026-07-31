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

/**
 * TRPC error codes whose messages are written for the end user. Anything outside this
 * set (INTERNAL_SERVER_ERROR above all) is not client copy and must not be echoed.
 */
const CLIENT_SAFE_TRPC_CODES: ReadonlySet<string> = new Set([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE_CONTENT',
  'TOO_MANY_REQUESTS',
]);

/** Structural TRPCError check — instanceof can be defeated by duplicate ESM module instances. */
function isClientSafeTRPCErrorLike(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && CLIENT_SAFE_TRPC_CODES.has(code);
}

/**
 * Like {@link publicMessageOf}, for the public routes whose controllers throw client-facing
 * copy as TRPCError (events RSVP, web-form submission, volunteer signup). Passes through
 * messages from the app's own error family and from TRPCErrors with a client-facing code;
 * a framework or driver error that merely carries a sub-500 `statusCode` gets the fallback.
 */
export function publicClientMessageOf(err: unknown, fallback: string): string {
  if (isAppErrorLike(err) && err.message) return err.message;
  if (isClientSafeTRPCErrorLike(err) && err.message) return err.message;
  return fallback;
}
