import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';

interface WorkTrait {
  readonly body: string;
  readonly icon: string;
  readonly title: string;
}

/**
 * Careers: honest about the current state (small team, no posted openings)
 * while describing how we work and inviting speculative notes. No fake
 * job-board scaffolding until there are real roles to list.
 */
@Component({
  selector: 'pc-careers-page',
  imports: [RouterLink, SiteHeader, SiteFooter, SiteIcon],
  templateUrl: './careers-page.html',
})
export class CareersPage {
  protected readonly mailto = 'mailto:hello@pplcrm.com?subject=Working%20at%20pplCRM';

  protected readonly traits: readonly WorkTrait[] = [
    {
      icon: 'users',
      title: 'Small and senior',
      body: 'A small team where everyone ships. No layers between the person writing the code and the person answering support email; they are often the same person.',
    },
    {
      icon: 'check-circle',
      title: 'Craft over ceremony',
      body: 'We sweat the details users can feel: honest button labels, fast pages, data that exports cleanly. Polish is how a product earns trust, so it is part of the job, not a nice-to-have.',
    },
    {
      icon: 'lock-closed',
      title: 'Principles with teeth',
      body: 'Your people are not our product is an engineering constraint here, not a slogan. We turn down features and revenue that would break it.',
    },
    {
      icon: 'globe-americas',
      title: 'Consequential users',
      body: 'The people who use pplCRM run constituency offices, local campaigns, non-profits and churches. When the product is good, real communities are served better. That is the point.',
    },
  ];
}
