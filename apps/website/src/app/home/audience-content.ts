import type { OrgMode } from '@common';

/**
 * Per-audience home-page copy.
 *
 * The `/for/…` routes all render one component, so without this every audience read the same
 * campaign-flavoured story below the hero — a non-profit was told about cutting turfs. A block
 * lives here when the JOB differs by vertical, not merely the vocabulary: rewording "Doors & the
 * field" to "Volunteers in the field" would still spend a prime card on the thing a food bank
 * cares least about, so slots are REPLACED rather than relabelled.
 *
 * Blocks that stayed shared (in home-page.ts): the "Why pplCRM" pillars, the network-effect
 * points, the FAQ and the pricing teasers. Those claims are true for everyone, and duplicating
 * them four times would only invite drift.
 *
 * `AUDIENCE_CONTENT` is a TOTAL Record, so adding a fifth organization type is a compile error
 * until every cell is filled — the same discipline `ORG_MODE_TERMS` uses in libs/common.
 *
 * Church wording deliberately mirrors what church mode actually renders in the app (Visitation,
 * Drop-offs, Giving — see `ORG_MODE_TERMS`). A pitch that says "visits" over an app that says
 * "Canvassing" is the credibility gap the website-claims registry exists to prevent.
 */
export type Audience = OrgMode;

export interface Hero {
  readonly h1: string;
  readonly sub: string;
  /** The URL shown in the browser-frame chrome. */
  readonly url: string;
  /** Product screenshot. Required: there is no mock fallback, so a missing shot is a build error. */
  readonly img: string;
  /**
   * Set when `img` is a borrowed shot standing in for one that has not been taken yet, so the
   * build can name it instead of the placeholder passing silently. The asset guard only checks
   * that a file exists — it cannot tell a real hero from a reused one.
   */
  readonly imgIsPlaceholder?: true;
}

export interface Step {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

export interface Feature {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

export interface Door {
  readonly addr: string;
  readonly who: string;
  readonly chip: string;
  readonly chipClass: string;
}

/** The phone mock in the Companion apps band: its header strings plus the door rows. */
export interface FieldPreview {
  readonly context: string;
  readonly place: string;
  readonly meta: string;
  /** Tailwind width class for the progress bar (kept as a literal so Tailwind can see it). */
  readonly progressClass: string;
  readonly progressNote: string;
  readonly conversations: string;
  readonly doors: readonly Door[];
}

export interface Closing {
  readonly h2: string;
  readonly body: string;
}

export interface AudienceCopy {
  /** Singular, for the hero's "I'm a…" picker. The nav uses plural labels — see site-nav.ts. */
  readonly pickerLabel: string;
  readonly hero: Hero;
  readonly steps: readonly Step[];
  readonly features: readonly Feature[];
  readonly companionFeatures: readonly Feature[];
  readonly field: FieldPreview;
  readonly closing: Closing;
  /** SoftwareApplication JSON-LD description; each /for/… URL declares its own. */
  readonly jsonLdDescription: string;
}

const CHIP_SUPPORTIVE = 'bg-success/20 text-success-content';
const CHIP_FOLLOW_UP = 'bg-info/15 text-[#0e4e6e]';
const CHIP_NOT_HOME = 'bg-warning/40 text-warning-content';
const CHIP_REMAINING = 'bg-base-300/60 text-base-content/60';

/** The five household names recur across the site's mock data — keep them identical everywhere. */
const ADDRESSES = ['214 Alder St', '218 Alder St', '222 Alder St', '226 Alder St', '230 Alder St'] as const;
const RESIDENTS = ['Elena & Marco Ramos', 'Wei & Lily Chen', 'Denise Cole', 'Priya Natarajan', 'Marcus Lee'] as const;

/** Door rows differ only by the first two chips — the outcome vocabulary of each vertical. */
function doorsWith(first: string, second: string): readonly Door[] {
  return [
    { addr: ADDRESSES[0], who: RESIDENTS[0], chip: first, chipClass: CHIP_SUPPORTIVE },
    { addr: ADDRESSES[1], who: RESIDENTS[1], chip: second, chipClass: CHIP_FOLLOW_UP },
    { addr: ADDRESSES[2], who: RESIDENTS[2], chip: 'Not home', chipClass: CHIP_NOT_HOME },
    { addr: ADDRESSES[3], who: RESIDENTS[3], chip: 'Remaining', chipClass: CHIP_REMAINING },
    { addr: ADDRESSES[4], who: RESIDENTS[4], chip: 'Remaining', chipClass: CHIP_REMAINING },
  ];
}

/** Slots 2, 3 and 6 keep their shape across audiences; only the example changes. */
const IMPORT_CARD: Feature = {
  icon: 'arrow-up-tray',
  title: 'Your spreadsheet, welcomed',
  body: 'Bring the whole messy spreadsheet; duplicates merge on the way in. If you ever leave, everything leaves with you: plain-CSV export, on every plan.',
};

const NEWSLETTER_CARD: Feature = {
  icon: 'megaphone',
  title: 'Newsletters that land',
  body: 'Write once, send to the 1,284 people it’s actually for. An AI deliverability check scores every send before it leaves, so spam-filter surprises get caught while they’re still fixable.',
};

const IMPORT_STEP: Step = {
  n: '3',
  title: 'Import your list when it clicks',
  body: 'Bring your spreadsheet. Duplicates merge automatically and the sample data steps aside.',
};

export const AUDIENCE_CONTENT: Record<Audience, AudienceCopy> = {
  office: {
    pickerLabel: 'Constituency office',
    hero: {
      h1: 'Every case answered. Every constituent remembered.',
      sub: 'A shared inbox, tasks with due dates, and an activity log that remembers every touch. Casework that survives staff turnover and election cycles.',
      url: 'app.pplcrm.com/inbox',
      img: 'assets/site-shots/01-shot.webp',
    },
    steps: [
      {
        n: '1',
        title: 'Create your free workspace',
        body: 'Sign up and land in a ready-made demo workspace: sample constituents and households, a live inbox and open case files. No card.',
      },
      {
        n: '2',
        title: 'Try everything on sample data',
        body: 'Triage a case, assign a follow-up, send a test newsletter. Nothing is locked, and nothing you break is real.',
      },
      IMPORT_STEP,
    ],
    features: [
      {
        icon: 'users',
        title: 'People & households',
        body: 'The Ramos family is one door, two constituents and one open case file, and the system knows it.',
      },
      {
        icon: 'inbox',
        title: 'A shared inbox & tasks',
        body: 'Connect Gmail or Outlook and mail flows both ways. Every message gets an owner and a due date, so nobody writes to your office twice about the same pothole.',
      },
      NEWSLETTER_CARD,
      {
        icon: 'map-pin',
        title: 'Doors & the field',
        body: 'Cut the riding into walkable routes; staff and volunteers see them on their phones. Every conversation syncs back live.',
      },
      {
        // An office does not fundraise — the riding association does. The shared card used to
        // advertise donations here, which was the wrong pitch for the site's default audience.
        icon: 'calendar',
        title: 'Events & clinics',
        body: 'Mobile office hours, town halls and community clinics. People register online and arrive already on your list.',
      },
      IMPORT_CARD,
    ],
    companionFeatures: [
      {
        icon: 'map-pin',
        title: 'Door-knock companion',
        body: 'Route lists by street, offline-first, one tap to log a conversation. Visits land in the report live.',
      },
      {
        icon: 'ticket',
        title: 'Leaflet routes',
        body: 'Every drop becomes a stop on a route. Mark it done and roll on.',
      },
      {
        icon: 'house-modern',
        title: 'Deliveries',
        body: 'Notices, newsletters and meeting invitations become routes with per-street progress for volunteer drivers.',
      },
    ],
    field: {
      context: 'Ward 5 · Route 12',
      place: 'Maple Heights',
      meta: '14 doors · 21 constituents',
      progressClass: 'w-[43%]',
      progressNote: '6 of 14 doors attempted',
      conversations: '5 conversations',
      doors: doorsWith('Spoke', 'Follow-up'),
    },
    closing: {
      h2: 'Try everything before you trust us with a single name.',
      body: 'Your free workspace opens with sample constituents, households, routes and a live inbox already in it. Triage a case, send a test newsletter, break things. When it clicks, import your real list. No card, no time limit.',
    },
    jsonLdDescription:
      'A people-first CRM for constituency offices: one shared list for constituents and volunteers, ' +
      'with a shared inbox, casework tasks, newsletters, events and field apps.',
  },

  campaign: {
    pickerLabel: 'Campaign',
    hero: {
      h1: 'Built for the people who knock and win campaigns.',
      sub: 'Turf cutting, live field reports, donations and yard-sign routes. A campaign HQ that keeps score.',
      url: 'app.pplcrm.com/canvassing',
      img: 'assets/site-shots/02-shot.webp',
    },
    steps: [
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
      IMPORT_STEP,
    ],
    features: [
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
      NEWSLETTER_CARD,
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
      IMPORT_CARD,
    ],
    companionFeatures: [
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
    ],
    field: {
      context: 'Demo campaign · Turf 12',
      place: 'Maple Heights',
      meta: '14 doors · 21 voters',
      progressClass: 'w-[43%]',
      progressNote: '6 of 14 doors attempted',
      conversations: '5 conversations',
      doors: doorsWith('Supporter', 'Mixed'),
    },
    closing: {
      h2: 'Try everything before you trust us with a single name.',
      body: 'Your free workspace opens with sample people, households, turfs and a live inbox already in it. Cut a turf, send a test newsletter, break things. When it clicks, import your real list. No card, no time limit.',
    },
    jsonLdDescription:
      'A people-first CRM for campaigns: one shared list for voters, donors and volunteers, with ' +
      'turf cutting, live field reports, donations, newsletters and field apps.',
  },

  nonprofit: {
    pickerLabel: 'Non-profit',
    hero: {
      h1: 'Donors, volunteers and neighbours. One list.',
      sub: 'Stop reconciling three spreadsheets. Gifts, drives and newsletters live on one person’s record.',
      url: 'app.pplcrm.com/people/ruth-abbott',
      img: 'assets/site-shots/03-shot.webp',
    },
    steps: [
      {
        n: '1',
        title: 'Create your free workspace',
        body: 'Sign up and land in a ready-made demo workspace: sample supporters and households, a live inbox and a donor ledger. No card.',
      },
      {
        n: '2',
        title: 'Try everything on sample data',
        body: 'Answer a supporter email, open a volunteer shift, send a test newsletter, record a gift. Nothing is locked, and nothing you break is real.',
      },
      IMPORT_STEP,
    ],
    features: [
      {
        icon: 'users',
        title: 'People & households',
        body: 'One household can be two donors and a volunteer, and the system knows it.',
      },
      {
        icon: 'inbox',
        title: 'A shared inbox & tasks',
        body: 'Connect Gmail or Outlook and mail flows both ways. Every message gets an owner and a due date, so no supporter gets two replies, or none.',
      },
      NEWSLETTER_CARD,
      {
        // Field work is a means, not the point, for most non-profits — volunteers are.
        icon: 'user-group',
        title: 'Volunteers, organized',
        body: 'Publish shifts, let volunteers claim them, and see who actually showed. Hours roll up per person without a clipboard.',
      },
      {
        icon: 'currency-dollar',
        title: 'Giving, gratefully',
        body: '611 donors, each one thanked on time. Recurring gifts, pledges and receipts without a second spreadsheet.',
      },
      IMPORT_CARD,
    ],
    companionFeatures: [
      {
        icon: 'map-pin',
        title: 'Outreach companion',
        body: 'Visit lists by neighbourhood, offline-first, one tap to log a conversation. Every visit syncs back live.',
      },
      {
        icon: 'ticket',
        title: 'Drop-off routes',
        body: 'Every request becomes a stop on a route. Mark it delivered and roll on.',
      },
      {
        icon: 'house-modern',
        title: 'Deliveries',
        body: 'Hampers, leaflets and program notices become routes with per-street progress for volunteer drivers.',
      },
    ],
    field: {
      context: 'Outreach · Route 12',
      place: 'Maple Heights',
      meta: '14 homes · 21 neighbours',
      progressClass: 'w-[43%]',
      progressNote: '6 of 14 homes visited',
      conversations: '5 conversations',
      doors: doorsWith('Interested', 'Follow-up'),
    },
    closing: {
      h2: 'Try everything before you trust us with a single name.',
      body: 'Your free workspace opens with sample supporters, households, volunteer shifts and a donor ledger already in it. Record a gift, send a test newsletter, break things. When it clicks, import your real list. No card, no time limit.',
    },
    jsonLdDescription:
      'A people-first CRM for non-profits: one shared list for donors, volunteers and neighbours, ' +
      'with a shared inbox, giving, volunteer shifts, newsletters and field apps.',
  },

  church: {
    pickerLabel: 'Church',
    hero: {
      h1: 'Know every family by name.',
      sub: 'Members, visitors and volunteers on one list. Giving, groups and follow-up visits all live on the family’s record.',
      // Households, not People: "know every family by name" is a claim about the household being
      // the unit, and the grid shows exactly that — the Haddads as four members on one row.
      url: 'app.pplcrm.com/households',
      img: 'assets/site-shots/04-shot.webp',
    },
    steps: [
      {
        n: '1',
        title: 'Create your free workspace',
        body: 'Sign up and land in a ready-made workspace: sample families and households, a live inbox and a giving ledger. No card.',
      },
      {
        n: '2',
        title: 'Try everything on sample data',
        body: 'Add a family, log a visit, send a test email, record a gift. Nothing is locked, and nothing you break is real.',
      },
      {
        n: '3',
        title: 'Import your directory when it clicks',
        body: 'Bring your directory. Duplicates merge automatically and the sample data steps aside.',
      },
    ],
    features: [
      {
        // A church thinks in households first — so the family, not the individual, leads.
        icon: 'users',
        title: 'Families, not contacts',
        body: 'The Ramos family is one household, two members and a child in Sunday school, and the system knows it.',
      },
      {
        icon: 'inbox',
        title: 'A shared inbox & tasks',
        body: 'Connect Gmail or Outlook and mail flows both ways. Every message gets an owner and a due date, so nobody in the office answers the same request twice.',
      },
      {
        icon: 'megaphone',
        title: 'Newsletters that land',
        body: 'Write once, send to the 1,284 people it’s actually for. An AI deliverability check scores every send before it leaves, so the weekly email doesn’t end up in spam.',
      },
      {
        icon: 'map-pin',
        title: 'Visits & follow-up',
        body: 'New-visitor follow-ups and care visits go out to the team on their phones. Every visit comes back logged, so nobody gets missed and nobody gets visited twice.',
      },
      {
        icon: 'currency-dollar',
        title: 'Giving, gratefully',
        body: 'Tithes, offerings and pledges land on each family’s record — receipted, thanked and counted, without a second spreadsheet.',
      },
      {
        icon: 'arrow-up-tray',
        title: 'Bring the directory',
        body: 'Import the whole messy directory; duplicates merge on the way in. If you ever leave, everything leaves with you: plain-CSV export, on every plan.',
      },
    ],
    companionFeatures: [
      {
        icon: 'map-pin',
        title: 'Visitation companion',
        body: 'Visit lists by neighbourhood, offline-first, one tap to log how it went. Every visit syncs back live.',
      },
      {
        icon: 'ticket',
        title: 'Drop-off routes',
        body: 'Meals, hampers and welcome bags become stops on a route. Mark it delivered and roll on.',
      },
      {
        icon: 'house-modern',
        title: 'Deliveries',
        body: 'Newsletters, invitations and care packages become routes with per-street progress for volunteer drivers.',
      },
    ],
    field: {
      context: 'Visitation · Route 12',
      place: 'Maple Heights',
      meta: '14 homes · 21 people',
      progressClass: 'w-[43%]',
      progressNote: '6 of 14 homes visited',
      conversations: '5 conversations',
      doors: doorsWith('Welcomed', 'Follow-up'),
    },
    closing: {
      h2: 'Try everything before you trust us with a single name.',
      body: 'Your free workspace opens with sample families, households and a giving ledger already in it. Add a family, send a test email, break things. When it clicks, import your directory. No card, no time limit.',
    },
    jsonLdDescription:
      'A people-first CRM for churches: one shared list for members, visitors and volunteers, with ' +
      'a shared inbox, giving, newsletters, visitation and field apps.',
  },
};
