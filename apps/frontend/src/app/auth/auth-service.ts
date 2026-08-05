import { inject, signal, Service } from '@angular/core';
import { IAuthUser, signInInputType, signUpInputType } from '../../../../../libs/common/src';
import { TRPCService } from '../services/api/trpc-service';
import { silentRefresh } from '../services/api/trpc-refreshlink';
import { TRPCError } from '@trpc/server';
import { TRPCClientError } from '@trpc/client';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { ApiError } from '../services/api/api-error';
import { registerSessionDiscard } from '../services/error.service';
import { isBrowserOffline, isServerUnreachable } from '../services/api/user-message';

/**
 * How long to wait for the sign-out request before calling it a transport failure. The browser's
 * own timeout runs into minutes, which would leave the user looking at a menu item that appears
 * to have done nothing.
 */
const SIGN_OUT_TIMEOUT_MS = 8000;

/** What the user picked when they were told the sign-out did not reach the server. */
type FailedSignOutChoice = 'retry' | 'this-device';

/** What actually happened when the user asked to sign out. */
export type SignOutResult =
  /** The server answered, so the refresh cookie is cleared and this browser cannot resume. */
  | { status: 'signed-out' }
  /** The server never answered and the user chose to leave anyway. This browser has stopped using
   *  the session, but it stays open server-side until this device gets back online. */
  | { status: 'signed-out-locally' }
  /** The server never answered and the user chose to stay signed in. Nothing changed. */
  | { status: 'still-signed-in' };

@Service()
export class AuthService extends TRPCService<'authusers'> {
  private readonly alerts = inject(AlertService);
  private readonly dialog = inject(ConfirmDialogService);
  private user = signal<IAuthUser | null>(null);
  private signOutInFlight: Promise<SignOutResult> | null = null;

  constructor() {
    super();
    // The two places that react to a 401 (ErrorService and the tRPC refresh link) clear the tokens
    // and navigate to /signin, but neither can reach this signal — they sit below this service in
    // the dependency graph. Hand them a way to null it, or the login guard reads a user who is no
    // longer signed in and bounces them straight back into the app.
    registerSessionDiscard(() => this.user.set(null));
  }

  public async getCurrentUser(opts?: { silent?: boolean }) {
    // The startup probe (init) passes silent: it swallows failures into `null` and lets the route
    // guards decide who gets in. A guest's UNAUTHORIZED here is a normal answer, not a toast-worthy
    // error — without this, every cold load of a public page (e.g. a password-reset link) flashes an
    // "unauthorized" toast.
    const request = opts?.silent
      ? (
          this.api.auth.currentUser.query as unknown as (
            input: undefined,
            o: { context: { skipErrorHandler: boolean } },
          ) => Promise<IAuthUser>
        )(undefined, { context: { skipErrorHandler: true } })
      : this.api.auth.currentUser.query();
    const user = (await request.catch(() => null)) as IAuthUser;
    if (user) this.user.set(user);
    return user;
  }

  public getUser(): IAuthUser | null {
    return this.user();
  }

  public getUserSignal() {
    return this.user;
  }

  public async init(): Promise<IAuthUser | null> {
    // A sign-out this browser started never reached the server, so the refresh cookie is still
    // here. Minting an access token from it would silently put the user back in the application
    // they believed they had left. Finish the sign-out instead, in the background so a device
    // that is still offline does not hold up start-up.
    if (this.tokenService.isSignOutPending()) {
      void this.completePendingSignOut();
      return null;
    }

    // Cold load: the in-memory access token is gone. Re-mint one from the HttpOnly refresh cookie
    // before asking who the user is, so a page reload doesn't look like a sign-out (SECURITY-REVIEW 2.1).
    await silentRefresh(this.tokenService);
    return this.getCurrentUser({ silent: true });
  }

  public async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
        resolve(result.split(',')[1]!);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = (await this.api.auth.uploadAvatar.mutate({
      dataBase64,
      mimeType: file.type as any,
      filename: file.name,
    })) as { avatar_url: string };

    const current = this.user();
    if (current) {
      this.user.set({
        ...current,
        avatar_url: res.avatar_url,
      });
    }

    return res;
  }

  public async deleteAvatar(): Promise<{ success: boolean }> {
    const res = (await this.api.auth.deleteAvatar.mutate()) as { success: boolean };

    const current = this.user();
    if (current) {
      this.user.set({
        ...current,
        avatar_url: null,
      });
    }

    return res;
  }

  public async cancelEmailChange() {
    const response = await this.api.auth.cancelEmailChange.mutate();
    await this.getCurrentUser();
    return response;
  }

  public resetPassword(input: { code: string; password: string }) {
    // The new-password page owns the error UX for this call.
    return (this.api.auth.resetPassword.mutate as unknown as (input: any, opts: any) => Promise<any>)(input, {
      context: { skipErrorHandler: true },
    });
  }

  public sendPasswordResetEmail(input: { email: string }) {
    // The reset-password page owns the error UX for this call.
    return (this.api.auth.sendPasswordResetEmail.mutate as unknown as (input: any, opts: any) => Promise<any>)(input, {
      context: { skipErrorHandler: true },
    });
  }

  public async signIn(
    input: signInInputType & { rememberMe?: boolean },
  ): Promise<{ requires2FA: boolean; email?: string; user?: IAuthUser | null }> {
    const response = await (this.api.auth.signIn.mutate as unknown as (input: any, opts: any) => Promise<any>)(input, {
      context: { skipErrorHandler: true },
    });

    if (response && 'requires2FA' in response && response.requires2FA) {
      return { requires2FA: true, email: response.email };
    }

    const user = await this.updateTokensAndGetCurrentUser(response);
    if (user?.tenant_deletion_scheduled_at) {
      void this.router.navigate(['/cancel-deletion']);
    } else if (user?.tenant_paused_at) {
      void this.router.navigate(['/resume-account']);
    }
    return { requires2FA: false, user };
  }

  public async verify2FA(input: { email: string; code: string; rememberMe?: boolean }) {
    const token = await (this.api.auth.verify2FA.mutate as unknown as (input: any, opts: any) => Promise<any>)(input, {
      context: { skipErrorHandler: true },
    });
    const user = await this.updateTokensAndGetCurrentUser(token);
    if ((user as IAuthUser | null)?.tenant_deletion_scheduled_at) {
      void this.router.navigate(['/cancel-deletion']);
    } else if ((user as IAuthUser | null)?.tenant_paused_at) {
      void this.router.navigate(['/resume-account']);
    }
    return user;
  }

  /**
   * Sign out, and only tell the user they are signed out if the server actually answered.
   *
   * The refresh cookie is HttpOnly, so this one request is the only thing that can clear it and
   * revoke the session row. If it never arrives (offline, DNS failure, timeout, CORS rejection, an
   * edge error short of the application) then dropping the in-memory access token and navigating
   * to /signin would be a lie: the next cold load mints a fresh access token from the surviving
   * cookie with no user action at all. So a request that never got an answer is treated as a
   * failure — no navigation, and the user is asked what they want to do.
   *
   * A request that DID get an answer, even an error answer, counts as signed out: the server
   * clears the cookie before running the handler and the reply carries that header out either way.
   */
  public signOut(): Promise<SignOutResult> {
    // One attempt at a time. An unreachable server keeps this pending until it times out, and a
    // user clicking the menu item again should join that attempt rather than start a second one.
    this.signOutInFlight ??= this.runSignOut();
    return this.signOutInFlight;
  }

  /**
   * Drop this browser's session state without asking the server to do anything.
   *
   * For callers that already know the session is gone (the server said so), never for a
   * user-initiated sign-out — it makes no claim about the server and revokes nothing.
   */
  public discardSession(): void {
    this.user.set(null);
    this.tokenService.clearAll();
    void this.router.navigate(['/signin']);
  }

  private async runSignOut(): Promise<SignOutResult> {
    try {
      for (;;) {
        const attempt = await this.requestSignOut();
        if (attempt.ok) return this.finishSignOut();

        console.error('Sign out did not reach the server:', attempt.error);
        const choice = await this.askAfterFailedSignOut();
        if (choice === 'retry') continue;
        if (choice === 'this-device') return this.signOutOnThisDeviceOnly();
        return { status: 'still-signed-in' };
      }
    } finally {
      // Released here rather than at the call site so every exit path frees it. `signOut()` has
      // already stored the promise by the time this runs: the first `await` above handed control
      // back to it.
      this.signOutInFlight = null;
    }
  }

  private async requestSignOut(): Promise<{ ok: true } | { ok: false; error: unknown }> {
    // Recorded BEFORE the request goes out. If the tab is closed while it is in flight, no code
    // here gets to run again and the refresh cookie only the server can clear is still in the
    // browser. This marker makes the next start of the app finish the sign-out (see `init`).
    this.tokenService.markSignOutPending();

    // The browser already knows there is no connection. Do not make the user wait out a timeout
    // for a request that cannot go anywhere.
    if (isBrowserOffline()) return { ok: false, error: new Error('The browser reports it is offline.') };

    try {
      await this.api.auth.signOut.mutate(undefined, {
        context: { skipErrorHandler: true },
        signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
      });
      return { ok: true };
    } catch (error) {
      return isSignOutTransportFailure(error) ? { ok: false, error } : { ok: true };
    }
  }

  private finishSignOut(): SignOutResult {
    this.tokenService.clearSignOutPending();
    this.discardSession();
    return { status: 'signed-out' };
  }

  private askAfterFailedSignOut(): Promise<FailedSignOutChoice | null> {
    const lead = isBrowserOffline()
      ? 'You are offline, so the sign-out never reached the server.'
      : 'The app could not reach the server, so the sign-out did not go through.';

    return this.dialog.choose<FailedSignOutChoice>({
      title: 'You are still signed in',
      message:
        `${lead} Closing a session is something only the server can do, so we have not signed you out.\n\n` +
        'Try again once you are back online. If you have to leave this computer now, choose "Sign out on this ' +
        'device". The app locks you out here straight away and finishes signing you out from the server as soon ' +
        'as this device reconnects. On a shared computer, change your password afterwards to close the session ' +
        'immediately.',
      variant: 'warning',
      choices: [
        { label: 'Try again', value: 'retry', variant: 'info' },
        { label: 'Sign out on this device', value: 'this-device' },
      ],
      cancelText: 'Stay signed in',
      allowBackdropClose: false,
    });
  }

  private signOutOnThisDeviceOnly(): SignOutResult {
    // The refresh cookie is HttpOnly: JavaScript cannot delete it, and the server that can is
    // exactly what we cannot reach. The pending marker set in `requestSignOut` is deliberately
    // left in place, so this browser will not resume the session and the next start retries the
    // revoke.
    this.discardSession();
    this.alerts.showWarn('Signed out on this device. The session stays open on the server until you are back online.');
    return { status: 'signed-out-locally' };
  }

  /**
   * Finish a sign-out that an earlier visit could not complete. Runs in the background at start-up.
   *
   * The in-memory access token is gone on a cold load, so the session has to be re-opened long
   * enough to revoke it. The pending marker is cleared only when the server answers; leaving it
   * set costs nothing, because signing in clears it and there is nothing else it blocks.
   */
  private async completePendingSignOut(): Promise<void> {
    try {
      const token = await silentRefresh(this.tokenService);
      // No token means either the cookie is already dead (nothing left to revoke) or this device
      // is still offline. Both say "try again next start", and neither is worth a message.
      if (!token) return;

      await this.api.auth.signOut.mutate(undefined, {
        context: { skipErrorHandler: true },
        signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS),
      });
      this.tokenService.clearSignOutPending();
    } catch (error) {
      if (!isSignOutTransportFailure(error)) this.tokenService.clearSignOutPending();
    } finally {
      this.user.set(null);
      this.tokenService.clearAll();
    }
  }

  /**
   * Create a workspace.
   *
   * During the closed beta the backend holds new workspaces for approval and deliberately
   * issues no session, so there is nothing to sign in with: `approvalPending` is returned and
   * the caller sends the user to the waitlist screen instead of the dashboard.
   */
  public async signUp(input: signUpInputType): Promise<{ user: IAuthUser | null; approvalPending: boolean }> {
    const result = await this.api.auth.signUp.mutate(input);
    if ((result as { approval_pending?: boolean }).approval_pending) {
      return { user: null, approvalPending: true };
    }
    const user = await this.updateTokensAndGetCurrentUser(result);
    return { user: user as IAuthUser | null, approvalPending: false };
  }

  public verifyEmail(input: { code: string }): Promise<{ success: boolean }> {
    return this.api.auth.verifyEmail.mutate(input) as Promise<{ success: boolean }>;
  }

  public resendVerificationEmail(email: string): Promise<{ success: boolean }> {
    // Callers toast their own success/failure (and handle rate-limit countdowns).
    return (this.api.auth.resendVerificationEmail.mutate as unknown as (input: any, opts: any) => Promise<any>)(
      { email },
      { context: { skipErrorHandler: true } },
    ) as Promise<{ success: boolean }>;
  }

  public checkEmail(email: string): Promise<{ hasPasskeys: boolean }> {
    // The sign-in page silently falls back to the password step if this fails —
    // a global error toast here would be noise.
    return (this.api.auth.checkEmail.query as unknown as (input: any, opts: any) => Promise<any>)(
      { email },
      { context: { skipErrorHandler: true } },
    ) as Promise<{ hasPasskeys: boolean }>;
  }

  public async signInWithPasskey(rememberMe?: boolean): Promise<{ user: IAuthUser | null; cancelled: boolean }> {
    const { options, nonce } = (await this.api.auth.passkeyAuthenticationOptions.query()) as any;
    let response: any;
    try {
      response = await startAuthentication({ optionsJSON: options });
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') return { user: null, cancelled: true };
      throw err;
    }
    const token = await (
      this.api.auth.verifyPasskeyAuthentication.mutate as unknown as (input: any, opts: any) => Promise<any>
    )({ response, nonce, rememberMe }, { context: { skipErrorHandler: true } });
    const user = await this.updateTokensAndGetCurrentUser(token);
    if (user?.tenant_deletion_scheduled_at) {
      void this.router.navigate(['/cancel-deletion']);
    } else if (user?.tenant_paused_at) {
      void this.router.navigate(['/resume-account']);
    }
    return { user, cancelled: false };
  }

  public async registerPasskey(friendlyName?: string): Promise<{ verified: boolean }> {
    const options = await this.api.auth.passkeyRegistrationOptions.query();
    const response = await startRegistration({ optionsJSON: options as any });
    return (await this.api.auth.verifyPasskeyRegistration.mutate({ response: response as any, friendlyName })) as {
      verified: boolean;
    };
  }

  public listPasskeys() {
    return this.api.auth.listPasskeys.query();
  }

  public deletePasskey(id: string) {
    return this.api.auth.deletePasskey.mutate({ id });
  }

  public dismissPasskeyPrompt() {
    return this.api.auth.dismissPasskeyPrompt.mutate();
  }

  public updatePasskeyName(id: string, friendlyName: string) {
    return this.api.auth.updatePasskeyName.mutate({ id, friendlyName });
  }

  /** This user's own signed-in devices. Carries no session id and no refresh token. */
  public listSessions() {
    return this.api.auth.listSessions.query();
  }

  /** End one session by its row id. The server re-checks that it belongs to this user. */
  public revokeSession(id: string) {
    return this.api.auth.revokeSession.mutate({ id });
  }

  /** End every session except this browser's. */
  public revokeOtherSessions() {
    return this.api.auth.revokeOtherSessions.mutate();
  }

  private async updateTokensAndGetCurrentUser(token: { auth_token?: string | null } | TRPCError) {
    if (!token || token instanceof TRPCError) {
      throw token;
    }
    // Only the access token comes back in the body now; the refresh token is set as an HttpOnly
    // cookie by the server (SECURITY-REVIEW 2.1).
    this.tokenService.set(token);
    return this.getCurrentUser();
  }
}

/**
 * True when the sign-out request never got an answer, which is the only case that leaves the
 * refresh cookie (and therefore a usable session) in the browser.
 *
 * The server clears the cookie before it runs the sign-out handler, and the reply carries that
 * header out even when the handler then throws, so any server-authored answer — including an
 * error one — means the cookie is gone. An error that is not a tRPC error at all cannot be shown
 * to have reached the server, so it counts as a failure too.
 */
function isSignOutTransportFailure(error: unknown): boolean {
  if (error instanceof ApiError || error instanceof TRPCClientError) return isServerUnreachable(error);
  return true;
}
