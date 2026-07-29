import { Component, inject } from '@angular/core';

import { SeoService } from '../ui/seo';
import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SIGNUP_URL } from '../ui/site-nav';

interface Qa {
  readonly q: string;
  readonly a: string;
}

interface Group {
  readonly label: string;
  readonly items: readonly Qa[];
}

@Component({
  selector: 'pc-faq-page',
  imports: [SiteHeader, SiteFooter],
  templateUrl: './faq-page.html',
})
export class FaqPage {
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly mailto = 'mailto:hello@pplcrm.com';

  private readonly seo = inject(SeoService);

  constructor() {
    // FAQPage rich-result data, built from the same Q&A shown on the page.
    this.seo.setJsonLd('faq', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: this.groups.flatMap((group) =>
        group.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      ),
    });
  }

  protected readonly groups: readonly Group[] = [
    {
      label: 'Getting started',
      items: [
        {
          q: 'Is the free plan really free?',
          a: 'Yes. No card and no time limit. The demo workspace, unlimited contacts and households, and 1,000 email subscribers stay free for as long as you want them.',
        },
        {
          q: 'What is the demo workspace?',
          a: 'A complete sample workspace for a fictional organization like yours: realistic people and households, donors, a live inbox and the work in progress your team would actually be doing. It exists so you can try every feature, including the destructive ones, without touching real data.',
        },
        {
          q: 'Do I need training to get started?',
          a: 'Most teams are triaging real cases their first morning. Buttons say what they do in plain language, and anything disabled tells you exactly what it’s waiting for.',
        },
        {
          q: 'How do I move from the demo to real work?',
          a: 'Import your spreadsheet. Duplicates merge automatically on the way in, and the sample data steps aside.',
        },
      ],
    },
    {
      label: 'Your data',
      items: [
        {
          q: 'Who owns the data?',
          a: 'You do. We never sell, share or rent it. Your donors and constituents are not our product.',
        },
        {
          q: 'Can I get my data back out?',
          a: 'Always. People, notes, donations and history export to plain CSV whenever you want, on every plan.',
        },
        {
          q: 'Is my workspace shared with other organizations?',
          a: 'No. Each organization runs in its own isolated workspace.',
        },
        {
          q: 'Where is my data stored?',
          a: 'In Canada. Your workspace data stays there for processing and backups.',
        },
        {
          q: 'What happens when I delete something?',
          a: 'Delete means deleted. Records are purged, not quietly archived for us to keep. Deleting a user login removes their personal details for good; the work they contributed stays with your workspace, shown as “Deleted user”.',
        },
      ],
    },
    {
      label: 'Newsletters',
      items: [
        {
          q: 'Will my newsletter land in spam?',
          a: 'Your mail goes out from your own verified domain, so inbox providers judge you on your own sending record, not on the worst spammer sharing your pipe. And before every send, an AI deliverability check scores your draft 0–100 against spam patterns and shows you exactly what to fix — on every plan, including Free.',
        },
        {
          q: 'Why do I verify a domain before sending?',
          a: 'Verification proves to inbox providers that the mail really comes from you. It is the single most effective thing that keeps a newsletter out of spam, and it means the reputation you build belongs to you.',
        },
        {
          q: 'What about unsubscribes and do-not-contact?',
          a: 'Honored automatically, everywhere. When someone unsubscribes or is marked do-not-contact, every future send skips them; nobody has to remember.',
        },
      ],
    },
    {
      label: 'Field apps',
      items: [
        {
          q: 'What do volunteers see?',
          a: 'Only what you hand them: the turf they’re walking or the route they’re driving, on iOS, Android or the web. Not the whole list.',
        },
        {
          q: 'Do the apps work offline?',
          a: 'Yes. Door lists and routes are offline-first, and knocks sync back to the field report when you’re in signal again.',
        },
        {
          q: 'Do field volunteers need their own seats?',
          a: 'No. Volunteers join by invite to use the companion apps and don’t take up a staff seat. Companion volunteers are part of the Movement plan, and they’re unlimited.',
        },
      ],
    },
    {
      label: 'Pricing',
      items: [
        {
          q: 'How much does it cost?',
          a: 'Grassroots starts at $29/month and Movement at $55/month, each covering your first 1,000 emailable subscribers. The price steps up in brackets as your list grows, and the pricing page always shows you the exact price at your subscriber count.',
        },
        {
          q: 'Can I pay annually?',
          a: 'Yes. Annual billing costs exactly 10× the monthly price — 2 months free — at every subscriber bracket, paid up front for the year. Monthly stays the default: campaigns that wrap up mid-year shouldn’t prepay twelve months. If your list grows into a higher bracket mid-year, the prorated difference for the rest of your current billing period is charged right away on either interval.',
        },
        {
          q: 'How is pricing metered?',
          a: 'On emailable subscribers, not total contacts. You can store your entire voter or canvassing universe for free and only pay for the people you can actually email; most tools charge you for every contact.',
        },
        {
          q: 'Are there fees on donations?',
          a: 'Donations processed through Stripe carry a 1% platform fee on top of Stripe’s own processing fees, shown transparently in the product. Subscriptions have no hidden fees.',
        },
        {
          q: 'Can I see prices in euros, pounds or Canadian dollars?',
          a: 'Yes. We show estimated prices in your local currency at today’s exchange rate, and you can switch currency on the pricing page. Billing is always in US dollars.',
        },
        {
          q: 'What happens when my list grows?',
          a: 'Nothing surprising, and nothing ever blocks. When your emailable subscribers cross into a new bracket we email your admins, move you to the new bracket, and charge the prorated difference for the rest of your current billing period — so your monthly email allowance grows the moment your list does. If your list shrinks, the price drops at the next renewal automatically.',
        },
        {
          q: 'Do you have a plan for larger organizations?',
          a: 'Yes. Enterprise is for federations, parties and multi-office operations: more than 200,000 subscribers, SSO and multiple linked workspaces. Write to hello@pplcrm.com and we’ll tailor it.',
        },
        {
          q: 'Can I talk to a human before committing?',
          a: 'Yes. Book a 15-minute walkthrough and we’ll set up the demo together, or write to hello@pplcrm.com.',
        },
      ],
    },
  ];
}
