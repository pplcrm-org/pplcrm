import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { USE_CASES } from './use-cases-content';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SIGNUP_URL } from '../ui/site-nav';

/**
 * The /use-cases hub: one card per scenario. The per-scenario pages are the
 * SEO landers; this page exists so the footer has one link that covers all of
 * them — the same division of labour as /switch.
 */
@Component({
  selector: 'pc-use-cases-page',
  imports: [SiteHeader, SiteFooter, RouterLink],
  templateUrl: './use-cases-page.html',
})
export class UseCasesPage {
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly useCases = USE_CASES;
}
