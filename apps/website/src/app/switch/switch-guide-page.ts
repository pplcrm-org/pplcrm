import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SIGNUP_URL } from '../ui/site-nav';
import { EMAIL_CHECK, SWITCH_GUIDES, WIZARD_STEPS, switchGuideBySlug } from './switch-content';

/**
 * One migration guide, rendered for the tool named in route data. Like the
 * /for/… audience pages, each guide has its own route entry (own title and
 * meta description) pointing at this component with `data.guide` set, so the
 * page prerenders statically and re-creates cleanly per tool.
 */
@Component({
  selector: 'pc-switch-guide-page',
  imports: [SiteHeader, SiteFooter, RouterLink],
  templateUrl: './switch-guide-page.html',
})
export class SwitchGuidePage {
  private readonly slug: string = String(inject(ActivatedRoute).snapshot.data['guide'] ?? '');

  protected readonly guide = switchGuideBySlug(this.slug);
  protected readonly steps = WIZARD_STEPS;
  protected readonly emailCheck = EMAIL_CHECK;
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly mailto = 'mailto:hello@pplcrm.com';

  /** The other three guides, for the cross-links under the honesty section. */
  protected readonly others = SWITCH_GUIDES.filter((g) => g.slug !== this.guide.slug);
}
