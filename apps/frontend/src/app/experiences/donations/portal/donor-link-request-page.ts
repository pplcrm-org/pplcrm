import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { DonorPortalApiError, DonorPortalApiService } from './donor-portal-api';

/**
 * The public /g page: a donor asks for their giving link by email. The confirmation copy is
 * IDENTICAL for every 200 whether or not the address matched anyone — this page must never reveal
 * who is in the org's records. A 429 gets an honest rate-limit message instead.
 */
@Component({
  selector: 'pc-donor-link-request-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-base-200 px-4 py-10">
      @if (sent()) {
        <div class="w-full max-w-[440px] pc-panel p-8 text-center">
          <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
            ✓
          </div>
          <h1 class="mb-2 text-xl font-semibold text-base-content">Check your email</h1>
          <p class="text-sm text-base-content/60">
            If that address matches our records, your giving link is on its way. It can take a few minutes to arrive.
          </p>
        </div>
      } @else {
        <div class="w-full max-w-[440px] pc-panel p-8">
          <h1 class="mb-1 text-xl font-semibold text-base-content">Get your giving link</h1>
          <p class="mb-6 text-sm leading-relaxed text-base-content/60">
            Enter the email address you used to donate and we will send you a private link to your giving page.
          </p>

          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); submit()" novalidate>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-base-content" for="donor-email">Email address</label>
              <input
                id="donor-email"
                class="input input-bordered w-full text-sm"
                [class.input-error]="!!error()"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                (input)="onInput($any($event.target).value)"
              />
              @if (error()) {
                <span class="text-xs text-error">{{ error() }}</span>
              }
            </div>

            <button class="btn btn-primary w-full" [disabled]="submitting()" type="submit">
              @if (submitting()) {
                <span class="loading loading-spinner loading-sm"></span>
              }
              Email me my link
            </button>
          </form>

          <p class="mt-6 text-center text-xs text-base-content/40">Powered by pplCRM</p>
        </div>
      }
    </div>
  `,
})
export class DonorLinkRequestPage {
  private readonly api = inject(DonorPortalApiService);

  protected readonly sent = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  private email = '';

  protected onInput(value: string): void {
    this.email = value;
    if (this.error()) this.error.set(null);
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    const email = this.email.trim();
    if (!email || !email.includes('@')) {
      this.error.set('Enter the email address you used to donate.');
      return;
    }

    this.submitting.set(true);
    try {
      await this.api.requestLink(email);
      // One confirmation for every 200 — a match and a miss must be indistinguishable here.
      this.sent.set(true);
    } catch (err) {
      if (err instanceof DonorPortalApiError && err.status === 429) {
        this.error.set('Too many link requests right now. Wait a few minutes and try again.');
      } else if (err instanceof DonorPortalApiError && err.status === 404) {
        // The server answered; the request just named no known organization. Saying
        // "check your connection" here would be untrue.
        this.error.set(
          'This page could not tell which organization you give to. Use the link from one of their emails.',
        );
      } else {
        this.error.set('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
