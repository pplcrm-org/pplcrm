import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ORG_MODES, PLANS, isOrgMode, startingPriceUsd } from '@common';
import type { PlanDef } from '@common';

import { AUDIENCE_CONTENT, type Audience, type Feature } from './audience-content';
import { BrowserFrame } from '../ui/browser-frame';
import { Constellation } from '../ui/constellation';
import { CurrencyService } from '../ui/currency.service';
import { SeoService } from '../ui/seo';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { audiencePath, signupUrlFor } from '../ui/site-nav';

import { environment } from '../../environments/environment';

interface Qa {
  readonly q: string;
  readonly a: string;
}

@Component({
  selector: 'pc-home-page',
  imports: [RouterLink, SiteHeader, SiteFooter, BrowserFrame, SiteIcon, Constellation],
  templateUrl: './home-page.html',
})
export class HomePage {
  private readonly seo = inject(SeoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /**
   * The audience this page is rendering for.
   *
   * The /for/… routes supply it in route data (see app.routes.ts); `/` has none and reads as the
   * default. Taken from the snapshot rather than the observable because each /for/… path is its
   * own route config, so switching audience re-creates the component — which is exactly what
   * makes `pick()` able to navigate.
   */
  protected readonly aud: Audience = ((value: unknown): Audience => (isOrgMode(value) ? value : 'office'))(
    inject(ActivatedRoute).snapshot.data['audience'],
  );

  protected readonly copy = AUDIENCE_CONTENT[this.aud];
  protected readonly hero = this.copy.hero;
  protected readonly steps = this.copy.steps;
  protected readonly features = this.copy.features;
  protected readonly companionFeatures = this.copy.companionFeatures;
  protected readonly field = this.copy.field;
  protected readonly doors = this.copy.field.doors;
  protected readonly closing = this.copy.closing;

  /** Carries the audience into signup so the visitor is not asked the same question twice. */
  protected readonly audienceSignupUrl = signupUrlFor(this.aud);

  /** Singular labels for the hero's "I'm a…" picker; the nav uses the plural forms. */
  protected readonly audiences: readonly { id: Audience; label: string }[] = ORG_MODES.map((id) => ({
    id,
    label: AUDIENCE_CONTENT[id].pickerLabel,
  }));

  constructor() {
    // SoftwareApplication rich-result data, described for THIS audience. Emitting the same
    // three-vertical blurb on all four URLs made them read as near-duplicates to a crawler.
    this.seo.setJsonLd('software', {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'pplCRM',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      url: `${environment.siteUrl}${this.route.snapshot.data['audience'] ? audiencePath(this.aud) : ''}`,
      description: this.copy.jsonLdDescription,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free plan' },
    });
  }

  /**
   * Switching audience navigates rather than just setting a signal.
   *
   * The old local-only toggle left the URL, <title>, meta description and canonical on the
   * previous audience while the body showed another — and now that the body copy varies too,
   * that mismatch would be the whole page. Navigating re-runs SeoTitleStrategy and makes the
   * choice shareable. Every /for/… page is prerendered, so this is a static fetch.
   */
  protected pick(id: Audience): void {
    if (id === this.aud) return;
    void this.router.navigate([audiencePath(id)]);
  }

  /** The three comparative claims in the "Why pplCRM" band — each one names a real alternative and beats it. */
  protected readonly whyPillars: readonly Feature[] = [
    {
      icon: 'clock',
      title: 'Built for the long game',
      body: 'A sales pipeline forgets a deal the day it closes. Your work compounds: this year’s case becomes next year’s volunteer becomes next cycle’s donor. pplCRM keeps that whole story on one record, however long you work the same streets.',
    },
    {
      icon: 'lock-closed',
      title: 'Your list is yours',
      body: 'A supporter list is the most sensitive thing an organization owns. Yours is never sold, never shared and never mined, and it lives in Canada in a workspace no other organization touches. The exit is never locked either; export everything to plain CSV, on every plan.',
    },
    {
      icon: 'paper-airplane',
      title: 'Email that lands',
      body: 'On big email platforms your newsletter shares a sending reputation with thousands of strangers, including the spammers. Here you send from your own verified domain, so the reputation you build is yours alone. Warm-up limits and abuse guardrails keep spammers off the platform entirely.',
    },
  ];

  protected readonly growFeatures: readonly Feature[] = [
    {
      icon: 'clipboard-document-list',
      title: 'Web forms & automations',
      body: 'Publish a signup or pledge page in minutes; every response becomes a person on your list. Then automations send the welcome, add the tag and open the task while you sleep.',
    },
    {
      icon: 'calendar',
      title: 'Events & volunteer shifts',
      body: 'Put an event online and open its shifts; volunteers claim them and land on the list already. No re-typing names off a signup sheet.',
    },
    {
      icon: 'credit-card',
      title: 'Online giving pages',
      body: 'Share a donation page and gifts land straight on the donor’s record: receipted, thanked and counted. No third spreadsheet to reconcile.',
    },
    {
      icon: 'rectangle-stack',
      title: 'One list, every campaign',
      body: 'Run this season and the next from one shared rolodex. Each campaign keeps its own supporters, mail and routes; admins decide who works in which, and the whole workspace follows.',
    },
  ];

  /** The three claims beside the constellation animation in the network band. */
  protected readonly networkPoints: readonly Feature[] = [
    {
      icon: 'user-group',
      title: 'See the web, not the spreadsheet',
      body: 'Households, workplaces, tags and shared causes tie your list together. pplCRM keeps every thread.',
    },
    {
      icon: 'route',
      title: 'Warm paths beat cold lists',
      body: 'Reach new people through the neighbour who already knows you. An introduction opens doors a cold call never will.',
    },
    {
      icon: 'presentation-chart-line',
      title: 'Every touch sharpens the map',
      body: 'Visits, notes, gifts and RSVPs each add a datapoint. The longer you organize, the smarter your network gets.',
    },
  ];

  private readonly currency = inject(CurrencyService);

  /** The three priced teaser cards (Free / Grassroots / Movement); enterprise stays a footnote elsewhere. */
  protected readonly tiers: readonly PlanDef[] = PLANS.filter((plan) => plan.displayed);

  /** "Starting at" price for a teaser card, in the active display currency ('$0', 'From €65', …). */
  protected startingPrice(plan: PlanDef): string {
    const usd = startingPriceUsd(plan);
    if (usd === null) return 'Custom';
    if (usd === 0) return this.currency.format(0);
    return `From ${this.currency.format(usd)}`;
  }

  protected readonly faqs: readonly Qa[] = [
    {
      q: 'Is the free plan really free?',
      a: 'Yes. No card and no time limit. The free plan stays free forever: 1,000 email subscribers, unlimited contacts and households, and 2 staff seats.',
    },
    {
      q: 'What is the demo workspace?',
      a: 'A ready-made sample workspace — realistic people and households, donors and a live inbox — so you can try every feature without touching real data. Every new workspace gets one, matched to the kind of organization you sign up as.',
    },
    {
      q: 'Can I import my existing list?',
      a: 'Yes. CSV import takes minutes and duplicates merge automatically on the way in.',
    },
    {
      q: 'Can I get my data back out?',
      a: 'Always. People, notes and donations export to plain CSV whenever you want.',
    },
    {
      q: 'Who owns the data?',
      a: 'You do. We never sell, share or rent it, and delete means deleted. Each organization runs in its own isolated workspace.',
    },
    {
      q: 'Where does my data live?',
      a: 'In Canada, isolated from every other organization’s workspace.',
    },
    {
      q: 'Will my newsletter land in spam?',
      a: 'You send from your own verified domain, so inbox providers judge you on your record, not a stranger’s. New senders warm up gradually, and unsubscribes are honored automatically.',
    },
    {
      q: 'How does pricing work?',
      a: 'Three plans: Free forever, Grassroots from $29/month and Movement from $55/month — or pay annually and get 2 months free. The price scales with your emailable subscribers, never your total contacts, so you can store your whole list for free and only pay for who you email.',
    },
  ];
}
