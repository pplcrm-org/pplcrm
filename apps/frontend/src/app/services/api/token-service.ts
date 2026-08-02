import { Service } from '@angular/core';

/**
 * Holds the short-lived access token IN MEMORY only (SECURITY-REVIEW.md 2.1). The long-lived refresh
 * token is never seen by JS — it lives in an HttpOnly cookie set by the backend — so an XSS payload
 * can't exfiltrate a durable credential. On a cold page load the access token is gone; the app
 * silently re-mints one from the refresh cookie (see trpc-refreshlink `silentRefresh`).
 *
 * `persistence` is the remember-me preference only (which drives the cookie lifetime server-side);
 * it no longer controls token storage because tokens are never persisted client-side.
 */
@Service()
export class TokenService {
  private persistence = false;
  private authToken: string | null = null;

  constructor() {
    this.persistence = localStorage.getItem(PERSISTENCE_KEY) === '1';
  }

  public clearAll(): void {
    this.authToken = null;
  }

  /**
   * Remember that the user asked to sign out but the server has not confirmed it yet.
   *
   * Only the server can delete the HttpOnly refresh cookie and revoke the session row, so a
   * sign-out request that never arrives leaves a usable session behind. This flag is the local
   * record of that intent. While it is set, {@link AuthService.init} refuses to mint a new access
   * token from the surviving cookie and retries the revoke instead, so an interrupted sign-out
   * (tab closed mid-request, machine offline) cannot silently resume on the next page load.
   *
   * It lives in localStorage because it has to outlive the tab that set it, and it is scoped to
   * the same browser profile as the cookie it guards against.
   */
  public markSignOutPending(): void {
    localStorage.setItem(PENDING_SIGNOUT_KEY, '1');
  }

  public clearSignOutPending(): void {
    localStorage.removeItem(PENDING_SIGNOUT_KEY);
  }

  public isSignOutPending(): boolean {
    return localStorage.getItem(PENDING_SIGNOUT_KEY) === '1';
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  public getPersistence(): boolean {
    return this.persistence;
  }

  public removeAuthToken(): void {
    this.authToken = null;
  }

  /** Accepts the token-issuing response shape ({ auth_token }); the refresh token is not returned
   * to JS anymore (it's in the HttpOnly cookie).
   *
   * Only the credentialed sign-in paths call this, so it is the right place to drop a stale
   * pending-sign-out flag: a fresh sign-in supersedes whatever the previous session was doing.
   * `setAuthToken` deliberately does not, because a silent refresh must not cancel a sign-out
   * that is still being retried. */
  public set(token: { auth_token?: string | null }): void {
    this.authToken = token.auth_token ?? null;
    this.clearSignOutPending();
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  public setPersistence(persistence: boolean): void {
    this.persistence = persistence;
    localStorage.setItem(PERSISTENCE_KEY, persistence ? '1' : '0');
  }
}

const PERSISTENCE_KEY = 'pc-persistence';

const PENDING_SIGNOUT_KEY = 'pc-signout-pending';
