import type { Router } from '@angular/router';
import type { TRPCLink } from '@trpc/client';
import { type Operation, TRPCClientError, createTRPCClient, httpLink } from '@trpc/client';
import { type Observer, type Unsubscribable, observable } from '@trpc/server/observable';
import superjson from 'superjson';

import type { TRPCRouter } from '../../../../../backend/src/app/modules/trpc';
import { environment } from '../../../environments/environment';
import { isCurrentRoutePublic } from '../../routing/public-routes';
import { discardSignedInUser } from '../error.service';
import type { TokenService } from './token-service';

interface JwtPayload {
  exp?: number;

  [key: string]: unknown;
}

type NextLink = (op: Operation) => ObservableLike;

/* ------------------------------------------------------------------ */
/* Local helper types                                                 */
/* ------------------------------------------------------------------ */
type ObservableLike<T = unknown, E = unknown> = {
  subscribe(args: Observer<T, E>): Unsubscribable;
};

/* ------------------------------------------------------------------ */
/* Core helpers                                                       */
/* ------------------------------------------------------------------ */

function forwardOp(op: Operation, next: NextLink, observer: Observer<unknown, unknown>): void {
  next(op).subscribe({
    next: (value) => observer.next(value),
    error: (err) => observer.error(err),
    complete: () => observer.complete(),
  });
}

let activeRefreshPromise: Promise<string> | null = null;

/**
 * Mint a fresh access token from the HttpOnly refresh cookie (SECURITY-REVIEW.md 2.1). No token is
 * read from JS/storage — the browser attaches the cookie because the refresh client sends
 * credentials. Concurrent callers share one in-flight request. Rejects if the cookie is missing or
 * the session is gone.
 */
function performRefresh(tokenSvc: TokenService): Promise<string> {
  if (activeRefreshPromise) return activeRefreshPromise;

  activeRefreshPromise = (async () => {
    try {
      const payload = await trpcRetryClient.auth.renewAuthToken.mutate();
      tokenSvc.setAuthToken(payload.auth_token);
      return payload.auth_token;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Attempt a silent re-auth on a cold page load: the in-memory access token is gone but the refresh
 * cookie may still be valid. Returns the new token, or null for a genuine guest. Never throws.
 */
export async function silentRefresh(tokenSvc: TokenService): Promise<string | null> {
  try {
    return await performRefresh(tokenSvc);
  } catch {
    tokenSvc.clearAll();
    return null;
  }
}

async function getValidAuthToken(tokenSvc: TokenService): Promise<string | null> {
  const authToken = tokenSvc.getAuthToken();
  // No in-memory token → treat as guest. Startup already ran silentRefresh, so we don't re-probe the
  // refresh endpoint on every guest request.
  if (!authToken) return null;

  // Still valid → use it. Expired → swap it for a fresh one via the refresh cookie.
  return isTokenExpired(authToken) ? performRefresh(tokenSvc) : authToken;
}

function handleRefreshFailure(
  err: unknown,
  tokenSvc: TokenService,
  router: Router,
  observer: Observer<unknown, unknown>,
): void {
  // Only an UNAUTHORIZED from the refresh endpoint proves the session is gone (real sign-out /
  // revocation). Anything else — backend down, offline, edge 503, a storage hiccup — says nothing
  // about the session, so keep the tokens and let the next request retry the refresh; signing the
  // user out during an outage would strand them on a sign-in form that can't work either.
  if (isUnauthorizedError(err)) {
    tokenSvc.clearAll();
    // The refresh endpoint itself said the session is gone, so the signed-in user this app is
    // still holding is stale. Clearing it is what lets /signin actually show: left set, the login
    // guard treats the dead session as a live one and redirects back into the app.
    discardSignedInUser();
    // Don't evict a guest from a legitimately public page (reset link, public form, etc.) just
    // because a stale token's refresh failed — surface the error instead.
    if (!isCurrentRoutePublic(router.url)) {
      void router.navigate(['/signin'], { queryParams: { returnUrl: router.url } });
    }
  }
  observer.error(err instanceof TRPCClientError ? err : new TRPCClientError(String(err)));
}

function isUnauthorizedError(err: unknown): boolean {
  if (!(err instanceof TRPCClientError)) return false;
  const data = err.data as { code?: string } | null | undefined;
  return data?.code === 'UNAUTHORIZED';
}

/** Sign-in must never be transparently retried — a failed attempt bumps rate-limit counters. */
function isSignInPath(path: string): boolean {
  return path === 'signIn' || path.endsWith('.signIn');
}

function isTokenExpired(token: string | null | undefined, leewaySeconds = 30): boolean {
  if (!token) return true;

  const payload = parseJwt(token);
  if (!payload?.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now + leewaySeconds;
}

function parseJwt(token: string): JwtPayload | null {
  try {
    const [, payload = ''] = token.split('.');
    // JWT payloads are base64url-encoded and unpadded; atob only accepts
    // standard base64, so convert the alphabet and restore padding first.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Public TRPC link                                                   */
/* ------------------------------------------------------------------ */

export function refreshLink(tokenSvc: TokenService, router: Router): TRPCLink<TRPCRouter> {
  return () => {
    return ({ op, next }: { op: Operation; next: NextLink }) =>
      observable<unknown, unknown>((observer) => {
        void (async () => {
          try {
            const authToken = await getValidAuthToken(tokenSvc);

            // Guest user — just forward.
            if (!authToken) {
              forwardOp(op, next, observer);
              return;
            }

            // Authenticated user — forward with (possibly refreshed) token. If the server still
            // rejects it with UNAUTHORIZED, the session behind our access token is usually gone
            // because another tab's silent refresh rotated it away. The shared refresh cookie is
            // still good, so mint a fresh token and retry the call once — invisibly. Only when
            // that refresh itself comes back UNAUTHORIZED (real sign-out / revocation) do we clear
            // tokens and redirect to /signin. Retrying is safe: the auth gate rejects before the
            // resolver runs, so the original call never executed.
            next(op).subscribe({
              next: (value) => observer.next(value),
              complete: () => observer.complete(),
              error: (err) => {
                if (!isUnauthorizedError(err) || isSignInPath(op.path)) {
                  observer.error(err);
                  return;
                }
                performRefresh(tokenSvc)
                  .then(() => forwardOp(op, next, observer))
                  // Judge by the refresh's own failure, not the original UNAUTHORIZED: a refresh
                  // that died on the network must not sign the user out.
                  .catch((refreshErr: unknown) => handleRefreshFailure(refreshErr, tokenSvc, router, observer));
              },
            });
          } catch (err) {
            handleRefreshFailure(err, tokenSvc, router, observer);
          }
        })();

        // No teardown logic needed.
        return;
      });
  };
}

/* ------------------------------------------------------------------ */
/* Dedicated client for token refreshes only                          */
/* ------------------------------------------------------------------ */
const trpcRetryClient = createTRPCClient<TRPCRouter>({
  links: [
    httpLink({
      url: environment.apiUrl,
      transformer: superjson,
      // Send the HttpOnly refresh cookie with the renew call.
      fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: 'include' }),
    }),
  ],
});
