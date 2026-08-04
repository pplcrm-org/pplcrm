import { signal } from '@angular/core';
import { TRPCError } from '@trpc/server';
import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth-service';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

// The real module opens a network connection to mint an access token from the refresh cookie.
// `refreshLink` is only read inside the TRPCService constructor, which these tests never run.
vi.mock('../services/api/trpc-refreshlink', () => ({
  silentRefresh: vi.fn(() => Promise.resolve(null)),
  refreshLink: vi.fn(),
}));

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { silentRefresh } from '../services/api/trpc-refreshlink';

/**
 * A tRPC error that reached the server and came back: it carries a server-authored `data`
 * payload. The sign-out route clears the refresh cookie before the handler runs, so even an
 * error answer means the session in this browser is closed.
 */
function serverAnsweredError(code = 'INTERNAL_SERVER_ERROR'): TRPCClientError<never> {
  const err = new TRPCClientError('boom');
  (err as unknown as { data: unknown }).data = { code, httpStatus: 500 };
  return err;
}

/** A tRPC error that never got an answer: no `data` anywhere in the chain. */
function transportError(): TRPCClientError<never> {
  return new TRPCClientError('Failed to fetch');
}

describe('AuthService', () => {
  let service: AuthService;
  let mockApi: any;
  let mockTokenService: {
    set: ReturnType<typeof vi.fn>;
    clearAll: ReturnType<typeof vi.fn>;
    markSignOutPending: ReturnType<typeof vi.fn>;
    clearSignOutPending: ReturnType<typeof vi.fn>;
    isSignOutPending: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  let mockDialog: { choose: ReturnType<typeof vi.fn> };
  let mockAlerts: { showWarn: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn> };
  /** Backing store for the mocked TokenService pending-sign-out flag. */
  let signOutPending: boolean;

  const mockUser = { id: '1', email: 'a@b.com', role: 'admin' };

  beforeEach(() => {
    mockApi = {
      auth: {
        currentUser: { query: vi.fn() },
        uploadAvatar: { mutate: vi.fn() },
        deleteAvatar: { mutate: vi.fn() },
        cancelEmailChange: { mutate: vi.fn() },
        resetPassword: { mutate: vi.fn() },
        sendPasswordResetEmail: { mutate: vi.fn() },
        signIn: { mutate: vi.fn() },
        verify2FA: { mutate: vi.fn() },
        signOut: { mutate: vi.fn() },
        signUp: { mutate: vi.fn() },
        verifyEmail: { mutate: vi.fn() },
        resendVerificationEmail: { mutate: vi.fn() },
        checkEmail: { query: vi.fn() },
        passkeyAuthenticationOptions: { query: vi.fn() },
        verifyPasskeyAuthentication: { mutate: vi.fn() },
        passkeyRegistrationOptions: { query: vi.fn() },
        verifyPasskeyRegistration: { mutate: vi.fn() },
        listPasskeys: { query: vi.fn() },
        deletePasskey: { mutate: vi.fn() },
        dismissPasskeyPrompt: { mutate: vi.fn() },
        updatePasskeyName: { mutate: vi.fn() },
      },
    };
    signOutPending = false;
    mockTokenService = {
      set: vi.fn(),
      clearAll: vi.fn(),
      markSignOutPending: vi.fn(() => {
        signOutPending = true;
      }),
      clearSignOutPending: vi.fn(() => {
        signOutPending = false;
      }),
      isSignOutPending: vi.fn(() => signOutPending),
    };
    mockRouter = { navigate: vi.fn() };
    mockDialog = { choose: vi.fn() };
    mockAlerts = { showWarn: vi.fn(), showError: vi.fn() };

    // Create a bare instance without invoking Angular inject()s
    service = Object.create(AuthService.prototype) as AuthService;
    (service as any).api = mockApi;
    (service as any).tokenService = mockTokenService;
    (service as any).router = mockRouter;
    (service as any).dialog = mockDialog;
    (service as any).alerts = mockAlerts;
    (service as any).user = signal(null);
    (service as any).signOutInFlight = null;

    vi.clearAllMocks();
    vi.mocked(silentRefresh).mockResolvedValue(null);
  });

  describe('getCurrentUser / getUser / getUserSignal', () => {
    it('stores and returns the user fetched from the api', async () => {
      mockApi.auth.currentUser.query.mockResolvedValue(mockUser);

      const result = await service.getCurrentUser();

      expect(result).toEqual(mockUser);
      expect(service.getUser()).toEqual(mockUser);
      expect(service.getUserSignal()()).toEqual(mockUser);
    });

    it('resolves to null and clears the user if the api call fails', async () => {
      mockApi.auth.currentUser.query.mockRejectedValue(new Error('network error'));

      const result = await service.getCurrentUser();

      expect(result).toBeNull();
      expect(service.getUser()).toBeNull();
    });

    it('init() delegates to getCurrentUser()', async () => {
      mockApi.auth.currentUser.query.mockResolvedValue(mockUser);

      await service.init();

      expect(mockApi.auth.currentUser.query).toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    it('returns requires2FA without updating tokens when the server asks for a second factor', async () => {
      mockApi.auth.signIn.mutate.mockResolvedValue({ requires2FA: true, email: 'a@b.com' });

      const result = await service.signIn({ email: 'a@b.com', password: 'pw' } as any);

      expect(result).toEqual({ requires2FA: true, email: 'a@b.com' });
      expect(mockTokenService.set).not.toHaveBeenCalled();
    });

    it('stores the token and loads the current user on a normal sign-in', async () => {
      mockApi.auth.signIn.mutate.mockResolvedValue({ auth_token: 'a1', refresh_token: 'r1' });
      mockApi.auth.currentUser.query.mockResolvedValue(mockUser);

      const result = await service.signIn({ email: 'a@b.com', password: 'pw' } as any);

      expect(mockTokenService.set).toHaveBeenCalledWith({ auth_token: 'a1', refresh_token: 'r1' });
      expect(result).toEqual({ requires2FA: false, user: mockUser });
    });

    it('redirects to /cancel-deletion when the account is scheduled for deletion', async () => {
      mockApi.auth.signIn.mutate.mockResolvedValue({ auth_token: 'a1', refresh_token: 'r1' });
      mockApi.auth.currentUser.query.mockResolvedValue({ ...mockUser, tenant_deletion_scheduled_at: '2030-01-01' });

      await service.signIn({ email: 'a@b.com', password: 'pw' } as any);

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/cancel-deletion']);
    });

    it('redirects to /resume-account when the tenant is paused', async () => {
      mockApi.auth.signIn.mutate.mockResolvedValue({ auth_token: 'a1', refresh_token: 'r1' });
      mockApi.auth.currentUser.query.mockResolvedValue({ ...mockUser, tenant_paused_at: '2030-01-01' });

      await service.signIn({ email: 'a@b.com', password: 'pw' } as any);

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/resume-account']);
    });
  });

  describe('verify2FA / updateTokensAndGetCurrentUser', () => {
    it('stores the returned token and resolves the current user', async () => {
      mockApi.auth.verify2FA.mutate.mockResolvedValue({ auth_token: 'a1', refresh_token: 'r1' });
      mockApi.auth.currentUser.query.mockResolvedValue(mockUser);

      const result = await service.verify2FA({ email: 'a@b.com', code: '123456' });

      expect(mockTokenService.set).toHaveBeenCalledWith({ auth_token: 'a1', refresh_token: 'r1' });
      expect(result).toEqual(mockUser);
    });

    it('throws when the api resolves a TRPCError', async () => {
      const error = new TRPCError({ code: 'UNAUTHORIZED', message: 'bad code' });
      mockApi.auth.verify2FA.mutate.mockResolvedValue(error);

      await expect(service.verify2FA({ email: 'a@b.com', code: 'bad' })).rejects.toBe(error);
      expect(mockTokenService.set).not.toHaveBeenCalled();
    });

    it('throws when the api resolves a falsy token', async () => {
      mockApi.auth.verify2FA.mutate.mockResolvedValue(null);

      await expect(service.verify2FA({ email: 'a@b.com', code: 'bad' })).rejects.toBeNull();
    });
  });

  describe('signOut', () => {
    it('clears the user, clears tokens, and navigates to /signin when the server answers', async () => {
      mockApi.auth.signOut.mutate.mockResolvedValue({ success: true });
      (service as any).user.set(mockUser);

      const result = await service.signOut();

      expect(result).toEqual({ status: 'signed-out' });
      expect(service.getUser()).toBeNull();
      expect(mockTokenService.clearAll).toHaveBeenCalled();
      expect(mockTokenService.clearSignOutPending).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin']);
      expect(mockDialog.choose).not.toHaveBeenCalled();
    });

    it('marks a sign-out as pending before the request leaves, so a closed tab cannot resume it', async () => {
      let pendingWhenRequestWasMade = false;
      mockApi.auth.signOut.mutate.mockImplementation(() => {
        pendingWhenRequestWasMade = mockTokenService.isSignOutPending();
        return Promise.resolve({ success: true });
      });

      await service.signOut();

      expect(pendingWhenRequestWasMade).toBe(true);
    });

    it('does NOT navigate or clear tokens when the request never reached the server', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(transportError());
      mockDialog.choose.mockResolvedValue(null); // "Stay signed in"
      (service as any).user.set(mockUser);

      const result = await service.signOut();

      expect(result).toEqual({ status: 'still-signed-in' });
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(mockTokenService.clearAll).not.toHaveBeenCalled();
      expect(service.getUser()).toEqual(mockUser);
    });

    it('tells the user the sign-out did not happen instead of failing silently', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(transportError());
      mockDialog.choose.mockResolvedValue(null);

      await service.signOut();

      expect(mockDialog.choose).toHaveBeenCalledTimes(1);
      const opts = mockDialog.choose.mock.calls[0][0];
      expect(opts.title).toBe('You are still signed in');
      expect(opts.choices.map((c: { value: string }) => c.value)).toEqual(['retry', 'this-device']);
    });

    it('leaves the pending marker set when the request never reached the server', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(transportError());
      mockDialog.choose.mockResolvedValue(null);

      await service.signOut();

      expect(mockTokenService.isSignOutPending()).toBe(true);
      expect(mockTokenService.clearSignOutPending).not.toHaveBeenCalled();
    });

    it('retries the request when the user picks "Try again", and completes on success', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValueOnce(transportError()).mockResolvedValueOnce({ success: true });
      mockDialog.choose.mockResolvedValueOnce('retry');

      const result = await service.signOut();

      expect(mockApi.auth.signOut.mutate).toHaveBeenCalledTimes(2);
      expect(mockDialog.choose).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'signed-out' });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin']);
    });

    it('keeps offering the choice while retries keep failing', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(transportError());
      mockDialog.choose.mockResolvedValueOnce('retry').mockResolvedValueOnce(null);

      const result = await service.signOut();

      expect(mockApi.auth.signOut.mutate).toHaveBeenCalledTimes(2);
      expect(mockDialog.choose).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'still-signed-in' });
    });

    it('lets the user leave the device, warns that the session is still open, and keeps the marker', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(transportError());
      mockDialog.choose.mockResolvedValue('this-device');
      (service as any).user.set(mockUser);

      const result = await service.signOut();

      expect(result).toEqual({ status: 'signed-out-locally' });
      expect(service.getUser()).toBeNull();
      expect(mockTokenService.clearAll).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin']);
      expect(mockAlerts.showWarn).toHaveBeenCalled();
      // Only the server can clear the refresh cookie, so the marker has to survive to stop the
      // next cold load resuming the session.
      expect(mockTokenService.isSignOutPending()).toBe(true);
    });

    it('counts a server-authored error as signed out — the reply clears the refresh cookie anyway', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(serverAnsweredError());

      const result = await service.signOut();

      expect(result).toEqual({ status: 'signed-out' });
      expect(mockDialog.choose).not.toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin']);
    });

    it('counts an already-dead session (UNAUTHORIZED) as signed out', async () => {
      mockApi.auth.signOut.mutate.mockRejectedValue(serverAnsweredError('UNAUTHORIZED'));

      const result = await service.signOut();

      expect(result).toEqual({ status: 'signed-out' });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin']);
    });

    it('skips the request entirely when the browser says it is offline', async () => {
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      mockDialog.choose.mockResolvedValue(null);

      const result = await service.signOut();

      expect(mockApi.auth.signOut.mutate).not.toHaveBeenCalled();
      expect(mockDialog.choose).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'still-signed-in' });
      onLine.mockRestore();
    });

    it('joins a sign-out that is already in flight instead of starting a second one', async () => {
      let release: (value: unknown) => void = () => undefined;
      mockApi.auth.signOut.mutate.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const first = service.signOut();
      const second = service.signOut();
      release({ success: true });

      expect(await first).toEqual({ status: 'signed-out' });
      expect(await second).toEqual({ status: 'signed-out' });
      expect(mockApi.auth.signOut.mutate).toHaveBeenCalledTimes(1);
    });

    it('allows a fresh attempt once the previous one has finished', async () => {
      mockApi.auth.signOut.mutate.mockResolvedValue({ success: true });

      await service.signOut();
      await service.signOut();

      expect(mockApi.auth.signOut.mutate).toHaveBeenCalledTimes(2);
    });
  });

  describe('discardSession', () => {
    it('drops local session state and navigates without asking the server', () => {
      (service as any).user.set(mockUser);

      service.discardSession();

      expect(service.getUser()).toBeNull();
      expect(mockTokenService.clearAll).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/signin']);
      expect(mockApi.auth.signOut.mutate).not.toHaveBeenCalled();
    });
  });

  describe('init with an unfinished sign-out', () => {
    it('does not resume the session from the surviving refresh cookie', async () => {
      mockTokenService.markSignOutPending();
      vi.mocked(silentRefresh).mockResolvedValue(null);

      const result = await service.init();

      expect(result).toBeNull();
      expect(mockApi.auth.currentUser.query).not.toHaveBeenCalled();
    });

    it('retries the revoke in the background and clears the marker once the server answers', async () => {
      mockTokenService.markSignOutPending();
      vi.mocked(silentRefresh).mockResolvedValue('fresh-access-token');
      mockApi.auth.signOut.mutate.mockResolvedValue({ success: true });

      await service.init();
      // The retry is deliberately not awaited by init(); let its microtasks drain.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockApi.auth.signOut.mutate).toHaveBeenCalledTimes(1);
      expect(mockTokenService.isSignOutPending()).toBe(false);
      expect(mockTokenService.clearAll).toHaveBeenCalled();
    });

    it('keeps the marker when the background retry still cannot reach the server', async () => {
      mockTokenService.markSignOutPending();
      vi.mocked(silentRefresh).mockResolvedValue('fresh-access-token');
      mockApi.auth.signOut.mutate.mockRejectedValue(transportError());

      await service.init();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockTokenService.isSignOutPending()).toBe(true);
    });
  });

  describe('avatar management', () => {
    it('uploadAvatar strips the data-url prefix before sending, and updates the cached user', async () => {
      (service as any).user.set(mockUser);
      mockApi.auth.uploadAvatar.mutate.mockResolvedValue({ avatar_url: 'https://cdn/avatar.png' });
      const file = new File(['hello'], 'avatar.png', { type: 'image/png' });

      const result = await service.uploadAvatar(file);

      expect(mockApi.auth.uploadAvatar.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: 'image/png', filename: 'avatar.png' }),
      );
      expect(result).toEqual({ avatar_url: 'https://cdn/avatar.png' });
      expect(service.getUser()).toEqual({ ...mockUser, avatar_url: 'https://cdn/avatar.png' });
    });

    it('deleteAvatar clears the cached avatar_url', async () => {
      (service as any).user.set({ ...mockUser, avatar_url: 'https://cdn/avatar.png' });
      mockApi.auth.deleteAvatar.mutate.mockResolvedValue({ success: true });

      const result = await service.deleteAvatar();

      expect(result).toEqual({ success: true });
      expect(service.getUser()).toEqual({ ...mockUser, avatar_url: null });
    });
  });

  describe('email/password flows', () => {
    it('cancelEmailChange refreshes the current user after the mutation', async () => {
      mockApi.auth.cancelEmailChange.mutate.mockResolvedValue({ success: true });
      mockApi.auth.currentUser.query.mockResolvedValue(mockUser);

      const result = await service.cancelEmailChange();

      expect(result).toEqual({ success: true });
      expect(mockApi.auth.currentUser.query).toHaveBeenCalled();
    });

    it('resetPassword forwards the code and password, opting out of the global error handler', async () => {
      mockApi.auth.resetPassword.mutate.mockResolvedValue({ success: true });

      await service.resetPassword({ code: 'abc', password: 'newpw' });

      expect(mockApi.auth.resetPassword.mutate).toHaveBeenCalledWith(
        { code: 'abc', password: 'newpw' },
        { context: { skipErrorHandler: true } },
      );
    });

    it('sendPasswordResetEmail forwards the email, opting out of the global error handler', async () => {
      mockApi.auth.sendPasswordResetEmail.mutate.mockResolvedValue({ success: true });

      await service.sendPasswordResetEmail({ email: 'a@b.com' });

      expect(mockApi.auth.sendPasswordResetEmail.mutate).toHaveBeenCalledWith(
        { email: 'a@b.com' },
        { context: { skipErrorHandler: true } },
      );
    });

    it('verifyEmail forwards the code', async () => {
      mockApi.auth.verifyEmail.mutate.mockResolvedValue({ success: true });

      const result = await service.verifyEmail({ code: '123' });

      expect(mockApi.auth.verifyEmail.mutate).toHaveBeenCalledWith({ code: '123' });
      expect(result).toEqual({ success: true });
    });

    it('resendVerificationEmail forwards the email, opting out of the global error handler', async () => {
      mockApi.auth.resendVerificationEmail.mutate.mockResolvedValue({ success: true });

      await service.resendVerificationEmail('a@b.com');

      expect(mockApi.auth.resendVerificationEmail.mutate).toHaveBeenCalledWith(
        { email: 'a@b.com' },
        { context: { skipErrorHandler: true } },
      );
    });

    it('checkEmail queries passkey availability for the given email, opting out of the global error handler', async () => {
      mockApi.auth.checkEmail.query.mockResolvedValue({ hasPasskeys: true });

      const result = await service.checkEmail('a@b.com');

      expect(mockApi.auth.checkEmail.query).toHaveBeenCalledWith(
        { email: 'a@b.com' },
        { context: { skipErrorHandler: true } },
      );
      expect(result).toEqual({ hasPasskeys: true });
    });
  });

  describe('passkeys', () => {
    it('signInWithPasskey resolves the user on success', async () => {
      mockApi.auth.passkeyAuthenticationOptions.query.mockResolvedValue({ options: {}, nonce: 'nonce-1' });
      vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred-1' } as any);
      mockApi.auth.verifyPasskeyAuthentication.mutate.mockResolvedValue({ auth_token: 'a1', refresh_token: 'r1' });
      mockApi.auth.currentUser.query.mockResolvedValue(mockUser);

      const result = await service.signInWithPasskey(true);

      expect(result).toEqual({ user: mockUser, cancelled: false });
    });

    it('signInWithPasskey reports cancellation when the browser prompt is dismissed', async () => {
      mockApi.auth.passkeyAuthenticationOptions.query.mockResolvedValue({ options: {}, nonce: 'nonce-1' });
      const notAllowed = new DOMException('cancelled', 'NotAllowedError');
      vi.mocked(startAuthentication).mockRejectedValue(notAllowed);

      const result = await service.signInWithPasskey();

      expect(result).toEqual({ user: null, cancelled: true });
      expect(mockApi.auth.verifyPasskeyAuthentication.mutate).not.toHaveBeenCalled();
    });

    it('signInWithPasskey rethrows unexpected errors from the browser prompt', async () => {
      mockApi.auth.passkeyAuthenticationOptions.query.mockResolvedValue({ options: {}, nonce: 'nonce-1' });
      const unexpected = new Error('boom');
      vi.mocked(startAuthentication).mockRejectedValue(unexpected);

      await expect(service.signInWithPasskey()).rejects.toBe(unexpected);
    });

    it('registerPasskey completes the registration ceremony', async () => {
      mockApi.auth.passkeyRegistrationOptions.query.mockResolvedValue({ challenge: 'c1' });
      vi.mocked(startRegistration).mockResolvedValue({ id: 'cred-1' } as any);
      mockApi.auth.verifyPasskeyRegistration.mutate.mockResolvedValue({ verified: true });

      const result = await service.registerPasskey('My phone');

      expect(mockApi.auth.verifyPasskeyRegistration.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ friendlyName: 'My phone' }),
      );
      expect(result).toEqual({ verified: true });
    });

    it('listPasskeys / deletePasskey / dismissPasskeyPrompt / updatePasskeyName delegate to the api', async () => {
      mockApi.auth.listPasskeys.query.mockResolvedValue([]);
      mockApi.auth.deletePasskey.mutate.mockResolvedValue({ success: true });
      mockApi.auth.dismissPasskeyPrompt.mutate.mockResolvedValue({ success: true });
      mockApi.auth.updatePasskeyName.mutate.mockResolvedValue({ success: true });

      await service.listPasskeys();
      await service.deletePasskey('cred-1');
      await service.dismissPasskeyPrompt();
      await service.updatePasskeyName('cred-1', 'New name');

      expect(mockApi.auth.listPasskeys.query).toHaveBeenCalled();
      expect(mockApi.auth.deletePasskey.mutate).toHaveBeenCalledWith({ id: 'cred-1' });
      expect(mockApi.auth.dismissPasskeyPrompt.mutate).toHaveBeenCalled();
      expect(mockApi.auth.updatePasskeyName.mutate).toHaveBeenCalledWith({ id: 'cred-1', friendlyName: 'New name' });
    });

    it('listSessions / revokeSession / revokeOtherSessions delegate to the api', async () => {
      mockApi.auth.listSessions = { query: vi.fn().mockResolvedValue([]) };
      mockApi.auth.revokeSession = { mutate: vi.fn().mockResolvedValue({ success: true, was_current: false }) };
      mockApi.auth.revokeOtherSessions = { mutate: vi.fn().mockResolvedValue({ revoked: 2 }) };

      await service.listSessions();
      await service.revokeSession('42');
      await service.revokeOtherSessions();

      expect(mockApi.auth.listSessions.query).toHaveBeenCalled();
      expect(mockApi.auth.revokeSession.mutate).toHaveBeenCalledWith({ id: '42' });
      expect(mockApi.auth.revokeOtherSessions.mutate).toHaveBeenCalled();
    });
  });
});
