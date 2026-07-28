import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PLANS, startingPriceUsd } from '@common';
import type { PlanDef } from '@common';

import { AppPreview, type PreviewKind } from '../ui/app-preview';
import { BrowserFrame } from '../ui/browser-frame';
import { Constellation } from '../ui/constellation';
import { CurrencyService } from '../ui/currency.service';
import { SeoService } from '../ui/seo';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SiteIcon } from '../ui/site-icon';
import { SIGNUP_URL } from '../ui/site-nav';

import { environment } from '../../environments/environment';

const AUDIENCE_IDS = ['office', 'camp', 'np'] as const;
type Audience = (typeof AUDIENCE_IDS)[number];

function isAudience(value: unknown): value is Audience {
  return AUDIENCE_IDS.some((id) => id === value);
}

interface Hero {
  readonly h1: string;
  readonly sub: string;
  readonly url: string;
  readonly kind: PreviewKind;
  /** Real product screenshot; when absent the <pc-app-preview> mock is shown. */
  readonly img?: string;
}

interface AudienceOption {
  readonly id: Audience;
  readonly label: string;
}

interface Step {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

interface Feature {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

interface Qa {
  readonly q: string;
  readonly a: string;
}

interface Door {
  readonly addr: string;
  readonly who: string;
  readonly chip: string;
  readonly chipClass: string;
}

const HEROES: Record<Audience, Hero> = {
  office: {
    h1: 'Every case answered. Every constituent remembered.',
    sub: 'A shared inbox, tasks with due dates, and an activity log that remembers every touch. Casework that survives staff turnover and election cycles.',
    url: 'app.pplcrm.com/inbox',
    kind: 'inbox',
    img: 'assets/site-shots/01-shot.webp',
  },
  camp: {
    h1: 'Built for the people who knock and win campaigns.',
    sub: 'Turf cutting, live field reports, donations and yard-sign routes. A campaign HQ that keeps score.',
    url: 'app.pplcrm.com/canvassing',
    kind: 'canvassing',
    img: 'assets/site-shots/02-shot.webp',
  },
  np: {
    h1: 'Donors, volunteers and neighbours. One list.',
    sub: 'Stop reconciling three spreadsheets. Gifts, drives and newsletters live on one person’s record.',
    url: 'app.pplcrm.com/donations',
    kind: 'donations',
    img: 'assets/site-shots/03-shot.webp',
  },
};

@Component({
  selector: 'pc-home-page',
  imports: [RouterLink, SiteHeader, SiteFooter, BrowserFrame, AppPreview, SiteIcon, Constellation],
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly signupUrl = SIGNUP_URL;

  private readonly seo = inject(SeoService);

  constructor() {
    // SoftwareApplication rich-result data for the landing page. The free tier
    // ($0) is the checkable, drift-safe offer to advertise here.
    this.seo.setJsonLd('software', {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'pplCRM',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      url: environment.siteUrl,
      description:
        'A people-first CRM for constituency offices, campaigns and non-profits: one shared list ' +
        'for constituents, voters, donors and volunteers, with a shared inbox, canvassing, ' +
        'donations, newsletters and field apps.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free plan' },
    });
  }

  /** The /for/… routes render this page with their audience preselected (see app.routes.ts). */
  private readonly routeAudience: unknown = inject(ActivatedRoute).snapshot.data['audience'];

  protected readonly aud = signal<Audience>(isAudience(this.routeAudience) ? this.routeAudience : 'office');
  protected readonly hero = computed<Hero>(() => HEROES[this.aud()]);

  protected readonly audiences: readonly AudienceOption[] = [
    { id: 'office', label: 'Constituency office' },
    { id: 'camp', label: 'Campaign' },
    { id: 'np', label: 'Non-profit' },
  ];

  protected readonly steps: readonly Step[] = [
    {
      n: '1',
      title: 'Create your free workspace',
      body: 'Sign up and land in a ready-made demo workspace: sample people and households, a live inbox, cut turfs and a donor ledger. No card.',
    },
    {
      n: '2',
      title: 'Try everything on sample data',
      body: 'Triage a case, cut a turf, send a test newsletter, record a donation. Nothing is locked, and nothing you break is real.',
    },
    {
      n: '3',
      title: 'Import your list when it clicks',
      body: 'Bring your spreadsheet. Duplicates merge automatically and the sample data steps aside.',
    },
  ];

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

  protected readonly features: readonly Feature[] = [
    {
      icon: 'users',
      title: 'People & households',
      body: 'The Ramos family is one door, two voters and a sign request, and the system knows it.',
    },
    {
      icon: 'inbox',
      title: 'A shared inbox & tasks',
      body: 'Connect Gmail or Outlook and mail flows both ways. Every message gets an owner and a due date, so nobody writes to your office twice about the same pothole.',
    },
    {
      icon: 'megaphone',
      title: 'Newsletters that land',
      body: 'Write once, send to the 1,284 people it’s actually for. An AI deliverability check scores every send before it leaves, so spam-filter surprises get caught while they’re still fixable.',
    },
    {
      icon: 'map-pin',
      title: 'Doors & the field',
      body: 'Cut turfs in the office; the crew sees them on their phones. Every knock syncs back live.',
    },
    {
      icon: 'currency-dollar',
      title: 'Donations, gratefully',
      body: '611 donors, each one thanked on time. Pledges, receipts and totals without a second spreadsheet.',
    },
    {
      icon: 'arrow-up-tray',
      title: 'Your spreadsheet, welcomed',
      body: 'Bring the whole messy spreadsheet; duplicates merge on the way in. If you ever leave, everything leaves with you: plain-CSV export, on every plan.',
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
      body: 'Run this race and the next from one shared rolodex. Each campaign keeps its own supporters, mail and turf; admins decide who works in which campaign, and the whole workspace follows.',
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
      body: 'Knocks, notes, gifts and RSVPs each add a datapoint. The longer you organize, the smarter your network gets.',
    },
  ];

  protected readonly companionFeatures: readonly Feature[] = [
    {
      icon: 'map-pin',
      title: 'Canvass companion',
      body: 'Door lists by turf, offline-first, one tap to log a conversation. Knocks land in the field report live.',
    },
    {
      icon: 'ticket',
      title: 'Yard sign routes',
      body: 'Every sign request becomes a stop on a route. Mark it placed and roll on.',
    },
    {
      icon: 'house-modern',
      title: 'Deliveries',
      body: 'Leaflets, hampers and meeting notices become routes with per-street progress for volunteer drivers.',
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
      a: 'A complete sample workspace for a fictional campaign: realistic people and households, donors, a live inbox and cut turfs. Try every feature without touching real data.',
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

  protected readonly doors: readonly Door[] = [
    {
      addr: '214 Alder St',
      who: 'Elena & Marco Ramos',
      chip: 'Supporter',
      chipClass: 'bg-success/20 text-success-content',
    },
    { addr: '218 Alder St', who: 'Wei & Lily Chen', chip: 'Mixed', chipClass: 'bg-info/15 text-[#0e4e6e]' },
    { addr: '222 Alder St', who: 'Denise Cole', chip: 'Not home', chipClass: 'bg-warning/40 text-warning-content' },
    {
      addr: '226 Alder St',
      who: 'Priya Natarajan',
      chip: 'Remaining',
      chipClass: 'bg-base-300/60 text-base-content/60',
    },
    { addr: '230 Alder St', who: 'Marcus Lee', chip: 'Remaining', chipClass: 'bg-base-300/60 text-base-content/60' },
  ];

  protected pick(id: Audience): void {
    this.aud.set(id);
  }
}
