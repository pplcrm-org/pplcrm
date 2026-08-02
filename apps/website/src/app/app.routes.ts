import type { Route } from '@angular/router';

/**
 * The /for/… audience URLs render the home page with that audience's hero
 * preselected (via route data) — the full story, tailored, instead of a thin
 * duplicate page that would strand visitors who land on it first. Footer
 * links to pages we haven't built yet resolve to the shared "coming soon"
 * stub so the nav never 404s; swap a stub for a real component when the page
 * exists.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    title: 'pplCRM — One list for constituents, voters, donors and volunteers',
    data: {
      description:
        'One shared list for constituents, voters, donors and volunteers — a shared inbox, ' +
        'canvassing, donations, newsletters and field apps. Free to start with sample data, no card.',
    },
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'faq',
    title: 'FAQ — pplCRM',
    data: {
      description:
        'Answers on the free plan, the demo workspace, importing your list, data ownership, ' +
        'where your data lives, newsletters and how pplCRM pricing works.',
    },
    loadComponent: () => import('./faq/faq-page').then((m) => m.FaqPage),
  },
  {
    path: 'for/offices',
    title: 'For constituency offices — pplCRM',
    data: {
      audience: 'office',
      description:
        'Casework that survives staff turnover: a shared inbox, tasks with due dates and an ' +
        'activity log that remembers every constituent touch. Free to start, no card.',
    },
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'for/campaigns',
    title: 'For campaigns — pplCRM',
    data: {
      audience: 'campaign',
      description:
        'A campaign HQ that keeps score — turf cutting, live field reports, donations and ' +
        'yard-sign routes on one shared list. Free to start with sample data.',
    },
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'for/nonprofits',
    title: 'For non-profits — pplCRM',
    data: {
      audience: 'nonprofit',
      description:
        'Donors, volunteers and neighbours on one list. Gifts, drives and newsletters live on ' +
        "every person's record, so you stop reconciling three spreadsheets.",
    },
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'for/churches',
    title: 'For churches — pplCRM',
    data: {
      audience: 'church',
      description:
        'Members, visitors and volunteers on one list. Giving, groups and follow-up visits all ' +
        "live on the family's record. Free to start, no card.",
    },
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'compare',
    title: 'pplCRM vs. the spreadsheet stack — pplCRM',
    data: {
      description:
        'See how one people-first list compares to the usual spreadsheet-and-point-tools stack ' +
        'for constituency office, campaign, non-profit and church work.',
    },
    loadComponent: () => import('./compare/compare-page').then((m) => m.ComparePage),
  },
  {
    path: 'switch',
    title: 'Switch to pplCRM from Breeze, Planning Center, NationBuilder or Mailchimp',
    data: {
      description:
        'Step-by-step guides for moving your list to pplCRM: what to export, where every column ' +
        'lands, and what does not come across — stated as plainly as what does.',
    },
    loadComponent: () => import('./switch/switch-page').then((m) => m.SwitchPage),
  },
  {
    path: 'switch/breeze',
    title: 'Moving from Breeze to pplCRM',
    data: {
      guide: 'breeze',
      description:
        'Export your people from Breeze, import them through the pplCRM wizard, and see exactly ' +
        'what maps — people, families, tags and notes in one CSV, limits stated plainly.',
    },
    loadComponent: () => import('./switch/switch-guide-page').then((m) => m.SwitchGuidePage),
  },
  {
    path: 'switch/planning-center',
    title: 'Moving from Planning Center to pplCRM',
    data: {
      guide: 'planning-center',
      description:
        'Export your Planning Center People list, import it through the pplCRM wizard, and see ' +
        'exactly what maps — households, tags and notes in one CSV, limits stated plainly.',
    },
    loadComponent: () => import('./switch/switch-guide-page').then((m) => m.SwitchGuidePage),
  },
  {
    path: 'switch/nationbuilder',
    title: 'Moving from NationBuilder to pplCRM',
    data: {
      guide: 'nationbuilder',
      description:
        'Export your NationBuilder people as a CSV and import them into pplCRM, where contacts ' +
        'and households are unlimited on every plan. Column-by-column mapping, limits stated plainly.',
    },
    loadComponent: () => import('./switch/switch-guide-page').then((m) => m.SwitchGuidePage),
  },
  {
    path: 'switch/mailchimp',
    title: 'Moving from Mailchimp to pplCRM',
    data: {
      guide: 'mailchimp',
      description:
        'Export your subscribed Mailchimp audience and import it into pplCRM in four steps — ' +
        'plus the honest part: how newsletter consent works here and what to do before your first send.',
    },
    loadComponent: () => import('./switch/switch-guide-page').then((m) => m.SwitchGuidePage),
  },
  {
    path: 'pricing',
    title: 'Pricing — pplCRM',
    data: {
      description:
        'Start free forever, then scale on plans priced by your emailable subscribers, not your ' +
        'total contacts. Store your whole list for free and pay only for who you email.',
    },
    loadComponent: () => import('./pricing/pricing-page').then((m) => m.PricingPage),
  },
  {
    path: 'docs',
    pathMatch: 'full',
    title: 'Docs — pplCRM',
    data: {
      description:
        'Guides for pplCRM: getting started, importing your list, the shared inbox, canvassing, ' +
        'donations, newsletters, forms and the field companions.',
    },
    loadComponent: () => import('./docs/docs-home').then((m) => m.DocsHome),
  },
  {
    // Per-article title/meta/canonical are set inside the component from the
    // resolved article (see DocsArticle).
    path: 'docs/:id',
    title: 'Docs — pplCRM',
    loadComponent: () => import('./docs/docs-article').then((m) => m.DocsArticle),
  },
  {
    path: 'about',
    title: 'About us — pplCRM',
    data: {
      description:
        'Why we build pplCRM — a people-first CRM for the constituency offices, campaigns and ' +
        'non-profits that treat their list as their most important asset.',
    },
    loadComponent: () => import('./company/about-page').then((m) => m.AboutPage),
  },
  {
    path: 'careers',
    title: 'Careers — pplCRM',
    data: {
      description: 'Interested in helping build pplCRM? Learn how we work and how to get in touch.',
    },
    loadComponent: () => import('./company/careers-page').then((m) => m.CareersPage),
  },
  {
    path: 'data-ownership',
    title: 'Data ownership — pplCRM',
    data: {
      description:
        'Your list is yours: never sold, never shared, never mined. Export everything to plain ' +
        'CSV on every plan, and delete means deleted.',
    },
    loadComponent: () => import('./company/data-ownership-page').then((m) => m.DataOwnershipPage),
  },
  {
    path: 'privacy',
    title: 'Privacy policy — pplCRM',
    data: {
      description:
        'How pplCRM handles your data: no third-party analytics, no ad trackers, per-organization ' +
        'isolated workspaces, and plain-CSV export on every plan.',
    },
    loadComponent: () => import('./legal/privacy-page').then((m) => m.PrivacyPage),
  },
  {
    path: 'eula',
    title: 'End user license agreement — pplCRM',
    data: { description: 'The end user license agreement for pplCRM.' },
    loadComponent: () => import('./legal/eula-page').then((m) => m.EulaPage),
  },
  {
    path: 'security',
    title: 'Security — pplCRM',
    data: {
      description:
        'How pplCRM keeps your list safe: isolated per-organization workspaces, encrypted data, ' +
        'and newsletters sent from your own verified domain.',
    },
    loadComponent: () => import('./legal/security-page').then((m) => m.SecurityPage),
  },
  {
    // Generic stub for footer links whose real page doesn't exist yet; the
    // heading comes from a ?pageTitle= query param (bound via component input).
    path: 'soon',
    title: 'Coming soon — pplCRM',
    loadComponent: () => import('./coming-soon/coming-soon-page').then((m) => m.ComingSoonPage),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
