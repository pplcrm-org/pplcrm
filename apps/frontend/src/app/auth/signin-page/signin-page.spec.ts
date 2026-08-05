import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SignInPage } from './signin-page';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { TokenService } from '../../services/api/token-service';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';

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
});
