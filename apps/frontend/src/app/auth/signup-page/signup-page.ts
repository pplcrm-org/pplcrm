import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { form, submit, required, email, minLength, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ORG_MODES, ORG_MODE_LABELS, isOrgMode, type OrgMode } from '../../../../../../libs/common/src';
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
  });

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
