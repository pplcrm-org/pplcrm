import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { CompanionGate } from './companion-gate';

/**
 * `/j/:code` — what a scanned join QR opens.
 *
 * Deliberately thin. The gate already owns the whole "who are you and may you be here"
 * state machine, and a QR join is one more entry into it, not a parallel flow: name and
 * contact, then the same one-time code, then the same wait-for-approval screen every
 * other volunteer sees.
 *
 * Once the gate opens, this hands off to the session-first canvass shell. It cannot
 * route to `/t/:token` — turf tokens are hashed, so the link the volunteer now
 * effectively holds can never be shown back to them.
 */
@Component({
  selector: 'pc-join-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CompanionGate],
  template: `
    <pc-companion-gate kind="join" [token]="code()" (ready)="onReady()">
      <div class="flex min-h-screen items-center justify-center">
        <span class="loading loading-spinner loading-md opacity-40" aria-label="Opening your turf"></span>
      </div>
    </pc-companion-gate>
  `,
})
export class JoinPage {
  /** Route param — the join code from /j/:code. */
  public readonly code = input.required<string>();

  private readonly router = inject(Router);

  protected onReady(): void {
    void this.router.navigate(['/canvass'], { replaceUrl: true });
  }
}
