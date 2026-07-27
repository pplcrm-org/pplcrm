import { Component } from '@angular/core';
import { Alerts } from '@uxcommon/components/alerts/alerts';

/**
 * The signed-out shell: a glass card over the dark background photo (.bg-image in styles.css).
 *
 * Deliberately pinned to one appearance. `data-theme="light"` is not a theme choice the viewer
 * can change — the auth surface does not follow the app's light/dark toggle, so its copy sets its
 * own near-white colours against the photo rather than reading from theme tokens.
 *
 * Two things removed from this element:
 * - `i18n-data-theme`, which marked the literal string "light" as translatable. It landed in the
 *   extraction catalogue, where a translator could have changed the theme value itself.
 * - `font-light` (weight 300), retired app-wide by the design doctrine as too fragile below 14px,
 *   especially over a photo.
 */
@Component({
  selector: 'pc-auth-layout',
  imports: [Alerts],
  template: `
    <div class="bg-image flex min-h-screen" data-theme="light">
      <div class="card card-compact glass m-auto w-96 shadow-xl">
        <div class="card-title justify-center shadow-lg">
          <img class="p-5" src="assets/logo.png" />
        </div>
        <pc-alerts />
        <div class="card-body">
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class AuthLayoutComponent {}
