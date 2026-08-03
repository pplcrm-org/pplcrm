import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { form, submit, required, email, minLength, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  CHAMBERS,
  CHAMBER_LABELS,
  DATA_REGION_CHOICES,
  DATA_REGION_CHOICE_DESCRIPTIONS,
  DATA_REGION_CHOICE_LABELS,
  DATA_RESIDENCY_MIN_PLAN,
  DEFAULT_DATA_REGION,
  DEFAULT_DATA_REGION_CHOICE,
  DEFAULT_ORG_MODE,
  JURISDICTIONS,
  JURISDICTION_IDS,
  ORG_MODES,
  ORG_MODE_DESCRIPTIONS,
  ORG_MODE_IS_ELECTORAL,
  ORG_MODE_LABELS,
  PLANS_BY_KEY,
  SEAT_TYPES,
  SEAT_TYPE_LABELS,
  US_AT_LARGE_CONGRESSIONAL_STATES,
  hasRegionPreference,
  hostingRegionFor,
  isChoicePendingRegion,
  isDataRegionChoice,
  isJurisdictionId,
  isOrgMode,
  regionsForCountry,
  seatLabelFor,
  type Chamber,
  type DataRegionChoice,
  type JurisdictionId,
  type OrgMode,
  type Region,
  type SeatType,
  type signUpInputType,
} from '@common';
import { Icon } from '@icons/icon';
import { AddressAutocomplete } from '@uxcommon/components/address-autocomplete/address-autocomplete';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthLayoutComponent } from 'apps/frontend/src/app/auth/auth-layout';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { passwordBreachNumber, passwordInBreach } from 'apps/frontend/src/app/auth/auth-utils';
import { getUserErrorMessage } from 'apps/frontend/src/app/services/api/user-message';

/** The three wizard steps, in order. `1` is the only one that refuses to be left incomplete. */
export const SIGNUP_STEPS = [1, 2, 3] as const;
export type SignUpStep = (typeof SIGNUP_STEPS)[number];

/** Short enough to fit the auth card's three-across step rail. */
const STEP_LABELS: Record<SignUpStep, string> = {
  1: 'Account',
  2: 'Organization',
  3: 'Contact',
};

/** The countries the jurisdiction registry models, plus the honest escape hatch. */
const COUNTRY_CHOICES = [
  { code: 'CA', name: 'Canada' },
  { code: 'US', name: 'United States' },
  { code: 'other', name: 'Somewhere else' },
] as const;
type CountryChoice = (typeof COUNTRY_CHOICES)[number]['code'];

function isCountryChoice(value: string): value is CountryChoice {
  return COUNTRY_CHOICES.some((c) => c.code === value);
}

@Component({
  selector: 'pc-signup',
  imports: [DecimalPipe, FormField, Icon, RouterModule, AuthLayoutComponent, AddressAutocomplete],
  templateUrl: './signup-page.html',
})
export class SignUpPage {
  private readonly alertSvc = inject(AlertService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly modes = ORG_MODES;
  protected readonly modeLabels = ORG_MODE_LABELS;

  protected readonly regions = DATA_REGION_CHOICES;
  protected readonly regionLabels = DATA_REGION_CHOICE_LABELS;

  /** Named in the notice under the picker, so the plan requirement and the pricing page cannot
   * drift apart — both read the same constant. */
  protected readonly residencyMinPlanName = PLANS_BY_KEY[DATA_RESIDENCY_MIN_PLAN].name;

  /** `?for=church` from an audience landing page; anything unrecognised leaves it unanswered. */
  private readonly modeParam = this.route.snapshot.queryParamMap.get('for');

  private _loading = createLoadingGate();

  protected readonly signUpData = signal({
    organization: '',
    email: '',
    password: '',
    first_name: '',
    middle_names: '',
    last_name: '',
    terms: '',
    /**
     * Organization type — `null` until answered. Asked here rather than later because the
     * starter tags, forms and demo data are all seeded inside the signup transaction, so a
     * mode chosen afterwards would be too late to shape any of them. Prefilled from `?for=`
     * so the marketing site's audience pages carry the answer through for free.
     */
    mode: this.initialMode(),
    /**
     * Where this workspace's data is stored. Unlike `mode` this starts answered — with "Does
     * not matter", which is the true state of an organization that has not thought about it
     * and the only answer that needs no paid plan. Asked here rather than later because it is
     * decided at provisioning time; see data-residency.ts.
     */
    data_region: DEFAULT_DATA_REGION_CHOICE as DataRegionChoice,
  });

  /**
   * Which step is on screen. Nothing is created until the last one is submitted — the starter
   * tags, starter forms and demo data are all seeded inside the signup transaction, so a wizard
   * that created the account on step 1 could not shape any of them from the later answers.
   */
  protected readonly step = signal<SignUpStep>(1);
  protected readonly steps = SIGNUP_STEPS;
  protected readonly stepLabels = STEP_LABELS;

  /**
   * Step 2's electoral answers. Held apart from `signUpData` so that a non-electoral
   * organization never carries office fields at all, and so switching the country or the level
   * of government can clear whatever no longer applies without touching the account fields.
   */
  protected readonly officeData = signal({
    office_locality: '',
    seat_name: '',
    office_title: '',
  });

  /** Country and level of government are two selects over one flat jurisdiction id. */
  protected readonly country = signal<CountryChoice | null>(null);
  protected readonly jurisdiction = signal<JurisdictionId | null>(null);
  protected readonly officeRegion = signal<string>('');
  protected readonly chamber = signal<Chamber | null>(null);
  protected readonly seatType = signal<SeatType>('district');
  /**
   * True while the current seat type is this page's own suggestion (at-large, offered when a
   * single-district state is picked) rather than the user's answer. A suggestion is withdrawn
   * when the state that prompted it changes; an answer the user gave by hand never is.
   */
  private readonly seatTypeWasAutoSet = signal(false);

  /** Step 3's contact answers, likewise separate so "Skip for now" can clear exactly these. */
  protected readonly contactData = signal({
    organization_address: '',
    organization_phone: '',
    organization_contact_email: '',
  });

  /**
   * True once a specific region is named. This — not which region — is what triggers the
   * notice, because naming any region at all is the part that needs the paid plan.
   */
  protected readonly regionPreferenceStated = computed(() => hasRegionPreference(this.signUpData().data_region));

  /**
   * True when the named region has no hosting yet, which is every region except Canada today.
   * Adds a second sentence to the notice: the choice is recorded, but the workspace is created
   * in Canada, and the form says so rather than implying otherwise.
   */
  protected readonly regionNotLiveYet = computed(() => isChoicePendingRegion(this.signUpData().data_region));

  /** The label for whatever was picked — used in the notice below. */
  protected readonly chosenRegionLabel = computed(() => DATA_REGION_CHOICE_LABELS[this.signUpData().data_region]);

  /** What the pick means, shown under the select whenever there is no notice to show instead.
   * Lives on the line below rather than inside the option, which a select would clip. */
  protected readonly chosenRegionDescription = computed(
    () => DATA_REGION_CHOICE_DESCRIPTIONS[this.signUpData().data_region],
  );

  /** Where the data actually goes given the pick — used by the availability sentence. */
  protected readonly actualRegionLabel = computed(
    () => DATA_REGION_CHOICE_LABELS[hostingRegionFor(this.signUpData().data_region)],
  );

  /**
   * Where a workspace lands when its region choice does not apply — used by the PLAN sentence,
   * which must not use `actualRegionLabel`. The two agree only while Canada is the sole live
   * region: once a second region opens, a non-Movement workspace that picked it still gets the
   * default, and `hostingRegionFor` would name the picked region instead.
   */
  protected readonly defaultRegionLabel = DATA_REGION_CHOICE_LABELS[DEFAULT_DATA_REGION];

  /**
   * Whether the question has been answered — the single source of truth for both the
   * placeholder and the submit gate. Until it is, the select shows its question the way
   * every other row on this form shows a placeholder.
   */
  protected readonly modeChosen = computed(() => this.signUpData().mode != null);

  /** Gates the org-type error so it appears on a failed submit, not while the form is untouched. */
  protected readonly submitAttempted = signal(false);

  protected readonly modeDescriptions = ORG_MODE_DESCRIPTIONS;
  protected readonly countries = COUNTRY_CHOICES;
  protected readonly chambers = CHAMBERS;
  protected readonly chamberLabels = CHAMBER_LABELS;
  protected readonly seatTypes = SEAT_TYPES;
  protected readonly seatTypeLabels = SEAT_TYPE_LABELS;
  protected readonly jurisdictions = JURISDICTIONS;

  /**
   * Whether this kind of organization runs elections. A church or a non-profit never sees a
   * single electoral question, because none of them mean anything for it.
   */
  protected readonly isElectoral = computed(() => {
    const mode = this.signUpData().mode;
    return mode != null && ORG_MODE_IS_ELECTORAL[mode];
  });

  /** The levels of government available in the chosen country. Empty until a country is picked. */
  protected readonly levels = computed<readonly JurisdictionId[]>(() => {
    const country = this.country();
    if (country == null || country === 'other') return [];
    return JURISDICTION_IDS.filter((id) => JURISDICTIONS[id].country === country);
  });

  /** The registry entry driving every question below it. Null until a level is chosen. */
  protected readonly spec = computed(() => {
    const id = this.jurisdiction();
    return id == null ? null : JURISDICTIONS[id];
  });

  /** Provinces and territories, or states — whichever the chosen level actually uses. */
  protected readonly regionOptions = computed<readonly Region[]>(() => regionsForCountry(this.spec()?.country ?? null));

  protected readonly regionQuestion = computed(() =>
    this.spec()?.country === 'CA' ? 'Which province or territory?' : 'Which state?',
  );

  /** The word this race actually uses for one seat area: riding, constituency, ward, district. */
  protected readonly seatLabel = computed(() => {
    const id = this.jurisdiction();
    if (id == null) return 'District';
    return seatLabelFor(id, this.officeRegion() || null, null);
  });

  /** Only a district seat sits in a chamber; a statewide office (governor) is asked no chamber. */
  protected readonly showChamber = computed(() => this.spec()?.usesChamber === true && this.seatType() === 'district');
  protected readonly showAtLarge = computed(() => this.spec()?.supportsAtLarge === true);
  protected readonly showRegion = computed(() => this.spec()?.requiresRegion === true);
  protected readonly showLocality = computed(() => this.spec()?.requiresLocality === true);

  /** An at-large seat covers the whole area, so it has no seat area to name. */
  protected readonly showSeatName = computed(() => this.jurisdiction() != null && this.seatType() === 'district');

  /**
   * The six states that elect their single member of the US House statewide. A federal race
   * there has no district at all, so at-large is offered as the answer that is already right.
   */
  protected readonly atLargeIsLikely = computed(
    () =>
      this.jurisdiction() === 'us_federal' &&
      (US_AT_LARGE_CONGRESSIONAL_STATES as readonly string[]).includes(this.officeRegion()),
  );

  protected readonly officeTitles = computed<readonly string[]>(() => this.spec()?.officeTitles ?? []);

  /** Bias the address suggestions towards the country already named, when one has been. */
  protected readonly addressRegionCodes = computed<string[]>(() => {
    const country = this.country();
    if (country === 'US') return ['us'];
    if (country === 'CA') return ['ca'];
    return ['ca', 'us'];
  });

  public readonly form = form(this.signUpData, (p) => {
    required(p.organization);
    required(p.email);
    email(p.email);
    required(p.password);
    minLength(p.password, 8);
    required(p.first_name);
  });

  /** No validators: every field on step 2 is optional, and blank must never block anyone. */
  public readonly officeForm = form(this.officeData);

  /**
   * One validator only, and it does not fire on a blank field: `email()` skips empty values.
   * A malformed public address would be rejected by the server after the whole wizard had been
   * filled in, so it is caught here instead — leaving it blank stays free.
   */
  public readonly contactForm = form(this.contactData, (p) => {
    email(p.organization_contact_email);
  });

  protected isLoading = this._loading.visible;

  /** Drives the counter that sits inside the password field. */
  protected readonly passwordLength = computed(() => this.form.password().value().length);

  /**
   * The org-type select is driven by hand rather than `[formField]`. Signal-forms reserves the
   * `mode` key on its field tree, so `form.mode` is not a field and binding it throws while
   * rendering. `join()` gates on it instead.
   */
  protected onModeChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    const mode = target.value;
    if (isOrgMode(mode)) {
      this.signUpData.update((d) => ({ ...d, mode }));
      // A church has no race to describe. Clearing on the way out means an answer typed before
      // the type was corrected can never be submitted alongside a type that contradicts it.
      if (!ORG_MODE_IS_ELECTORAL[mode]) this.clearOffice();
    }
  }

  /** Reads a `<select>`'s value, or null when the event did not come from one. */
  private selectedValue(event: Event): string | null {
    const target = event.target;
    return target instanceof HTMLSelectElement ? target.value : null;
  }

  /** Country first. Changing it invalidates every answer below, so all of them are cleared. */
  protected onCountryChange(event: Event): void {
    const value = this.selectedValue(event);
    if (value == null || !isCountryChoice(value)) return;

    this.country.set(value);
    this.clearOffice();
    // "Somewhere else" is a real answer, not a missing one: it maps to the `other` jurisdiction,
    // which is what covers school boards, band councils and countries we do not model.
    this.jurisdiction.set(value === 'other' ? 'other' : null);
  }

  /** Level of government. Region, chamber and seat all depend on it, so they reset with it. */
  protected onLevelChange(event: Event): void {
    const value = this.selectedValue(event);
    if (value == null || !isJurisdictionId(value)) return;

    this.clearOffice();
    this.jurisdiction.set(value);
  }

  protected onOfficeRegionChange(event: Event): void {
    const value = this.selectedValue(event);
    if (value == null) return;

    this.officeRegion.set(value);
    // In the six states that elect their one House member statewide there is no district to
    // name, so at-large is offered already chosen rather than left as a trap.
    if (this.atLargeIsLikely()) {
      this.seatType.set('at_large');
      this.seatTypeWasAutoSet.set(true);
      this.officeData.update((o) => ({ ...o, seat_name: '' }));
    } else if (this.seatTypeWasAutoSet()) {
      // The at-large still on screen was this page's suggestion for the previous, single-district
      // state. The newly chosen state has districts, so the suggestion is withdrawn — but only a
      // suggestion is: a seat type the user picked by hand is never overridden.
      this.seatTypeWasAutoSet.set(false);
      this.seatType.set('district');
    }
  }

  protected onChamberChange(event: Event): void {
    const value = this.selectedValue(event);
    if (value == null) return;
    // `find` narrows to Chamber without a cast; an empty or unknown value means "not answered".
    this.chamber.set(CHAMBERS.find((c) => c === value) ?? null);
  }

  protected onSeatTypeChange(event: Event): void {
    const value = this.selectedValue(event);
    const seatType = value == null ? undefined : SEAT_TYPES.find((s) => s === value);
    if (seatType === undefined) return;

    this.seatType.set(seatType);
    // The user answered, so whatever this page had suggested stops being a suggestion.
    this.seatTypeWasAutoSet.set(false);
    // An at-large seat covers the whole area. Sending a name with it is the contradiction the
    // server rejects, so the name is dropped the moment at-large is chosen — and so is the
    // chamber, because a statewide office sits in neither one.
    if (seatType === 'at_large') {
      this.officeData.update((o) => ({ ...o, seat_name: '' }));
      this.chamber.set(null);
    }
  }

  /** Everything step 2 asks about the race, back to unanswered. */
  private clearOffice(): void {
    this.jurisdiction.set(null);
    this.officeRegion.set('');
    this.chamber.set(null);
    this.seatType.set('district');
    this.seatTypeWasAutoSet.set(false);
    this.officeData.set({ office_locality: '', seat_name: '', office_title: '' });
  }

  /** Driven by hand for the same reason as `onModeChange`: it is a plain select, not a
   * signal-forms field, so nothing here can be bound with `[formField]`. */
  protected onRegionChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    const region = target.value;
    if (isDataRegionChoice(region)) {
      this.signUpData.update((d) => ({ ...d, data_region: region }));
    }
  }

  /** Only a recognised `?for=` counts as an answer; anything else leaves the picker empty. */
  private initialMode(): OrgMode | null {
    const raw = this.modeParam;
    return isOrgMode(raw) ? raw : null;
  }

  /** Position in the rail, so the DaisyUI steps can colour everything up to here. */
  protected readonly stepIndex = computed(() => SIGNUP_STEPS.indexOf(this.step()));

  /** A step already passed can be reopened; a step ahead cannot be jumped to. */
  protected canReachStep(step: SignUpStep): boolean {
    return step <= this.step();
  }

  /** Going back never clears an answer — every answer lives in a signal that outlives the step. */
  protected goToStep(step: SignUpStep): void {
    if (this.canReachStep(step)) this.step.set(step);
  }

  protected back(): void {
    const current = this.step();
    if (current === 3) this.step.set(2);
    else if (current === 2) this.step.set(1);
  }

  /**
   * Forward from step 1 or step 2.
   *
   * Step 1 is the only step that refuses to be left incomplete: without an organization name, a
   * name, an email and a password there is no account to create. Step 2 asks for its answer but
   * points at "Skip for now" rather than trapping anyone.
   */
  protected next(): void {
    if (this.step() === 1) {
      this.form().markAsTouched();
      if (this.form().invalid()) {
        this.alertSvc.showError('Please enter all information before continuing.');
        return;
      }
      this.step.set(2);
      return;
    }

    if (this.step() === 2) {
      this.submitAttempted.set(true);
      if (!this.modeChosen()) {
        this.alertSvc.showError('Please choose what kind of organization this is, or skip this step.');
        return;
      }
      this.step.set(3);
    }
  }

  /**
   * Step 2's skip. Records nothing about the organization type or the race, which leaves the
   * server's own defaults to apply. Moves on rather than blocking, because an unanswered
   * question must never be the reason someone cannot create an account.
   */
  protected skipOrganizationStep(): void {
    this.signUpData.update((d) => ({ ...d, mode: null }));
    this.clearOffice();
    this.country.set(null);
    this.submitAttempted.set(false);
    this.step.set(3);
  }

  /** Trimmed text, or null when nothing was typed. Null is what the server reads as unanswered. */
  private trimmedOrNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Every answer the wizard collected, as one payload.
   *
   * Two rules govern what goes in. A question that was never shown contributes nothing, so a
   * church sends no office fields at all. A question that was shown but not answered sends null,
   * which the server reads as unanswered rather than as a contradiction. The only thing it may
   * never send is a self-contradictory set — an at-large seat with a name, a chamber outside a
   * two-chamber legislature — which is why each office field is filtered through its own spec.
   */
  private buildPayload(): signUpInputType {
    const account = this.signUpData();
    const contact = this.contactData();
    const office = this.officeData();

    const base = {
      ...account,
      // A skipped step 2 leaves this null, and the server's own default is what applies.
      mode: account.mode ?? DEFAULT_ORG_MODE,
      organization_address: this.trimmedOrNull(contact.organization_address),
      organization_phone: this.trimmedOrNull(contact.organization_phone),
      organization_contact_email: this.trimmedOrNull(contact.organization_contact_email),
    };

    const jurisdiction = this.jurisdiction();
    if (!this.isElectoral() || jurisdiction == null) return base;

    const spec = JURISDICTIONS[jurisdiction];
    const region = this.officeRegion().trim();
    const seatType = this.seatType();

    return {
      ...base,
      jurisdiction,
      office_region: spec.requiresRegion && region.length > 0 ? region : null,
      office_locality: spec.requiresLocality ? this.trimmedOrNull(office.office_locality) : null,
      // A chamber belongs to a district seat only — a statewide office sits in neither chamber.
      chamber: spec.usesChamber && seatType === 'district' ? this.chamber() : null,
      seat_type: seatType,
      seat_name: seatType === 'district' ? this.trimmedOrNull(office.seat_name) : null,
      office_title: this.trimmedOrNull(office.office_title),
    };
  }

  /** Step 3's skip: clear the three contact answers, then create the workspace anyway. */
  protected async skipContactStep(): Promise<void> {
    this.contactData.set({ organization_address: '', organization_phone: '', organization_contact_email: '' });
    await this.join();
  }

  /**
   * One submit handler for all three steps, so pressing Enter in a field does what the visible
   * primary button says: continue on steps 1 and 2, create the workspace on step 3.
   */
  protected async onFormSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.step() === 3) {
      await this.join();
      return;
    }
    this.next();
  }

  protected passwordBreachNumber = passwordBreachNumber;
  protected passwordInBreach = passwordInBreach;

  public get email() {
    return this.form.email();
  }

  public get firstName() {
    return this.form.first_name();
  }

  public get organization() {
    return this.form.organization();
  }

  public get password() {
    return this.form.password();
  }

  public get contactEmail() {
    return this.contactForm.organization_contact_email();
  }

  /**
   * The address is the one field on step 3 that is not a `[formField]`: `pc-address-autocomplete`
   * owns its own input so it can upgrade into Google Places, and reports the text it holds. It
   * emits on every keystroke and again with the formatted address when a suggestion is picked.
   */
  protected onAddressTextChange(text: string): void {
    this.contactData.update((c) => ({ ...c, organization_address: text }));
  }

  public async join(event?: Event) {
    event?.preventDefault();
    this.form().markAsTouched();

    // Step 1 is the only step that can stop a signup. Reaching here with it incomplete means the
    // rail was used to jump back, so send the user to the step that actually needs work.
    if (this.form().invalid()) {
      this.step.set(1);
      this.alertSvc.showError('Please enter all information before continuing.');
      return;
    }

    // The one thing step 3 can get wrong rather than leave blank. Blank stays free — the email
    // validator ignores an empty field — so this only fires on text that is not an address.
    this.contactForm().markAsTouched();
    if (this.contactForm().invalid()) {
      this.step.set(3);
      this.alertSvc.showError('Please enter a valid public contact email, or leave it blank.');
      return;
    }

    await submit(this.form, {
      action: async () => {
        const end = this._loading.begin();
        try {
          // One call, at the end. Starter tags, starter forms and the demo dataset are all
          // seeded inside this transaction, so nothing exists until it succeeds.
          const { user, approvalPending } = await this.authService.signUp(this.buildPayload());
          if (approvalPending) {
            // Closed beta: the workspace exists but has no session yet. Send them to sign-in
            // with the waitlist panel rather than a toast that scrolls away, so the state is
            // still on screen when they come back to try again.
            await this.router.navigate(['/signin'], {
              queryParams: { approvalPending: 'true', email: this.signUpData().email },
            });
          } else if (user) {
            await this.router.navigate(['/signin'], {
              queryParams: { verificationPending: 'true', email: user.email },
            });
          } else {
            this.alertSvc.showError('Unable to complete signup.');
          }
        } catch (err) {
          this.alertSvc.showError(getUserErrorMessage(err, 'Could not complete the signup. Please try again.'));
        } finally {
          end();
        }
        return null;
      },
      onInvalid: () => {
        this.alertSvc.showError('Please enter all information before continuing.');
      },
    });
  }
}
