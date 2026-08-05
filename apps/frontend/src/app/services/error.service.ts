import { Injector, inject, Service } from '@angular/core';
import { Router } from '@angular/router';
import { JSendServerError } from '../../../../../libs/common/src';
import { TRPCClientError } from '@trpc/client';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ApiError } from './api/api-error';
import { SERVER_UNREACHABLE_MESSAGE, getUserErrorMessage, isServerUnreachable } from './api/user-message';

import { TokenService } from './api/token-service';
import { isCurrentRoutePublic } from '../routing/public-routes';
import { STALE_BUNDLE_MESSAGE, isStaleBundleError } from '../routing/stale-bundle';

/**
 * Window after a 401 sign-out redirect during which we (a) dedupe further 401s into the same
 * sign-out and (b) mute the "Failed to load …" error toasts that the burst of failing in-flight
 * queries would otherwise raise. Long enough to cover the cascade, short enough not to swallow an
 * unrelated error the user triggers next.
 */
const SIGNOUT_QUIET_MS = 3000;

/**
 * Drops the in-memory signed-in user. `AuthService` registers it at construction; nothing else
 * can clear that signal.
 *
 * Registered rather than injected because the two places that handle a 401 — this service and the
 * tRPC refresh link — sit underneath `AuthService` (it is built on the tRPC stack that reaches
 * back here), so injecting it would be a cycle. Clearing tokens alone is not enough: the sign-in
 * page's login guard reads the still-present user, decides they are signed in, and sends the dead
 * session back to /dashboard, whose queries 401 again.
 */
let sessionDiscardHook: (() => void) | null = null;

/** Called once by `AuthService` so the 401 paths below can clear its user signal. */
export function registerSessionDiscard(discard: () => void): void {
  sessionDiscardHook = discard;
}

/** Clear the signed-in user, if `AuthService` has been constructed and registered its hook. */
export function discardSignedInUser(): void {
  sessionDiscardHook?.();
}

@Service()
export class ErrorService {
  private readonly alerts = inject(AlertService);
  private readonly injector = inject(Injector);
  private readonly tokenSvc = inject(TokenService);

  private lastRedirect = 0;

  /**
   * Resolved lazily, never in a field initializer: `GlobalErrorHandler` (and therefore this
   * service) is constructed while the application injector is still initializing, ahead of the
   * Router, and the tRPC stack that the Router's own dependencies reach reaches back here
   * (TRPCService → ErrorService). Injecting it eagerly risks a boot-time NG0200; by the time
   * anything calls `handle()` the Router exists.
   */
  private get router(): Router {
    return this.injector.get(Router);
  }

  public handle(error: unknown): void {
    console.error('ErrorService.handle:', error);
    // Backend unreachable (offline / outage / edge 503): the server said nothing about the
    // session, so never sign the user out — just say what's wrong. AlertService coalesces the
    // identical toasts a burst of failing queries would produce.
    if (isServerUnreachable(error)) {
      this.alerts.showError(SERVER_UNREACHABLE_MESSAGE);
      return;
    }
    // Handle JSend server errors produced by the HTTP interceptor
    if (error instanceof JSendServerError) {
      if (!this.redirectFromStatus(error.statusCode)) {
        this.alerts.showError(error.messageText);
      }
      return;
    }

    if (error instanceof TRPCClientError) {
      const code = error.data?.code;
      if (!this.redirectFromCode(code)) {
        this.alerts.showError(error.message);
      }
      return;
    }

    if (error instanceof ApiError) {
      const original = error.originalError;
      if (original instanceof TRPCClientError) {
        const code = original.data?.code;
        if (!this.redirectFromCode(code)) {
          this.alerts.showError(error.message);
        }
        return;
      }
      this.alerts.showError(error.message);
      return;
    }

    // A lazy-route chunk the browser refused to import. app.config.ts already tried to rescue the
    // navigation with a hard reload; reaching here means it declined (a reload just happened, or
    // storage is unavailable), so tell the user the one thing that actually helps.
    if (isStaleBundleError(error)) {
      this.alerts.showError(STALE_BUNDLE_MESSAGE);
      return;
    }

    // Uncaught exceptions land here via GlobalErrorHandler — never show their
    // raw message (e.g. a TypeError) to the user; the console has the details.
    this.alerts.showError(getUserErrorMessage(error, 'Something went wrong, please try again'));
  }

  /**
   * Sign the user out and send them to /signin. Called for any 401/UNAUTHORIZED — including on
   * requests that pass `skipErrorHandler` (that flag suppresses the error toast, not the sign-out).
   * No-ops on public pages and de-dupes rapid calls, so probes and public routes stay put.
   */
  public redirectToSignIn(): void {
    this.redirect();
  }

  private redirect(): boolean {
    // Guests belong on public pages (reset links, public forms, subscription confirmation). A stray
    // 401/UNAUTHORIZED there must not bounce them to /signin — let the caller surface the error.
    if (isCurrentRoutePublic(this.router.url)) return false;

    const now = Date.now();
    // A sign-out redirect is already in flight from a 401 moments ago — report the
    // duplicate as handled so it stays silent instead of falling through to a toast.
    if (now - this.lastRedirect < SIGNOUT_QUIET_MS) return true;
    this.lastRedirect = now;

    this.tokenSvc.clearAll();
    discardSignedInUser();
    // Mute the misleading "Failed to load …" toasts the other in-flight queries are about to raise;
    // the sign-in page tells the user what actually happened. Info/success toasts still show.
    this.alerts.muteErrorsFor(SIGNOUT_QUIET_MS);
    const returnUrl = this.router.url;
    void this.router.navigate(['/signin'], { queryParams: { returnUrl } });
    return true;
  }

  private redirectFromCode(code?: string): boolean {
    if (code === 'UNAUTHORIZED') return this.redirect();
    return false;
  }

  private redirectFromStatus(status?: number): boolean {
    if (status === 401) return this.redirect();
    return false;
  }
}
