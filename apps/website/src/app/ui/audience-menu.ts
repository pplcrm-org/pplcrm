import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AUDIENCE_NAV } from './site-nav';

/**
 * The header's "Who it's for" menu.
 *
 * The four audience landing pages used to sit in the nav as flat `For …` links. At `lg` that row
 * also carries Compare, Pricing, the currency switcher and both auth buttons, so a fourth
 * audience did not fit — collapsing them into one trigger takes the row from five links to three
 * and leaves room for more verticals later.
 *
 * A DaisyUI `dropdown`, matching {@link CurrencySwitcher} — platform-first, no custom widget, and
 * two looks (`onDark` over the navy hero) to match {@link SiteHeader}'s variants.
 */
@Component({
  selector: 'pc-audience-menu',
  imports: [RouterLink],
  template: `
    <div class="dropdown">
      <button type="button" tabindex="0" [class]="triggerClass()" aria-label="Who pplCRM is for">
        <span>Who it's for</span>
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
        @for (item of audiences; track item.id) {
          <li>
            <a [routerLink]="item.path" class="text-[13.5px]" (click)="close($event)">{{ item.label }}</a>
          </li>
        }
      </ul>
    </div>
  `,
})
export class AudienceMenu {
  public readonly onDark = input<boolean>(false);

  protected readonly audiences = AUDIENCE_NAV;

  protected readonly triggerClass = computed<string>(() =>
    this.onDark()
      ? 'flex items-center gap-1 text-[13.5px] font-medium text-white/85 hover:text-white'
      : 'flex items-center gap-1 text-[13.5px] font-medium text-base-content hover:text-primary',
  );

  protected close(event: Event): void {
    // DaisyUI dropdowns close on blur; drop focus so the menu dismisses after a pick.
    (event.currentTarget as HTMLElement | null)?.blur();
  }
}
