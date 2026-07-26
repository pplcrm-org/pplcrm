import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';

/** Marks a page as "reached from the go-live wizard". Present on the URL, so it survives a
 * reload and a back button, and it disappears the moment the user navigates somewhere of their
 * own accord — no stored "I'm in a wizard" flag to get stuck. */
export const SETUP_RETURN_PARAM = 'setup';

/**
 * The rail back to the wizard.
 *
 * Several go-live steps hand off to a real page — verify a domain, import a CSV, invite the team —
 * because rebuilding those inside the wizard would mean two implementations of the same thing,
 * drifting apart. The cost is that the user lands somewhere that looks nothing like the wizard,
 * with no obvious way back; the wizard's own progress rail is gone and `/go-live` is not a URL
 * anyone guesses. This strip is the way back, and it also answers "why am I here" while they're
 * in the middle of an unfamiliar page.
 *
 * Mounted once in the shell so every routed page gets it for free.
 */
@Component({
  selector: 'pc-setup-return-bar',
  imports: [Icon, RouterLink],
  template: `
    @if (visible()) {
      <div
        class="flex items-center justify-between gap-4 border-b border-primary/20 bg-primary/10 px-4 py-2 text-xs sm:text-sm"
      >
        <div class="flex min-w-0 items-center gap-2">
          <pc-icon name="arrow-left" [size]="5" class="shrink-0 text-primary"></pc-icon>
          <span class="truncate text-base-content/80">
            You're setting up your workspace. Finish here, then head back to pick up where you left off.
          </span>
        </div>
        <a routerLink="/go-live" class="btn btn-primary btn-xs shrink-0 sm:btn-sm">Back to setup</a>
      </div>
    }
  `,
})
export class SetupReturnBar {
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap);

  protected readonly visible = computed(() => this.params()?.get(SETUP_RETURN_PARAM) === '1');
}
