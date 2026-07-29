import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '@common';

import { CompanionSessionService } from './companion-api';

/**
 * `/` — the door for a volunteer who could not scan the QR.
 *
 * The join card in the CRM prints "Can't scan? Enter this code at go.pplcrm.com", so the
 * bare host has to be a place that accepts a code, not the dead-link catch-all. This is
 * that place, and nothing more: it takes eight characters, confirms the code is live, and
 * hands off to `/j/:code`, which is the same gate a scan opens.
 *
 * The code is checked here rather than after the redirect so a typo stays a correction in
 * a field the volunteer is already looking at, instead of a full-page "this link isn't
 * active" that throws away what they typed (§3, guide don't error).
 */
@Component({
  selector: 'pc-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
      <header class="flex flex-col gap-1 text-center">
        <h1 class="text-lg font-semibold">Join the canvass</h1>
        <p class="text-base-content/70">Enter the {{ length }}-character code your organizer gave you.</p>
      </header>

      <form class="flex flex-col gap-3" (submit)="submit($event)">
        <input
          class="input input-bordered min-h-14 w-full text-center font-mono text-2xl uppercase tracking-[0.3em]"
          type="text"
          name="joinCode"
          inputmode="text"
          autocapitalize="characters"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          [attr.maxlength]="length"
          [attr.aria-label]="length + '-character join code'"
          [value]="code()"
          (input)="onInput($event)"
        />
        @if (error()) {
          <p class="text-center text-sm text-error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="btn btn-primary min-h-11 w-full" [disabled]="checking() || !complete()">
          @if (checking()) {
            Checking…
          } @else if (!complete()) {
            Enter all {{ length }} characters
          } @else {
            Continue
          }
        </button>
      </form>

      <!-- A volunteer who already joined on this phone has no link to come back to: turf
           tokens are hashed, so the device session is their only way in. -->
      @if (hasSession()) {
        <button type="button" class="btn btn-ghost btn-sm" (click)="resume()">Continue where you left off</button>
      }

      <p class="text-center text-xs text-base-content/55">
        No code? Ask your organizer — they hand these out at a launch.
      </p>
    </div>
  `,
})
export class HomePage {
  protected readonly length = JOIN_CODE_LENGTH;

  private readonly router = inject(Router);
  private readonly session = inject(CompanionSessionService);

  protected readonly checking = signal(false);
  protected readonly code = signal('');
  protected readonly error = signal<string | null>(null);

  protected readonly complete = computed(() => this.code().length === JOIN_CODE_LENGTH);
  protected readonly hasSession = computed(() => this.session.sessionToken() != null);

  protected onInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const normalized = normalizeJoinCode(input.value);
    // Write back so stripped characters (spaces, dashes, look-alikes) never linger in the
    // field showing something we did not accept.
    input.value = normalized;
    this.code.set(normalized);
    this.error.set(null);
  }

  protected resume(): void {
    void this.router.navigate(['/canvass']);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.checking() || !this.complete()) return;
    this.checking.set(true);
    this.error.set(null);
    try {
      const access = await this.session.getAccess('join', this.code());
      if (access.state === 'unreachable') {
        this.error.set("Can't reach the server. Check your connection and try again.");
        return;
      }
      if (access.state === 'dead') {
        this.error.set("We don't recognize that code. Check it with your organizer.");
        return;
      }
      await this.router.navigate(['/j', this.code()]);
    } finally {
      this.checking.set(false);
    }
  }
}

/**
 * Uppercase, drop anything outside the code alphabet, and cap the length.
 *
 * The alphabet already excludes the ambiguous glyphs (0/O, 1/I/L, U), so a character
 * outside it is a stray separator or a misread, never a meaningful one — dropping it lets
 * someone paste "4vgx-xsbn" and get the code they meant.
 */
export function normalizeJoinCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (JOIN_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === JOIN_CODE_LENGTH) break;
  }
  return out;
}
