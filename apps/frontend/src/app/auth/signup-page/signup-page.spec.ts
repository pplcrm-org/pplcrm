import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SignUpPage } from './signup-page';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SignUpPage', () => {
  let component: SignUpPage;
  let fixture: ComponentFixture<SignUpPage>;

  let mockAuthSvc: any;
  let mockAlertSvc: any;

  beforeEach(async () => {
    mockAuthSvc = {
      signUp: vi.fn().mockResolvedValue({ user: { first_name: 'John' }, approvalPending: false }),
    };

    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      alertList: vi.fn().mockReturnValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [SignUpPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: AlertService, useValue: mockAlertSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SignUpPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have initial invalid form state', () => {
    expect(component.form().invalid()).toBe(true);
  });

  it('should block join and show alert if form is invalid', async () => {
    await component.join();
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please enter all information before continuing.');
    expect(mockAuthSvc.signUp).not.toHaveBeenCalled();
  });

  // The org type seeds starter tags, forms and the demo dataset inside the signup transaction,
  // so it has to be answered before the transaction runs — there is no fixing it afterwards.
  it('should block join when every other field is filled but no org type was chosen', async () => {
    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: null,
    });
    fixture.detectChanges();

    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please choose what kind of organization this is.');
    expect(mockAuthSvc.signUp).not.toHaveBeenCalled();
    expect(component['submitAttempted']()).toBe(true);
  });

  it('should submit form and redirect to signin with verificationPending when valid', async () => {
    mockAuthSvc.signUp.mockResolvedValue({
      user: { first_name: 'John', email: 'test@example.com' },
      approvalPending: false,
    });

    const mockRouter = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);

    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: 'campaign',
    });

    fixture.detectChanges();
    expect(component.form().valid()).toBe(true);

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: 'campaign',
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { verificationPending: 'true', email: 'test@example.com' },
    });
  });

  it('should show error if signup returns no user', async () => {
    mockAuthSvc.signUp.mockResolvedValue({ user: null, approvalPending: false });

    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: '',
      terms: '',
      mode: 'campaign',
    });

    fixture.detectChanges();
    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Unable to complete signup.');
  });

  it('should show error if signup throws exception', async () => {
    const errorMsg = 'Email already exists';
    mockAuthSvc.signUp.mockRejectedValue(new Error(errorMsg));

    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: '',
      terms: '',
      mode: 'campaign',
    });

    fixture.detectChanges();
    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(errorMsg);
  });

  it('should redirect to signin with verificationPending on successful sign up', async () => {
    mockAuthSvc.signUp.mockResolvedValue({
      user: { first_name: 'John', email: 'test@example.com' },
      approvalPending: false,
    });

    const mockRouter = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);

    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: 'campaign',
    });

    fixture.detectChanges();
    await component.join();

    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { verificationPending: 'true', email: 'test@example.com' },
    });
  });

  // Closed beta: signup succeeds but issues no session, so the page must route to the waitlist
  // panel rather than treat "no user" as a failure.
  it('should redirect to signin with approvalPending when the workspace awaits beta approval', async () => {
    mockAuthSvc.signUp.mockResolvedValue({ user: null, approvalPending: true });

    const mockRouter = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);

    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: 'campaign',
    });

    fixture.detectChanges();
    await component.join();

    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { approvalPending: 'true', email: 'test@example.com' },
    });
    expect(mockAlertSvc.showError).not.toHaveBeenCalled();
  });

  it('should call join only once on form submit via button click', async () => {
    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: 'campaign',
    });
    fixture.detectChanges();

    const joinSpy = vi.spyOn(component, 'join');
    const buttonEl = fixture.nativeElement.querySelector('button[type="submit"]');
    buttonEl.click();
    fixture.detectChanges();

    expect(joinSpy).toHaveBeenCalledTimes(1);
  });
});
