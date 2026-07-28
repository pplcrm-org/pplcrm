import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { form, submit, required, email, minLength, FormField } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  DEFAULT_ORG_MODE,
  ORG_MODES,
  ORG_MODE_DESCRIPTIONS,
  ORG_MODE_LABELS,
  isOrgMode,
  type OrgMode,
  type signUpInputType,
} from '../../../../../../libs/common/src';
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
  protected readonly modeDescriptions = ORG_MODE_DESCRIPTIONS;

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
     * Organization type. Asked here rather than later because the starter tags, forms and
     * demo data are seeded in the signup transaction. Preselected from `?for=` so the
     * marketing site's audience pages carry the answer through for free.
     */
    mode: this.initialMode(),
  });

  public readonly form = form(this.signUpData, (p) => {
    required(p.organization);
    required(p.email);
    email(p.email);
    required(p.password);
    minLength(p.password, 8);
    required(p.first_name);
  });

  protected isLoading = this._loading.visible;

  protected selectMode(mode: OrgMode): void {
    this.signUpData.update((d) => ({ ...d, mode }));
  }

  /** `?for=church` from an audience landing page; anything unrecognised falls back. */
  private initialMode(): OrgMode {
    const raw = this.route.snapshot.queryParamMap.get('for');
    return isOrgMode(raw) ? raw : DEFAULT_ORG_MODE;
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

    await submit(this.form, {
      action: async () => {
        const end = this._loading.begin();
        try {
          const { user, approvalPending } = await this.authService.signUp(this.signUpData() as signUpInputType);
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
