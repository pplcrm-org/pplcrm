import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SignUpPage } from './signup-page';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A change event carrying a real `<select>`, because every picker on this page narrows with
 * `instanceof HTMLSelectElement` before reading the value.
 *
 * The option has to be appended: setting `.value` on a `<select>` with no children silently
 * leaves it empty, so a stubbed element would make every one of these assertions pass by
 * accident — including the ones that are meant to prove an unknown value is rejected.
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

/** A complete, valid step 1. Everything after step 1 is optional by design. */
const VALID_ACCOUNT = {
  organization: 'Acme Corp',
  email: 'test@example.com',
  password: 'validPassword123',
  first_name: 'John',
  middle_names: '',
  last_name: 'Doe',
  terms: 'true',
  mode: null,
  data_region: 'any',
} as const;

describe('SignUpPage', () => {
  let component: SignUpPage;
  let fixture: ComponentFixture<SignUpPage>;

  let mockAuthSvc: any;
  let mockAlertSvc: any;

  /** Fill step 1 the way a user would have to before any later step is reachable. */
  function fillAccount(overrides: Record<string, unknown> = {}): void {
    component['signUpData'].set({ ...VALID_ACCOUNT, ...overrides });
    fixture.detectChanges();
  }

  /** Walk to the last step with a chosen organization type, as a user clicking Continue would. */
  function walkToLastStep(mode = 'campaign'): void {
    fillAccount();
    component['next']();
    component['onModeChange'](changeEventFromSelect(mode));
    component['next']();
    fixture.detectChanges();
  }

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

  it('should start on the first step', () => {
    expect(component['step']()).toBe(1);
  });

  // ============================ STEP 1 — the only blocking step ============================

  it('should refuse to leave step 1 while the account fields are incomplete', () => {
    component['next']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please enter all information before continuing.');
    expect(component['step']()).toBe(1);
    expect(mockAuthSvc.signUp).not.toHaveBeenCalled();
  });

  it('should move to step 2 once the account fields are filled', () => {
    fillAccount();

    component['next']();

    expect(component['step']()).toBe(2);
    expect(mockAlertSvc.showError).not.toHaveBeenCalled();
  });

  // Reaching the submit with step 1 incomplete means the step rail was used to jump back, so
  // the user is sent to the step that actually needs work rather than shown a dead end.
  it('should block join and return to step 1 when the account fields are incomplete', async () => {
    component['step'].set(3);

    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please enter all information before continuing.');
    expect(component['step']()).toBe(1);
    expect(mockAuthSvc.signUp).not.toHaveBeenCalled();
  });

  // ======================= STEP 2 — what you organize, and the race =======================

  // The org type seeds starter tags, forms and the demo dataset inside the signup transaction,
  // so it has to be answered before the transaction runs. It is still not a wall: the step says
  // so and offers a skip, which leaves the server's own default to apply.
  it('should ask for the organization type before continuing, and name the skip', () => {
    fillAccount();
    component['next']();

    component['next']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(
      'Please choose what kind of organization this is, or skip this step.',
    );
    expect(component['step']()).toBe(2);
    expect(component['submitAttempted']()).toBe(true);
  });

  it('should let the organization step be skipped without answering anything', () => {
    fillAccount();
    component['next']();

    component['skipOrganizationStep']();

    expect(component['step']()).toBe(3);
    expect(component['signUpData']().mode).toBeNull();
    expect(component['jurisdiction']()).toBeNull();
  });

  it('should ask a church no electoral questions at all', () => {
    fillAccount();
    component['next']();

    component['onModeChange'](changeEventFromSelect('church'));

    expect(component['isElectoral']()).toBe(false);
  });

  it('should ask a campaign about the office it is contesting', () => {
    fillAccount();
    component['next']();

    component['onModeChange'](changeEventFromSelect('campaign'));

    expect(component['isElectoral']()).toBe(true);
  });

  it('should render no electoral question on screen for a church', () => {
    fillAccount();
    component['next']();
    component['onModeChange'](changeEventFromSelect('church'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('What you organize');
    expect(text).not.toContain('Which country?');
  });

  it('should render the country question on screen for a campaign', () => {
    fillAccount();
    component['next']();
    component['onModeChange'](changeEventFromSelect('campaign'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Which country?');
    // Nothing below it until the country is answered.
    expect(text).not.toContain('Which level of government?');
  });

  it('should reveal the level of government only after a country is chosen', () => {
    fillAccount();
    component['next']();
    component['onModeChange'](changeEventFromSelect('campaign'));
    component['onCountryChange'](changeEventFromSelect('CA'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Which level of government?');
    expect(text).toContain('Canada — federal');
  });

  it('should offer only the levels of government that exist in the chosen country', () => {
    component['onCountryChange'](changeEventFromSelect('CA'));
    expect(component['levels']()).toEqual(['ca_federal', 'ca_provincial', 'ca_municipal']);

    component['onCountryChange'](changeEventFromSelect('US'));
    expect(component['levels']()).toEqual(['us_federal', 'us_state', 'us_local']);
  });

  // "Somewhere else" is a real answer covering school boards, band councils and countries we do
  // not model, so it resolves straight to a jurisdiction rather than leaving the question open.
  it('should treat "somewhere else" as the other jurisdiction with no level to pick', () => {
    component['onCountryChange'](changeEventFromSelect('other'));

    expect(component['jurisdiction']()).toBe('other');
    expect(component['levels']()).toEqual([]);
  });

  // Only a US state legislature has two elected chambers drawn on two different maps.
  it('should ask which chamber only for a US state race', () => {
    component['onCountryChange'](changeEventFromSelect('US'));

    component['onLevelChange'](changeEventFromSelect('us_federal'));
    expect(component['showChamber']()).toBe(false);

    component['onLevelChange'](changeEventFromSelect('us_state'));
    expect(component['showChamber']()).toBe(true);
  });

  // Every seat in the House of Commons is contested in a riding, so offering at-large there
  // would be offering an answer that cannot be true.
  it('should offer at-large only where that jurisdiction has such seats', () => {
    component['onCountryChange'](changeEventFromSelect('CA'));
    component['onLevelChange'](changeEventFromSelect('ca_federal'));
    expect(component['showAtLarge']()).toBe(false);

    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_federal'));
    expect(component['showAtLarge']()).toBe(true);
  });

  it('should name the seat with the word the chosen region actually uses', () => {
    component['onCountryChange'](changeEventFromSelect('CA'));
    component['onLevelChange'](changeEventFromSelect('ca_provincial'));

    component['onOfficeRegionChange'](changeEventFromSelect('ON'));
    expect(component['seatLabel']()).toBe('Riding');

    component['onOfficeRegionChange'](changeEventFromSelect('AB'));
    expect(component['seatLabel']()).toBe('Constituency');
  });

  // Six states elect their single member of the US House statewide. There is no district there
  // to name, so at-large is offered already chosen and any typed seat name is dropped with it.
  it('should default a US House race in an at-large state to at-large', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_federal'));
    component['officeData'].update((o) => ({ ...o, seat_name: 'WY-1' }));

    component['onOfficeRegionChange'](changeEventFromSelect('WY'));

    expect(component['atLargeIsLikely']()).toBe(true);
    expect(component['seatType']()).toBe('at_large');
    expect(component['officeData']().seat_name).toBe('');
    expect(component['showSeatName']()).toBe(false);
  });

  it('should not default to at-large in a state that has districts', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_federal'));

    component['onOfficeRegionChange'](changeEventFromSelect('OH'));

    expect(component['atLargeIsLikely']()).toBe(false);
    expect(component['seatType']()).toBe('district');
  });

  // The reverse: the automatic at-large is only ever a suggestion for the single-district state
  // that prompted it. Kept after a switch to Ohio it would be the wrong default for a House race.
  it('should withdraw the automatic at-large when the state changes to one with districts', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_federal'));
    component['onOfficeRegionChange'](changeEventFromSelect('WY'));
    expect(component['seatType']()).toBe('at_large');

    component['onOfficeRegionChange'](changeEventFromSelect('OH'));

    expect(component['seatType']()).toBe('district');
  });

  it('should never withdraw an at-large the user chose by hand', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_federal'));
    component['onOfficeRegionChange'](changeEventFromSelect('OH'));
    // A Senate race in Ohio: at-large is the user's own answer, not this page's suggestion.
    component['onSeatTypeChange'](changeEventFromSelect('at_large'));

    component['onOfficeRegionChange'](changeEventFromSelect('PA'));

    expect(component['seatType']()).toBe('at_large');
  });

  // A contradictory answer set is the one thing the server rejects, so an answer that no longer
  // applies is cleared the moment the answer above it changes.
  it('should clear the answers below when the level of government changes', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_state'));
    component['onOfficeRegionChange'](changeEventFromSelect('OH'));
    component['onChamberChange'](changeEventFromSelect('upper'));
    component['officeData'].update((o) => ({ ...o, seat_name: 'District 3' }));

    component['onLevelChange'](changeEventFromSelect('us_local'));

    expect(component['officeRegion']()).toBe('');
    expect(component['chamber']()).toBeNull();
    expect(component['officeData']().seat_name).toBe('');
  });

  it('should drop the seat name as soon as the seat is at-large', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_local'));
    component['officeData'].update((o) => ({ ...o, seat_name: 'Ward 4' }));

    component['onSeatTypeChange'](changeEventFromSelect('at_large'));

    expect(component['seatType']()).toBe('at_large');
    expect(component['officeData']().seat_name).toBe('');
  });

  // A statewide office — governor, attorney general — sits in neither chamber, so the chamber
  // question disappears and a chamber chosen for a district seat cannot ride along.
  it('should hide the chamber question and drop its answer for a statewide office', () => {
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_state'));
    component['onChamberChange'](changeEventFromSelect('upper'));
    expect(component['showChamber']()).toBe(true);

    component['onSeatTypeChange'](changeEventFromSelect('at_large'));

    expect(component['showChamber']()).toBe(false);
    expect(component['chamber']()).toBeNull();
  });

  it('should forget the race entirely when the organization type stops holding elections', () => {
    fillAccount();
    component['next']();
    component['onModeChange'](changeEventFromSelect('campaign'));
    component['onCountryChange'](changeEventFromSelect('CA'));
    component['onLevelChange'](changeEventFromSelect('ca_federal'));

    component['onModeChange'](changeEventFromSelect('church'));

    expect(component['jurisdiction']()).toBeNull();
    expect(component['isElectoral']()).toBe(false);
  });

  // ================================ Moving between steps ================================

  it('should keep every answer when stepping back and forward again', () => {
    walkToLastStep();
    component['contactData'].update((c) => ({ ...c, organization_phone: '613-555-0100' }));

    component['back']();
    component['back']();

    expect(component['step']()).toBe(1);
    expect(component['signUpData']().organization).toBe('Acme Corp');
    expect(component['signUpData']().mode).toBe('campaign');
    expect(component['contactData']().organization_phone).toBe('613-555-0100');
  });

  it('should allow reopening a step already passed, but not one still ahead', () => {
    fillAccount();
    component['next']();

    expect(component['canReachStep'](1)).toBe(true);
    expect(component['canReachStep'](3)).toBe(false);

    component['goToStep'](3);
    expect(component['step']()).toBe(2);

    component['goToStep'](1);
    expect(component['step']()).toBe(1);
  });

  // ========================= STEP 3 — contact details and residency =========================

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
    walkToLastStep();
    component['onRegionChange'](changeEventFromSelect('eu'));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Movement');
    expect(text).toContain('European Union hosting is also not open yet');
  });

  it('should show no residency notice at all while no region is named', () => {
    walkToLastStep();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Movement');
  });

  it('should ignore an unrecognised region rather than storing it', () => {
    component['onRegionChange'](changeEventFromSelect('uk'));

    expect(component['signUpData']().data_region).toBe('any');
  });

  // A malformed public address would be rejected by the server after the whole wizard had been
  // filled in. Leaving it blank stays free; only text that is not an address is refused.
  it('should refuse a malformed public contact email and return to that step', async () => {
    walkToLastStep();
    component['contactData'].update((c) => ({ ...c, organization_contact_email: 'not-an-email' }));
    component['step'].set(1);

    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(
      'Please enter a valid public contact email, or leave it blank.',
    );
    expect(component['step']()).toBe(3);
    expect(mockAuthSvc.signUp).not.toHaveBeenCalled();
  });

  it('should accept a blank public contact email', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    walkToLastStep();

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalled();
  });

  // ============================ Submitting — one call, at the end ============================

  it('should submit form and redirect to signin with verificationPending when valid', async () => {
    mockAuthSvc.signUp.mockResolvedValue({
      user: { first_name: 'John', email: 'test@example.com' },
      approvalPending: false,
    });

    const mockRouter = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(mockRouter, 'navigate').mockResolvedValue(true as any);

    walkToLastStep();
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
      organization_address: null,
      organization_phone: null,
      organization_contact_email: null,
    });
    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { verificationPending: 'true', email: 'test@example.com' },
    });
  });

  it('should redirect to signin with verificationPending on successful sign up', async () => {
    mockAuthSvc.signUp.mockResolvedValue({
      user: { first_name: 'John', email: 'test@example.com' },
      approvalPending: false,
    });
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);

    walkToLastStep();
    await component.join();

    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { verificationPending: 'true', email: 'test@example.com' },
    });
  });

  it('should show error if signup returns no user', async () => {
    mockAuthSvc.signUp.mockResolvedValue({ user: null, approvalPending: false });

    walkToLastStep();
    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Unable to complete signup.');
  });

  it('should show error if signup throws exception', async () => {
    const errorMsg = 'Email already exists';
    mockAuthSvc.signUp.mockRejectedValue(new Error(errorMsg));

    walkToLastStep();
    await component.join();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(errorMsg);
  });

  // Closed beta: signup succeeds but issues no session, so the page must route to the waitlist
  // panel rather than treat "no user" as a failure.
  it('should redirect to signin with approvalPending when the workspace awaits beta approval', async () => {
    mockAuthSvc.signUp.mockResolvedValue({ user: null, approvalPending: true });
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);

    walkToLastStep();
    await component.join();

    expect(navigateSpy).toHaveBeenCalledWith(['/signin'], {
      queryParams: { approvalPending: 'true', email: 'test@example.com' },
    });
    expect(mockAlertSvc.showError).not.toHaveBeenCalled();
  });

  // Residency is decided when the workspace is provisioned, so it has to leave the form with
  // the rest of the signup payload rather than being set afterwards.
  it('should send the chosen data region to signUp', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);

    walkToLastStep();
    component['onRegionChange'](changeEventFromSelect('eu'));

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(expect.objectContaining({ data_region: 'eu' }));
  });

  it('should call join only once on form submit via button click', async () => {
    walkToLastStep();

    const joinSpy = vi.spyOn(component, 'join');
    const buttonEl = fixture.nativeElement.querySelector('button[type="submit"]');
    buttonEl.click();
    fixture.detectChanges();

    expect(joinSpy).toHaveBeenCalledTimes(1);
  });

  // A church has no race, so the payload must carry no office fields at all rather than empty
  // ones — the server reads a present-but-empty office block differently from an absent one.
  it('should send no office fields for an organization that holds no elections', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    walkToLastStep('church');

    await component.join();

    const payload = mockAuthSvc.signUp.mock.calls[0][0];
    expect(payload.mode).toBe('church');
    expect(payload).not.toHaveProperty('jurisdiction');
    expect(payload).not.toHaveProperty('seat_type');
  });

  it('should send the office answers a campaign gave', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    walkToLastStep();
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_state'));
    component['onOfficeRegionChange'](changeEventFromSelect('OH'));
    component['onChamberChange'](changeEventFromSelect('lower'));
    component['officeData'].set({
      office_locality: '',
      seat_name: ' District 3 ',
      office_title: 'State Representative',
    });

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        jurisdiction: 'us_state',
        office_region: 'OH',
        // us_state does not ask for a locality, so nothing is claimed about one.
        office_locality: null,
        chamber: 'lower',
        seat_type: 'district',
        seat_name: 'District 3',
        office_title: 'State Representative',
      }),
    );
  });

  it('should send no chamber with a statewide office, which sits in neither one', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    walkToLastStep();
    component['onCountryChange'](changeEventFromSelect('US'));
    component['onLevelChange'](changeEventFromSelect('us_state'));
    component['onOfficeRegionChange'](changeEventFromSelect('AZ'));
    component['onChamberChange'](changeEventFromSelect('upper'));
    component['onSeatTypeChange'](changeEventFromSelect('at_large'));

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ jurisdiction: 'us_state', seat_type: 'at_large', chamber: null }),
    );
  });

  // Skipping step 2 records nothing, which leaves the server's own default org type to apply.
  it('should fall back to the default organization type when step 2 was skipped', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    fillAccount();
    component['next']();
    component['skipOrganizationStep']();

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(expect.objectContaining({ mode: 'office' }));
  });

  it('should clear the contact answers and still create the workspace when step 3 is skipped', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    walkToLastStep();
    component['contactData'].set({
      organization_address: '12 Main St',
      organization_phone: '613-555-0100',
      organization_contact_email: 'office@example.com',
    });

    await component['skipContactStep']();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_address: null,
        organization_phone: null,
        organization_contact_email: null,
      }),
    );
  });

  it('should send the contact answers that were given', async () => {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true as any);
    walkToLastStep();
    component['onAddressTextChange']('12 Main St, Ottawa');
    component['contactData'].update((c) => ({ ...c, organization_contact_email: 'office@example.com' }));

    await component.join();

    expect(mockAuthSvc.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_address: '12 Main St, Ottawa',
        organization_contact_email: 'office@example.com',
      }),
    );
  });
});

// The marketing site's audience pages carry the answer through for free, so a visitor arriving
// from one of them finds step 2's first question already answered.
describe('SignUpPage with a ?for= hint', () => {
  async function createWith(forParam: string): Promise<SignUpPage> {
    await TestBed.configureTestingModule({
      imports: [SignUpPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { signUp: vi.fn() } },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn(), alertList: () => [] } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ for: forParam }) } },
        },
      ],
    }).compileComponents();

    return TestBed.createComponent(SignUpPage).componentInstance;
  }

  it('should pre-answer the organization type from a recognised hint', async () => {
    const component = await createWith('church');

    expect(component['signUpData']().mode).toBe('church');
    expect(component['isElectoral']()).toBe(false);
  });

  it('should leave the organization type unanswered for an unrecognised hint', async () => {
    const component = await createWith('sailing-club');

    expect(component['signUpData']().mode).toBeNull();
  });
});
