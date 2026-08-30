import { inject, Service } from '@angular/core';
import { Router } from '@angular/router';
import { GENERIC_SIGNIN_ERROR } from '../../../../../../libs/common/src';
import { ErrorService } from '../error.service';
import {
  TRPCClient,
  TRPCClientError,
  TRPCLink,
  createTRPCClient,
  httpLink as trpcHttpLink,
  loggerLink,
} from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import { TRPCRouter } from '../../../../../backend/src/app/modules/trpc';
import { environment } from '../../../environments/environment';
import { TokenService } from './token-service';
import { refreshLink } from './trpc-refreshlink';
import { ApiError } from './api-error';

// The type parameter became unused when the dead runCachedCall cache was removed (2026-08-30),
// but every subclass still writes `extends TRPCService<'persons'>` etc. — dropping it here would
// touch them all for no behaviour change. Underscore-named so the compiler accepts it as
// deliberately unused; it goes away for real when the TRPCService-extending components are
// migrated onto AbstractAPIService (the one deferred review item).
@Service()
export class TRPCService<_T> {
  protected readonly errorSvc = inject(ErrorService);

  protected readonly router = inject(Router);

  protected readonly tokenService = inject(TokenService);

  protected ac = new AbortController();

  public readonly api: TRPCClient<TRPCRouter>;

  constructor() {
    this.api = createTRPCClient<TRPCRouter>({
      links: [
        // Dev-only: logs every tRPC op to the console. Disabled in production builds.
        loggerLink({ enabled: () => !environment.production }),
        // errorLink must sit OUTSIDE refreshLink: refreshLink transparently refreshes and retries
        // an UNAUTHORIZED call once (e.g. after another tab rotated the session), and errorLink
        // must only see the error — and redirect to /signin — when that retry has already failed.
        errorLink(this.errorSvc),
        refreshLink(this.tokenService, this.router),
        httpUnbatchedLink(this.tokenService, () => this.ac.signal),
      ],
    });
  }

  public abort() {
    this.ac.abort();
    this.ac = new AbortController(); // create a fresh controller so future calls are not auto-aborted
  }

  // NOTE: an IndexedDB response cache (runCachedCall) lived here until 2026-08-30 with zero
  // callers. It was removed rather than wired up: a time-based cache with no invalidation on
  // mutations would show stale tags/teams/lists after an edit. If client-side caching returns,
  // it needs a mutation-invalidation design, not a TTL.
}

function errorLink(errorSvc: ErrorService): TRPCLink<TRPCRouter> {
  const GENERIC_INPUT_MSG = 'Please check your input and try again';

  return () =>
    ({ next, op }) =>
      observable((observer) => {
        const unsubscribe = next(op).subscribe({
          next: (value) => observer.next(value),
          error: (err) => {
            const meta = op.context as { skipErrorHandler?: boolean } | undefined;
            const path = op.path ?? '';
            const isSignIn = path === 'auth.signIn' || path.endsWith('.signIn') || path === 'signIn';
            let finalErr: any = err;
            let code: string | undefined;

            if (err instanceof TRPCClientError) {
              code = err.data?.code as string | undefined;

              let msg = err.message;
              if (isSignIn && (code === 'BAD_REQUEST' || code === 'UNAUTHORIZED' || code === 'NOT_FOUND')) {
                // Server formatter should already do this; this is just a client fallback
                msg = GENERIC_SIGNIN_ERROR;
              } else if (code === 'BAD_REQUEST') {
                const isValidationError = (err.data as { isZodError?: boolean })?.isZodError;
                if (isValidationError) {
                  msg = GENERIC_INPUT_MSG;
                }
              }
              finalErr = new ApiError(msg, err);
            }

            // Aborted requests (component teardown, superseded loads) are not
            // user-facing failures — never toast or redirect them.
            if (!isAbortError(err)) {
              if (code === 'UNAUTHORIZED' && !isSignIn) {
                // A dead session must sign the user out even when the caller passed skipErrorHandler:
                // that flag suppresses the error toast, not the sign-out. redirectToSignIn() no-ops on
                // public pages and de-dupes, so probes and public routes stay put.
                errorSvc.redirectToSignIn();
              } else if (!meta?.skipErrorHandler) {
                errorSvc.handle(finalErr);
              }
            }

            observer.error(finalErr);
          },
          complete: () => observer.complete(),
        });
        return unsubscribe;
      });
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof TRPCClientError) {
    const cause: unknown = err.cause;
    return cause instanceof DOMException && cause.name === 'AbortError';
  }
  return false;
}

function httpUnbatchedLink(tokenSvc: TokenService, getAbortSignal: () => AbortSignal) {
  return trpcHttpLink({
    url: environment.apiUrl,
    transformer: superjson,
    // Combine the per-request signal tRPC provides with the service-level
    // controller so TRPCService.abort() actually cancels in-flight requests.
    // `credentials: 'include'` is required so the browser honors Set-Cookie on the
    // sign-in/out responses and attaches the HttpOnly refresh cookie (SECURITY-REVIEW 2.1).
    fetch(input, init) {
      const signals: AbortSignal[] = [getAbortSignal()];
      if (init?.signal) signals.push(init.signal);
      return globalThis.fetch(input, { ...init, credentials: 'include', signal: AbortSignal.any(signals) });
    },
    headers() {
      const authToken = tokenSvc.getAuthToken();
      return authToken ? { Authorization: `Bearer ${authToken}` } : {};
    },
  });
}
