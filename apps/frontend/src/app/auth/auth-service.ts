import { signal, Service } from '@angular/core';
import { IAuthUser, signInInputType, signUpInputType } from '../../../../../libs/common/src';
import { TRPCService } from '../services/api/trpc-service';
import { silentRefresh } from '../services/api/trpc-refreshlink';
import { TRPCError } from '@trpc/server';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

@Service()
export class AuthService extends TRPCService<'authusers'> {
  private user = signal<IAuthUser | null>(null);

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

  public async init() {
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

  public async signOut() {
    let apiReturn = null;
    try {
      apiReturn = await this.api.auth.signOut.mutate();
    } catch (error) {
      console.error('Error during sign out:', error);
    }

    this.user.set(null);
    this.tokenService.clearAll();
    void this.router.navigate(['/signin']);

    return apiReturn;
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
