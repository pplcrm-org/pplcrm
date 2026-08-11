import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FEATURE_NAV } from './site-nav';

/**
 * The header's "Features" menu — the deep feature pages (canvassing, deliveries, districts),
 * collapsed into one trigger for the same reason the audiences are: the `lg` nav row has no
 * room for three more flat links.
 *
 * A DaisyUI `dropdown`, same markup as {@link AudienceMenu} — platform-first, no custom widget.
 */
@Component({
  selector: 'pc-feature-menu',
  imports: [RouterLink],
  template: `
    <div class="dropdown">
      <button
        type="button"
        tabindex="0"
        class="flex items-center gap-1 text-[13.5px] font-medium text-base-content hover:text-primary"
        aria-label="pplCRM feature pages"
      >
        <span>Features</span>
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <ul
        tabindex="0"
        class="menu dropdown-content z-10 mt-2 w-56 rounded-box border border-line bg-base-100 p-2 shadow-lg"
      >
        @for (item of features; track item.path) {
          <li>
            <a [routerLink]="item.path" class="text-[13.5px]" (click)="close($event)">{{ item.label }}</a>
          </li>
        }
      </ul>
    </div>
  `,
})
export class FeatureMenu {
  protected readonly features = FEATURE_NAV;

  protected close(event: Event): void {
    // DaisyUI dropdowns close on blur; drop focus so the menu dismisses after a pick.
    (event.currentTarget as HTMLElement | null)?.blur();
  }
}
