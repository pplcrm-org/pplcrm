import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SignInPage } from './signin-page';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { TokenService } from '../../services/api/token-service';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TRPCClientError } from '@trpc/client';
import { SERVER_UNREACHABLE_MESSAGE } from '../../services/api/user-message';

describe('SignInPage', () => {
  let component: SignInPage;
  let fixture: ComponentFixture<SignInPage>;

  let mockAuthSvc: any;
  let mockAlertSvc: any;
  let mockTokenSvc: any;
  let mockRouter: any;

  beforeEach(async () => {
    mockAuthSvc = {
      getUserSignal: vi.fn().mockReturnValue(signal(null)),
      checkEmail: vi.fn().mockResolvedValue({ hasPasskeys: false }),
      signIn: vi.fn().mockResolvedValue({ requires2FA: false, user: null }),
      signInWithPasskey: vi.fn().mockResolvedValue({ cancelled: true }),
      verify2FA: vi.fn().mockResolvedValue(undefined),
      listPasskeys: vi.fn().mockResolvedValue([{ id: 'pk1' }]),
      registerPasskey: vi.fn().mockResolvedValue({ verified: true }),
      resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
      // Passkey-setup prompt already dismissed by default, so signIn tests that don't care
      // about the prompt never wander into the passkey-setup step.
      getUser: vi.fn().mockReturnValue({ id: '123', passkey_setup_dismissed_at: '2026-01-01T00:00:00Z' }),
      dismissPasskeyPrompt: vi.fn().mockResolvedValue(undefined),
    };

    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      alertList: vi.fn().mockReturnValue([]),
    };

    mockTokenSvc = {
      getPersistence: vi.fn().mockReturnValue(true),
      setPersistence: vi.fn(),
      clearAll: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: TokenService, useValue: mockTokenSvc },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    }).compileComponents();

    mockRouter = TestBed.inject(Router);
    vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);

    fixture = TestBed.createComponent(SignInPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should redirect to summary if user is already logged in and verified', () => {
    mockAuthSvc.getUserSignal.mockReturnValue(signal({ id: '123', email_verified: true }));

    const fixture2 = TestBed.createComponent(SignInPage);
    fixture2.detectChanges();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['dashboard']);
  });

  it('should NOT redirect a signed-in user whose email is not verified — avoids the authGuard redirect loop', () => {
    // Regression guard (REVIEW5 T1-5): navigating an unverified user to /dashboard bounces off
    // authGuard (which sends unverified users back to /signin) into an infinite redirect loop
    // that hangs the page.
    mockAuthSvc.getUserSignal.mockReturnValue(signal({ id: '123', email_verified: false }));

    const fixture2 = TestBed.createComponent(SignInPage);
    fixture2.detectChanges();

    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should toggle token persistence', () => {
    const mockEvent = { checked: false } as any;
    component.togglePersistence(mockEvent);
    expect(mockTokenSvc.setPersistence).toHaveBeenCalledWith(false);
  });

  it('should block sign in and show alert if password is empty', async () => {
    component['emailData'].update((e) => ({ ...e, email: 'test@example.com' }));

    await component.signIn();

    expect(mockTokenSvc.clearAll).toHaveBeenCalled();
    expect(component.passwordForm().invalid()).toBe(true);
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please enter your password.');
    expect(mockAuthSvc.signIn).not.toHaveBeenCalled();
  });

  it('should block sign in and show alert if password is too short', async () => {
    component['emailData'].update((e) => ({ ...e, email: 'test@example.com' }));
    component.password.value.set('short');

    await component.signIn();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Password must be at least 8 characters.');
    expect(mockAuthSvc.signIn).not.toHaveBeenCalled();
  });

  it('should block continueWithEmail and show alert if email is empty', async () => {
    await component.continueWithEmail();

    expect(component.emailForm().invalid()).toBe(true);
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Email is required.');
    expect(mockAuthSvc.checkEmail).not.toHaveBeenCalled();
  });

  it('should block continueWithEmail and show alert if email is invalid format', async () => {
    component.emailField.value.set('invalid-email');

    await component.continueWithEmail();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please enter a valid email address.');
    expect(mockAuthSvc.checkEmail).not.toHaveBeenCalled();
  });

  it('should normalize email before signing in', async () => {
    component['emailData'].update((e) => ({ ...e, email: ' Test@Example.com ' }));
    component.password.value.set('validPassword123');

    await component.signIn();

    expect(mockAuthSvc.signIn).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'validPassword123',
      rememberMe: true,
    });
  });

  it('should handle sign in errors gracefully', async () => {
    const errorMsg = 'Invalid credentials';
    mockAuthSvc.signIn.mockRejectedValue(new Error(errorMsg));

    component['emailData'].update((e) => ({ ...e, email: 'test@example.com' }));
    component.password.value.set('validPassword123');

    await component.signIn();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(errorMsg);
  });

  it('should switch to 2FA step when signIn requires 2FA', async () => {
    mockAuthSvc.signIn.mockResolvedValue({ requires2FA: true, email: 'test@example.com' });

    component['emailData'].update((e) => ({ ...e, email: 'test@example.com' }));
    component.password.value.set('validPassword123');

    await component.signIn();

    expect(component['step']()).toBe('2fa');
    expect(component.emailFor2FA()).toBe('test@example.com');
  });

  it('should verify 2FA successfully', async () => {
    component['step'].set('2fa');
    component['emailFor2FA'].set('test@example.com');
    component.code.value.set('123456');

    await component.verify2FA();

    expect(mockAuthSvc.verify2FA).toHaveBeenCalledWith({
      email: 'test@example.com',
      code: '123456',
      rememberMe: true,
    });
  });

  it('should block 2FA verification if code is invalid pattern', async () => {
    component['step'].set('2fa');
    component['emailFor2FA'].set('test@example.com');
    component.code.value.set('abc');

    await component.verify2FA();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Verification code must be exactly 6 digits.');
    expect(mockAuthSvc.verify2FA).not.toHaveBeenCalled();
  });

  it('should go back to email step when canceling 2FA', () => {
    component['step'].set('2fa');
    component['emailFor2FA'].set('test@example.com');
    component.code.value.set('123456');

    component.goBackToEmail();

    expect(component['step']()).toBe('email');
    expect(component.code.value()).toBe('');
  });

  describe('passkey step', () => {
    it('enters the passkey step when the email has passkeys, and a cancelled passkey falls back to password', async () => {
      mockAuthSvc.checkEmail.mockResolvedValue({ hasPasskeys: true });
      // Capture the step at the moment the passkey ceremony starts — continueWithEmail
      // sets it and immediately awaits the (mocked) ceremony.
      let stepWhenPasskeyCalled: string | null = null;
      mockAuthSvc.signInWithPasskey.mockImplementation((): Promise<any> => {
        stepWhenPasskeyCalled = component['step']();
        return Promise.resolve({ cancelled: true });
      });
      component.emailField.value.set('test@example.com');

      await component.continueWithEmail();

      expect(mockAuthSvc.checkEmail).toHaveBeenCalledWith('test@example.com');
      expect(stepWhenPasskeyCalled).toBe('passkey');
      expect(mockAuthSvc.signInWithPasskey).toHaveBeenCalledWith(true); // persistence flag
      // Cancelling the browser prompt lands on the password step, not a dead end.
      expect(component['step']()).toBe('password');
    });

    it('renders the passkey step with its password fallback', () => {
      component['step'].set('passkey');
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('Sign in with passkey');
      expect(text).toContain('Use password instead');
    });

    it('"Use password instead" falls back to the password step', () => {
      component['step'].set('passkey');
      fixture.detectChanges();

      const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
      const fallback = buttons.find((b) => (b.textContent ?? '').includes('Use password instead'));
      if (!fallback) throw new Error('No "Use password instead" button rendered');
      fallback.click();
      fixture.detectChanges();

      expect(component['step']()).toBe('password');
    });

    it('a successful passkey authentication proceeds like a sign-in (navigates once the user lands)', async () => {
      // The shared beforeEach fixture would also see the re-mocked user signal on a
      // scheduler tick and navigate on its own — remove it so the call is attributable.
      fixture.destroy();
      const userSig = signal<any>(null);
      mockAuthSvc.getUserSignal.mockReturnValue(userSig);
      mockAuthSvc.signInWithPasskey.mockImplementation((): Promise<any> => {
        // The real auth service sets the user signal as part of the passkey sign-in.
        userSig.set({ id: 'u1', email_verified: true });
        return Promise.resolve({ cancelled: false, user: { id: 'u1' } });
      });

      const fixture2 = TestBed.createComponent(SignInPage);
      const component2 = fixture2.componentInstance;
      component2['step'].set('passkey');

      await component2.signInWithPasskey();
      fixture2.detectChanges();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['dashboard']);
      expect(mockAlertSvc.showError).not.toHaveBeenCalled();
    });

    it('a browser-level cancel (NotAllowedError) falls back to password without an error toast', async () => {
      const err = new Error('The operation either timed out or was not allowed.');
      err.name = 'NotAllowedError';
      mockAuthSvc.signInWithPasskey.mockRejectedValue(err);
      component['step'].set('passkey');

      await component.signInWithPasskey();

      expect(component['step']()).toBe('password');
      expect(mockAlertSvc.showError).not.toHaveBeenCalled();
    });

    it('a passkey that authenticates but returns no user surfaces the error and stays usable', async () => {
      mockAuthSvc.signInWithPasskey.mockResolvedValue({ cancelled: false, user: null });
      component['step'].set('passkey');

      await component.signInWithPasskey();

      expect(mockAlertSvc.showError).toHaveBeenCalledWith('Passkey authentication failed. Please try again.');
      // Still on the passkey step, where "Use password instead" remains available.
      expect(component['step']()).toBe('passkey');
    });

    it('a checkEmail transport failure keeps the user on the email step and says the server is unreachable', async () => {
      // A TRPCClientError with no server-authored data payload is exactly what a
      // fetch-level failure produces — see isServerUnreachable in user-message.ts.
      mockAuthSvc.checkEmail.mockRejectedValue(new TRPCClientError('Failed to fetch'));
      component.emailField.value.set('test@example.com');

      await component.continueWithEmail();

      expect(mockAlertSvc.showError).toHaveBeenCalledWith(SERVER_UNREACHABLE_MESSAGE);
      expect(component['step']()).toBe('email');
      expect(mockAuthSvc.signInWithPasskey).not.toHaveBeenCalled();
    });

    it('any other checkEmail failure falls through to the password step', async () => {
      mockAuthSvc.checkEmail.mockRejectedValue(new Error('boom'));
      component.emailField.value.set('test@example.com');

      await component.continueWithEmail();

      expect(component['step']()).toBe('password');
      expect(mockAlertSvc.showError).not.toHaveBeenCalled();
    });
  });

  describe('passkey-setup step', () => {
    it('offers passkey setup after a password sign-in when the user has none and never dismissed the prompt', async () => {
      mockAuthSvc.getUser.mockReturnValue({ id: 'u1', passkey_setup_dismissed_at: null });
      mockAuthSvc.listPasskeys.mockResolvedValue([]);
      mockAuthSvc.signIn.mockResolvedValue({ requires2FA: false });
      component['emailData'].update((e) => ({ ...e, email: 'test@example.com' }));
      component.password.value.set('validPassword123');

      await component.signIn();

      expect(component['step']()).toBe('passkey-setup');
    });

    it('skips the prompt when the user already has a passkey', async () => {
      mockAuthSvc.getUser.mockReturnValue({ id: 'u1', passkey_setup_dismissed_at: null });
      mockAuthSvc.listPasskeys.mockResolvedValue([{ id: 'pk1' }]);
      mockAuthSvc.signIn.mockResolvedValue({ requires2FA: false });
      component['emailData'].update((e) => ({ ...e, email: 'test@example.com' }));
      component.password.value.set('validPassword123');

      await component.signIn();

      expect(component['step']()).not.toBe('passkey-setup');
    });

    it('setting up the passkey registers it and confirms', async () => {
      mockAuthSvc.registerPasskey.mockResolvedValue({ verified: true });

      await component.setupPasskey();

      expect(mockAuthSvc.registerPasskey).toHaveBeenCalled();
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Passkey set up successfully!');
    });

    it('skipping the prompt dismisses it and releases navigation into the app', async () => {
      // Same as above: the shared fixture's own navigation effect must not muddy the pin.
      fixture.destroy();
      const userSig = signal<any>(null);
      mockAuthSvc.getUserSignal.mockReturnValue(userSig);
      mockAuthSvc.getUser.mockReturnValue({ id: 'u1', passkey_setup_dismissed_at: null });
      mockAuthSvc.listPasskeys.mockResolvedValue([]);
      mockAuthSvc.signIn.mockImplementation((): Promise<any> => {
        // The real service lands the signed-in user before signIn resolves.
        userSig.set({ id: 'u1', email_verified: true });
        return Promise.resolve({ requires2FA: false });
      });

      const fixture2 = TestBed.createComponent(SignInPage);
      const component2 = fixture2.componentInstance;
      component2['emailData'].update((e: any) => ({ ...e, email: 'test@example.com' }));
      component2.password.value.set('validPassword123');

      await component2.signIn();
      fixture2.detectChanges();

      // On the setup prompt, navigation is suppressed even though the user is signed in.
      expect(component2['step']()).toBe('passkey-setup');
      expect(mockRouter.navigate).not.toHaveBeenCalled();

      await component2.skipPasskeySetup();
      fixture2.detectChanges();

      expect(mockAuthSvc.dismissPasskeyPrompt).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['dashboard']);
    });
  });
});
