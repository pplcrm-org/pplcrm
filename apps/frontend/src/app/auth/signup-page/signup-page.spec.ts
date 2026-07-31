import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SignUpPage } from './signup-page';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A change event carrying a real `<select>`, because `onRegionChange` narrows with
 * `instanceof HTMLSelectElement` before reading the value.
 *
 * The option has to be appended: setting `.value` on a `<select>` with no children silently
 * leaves it empty, so a stubbed element would make every one of these assertions pass by
 * accident — including the one that is meant to prove an unknown region is rejected.
 */
function changeEventFromSelect(value: string): Event {
  const select = document.createElement('select');
  const option = document.createElement('option');
  option.value = value;
  select.appendChild(option);
  select.value = value;

  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: select });
  return event;
}

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
      data_region: 'any',
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
      data_region: 'any',
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
      data_region: 'any',
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
      data_region: 'any',
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
      data_region: 'any',
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
      data_region: 'any',
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
      data_region: 'any',
    });

    fixture.detectChanges();
    await component.join();

    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { approvalPending: 'true', email: 'test@example.com' },
    });
    expect(mockAlertSvc.showError).not.toHaveBeenCalled();
  });

  // Residency is decided when the workspace is provisioned, so it has to leave the form with
  // the rest of the signup payload rather than being set afterwards.
  it('should send the chosen data region to signUp', async () => {
    mockAuthSvc.signUp.mockResolvedValue({
      user: { first_name: 'John', email: 'test@example.com' },
      approvalPending: false,
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);

    component['signUpData'].set({
      organization: 'Acme Corp',
      email: 'test@example.com',
      password: 'validPassword123',
      first_name: 'John',
      middle_names: '',
      last_name: 'Doe',
      terms: 'true',
      mode: 'campaign',
      data_region: 'eu',
    });
    fixture.detectChanges();

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(expect.objectContaining({ data_region: 'eu' }));
  });

  // Unlike the org type, residency starts answered — with "no preference", which is free and
  // true. Defaulting to a region would present a paid choice as already made, and would warn
  // every user who never touched the picker.
  it('should default to no region preference and show no notice', () => {
    expect(component['signUpData']().data_region).toBe('any');
    expect(component['regionPreferenceStated']()).toBe(false);
    expect(component['regionNotLiveYet']()).toBe(false);
    expect(component['chosenRegionLabel']()).toBe('Does not matter');
  });

  // Naming any region at all is the part that needs the paid plan, so Canada — which is where
  // the data goes regardless — must still raise the plan notice.
  it('should flag the plan requirement for every named region, including the one we run in', () => {
    component['onRegionChange'](changeEventFromSelect('ca'));

    expect(component['regionPreferenceStated']()).toBe(true);
    expect(component['regionNotLiveYet']()).toBe(false);
    expect(component['residencyMinPlanName']).toBe('Movement');
  });

  // The form must not imply a residency the infrastructure cannot deliver. Picking a region
  // with no hosting yet has to raise both notices, not pass silently.
  it('should flag a chosen region that has no hosting yet', () => {
    component['onRegionChange'](changeEventFromSelect('us'));

    expect(component['signUpData']().data_region).toBe('us');
    expect(component['regionPreferenceStated']()).toBe(true);
    expect(component['regionNotLiveYet']()).toBe(true);
    expect(component['chosenRegionLabel']()).toBe('United States');
    // What the notice promises: the data actually goes to the region we run in.
    expect(component['actualRegionLabel']()).toBe('Canada');
  });

  it('should describe the choice under the picker', () => {
    expect(component['chosenRegionDescription']()).toContain('Canada');

    component['onRegionChange'](changeEventFromSelect('eu'));

    expect(component['chosenRegionDescription']()).toContain('European Union');
  });

  // The plan notice names the plan; a wrong or missing name would be a false statement about
  // what the user has to buy.
  it('should render the plan requirement and the availability note together', () => {
    component['onRegionChange'](changeEventFromSelect('eu'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Movement');
    expect(text).toContain('European Union hosting is also not open yet');
  });

  it('should show no residency notice at all while no region is named', () => {
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Movement');
  });

  it('should ignore an unrecognised region rather than storing it', () => {
    component['onRegionChange'](changeEventFromSelect('uk'));

    expect(component['signUpData']().data_region).toBe('any');
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
      data_region: 'any',
    });
    fixture.detectChanges();

    const joinSpy = vi.spyOn(component, 'join');
    const buttonEl = fixture.nativeElement.querySelector('button[type="submit"]');
    buttonEl.click();
    fixture.detectChanges();

    expect(joinSpy).toHaveBeenCalledTimes(1);
  });
});
