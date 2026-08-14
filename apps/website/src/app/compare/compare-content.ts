import type { SwitchSlug } from '../switch/switch-content';

/**
 * The named-competitor charts on /compare.
 *
 * Three rules keep these defensible, and the first is enforced by the type system:
 *
 *  1. A NEGATIVE claim about another product (`partial` or `not-offered`) REQUIRES a `source`
 *     URL to that vendor's own public documentation — an unsourced negative is a compile
 *     error. `built-in` and `different-focus` cells may carry a source but do not need one.
 *  2. The pplCRM column states only registry-backed facts (`pplcrm-website-claims`) — nothing
 *     aspirational, nothing planned.
 *  3. Each chart prints `checkedOn`, the real date the sources were read. Re-verify the
 *     sources and bump the date whenever a cell changes. Never print a competitor's prices,
 *     seat counts or plan names as numbers — they change without notice; describe the
 *     structure ("priced by database size") instead.
 *
 * Where a competitor genuinely has the feature, the cell says `built-in` — conceding
 * strengths is what makes the rest of the chart believable. All cells below were verified
 * against the linked vendor pages on 2026-08-11.
 */

export type CompareCategoryId = 'generic' | 'political' | 'community';

export type Verdict = 'built-in' | 'partial' | 'not-offered' | 'different-focus';

export const VERDICT_LABELS: Readonly<Record<Verdict, string>> = {
  'built-in': 'Built in',
  partial: 'Partial',
  'not-offered': 'Not offered',
  'different-focus': 'Different focus',
};

/** A competitor cell. The union makes an unsourced negative claim a compile error. */
export type CompareCell =
  | { readonly verdict: 'built-in' | 'different-focus'; readonly note: string; readonly source?: string }
  | { readonly verdict: 'partial' | 'not-offered'; readonly note: string; readonly source: string };

export interface CompetitorRef {
  /** Stable key — also the slug a future /compare/<slug> page would use. */
  readonly slug: string;
  readonly name: string;
  /** One neutral sentence on what the tool is, in its own words where possible. */
  readonly note: string;
  /** Set when a /switch guide exists for this tool; the chart links it. */
  readonly switchGuide?: SwitchSlug;
}

export interface CategoryRow {
  readonly job: string;
  /** The pplCRM cell. Must restate a claims-registry-backed fact. */
  readonly pplcrm: string;
  /** Index-aligned with the chart's `competitors` tuple. */
  readonly cells: readonly [CompareCell, CompareCell, CompareCell];
}

export interface CompareCategoryChart {
  readonly id: CompareCategoryId;
  readonly heading: string;
  readonly intro: string;
  /** The date the sources were actually read, printed under the chart. */
  readonly checkedOn: string;
  readonly competitors: readonly [CompetitorRef, CompetitorRef, CompetitorRef];
  readonly rows: readonly CategoryRow[];
}

/**
 * One date PER CHART, not one shared constant: with a single constant, fixing one chart's
 * cell and bumping the date silently re-dated the other charts' 40-odd sourced cells as
 * "verified today" when they were not (REVIEW7 F7). Bump only the chart whose sources you
 * actually re-read.
 */
const GENERIC_CHECKED_ON = 'August 11, 2026';
const POLITICAL_CHECKED_ON = 'August 11, 2026';
const CHURCH_CHECKED_ON = 'August 11, 2026';

const GENERIC_CHART: CompareCategoryChart = {
  id: 'generic',
  heading: 'The tools you already have open',
  intro:
    'Mailchimp, HubSpot and the spreadsheet are excellent at their own jobs. Organizing streets, households and volunteers is not their job, and their own documentation says so.',
  checkedOn: GENERIC_CHECKED_ON,
  competitors: [
    {
      slug: 'mailchimp',
      name: 'Mailchimp',
      note: 'An email and SMS marketing platform, by its own description.',
      switchGuide: 'mailchimp',
    },
    {
      slug: 'hubspot',
      name: 'HubSpot',
      note: 'A CRM for sales, marketing and customer-service teams.',
    },
    {
      slug: 'spreadsheets',
      name: 'Spreadsheets',
      note: 'Google Sheets or Excel, plus whatever grew around them.',
    },
  ],
  rows: [
    {
      job: 'Canvassing, turfs and walk sheets',
      pplcrm:
        'Cut any list into turfs that stop at your boundary lines; phones and printed walk sheets share one walking order.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'No canvassing, turfs or walk sheets; canvassing arrives only through third-party integrations.',
          source: 'https://mailchimp.com/features/',
        },
        {
          verdict: 'not-offered',
          note: 'No canvassing, turf or walk-sheet features in the product or its docs.',
          source: 'https://www.hubspot.com/products/crm',
        },
        {
          verdict: 'different-focus',
          note: 'A paper list on a clipboard, re-typed at night — if it happens at all.',
        },
      ],
    },
    {
      job: 'Households, not just contacts',
      pplcrm:
        'One address, several residents, one record — with every electoral area the address falls in held against it.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'Audiences are flat contact lists organized by tags, groups and segments; no household unit.',
          source: 'https://mailchimp.com/help/getting-started-audience/',
        },
        {
          verdict: 'not-offered',
          note: 'Standard objects are contacts, companies, deals and tickets; custom objects need an Enterprise plan.',
          source: 'https://knowledge.hubspot.com/records/understand-objects',
        },
        {
          verdict: 'different-focus',
          note: 'A “household” is three rows that share a typo.',
        },
      ],
    },
    {
      job: 'Ridings and districts on every door',
      pplcrm:
        'Published official maps selectable in a click; every located household knows its areas, in your race’s own words.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'No electoral concept; fields are name, address and phone, plus generic custom fields you fill yourself.',
          source: 'https://mailchimp.com/help/manage-audience-signup-form-fields/',
        },
        {
          verdict: 'not-offered',
          note: 'Location defaults stop at city, state and postal code; a custom property can hold a label by hand, with no map behind it.',
          source: 'https://knowledge.hubspot.com/properties/hubspots-default-contact-properties',
        },
        {
          verdict: 'different-focus',
          note: 'One column headed “Ward”, overwritten by the next import.',
        },
      ],
    },
    {
      job: 'Volunteers in the field',
      pplcrm:
        'Account-less companion apps: a personal link plus a one-time code, one admin approval per volunteer, revocable from every phone.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'Its mobile app is for the account owner and requires a Mailchimp login.',
          source: 'https://mailchimp.com/features/mailchimp-mobile/',
        },
        {
          verdict: 'not-offered',
          note: 'The mobile app requires a HubSpot user login, and every user on a paid plan holds a seat.',
          source: 'https://knowledge.hubspot.com/account-mangagement/how-to-install-the-hubspot-mobile-application',
        },
        {
          verdict: 'different-focus',
          note: 'Sharing the spreadsheet link — and hoping.',
        },
      ],
    },
    {
      job: 'What the price scales with',
      pplcrm: 'Emailable subscribers only. The whole voter file is free to store, on every plan.',
      cells: [
        {
          verdict: 'different-focus',
          note: 'Priced by contact-count tiers; unsubscribed and non-subscribed contacts still count toward the bill.',
          source: 'https://mailchimp.com/help/about-your-contacts/',
        },
        {
          verdict: 'different-focus',
          note: 'Priced by paid seats plus marketing-contact tiers; one contact over a tier moves you up a tier.',
          source: 'https://knowledge.hubspot.com/account/understand-marketing-contacts-billing',
        },
        {
          verdict: 'different-focus',
          note: 'Free — plus the reconciling hours and the mistakes that slip out in between.',
        },
      ],
    },
  ],
};

const POLITICAL_CHART: CompareCategoryChart = {
  id: 'political',
  heading: 'The political platforms',
  intro:
    'The tools a campaign manager will name. NGP VAN is the US Democratic ecosystem’s standard and this chart says so; the structural differences are who can use each tool, what ships bundled, and what happens after the knock.',
  checkedOn: POLITICAL_CHECKED_ON,
  competitors: [
    {
      slug: 'nationbuilder',
      name: 'NationBuilder',
      note: 'A community-organizing platform priced by database size.',
      switchGuide: 'nationbuilder',
    },
    {
      slug: 'ngpvan',
      name: 'NGP VAN',
      note: 'The standard toolset of the US Democratic and progressive movement.',
    },
    {
      slug: 'ecanvasser',
      name: 'Ecanvasser',
      note: 'A field-canvassing platform that syncs with CRMs and email tools.',
    },
  ],
  rows: [
    {
      job: 'Turf cutting bounded by electoral lines',
      pplcrm:
        'Turfs are cut along your race’s own boundary maps — polling division, riding, ward — and never cross a line. Included, not an add-on.',
      cells: [
        {
          verdict: 'partial',
          note: 'Map-view turf cutting draws hand-made shapes; mapping and walk sheets are paid add-ons, and turfs are not bounded by electoral polygons.',
          source: 'https://support.nationbuilder.com/en/articles/2306507-how-to-use-map-view-and-turf-cut',
        },
        {
          verdict: 'built-in',
          note: 'Full turf cutting — manual, automatic or distributed — feeding lists to MiniVAN.',
          source: 'https://www.ngpvan.com/wp-content/uploads/Turf-Cutting-OBP.pdf',
        },
        {
          verdict: 'built-in',
          note: 'Map territories by polygon or free-draw, or from boundary files you upload yourself.',
          source: 'https://www.ecanvasser.com/feature/territory-mapping',
        },
      ],
    },
    {
      job: 'Official boundary maps in the box',
      pplcrm:
        'Elections Canada federal ridings, Elections Ontario and Elections Alberta provincial maps, and US congressional and state legislative maps — selectable in a click, free.',
      cells: [
        {
          verdict: 'partial',
          note: 'Auto-districting labels a contact’s districts from their address; there is no selectable boundary map to see or cut against.',
          source: 'https://support.nationbuilder.com/en/articles/3296866-how-auto-districting-works',
        },
        {
          verdict: 'different-focus',
          note: 'Built for the US ecosystem it serves; its site describes US campaigns, PACs and unions, and mentions no Canadian offering.',
          source: 'https://www.ngpvan.com/',
        },
        {
          verdict: 'partial',
          note: 'Territories come from hand-drawing or shapefiles you supply; no bundled official electoral maps.',
          source: 'https://www.ecanvasser.com/feature/territory-mapping',
        },
      ],
    },
    {
      job: 'A volunteer app with no installs, no accounts',
      pplcrm:
        'A personal link plus a one-time code, in the phone’s browser. No app store, no volunteer passwords; one admin approval per volunteer.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'No first-party canvassing app; mobile canvassing happens through third-party partner apps.',
          source: 'https://support.nationbuilder.com/en/articles/4377332-field-community-organizing',
        },
        {
          verdict: 'partial',
          note: 'MiniVAN is the industry standard — volunteers install the app and log in with an ActionID account.',
          source: 'https://www.ngpvan.com/blog/canvassing-with-minivan/',
        },
        {
          verdict: 'partial',
          note: 'The Walk app is the core product — installed from the app stores, with a volunteer profile and password.',
          source: 'https://support.ecanvasser.com/en/articles/2499368-walk-app-getting-started',
        },
      ],
    },
    {
      job: 'Yard signs: from doorstep answer to delivery route',
      pplcrm:
        'A “wants a sign” answer at the door becomes a request; requests become hour-sized driving routes with a one-stop driver page.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'No yard-sign feature; the “yard sign planner” page on its site is a customer suggestion from 2012.',
          source: 'https://nationbuilder.com/yard_sign_planner',
        },
        {
          verdict: 'not-offered',
          note: 'No yard-sign tracking or delivery routing documented; the closest is a canvass script question recording willingness.',
          source: 'https://www.ngpvan.com/',
        },
        {
          verdict: 'different-focus',
          note: 'A canvassing platform — teams, doors and voter interactions; sign logistics are not part of its described feature set.',
          source: 'https://www.ecanvasser.com/use-case/political-campaigns',
        },
      ],
    },
    {
      job: 'Canadian official receipting',
      pplcrm:
        'CRA charitable plus federal, BC, Alberta and Ontario political regimes, gap-free numbering, cancel-and-replace — with the Elections Ontario and Élections Québec carve-outs stated plainly.',
      cells: [
        {
          verdict: 'partial',
          note: 'Generic email/PDF receipts with a tax-deductible flag; custom PDFs go through a third-party integration. No CRA-numbered regimes.',
          source: 'https://support.nationbuilder.com/en/articles/2359914-donation-receipts',
        },
        {
          verdict: 'not-offered',
          note: 'Compliance means US campaign finance — FEC and state disclosure reports; no CRA or tax-receipt capability.',
          source: 'https://www.ngpvan.com/compliance-reporting/',
        },
        {
          verdict: 'not-offered',
          note: 'No receipting; donation collection itself is delegated to payment-processor integrations.',
          source: 'https://www.ecanvasser.com/integrations',
        },
      ],
    },
    {
      job: 'What the price scales with',
      pplcrm:
        'Emailable subscribers. Contacts and households are unlimited on every plan — a voter file is free to store.',
      cells: [
        {
          verdict: 'different-focus',
          note: 'Public tiers priced by database size, with overage fees above each tier’s cap.',
          source: 'https://nationbuilder.com/pricing',
        },
        {
          verdict: 'different-focus',
          note: 'No public pricing; every path on the site is a sales-demo request.',
          source: 'https://www.ngpvan.com/',
        },
        {
          verdict: 'different-focus',
          note: 'Public tiers priced by territory size — contacts or houses, whichever is higher — with unlimited users.',
          source: 'https://www.ecanvasser.com/pricing',
        },
      ],
    },
  ],
};

const COMMUNITY_CHART: CompareCategoryChart = {
  id: 'community',
  heading: 'The community and donor tools',
  intro:
    'The tools a non-profit or congregation is likely already using. Where they are strong — Planning Center’s households and Canadian receipting are real — the chart concedes it.',
  checkedOn: CHURCH_CHECKED_ON,
  competitors: [
    {
      slug: 'planning-center',
      name: 'Planning Center',
      note: '“The flexible system that brings ministry details together.”',
      switchGuide: 'planning-center',
    },
    {
      slug: 'little-green-light',
      name: 'Little Green Light',
      note: 'Donor management priced by constituent record count, users unlimited.',
    },
    {
      slug: 'civicrm',
      name: 'CiviCRM',
      note: 'Open-source CRM you self-host or run through a hosting partner.',
    },
  ],
  rows: [
    {
      job: 'Door-to-door visits, drives and delivery routes',
      pplcrm:
        'Visits and drives run as turfs and hour-sized routes, with account-less phone pages for the volunteers who walk and drive them.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'Its modules are Services, People, Groups, Check-Ins, Giving, Calendar, Registrations and Publishing — no field-outreach or routing module.',
          source: 'https://www.planningcenter.com/',
        },
        {
          verdict: 'not-offered',
          note: 'Fundraising and donor management; volunteer features track interests and hours, not field work or routes.',
          source: 'https://www.littlegreenlight.com/features/',
        },
        {
          verdict: 'partial',
          note: 'CiviCampaign prints paper walk lists from surveys; no boundary-bounded turf cutting, mobile canvass app or routing.',
          source: 'https://docs.civicrm.org/user/en/latest/survey/what-is-civisurvey/',
        },
      ],
    },
    {
      job: 'Canadian tax receipting',
      pplcrm:
        'CRA official receipts with gap-free numbering and cancel-and-replace corrections; donors outside a regime get giving summaries marked as exactly that.',
      cells: [
        {
          verdict: 'built-in',
          note: 'Its Canadian donor statements meet CRA receipt requirements — signature, registration number, unique receipt number — per its own docs.',
          source: 'https://help.planningcenter.com/en/138382-monetary-donation-receipts-and-acknowledgments.html',
        },
        {
          verdict: 'partial',
          note: 'Sequential receipt numbers for Canadian accounts via a settings toggle; the receipt itself is a template you build, with no CRA-compliance claim.',
          source: 'https://help.littlegreenlight.com/article/423-add-receipt-numbers-to-acknowledgments',
        },
        {
          verdict: 'partial',
          note: 'Via the CDN Tax Receipts extension — stable and maintained, but an add-on you install, not core.',
          source: 'https://civicrm.org/extensions/cdn-tax-receipts',
        },
      ],
    },
    {
      job: 'A deliverability gate before a send',
      pplcrm:
        'Every newsletter is scored before it leaves; a score below 50 cannot send, and an AI content review runs on every check.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'Email problems surface after sending — warning icons and failed statuses; the docs describe no pre-send gate.',
          source: 'https://help.planningcenter.com/en/139174-send-an-email.html',
        },
        {
          verdict: 'partial',
          note: 'Built-in direct email with per-address deliverability checks and send limits; no campaign-level score gate.',
          source: 'https://help.littlegreenlight.com/article/460-sending-email-directly-from-little-green-light',
        },
        {
          verdict: 'not-offered',
          note: 'CiviMail deliverability docs are sysadmin guidance — SPF, DKIM, DMARC, blacklists — not an automated gate.',
          source: 'https://docs.civicrm.org/sysadmin/en/latest/setup/civimail/deliverability/',
        },
      ],
    },
    {
      job: 'A shared team inbox',
      pplcrm:
        'Connect Gmail or Microsoft 365 and mail flows both ways; every message gets an owner and a service-level clock, and one click turns it into a task with a due date.',
      cells: [
        {
          verdict: 'not-offered',
          note: 'No inbox module anywhere in its product line.',
          source: 'https://www.planningcenter.com/',
        },
        {
          verdict: 'not-offered',
          note: 'No Gmail or Microsoft sync; email capture is per-message BCC or forwarding into the record.',
          source: 'https://www.littlegreenlight.com/integrations/',
        },
        {
          verdict: 'not-offered',
          note: 'Inbound processing files mail as contact activities; there is no inbox screen for reading and replying.',
          source: 'https://docs.civicrm.org/sysadmin/en/latest/setup/civimail/inbound/',
        },
      ],
    },
    {
      job: 'What it is instead',
      pplcrm: 'One list with the field, the mail and the money attached — built for organizing work specifically.',
      cells: [
        {
          verdict: 'different-focus',
          note: 'Church management done well: worship planning, check-ins and congregation records, “made for churches of every kind and size.”',
          source: 'https://www.planningcenter.com/',
        },
        {
          verdict: 'different-focus',
          note: 'Simple donor management priced by constituent record count, with unlimited users.',
          source: 'https://www.littlegreenlight.com/pricing/',
        },
        {
          verdict: 'different-focus',
          note: 'Open source and free to download; you self-host or pay a hosting partner, and upgrades are yours to run.',
          source: 'https://civicrm.org/download',
        },
      ],
    },
  ],
};

export const COMPARE_CHARTS: readonly CompareCategoryChart[] = [GENERIC_CHART, POLITICAL_CHART, COMMUNITY_CHART];
