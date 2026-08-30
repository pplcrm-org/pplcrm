import { JSendServerError } from '../../../../../../libs/common/src';
import { TRPCClientError } from '@trpc/client';

import { ApiError } from './api-error';

/** Shown when a request never got a response from the backend and the browser IS online. */
export const SERVER_UNREACHABLE_MESSAGE =
  "We can't reach the server right now. Check your internet connection and try again in a moment.";

/**
 * Shown for the same class of failure when the browser reports it is offline.
 *
 * The two are worth separating (§3, fail specifically): "check your internet connection" is a
 * guess, while "you're offline" is a fact the browser already told us, and it tells the user the
 * problem is on their end and their work is still on screen. Nothing else in the CRM consulted
 * `navigator.onLine` at all.
 */
export const OFFLINE_MESSAGE =
  "You're offline, so that didn't save. Your changes are still here — reconnect and retry.";

/** `navigator` is absent under SSR/tests; assume online so we never invent an offline message. */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * True when the request never produced a server-authored error: the backend is down/unreachable or
 * the client is offline. A tRPC error that actually came from the server always carries a `data`
 * payload with a code; a fetch-level failure (or an edge backend-down 503 with a non-tRPC body)
 * does not. Says nothing about the session — callers must NOT treat this as a sign-out signal.
 *
 * Caveat the wrapper chain creates: when our errorLink emits an ApiError, tRPC's client re-wraps
 * it into a fresh TRPCClientError with no `data`, keeping the original as `cause`. So a missing
 * `data` on the outer error proves nothing by itself — only a chain with no server-authored error
 * anywhere in it means the server never answered.
 */
export function isServerUnreachable(error: unknown): boolean {
  if (error instanceof ApiError) return isServerUnreachable(error.originalError);
  return error instanceof TRPCClientError && !hasServerAuthoredError(error, 0);
}

const MAX_CAUSE_DEPTH = 5;

/** Walks cause/originalError links looking for a tRPC error that carries a server `data` payload. */
function hasServerAuthoredError(error: unknown, depth: number): boolean {
  if (depth > MAX_CAUSE_DEPTH || error == null) return false;
  if (error instanceof TRPCClientError && error.data != null) return true;
  if (error instanceof ApiError) return hasServerAuthoredError(error.originalError, depth + 1);
  if (error instanceof Error) return hasServerAuthoredError(error.cause, depth + 1);
  return false;
}

/**
 * The tRPC error code the server authored for this failure ('CONFLICT', 'NOT_FOUND', …), or null
 * when no server-authored code exists anywhere in the wrapper chain. Callers branch on THIS,
 * never on message text: copy edits and production message sanitization must not change client
 * behaviour, and a message match silently breaks when either happens.
 */
export function getServerErrorCode(error: unknown): string | null {
  return findServerErrorCode(error, 0);
}

function findServerErrorCode(error: unknown, depth: number): string | null {
  if (depth > MAX_CAUSE_DEPTH || error == null) return null;
  if (error instanceof TRPCClientError) {
    const code = (error.data as { code?: unknown } | undefined)?.code;
    if (typeof code === 'string') return code;
  }
  if (error instanceof ApiError) return findServerErrorCode(error.originalError, depth + 1);
  if (error instanceof Error) return findServerErrorCode(error.cause, depth + 1);
  return null;
}

/**
 * Returns a message that is safe to show to the user.
 *
 * Server errors (tRPC / JSend) are already sanitized by the backend, so their
 * message is shown as-is. A plain `new Error('…')` is app-authored copy and
 * passes through too. Anything else (TypeError, DOMException, third-party
 * errors) would leak internals into the UI, so the caller's fallback is shown
 * instead — the full error still goes to the console via the usual handlers.
 */
export function getUserErrorMessage(error: unknown, fallback: string): string {
  // A raw fetch failure would surface as browser-speak ("Failed to fetch") — translate it, and
  // name the actual cause when the browser already knows the connection is down.
  if (isServerUnreachable(error)) {
    return isBrowserOffline() ? OFFLINE_MESSAGE : SERVER_UNREACHABLE_MESSAGE;
  }
  if (error instanceof ApiError || error instanceof TRPCClientError) {
    return error.message || fallback;
  }
  if (error instanceof JSendServerError) {
    return error.messageText || fallback;
  }
  if (error instanceof Error && error.constructor === Error && error.message) {
    return error.message;
  }
  return fallback;
}
