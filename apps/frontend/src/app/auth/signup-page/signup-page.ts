import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { form, submit, required, email, minLength, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  DATA_REGION_CHOICES,
  DATA_REGION_CHOICE_DESCRIPTIONS,
  DATA_REGION_CHOICE_LABELS,
  DATA_RESIDENCY_MIN_PLAN,
  DEFAULT_DATA_REGION,
  DEFAULT_DATA_REGION_CHOICE,
  ORG_MODES,
  ORG_MODE_LABELS,
  PLANS_BY_KEY,
  hasRegionPreference,
  hostingRegionFor,
  isChoicePendingRegion,
  isDataRegionChoice,
  isOrgMode,
  type DataRegionChoice,
  type OrgMode,
} from '@common';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthLayoutComponent } from 'apps/frontend/src/app/auth/auth-layout';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { passwordBreachNumber, passwordInBreach } from 'apps/frontend/src/app/auth/auth-utils';
import { getUserErrorMessage } from 'apps/frontend/src/app/services/api/user-message';

@Component({
  selector: 'pc-signup',
  imports: [DecimalPipe, FormField, Icon, RouterModule, AuthLayoutComponent],
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

  public readonly form = form(this.signUpData, (p) => {
    required(p.organization);
    required(p.email);
    email(p.email);
    required(p.password);
    minLength(p.password, 8);
    required(p.first_name);
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
    }
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

  public async join(event?: Event) {
    event?.preventDefault();
    this.form().markAsTouched();
    this.submitAttempted.set(true);

    // Org type is not a signal-forms field (see `onModeChange`), so it is gated here. Narrowing
    // it to a local also lets the payload below drop the `as signUpInputType` cast. When the rest
    // of the form is incomplete too, defer to the generic message rather than singling this out.
    const { mode } = this.signUpData();
    if (mode == null) {
      this.alertSvc.showError(
        this.form().valid()
          ? 'Please choose what kind of organization this is.'
          : 'Please enter all information before continuing.',
      );
      return;
    }

    await submit(this.form, {
      action: async () => {
        const end = this._loading.begin();
        try {
          const { user, approvalPending } = await this.authService.signUp({ ...this.signUpData(), mode });
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
