import { Service, signal } from '@angular/core';

/**
 * A workspace-wide "a gift or pledge just changed" tick.
 *
 * The donations page provides its own component-scoped `DonationsService` — that is deliberate, so
 * the All and One-time tabs never share one mutable list scope — which means the refresh signal on
 * that service only ever reaches the one grid that owns it. Both donation tabs also stay alive in
 * the route-reuse cache after you navigate away. Together those two facts meant a gift recorded
 * anywhere other than the grid you happen to be looking at (the sibling tab, or a person's page
 * through Stripe checkout) left that grid showing the rows it had already loaded, and only a
 * browser reload brought the new gift in.
 *
 * Every donation write goes through `DonationsService`, so the tick is raised there rather than in
 * whichever component initiated it: no surface can record a gift and forget to announce it. A grid
 * that is currently detached in the route cache reacts when it is shown again.
 */
@Service()
export class DonationsChangedService {
  private readonly _version = signal(0);

  /** Increments once per successful donation or pledge write. Never resets. */
  public readonly version = this._version.asReadonly();

  public notify(): void {
    this._version.update((n) => n + 1);
  }
}
