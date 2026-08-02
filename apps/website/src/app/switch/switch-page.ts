import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SIGNUP_URL } from '../ui/site-nav';
import { EMAIL_CHECK, SWITCH_GUIDES, WIZARD_STEPS } from './switch-content';

/**
 * The /switch hub: one card per migration guide plus the shared import
 * mechanics. The per-tool pages are the SEO landers; this page exists so the
 * footer and compare page have one link that covers all of them.
 */
@Component({
  selector: 'pc-switch-page',
  imports: [SiteHeader, SiteFooter, RouterLink],
  templateUrl: './switch-page.html',
})
export class SwitchPage {
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly mailto = 'mailto:hello@pplcrm.com';
  protected readonly guides = SWITCH_GUIDES;
  protected readonly steps = WIZARD_STEPS;
  protected readonly emailCheck = EMAIL_CHECK;
}
