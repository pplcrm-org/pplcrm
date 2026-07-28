import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { SIGNUP_URL } from '../ui/site-nav';

interface Principle {
  readonly body: string;
  readonly icon: string;
  readonly title: string;
}

/**
 * About us: why pplCRM exists and the principles the product answers to.
 * Deliberately free of headcount, customer counts, and founder mythology;
 * the page makes only claims the product itself keeps.
 */
@Component({
  selector: 'pc-about-page',
  imports: [RouterLink, SiteHeader, SiteFooter, SiteIcon],
  templateUrl: './about-page.html',
})
export class AboutPage {
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly mailto = 'mailto:hello@pplcrm.com';

  protected readonly principles: readonly Principle[] = [
    {
      icon: 'users',
      title: 'Relationships, not pipelines',
      body: 'Sales CRMs exist to move deals to “closed”. Community work never closes: the same people, the same streets, year after year. Everything in pplCRM is shaped by that one difference.',
    },
    {
      icon: 'lock-closed',
      title: 'Your people are not our product',
      body: 'We charge money for software. That is the whole business model. We never sell, share, rent or mine the people in your workspace, and we never will.',
    },
    {
      icon: 'chat-bubble-bottom-center-text',
      title: 'Plain language everywhere',
      body: 'Buttons say what they do. Disabled things explain what they are waiting for. Volunteers should be productive their first morning, without a training budget.',
    },
    {
      icon: 'map',
      title: 'Built for the field',
      body: 'The work happens at doors and on driveways, not just at desks. Turfs, routes and the companion apps are first-class parts of the product, not bolt-ons.',
    },
    {
      icon: 'currency-dollar',
      title: 'Priced for real budgets',
      body: 'Constituency offices, local campaigns, small non-profits and churches do not have enterprise budgets. Unlimited contacts on every plan; you pay only for features and email subscribers.',
    },
    {
      icon: 'arrow-down-tray',
      title: 'Easy to leave',
      body: 'Everything exports to plain CSV on every plan, whenever you want. A tool you can leave in an afternoon is a tool that has to keep earning your trust.',
    },
  ];
}
