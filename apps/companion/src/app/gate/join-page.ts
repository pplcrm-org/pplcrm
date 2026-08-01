import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { CompanionSessionService } from './companion-api';
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
 * effectively holds can never be shown back to them. What it CAN carry across is the
 * turf the code names: `joinAttach` places an already-approved volunteer on that turf
 * (a fresh joiner was placed at approval) and `/canvass?turf=…` opens it directly
 * instead of dropping everyone on the picker.
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
  private readonly session = inject(CompanionSessionService);

  protected onReady(): void {
    void this.openCanvass();
  }

  /** A null turf (unscoped code, blip, turf retired) falls back to the plain shell. */
  private async openCanvass(): Promise<void> {
    const turfId = await this.session.joinAttach(this.code());
    await this.router.navigate(['/canvass'], {
      replaceUrl: true,
      ...(turfId ? { queryParams: { turf: turfId } } : {}),
    });
  }
}
