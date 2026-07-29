import { Component, inject } from '@angular/core';
import type { CurrencyCode } from '@common';

import { CurrencyService } from './currency.service';

/**
 * Currency picker for the pricing page. Lets a visitor override the auto-detected display currency;
 * the choice persists (see {@link CurrencyService}). A DaisyUI `dropdown` — platform-first, no
 * custom widget.
 *
 * It used to live in the site header on every page, but prices only ever appear on /pricing, so a
 * globe dropdown in the nav was a permanent control for a single page's concern. Keeping it beside
 * the subscriber slider also means the currency, the subscriber count and the billing interval —
 * the three things that decide the number on screen — sit in one card.
 */
@Component({
  selector: 'pc-currency-switcher',
  template: `
    <div class="dropdown dropdown-end">
      <button
        type="button"
        tabindex="0"
        class="flex items-center gap-1.5 rounded-field border border-line px-2.5 py-1.5 text-[13px] font-medium text-base-content hover:border-primary hover:text-primary"
        [attr.aria-label]="'Change currency, currently ' + active().label"
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" stroke-linecap="round" />
        </svg>
        <span class="tabular-nums">{{ active().code }}</span>
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
        class="menu dropdown-content z-10 mt-2 w-52 rounded-box border border-line bg-base-100 p-2 shadow-lg"
      >
        @for (opt of options; track opt.code) {
          <li>
            <button
              type="button"
              class="flex items-center justify-between gap-3 text-[13.5px]"
              [class.text-primary]="opt.code === active().code"
              [class.font-semibold]="opt.code === active().code"
              (click)="select(opt.code, $event)"
            >
              <span>{{ opt.label }}</span>
              <span class="tabular-nums text-base-content/50">{{ opt.symbol }} {{ opt.code }}</span>
            </button>
          </li>
        }
      </ul>
    </div>
  `,
})
export class CurrencySwitcher {
  private readonly currency = inject(CurrencyService);

  protected readonly options = this.currency.options;
  protected readonly active = this.currency.active;

  protected select(code: CurrencyCode, event: Event): void {
    this.currency.setCurrency(code);
    // DaisyUI dropdowns close on blur; drop focus so the menu dismisses after a pick.
    (event.currentTarget as HTMLElement | null)?.blur();
  }
}
