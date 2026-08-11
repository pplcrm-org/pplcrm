import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { USE_CASES, useCaseBySlug } from './use-cases-content';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SIGNUP_URL } from '../ui/site-nav';

/**
 * One use-case page, rendered for the scenario named in route data. Like the
 * /switch guides, each scenario has its own route entry (own title and meta
 * description) pointing at this component with `data.useCase` set, so the page
 * prerenders statically and re-creates cleanly per scenario.
 */
@Component({
  selector: 'pc-use-case-page',
  imports: [SiteHeader, SiteFooter, RouterLink],
  templateUrl: './use-case-page.html',
})
export class UseCasePage {
  private readonly slug: string = String(inject(ActivatedRoute).snapshot.data['useCase'] ?? '');

  protected readonly useCase = useCaseBySlug(this.slug);
  protected readonly signupUrl = SIGNUP_URL;

  /** The other scenarios, for the cross-links above the CTA. */
  protected readonly others = USE_CASES.filter((u) => u.slug !== this.useCase.slug);
}
