import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The old delivery-route links (/r/:token) retired with the driving-route system
 * (turfs-absorb-deliveries Phase 4): delivery work now goes out as delivery outings in
 * the same companion app canvassers use, reached by /t/:token links or the /canvass home.
 * An old link cannot be resolved to its replacement here — the replacement is a personal
 * link that was sent to the volunteer when the outing was re-assigned — so this page says
 * exactly that instead of a bare dead-link error.
 */
@Component({
  selector: 'pc-route-moved-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 class="text-xl font-bold">This link has moved</h1>
      <p class="max-w-sm text-sm text-base-content/70">
        Deliveries now run through the same app as canvassing. Check your messages for a newer link from your organizer
        — or if you have delivered with us before, your outing may already be waiting for you.
      </p>
      <a routerLink="/canvass" class="btn btn-primary">Open my outings</a>
      <p class="text-xs text-base-content/40">Powered by pplCRM</p>
    </div>
  `,
})
export class RouteMovedPage {}
