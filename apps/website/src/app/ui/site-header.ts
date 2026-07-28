import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AudienceMenu } from './audience-menu';
import { AuthHint } from './auth-hint';
import { CurrencySwitcher } from './currency-switcher';
import { AUDIENCE_NAV, DASHBOARD_URL, LOGIN_URL, PRIMARY_NAV, SIGNUP_URL } from './site-nav';
import { SiteLogo } from './site-logo';

type HeaderVariant = 'over-hero' | 'solid';

/**
 * Site header. Two looks from one component:
 *  - `over-hero`  transparent bar with light text, sits on the navy hero (Home)
 *  - `solid`      white bar with a hairline border and dark text (FAQ, stubs)
 * Below `md` the nav collapses behind a hamburger toggle.
 */
@Component({
  selector: 'pc-site-header',
  imports: [RouterLink, SiteLogo, CurrencySwitcher, AudienceMenu],
  template: `
    <header [class]="barClass()">
      <div class="site-wrap flex items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <a routerLink="/" class="flex items-center" aria-label="pplCRM home">
          <pc-site-logo [onDark]="onDark()" />
        </a>

        <!-- Desktop nav -->
        <nav class="hidden items-center gap-5 text-[13.5px] font-medium lg:flex xl:gap-6">
          <pc-audience-menu [onDark]="onDark()" />
          @for (link of nav; track link.path) {
            <a [routerLink]="link.path" [class]="linkClass()">{{ link.label }}</a>
          }
          <pc-currency-switcher [onDark]="onDark()" />
          @if (signedIn()) {
            <a [href]="dashboardUrl" class="btn btn-primary btn-sm rounded-field font-semibold">Dashboard</a>
          } @else {
            <a [href]="loginUrl" [class]="loginBtnClass()">Log in</a>
            <a [href]="signupUrl" class="btn btn-primary btn-sm rounded-field font-semibold">Start free</a>
          }
        </nav>

        <!-- Mobile toggle -->
        <button
          type="button"
          class="btn btn-square btn-ghost btn-sm lg:hidden"
          [class.text-white]="onDark()"
          [attr.aria-expanded]="open()"
          aria-label="Toggle menu"
          (click)="open.set(!open())"
        >
          @if (open()) {
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
            </svg>
          } @else {
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
            </svg>
          }
        </button>
      </div>

      <!-- Mobile menu -->
      @if (open()) {
        <nav class="border-t border-line bg-base-100 px-5 py-3 text-sm font-medium text-base-content lg:hidden">
          <!-- No accordion: vertical space is free on mobile, so the audiences are simply
               grouped under a label rather than hidden behind another tap. -->
          <p class="pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">Who it's for</p>
          @for (item of audiences; track item.id) {
            <a [routerLink]="item.path" class="block py-2.5 pl-3 hover:text-primary" (click)="open.set(false)">{{
              item.label
            }}</a>
          }
          <div class="my-2 border-t border-line"></div>
          @for (link of nav; track link.path) {
            <a [routerLink]="link.path" class="block py-2.5 hover:text-primary" (click)="open.set(false)">{{
              link.label
            }}</a>
          }
          <div class="mt-3 flex flex-col gap-2 border-t border-line pt-3">
            <div class="pb-1">
              <pc-currency-switcher />
            </div>
            @if (signedIn()) {
              <a [href]="dashboardUrl" class="btn btn-primary btn-sm rounded-field font-semibold">Dashboard</a>
            } @else {
              <a [href]="loginUrl" class="btn btn-outline btn-sm rounded-field">Log in</a>
              <a [href]="signupUrl" class="btn btn-primary btn-sm rounded-field font-semibold">Start free</a>
            }
          </div>
        </nav>
      }
    </header>
  `,
})
export class SiteHeader {
  public readonly variant = input<HeaderVariant>('solid');

  private readonly auth = inject(AuthHint);

  protected readonly nav = PRIMARY_NAV;
  protected readonly audiences = AUDIENCE_NAV;
  protected readonly loginUrl = LOGIN_URL;
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly dashboardUrl = DASHBOARD_URL;
  protected readonly signedIn = this.auth.signedIn;
  protected readonly open = signal(false);

  protected readonly onDark = computed<boolean>(() => this.variant() === 'over-hero');

  protected readonly barClass = computed<string>(() =>
    this.onDark() ? 'sticky top-0 z-50 bg-navy' : 'sticky top-0 z-50 border-b border-line bg-base-100',
  );

  protected readonly linkClass = computed<string>(() =>
    this.onDark() ? 'text-white/85 hover:text-white' : 'text-base-content hover:text-primary',
  );

  protected readonly loginBtnClass = computed<string>(() =>
    this.onDark()
      ? 'rounded-field border border-white/35 px-4 py-2 font-semibold text-white hover:bg-white/10'
      : 'btn btn-outline btn-sm rounded-field',
  );
}
