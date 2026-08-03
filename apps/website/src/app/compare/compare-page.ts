import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SiteFooter } from '../ui/site-footer';
import { SiteHeader } from '../ui/site-header';
import { SIGNUP_URL } from '../ui/site-nav';

/** One job, told twice: how the spreadsheet stack does it, how pplCRM does it. */
interface CompareRow {
  readonly job: string;
  readonly stack: string;
  readonly crm: string;
}

interface PlatformPoint {
  readonly title: string;
  readonly body: string;
}

@Component({
  selector: 'pc-compare-page',
  imports: [SiteHeader, SiteFooter, RouterLink],
  templateUrl: './compare-page.html',
})
export class ComparePage {
  protected readonly signupUrl = SIGNUP_URL;
  protected readonly mailto = 'mailto:hello@pplcrm.com';

  protected readonly rows: readonly CompareRow[] = [
    {
      job: 'Keeping one person’s story straight',
      stack: 'Three files hold three versions of the same person, and nobody is sure which one is current.',
      crm: 'One record holds the household, the emails, the gifts, the knocks and the notes. Update it once; it’s correct everywhere.',
    },
    {
      job: 'Sending the newsletter',
      stack:
        'Export a CSV, upload it to the email tool, clean the bounces, repeat next month. Unsubscribes live only in the email tool.',
      crm: 'Segments come straight from the live list, and every unsubscribe and do-not-contact is honored automatically.',
    },
    {
      job: 'Staying out of spam',
      stack:
        'Your mail shares a sending reputation with thousands of strangers on the same platform, including the spammers.',
      crm: 'You send from your own verified domain. The reputation you build is yours alone.',
    },
    {
      job: 'Answering everyone who writes in',
      stack: 'Requests live in whoever’s inbox they landed in. Follow-up depends on memory and flags.',
      crm: 'A shared inbox gives every message an owner and a due date; nothing waits on one person remembering.',
    },
    {
      job: 'The field: knocks, signs, deliveries',
      stack: 'Paper lists in the car, re-typed into the sheet at night, if it happens at all.',
      crm: 'Offline-first companion apps for volunteers; every knock and delivery syncs back to the live report.',
    },
    {
      job: 'Knowing which district a door is in',
      stack:
        'One column headed “Ward”, meaning something different in every file you were handed, overwritten the next time somebody re-imports.',
      crm: 'Every boundary covering an address is held against the household at once: riding, ward, congressional district, precinct. Each screen calls them by the word your own race uses.',
    },
    {
      job: 'When a staffer or volunteer leaves',
      stack: 'The master file lived on their laptop. So did the passwords.',
      crm: 'History belongs to the workspace, not a laptop. Access ends with one click; the story stays.',
    },
    {
      job: 'What it costs',
      stack: 'Free, plus the hours spent reconciling files and the mistakes that slip out in between.',
      crm: 'Free forever for unlimited contacts and 1,000 email subscribers. Paid plans price by the people you email, never the size of your list.',
    },
  ];

  /** For visitors evaluating the big organizing platforms; principles, not a feature grid. */
  protected readonly platformPoints: readonly PlatformPoint[] = [
    {
      title: 'Growth is never taxed',
      body: 'Platforms that price by database size charge you for every name you collect. Here contacts and households are unlimited on every plan; you pay only for emailable subscribers.',
    },
    {
      title: 'No contracts, no exit fee',
      body: 'Pay month to month — or annually for 2 months free, your choice — and everything exports to plain CSV on every plan. A tool you can leave anytime is a tool you can trust with your list.',
    },
    {
      title: 'Try before you trust',
      body: 'No sales call, no demo video. The free workspace opens with sample data already in it, so you evaluate with your own hands.',
    },
  ];
}
