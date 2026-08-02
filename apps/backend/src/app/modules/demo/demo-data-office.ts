/**
 * The hand-curated demo dataset for `office` mode — a sitting councillor's constituency office.
 *
 * One of several — see `demo-datasets.ts` for the per-mode registry and `demo-data-types.ts` for
 * the shapes and the ground rules every dataset obeys.
 *
 * WHY THIS DERIVES FROM THE CAMPAIGN DATASET instead of inventing its own city, and why the church
 * and non-profit datasets do the opposite: an office and a campaign in the same riding really do
 * work the same rolodex. The same families live at the same addresses, care about the same issues,
 * and turn up to the same park cleanup. What differs is the WORK — casework instead of sign drops,
 * community clinics instead of a meet-and-greet, and no fundraising at all, because a publicly
 * funded office is not the legal entity that raises money (the riding association is). So the
 * people, places, companies, teammates, lists, issue assignments and survey responses are shared
 * verbatim, and every section that describes work is authored here.
 *
 * Two invariants this file exists to hold, both enforced by `demo-datasets.spec.ts`:
 *  - `office` no longer seeds 'lawn sign location' (that tag moved to the campaign column of
 *    MODE_EXTRA_TAGS), so no household here may reference it.
 *  - `office` starts with Donations off (ORG_MODE_MODULE_DEFAULTS), so `donations` and `pledges`
 *    are empty — a populated ledger behind a hidden sidebar entry is worse than no ledger.
 */

import type {
  DemoDataset,
  DemoDeliveryRequestDef,
  DemoDeliveryRouteDef,
  DemoEmailDef,
  DemoHouseholdDef,
  DemoNewsletterDef,
  DemoTaskDef,
  DemoTeamDef,
  DemoTurfDef,
  DemoVolunteerEventDef,
} from './demo-data-types';
import { DEMO_CITY, DEMO_COUNTRY, DEMO_STATE, allSites } from './demo-data-places';
import {
  DEMO_COMPANIES,
  DEMO_ISSUE_ASSIGNMENTS,
  DEMO_LISTS,
  DEMO_NEWSLETTERS,
  DEMO_PERSONS,
  DEMO_SUBMISSIONS,
  DEMO_TEAM,
  DEMO_TURFS,
  DEMO_USERS,
  DEMO_VOLUNTEER_EVENTS,
} from './demo-seed-data';

/** Same addresses as the campaign dataset, minus the sign locations. */
export const OFFICE_HOUSEHOLDS: DemoHouseholdDef[] = allSites({
  'hh-gladstone': { notes: 'Buzzer broken — knock loudly.' },
  'hh-kilborn-import': { notes: 'Came in on the March CSV import.' },
  'hh-frank': { notes: 'Open case: traffic calming pilot on the block.' },
});

// ── Casework (the office's actual first job) ─────────────────────────────────
// Every task names a person or company that exists in the shared dataset, so the demo reads as
// one operation rather than a to-do list about strangers.

export const OFFICE_TASKS: DemoTaskDef[] = [
  {
    name: 'Call Marc Tremblay back about the dead tree on Cooper Street',
    details:
      'City forestry has the file but no date yet. He prefers French for written follow-up — send the reference number by email after the call.',
    status: 'todo',
    priority: 'high',
    position: 1,
    dueInDays: 2,
    assignToOwner: true,
  },
  {
    name: 'Chase the sidewalk repair order for 468 Byron Avenue',
    details:
      'Heather MacDonald reported the heaved slab three weeks ago. Public works gave us a work order number — ask for a scheduled week.',
    status: 'in_progress',
    priority: 'urgent',
    position: 2,
    dueInDays: 1,
    assignToOwner: true,
  },
  {
    name: 'Get the Frank Street traffic calming pilot onto the committee agenda',
    details:
      'Kevin O’Brien and eleven neighbours want the pilot made permanent. Deadline for agenda items is the Thursday before.',
    status: 'in_progress',
    priority: 'high',
    position: 3,
    dueInDays: 4,
    assignToUser: 'u-carlos',
  },
  {
    name: 'Answer Liam Byrne on the Charlotte Street lighting request',
    details: 'Hydro says the pole audit is done. Send him the summary and close the file if he is satisfied.',
    status: 'todo',
    priority: 'medium',
    position: 4,
    dueInDays: 3,
    assignToUser: 'u-carlos',
  },
  {
    name: 'Book the Glebe Community Centre for the next community clinic',
    details: 'Waiting to hear back about availability in the last week of the month. Evening slot preferred.',
    status: 'waiting',
    priority: 'high',
    position: 5,
    dueInDays: 10,
  },
  {
    name: 'Ask Devon Clarke about hosting mobile office hours',
    details: 'Bytown Coffee Roasters has room for a table on a weeknight. Devon was open to it when we spoke in May.',
    status: 'todo',
    priority: 'medium',
    position: 6,
    dueInDays: 7,
  },
  {
    name: 'Print 250 notices for the Westboro sidewalk consultation',
    details: 'Marcus Webb at Hintonburg Print Co. prints at cost — send him the artwork and confirm pickup Thursday.',
    status: 'in_progress',
    priority: 'medium',
    position: 7,
    dueInDays: 4,
    assignToUser: 'u-emma',
  },
  {
    name: 'Recruit two more volunteers for the Sandy Hill notice drop',
    details: 'Julie Lavoie offered to ask around Sweetland Avenue. Check the volunteer prospects list first.',
    status: 'in_progress',
    priority: 'medium',
    position: 8,
    dueInDays: 5,
    assignToUser: 'u-carlos',
  },
  {
    name: 'Update the intake script with what the issues survey said',
    details: 'Housing and transit are leading by a wide margin — move both to the top of the questions we ask.',
    status: 'todo',
    priority: 'low',
    position: 9,
  },
  {
    name: 'Follow up with Isabelle Fortin on the profile piece',
    details: 'She asked for two constituent interviews and a photo. Suggest Grace Okafor and Harpreet Singh.',
    status: 'waiting',
    priority: 'medium',
    position: 10,
    dueInDays: 8,
  },
  {
    name: 'Coffee with Michelle Thibault',
    details: 'Former riding association president. Pick her brain on the ward captains model before we grow the team.',
    status: 'todo',
    priority: 'medium',
    position: 11,
    dueInDays: 6,
  },
  {
    name: 'Print name badges for Saturday’s door-knock round',
    details: 'Six volunteers signed up so far — print a few blanks too.',
    status: 'todo',
    priority: 'medium',
    position: 12,
    dueInDays: 3,
    assignToOwner: true,
  },
  {
    name: 'Send welcome notes to this month’s new contacts',
    details: 'Omar, Aiko, Lucia and David all came in through the website this month.',
    status: 'done',
    priority: 'low',
    position: 13,
    completedDaysAgo: 3,
  },
  {
    name: 'Thank the Brewer Park cleanup volunteers',
    details: 'Julie, Grace, Harpreet and Amadou all showed — a short personal email each goes a long way.',
    status: 'done',
    priority: 'medium',
    position: 14,
    completedDaysAgo: 17,
  },
  {
    name: 'Draft the June ward newsletter outline',
    details: 'Lead with the sidewalk consultation, then the transit survey results, then clinic dates.',
    status: 'in_progress',
    priority: 'medium',
    position: 15,
    dueInDays: 6,
    assignToUser: 'u-emma',
  },
  {
    name: 'Clean up duplicate entries from the spring import',
    details:
      'The March CSV import created a handful of near-duplicates — review the Duplicates page and merge or dismiss.',
    status: 'todo',
    priority: 'low',
    position: 16,
  },
];

/** Same people as the campaign crew; an office calls the work what it is. */
export const OFFICE_TEAM: DemoTeamDef = {
  ...DEMO_TEAM,
  name: 'Door-knocking crew',
  description: 'The regulars who knock doors and drop notices most weekends.',
};

/** Reworded by key so the shift sign-ups (and the people in them) stay shared. */
const OFFICE_EVENT_COPY: Record<string, Pick<DemoVolunteerEventDef, 'name' | 'description' | 'slug'>> = {
  'ev-canvass': {
    name: 'Saturday door-knock round',
    slug: 'saturday-door-knock-round',
    description:
      'Year-round outreach round. Meet at the Hintonburg Community Centre for a 30-minute briefing, then pairs head out with door lists and a stack of notices. Coffee and snacks provided.',
  },
};

export const OFFICE_VOLUNTEER_EVENTS: DemoVolunteerEventDef[] = DEMO_VOLUNTEER_EVENTS.map((event) => ({
  ...event,
  ...OFFICE_EVENT_COPY[event.key],
}));

/** Only the description changes — the membership is the point and it is shared. */
const OFFICE_LIST_DESCRIPTIONS: Record<string, string> = {
  'list-volunteers': 'People who volunteered before or said they might — first call for door-knock rounds and drops.',
  'list-mainstreet': 'Business owners and managers along the commercial strips — consultations and window notices.',
};

export const OFFICE_LISTS = DEMO_LISTS.map((list) => ({
  ...list,
  description: OFFICE_LIST_DESCRIPTIONS[list.key] ?? list.description,
}));

/**
 * The shared newsletters, reworded where they talk about a campaign.
 *
 * Overridden BY KEY and only on the text fields: `links`, `recipients` and `engagement` stay
 * shared, and every `href` inside the rewritten HTML is unchanged — the seeder derives the report
 * numbers from the engagement specs by URL, so a reworded link would silently zero a click count.
 * ('nl-welcome' — "we have opened a community office" — needed no changes at all.)
 */
const OFFICE_NEWSLETTER_COPY: Record<
  string,
  Partial<Pick<DemoNewsletterDef, 'name' | 'subject' | 'preview_text' | 'html_content' | 'plain_text_content'>>
> = {
  'nl-spring': {
    name: 'Spring ward update',
    html_content:
      '<h1>Spring ward update</h1>' +
      '<p>Thirty of us spent Saturday morning at Brewer Park — <a href="https://example.org/park-cleanup-recap">see the photos</a>. ' +
      'Thank you to everyone who came out.</p>' +
      '<p>At the doors this month, transit reliability came up more than any other issue. ' +
      'We put together a <a href="https://example.org/transit-survey">two-minute survey</a> so we can bring your answers to the next community association meeting.</p>' +
      '<p>Our next round of door knocking starts soon — <a href="https://example.org/volunteer-signup">sign up here</a> if you can give a Saturday morning.</p>',
    plain_text_content:
      'Spring ward update — Brewer Park cleanup recap, a two-minute transit survey, and door-knocking sign-up. ' +
      'Survey: https://example.org/transit-survey — Volunteer: https://example.org/volunteer-signup',
  },
  'nl-june': {
    name: 'June ward update',
    subject: 'June update: sidewalk consultation and your transit survey results',
    preview_text: 'Where to have your say on the Westboro sidewalks — plus what 200 of you said about transit.',
    html_content:
      '<h1>June ward update</h1>' +
      '<p>The Westboro sidewalk consultation opens this Saturday at the Hintonburg Community Centre — drop in any time between 10:00 and noon.</p>' +
      '<p>Transit survey results are in: reliability beat frequency two to one. Full breakdown next issue.</p>',
    plain_text_content:
      'June ward update — Westboro sidewalk consultation Saturday, 10:00–noon at the Hintonburg CC. Transit survey: reliability beat frequency two to one.',
  },
};

export const OFFICE_NEWSLETTERS: DemoNewsletterDef[] = DEMO_NEWSLETTERS.map((newsletter) => ({
  ...newsletter,
  ...OFFICE_NEWSLETTER_COPY[newsletter.key],
}));

// ── Inbox ───────────────────────────────────────────────────────────────────
// Casework threads: something is broken, someone owns it, and one is already answered. The
// assignment mix (owner / two staff / unassigned) is what makes the triage UI worth looking at.

export const OFFICE_EMAILS: DemoEmailDef[] = [
  {
    folder: 'inbox',
    person: 'heather-macdonald',
    subject: 'Sidewalk on Byron is still a tripping hazard',
    preview_text: 'The slab outside 468 has lifted again and my neighbour went down on it last week…',
    status: 'open',
    daysAgo: 2,
    is_favourite: true,
    attachments: ['sidewalk-hazard'],
    body_html:
      '<p>Hello,</p><p>The slab outside 468 Byron Avenue has lifted again and my neighbour went down on it last week. Photo attached — you can see how far it has moved since the spring.</p><p>Is there a repair scheduled?</p><p>Heather</p>',
  },
  {
    folder: 'inbox',
    person: 'marc-tremblay',
    subject: 'Arbre mort rue Cooper / Dead tree on Cooper Street',
    preview_text: 'Bonjour! L’arbre devant le 174 rue Cooper est mort depuis l’hiver — il perd des branches…',
    status: 'open',
    assignTo: 'owner',
    daysAgo: 3,
    body_html:
      '<p>Bonjour!</p><p>L’arbre devant le 174 rue Cooper est mort depuis l’hiver et il perd des branches sur le trottoir. Est-ce que la Ville peut l’inspecter?</p><p>Merci,<br>Marc</p>',
  },
  {
    folder: 'inbox',
    person: 'kevin-obrien',
    subject: 'Please make the Frank Street pilot permanent',
    preview_text: 'Eleven of us on the block signed the note below. The bollards have changed how people drive…',
    status: 'open',
    assignTo: 'u-carlos',
    daysAgo: 4,
    body_html:
      '<p>Hi,</p><p>Eleven of us on the block signed the note below. The bollards have changed how people drive down Frank — we would like the pilot made permanent before it is taken out in the fall.</p><p>Kevin</p>',
  },
  {
    folder: 'inbox',
    person: 'devon-clarke',
    subject: 'Mobile office hours at the café — possible dates',
    preview_text: 'Happy to give you a table for the morning. The last two Thursdays of the month are open…',
    status: 'open',
    daysAgo: 1,
    attachments: ['office-hours-hold'],
    body_html:
      '<p>Hi,</p><p>Happy to give you a table for the morning — people are in and out from about eight. The last two Thursdays of the month are open right now. Calendar hold attached for the first one.</p><p>Devon<br>Bytown Coffee Roasters</p>',
  },
  {
    folder: 'inbox',
    person: 'fatima-elsayed',
    subject: 'Newsletter swap with the community association?',
    preview_text: 'Our association newsletter goes to about 900 households in Westboro. Would you be open to…',
    status: 'open',
    assignTo: 'u-emma',
    daysAgo: 3,
    attachments: ['westboro-circulation'],
    body_html:
      '<p>Hello,</p><p>Our association newsletter goes to about 900 households in Westboro. Would you be open to trading a short update from the office next month?</p><p>Our last three months of circulation are attached.</p><p>Fatima</p>',
  },
  {
    folder: 'inbox',
    person: 'isabelle-fortin',
    subject: 'Interview request: how the office handles casework',
    preview_text: 'I am writing about what constituents actually get when they call a ward office. Could we set up…',
    status: 'open',
    assignTo: 'u-natalie',
    daysAgo: 5,
    body_html:
      '<p>Hi,</p><p>I am writing about what constituents actually get when they call a ward office. Could we set up 30 minutes this week? I would also love to speak with two people whose cases you closed.</p><p>Isabelle Fortin</p>',
  },
  {
    folder: 'inbox',
    person: 'grace-okafor',
    subject: 'Riverkeepers — shoreline cleanup partnership',
    preview_text: 'Following up from the cleanup — the board reviews community partnerships quarterly, and the…',
    status: 'closed',
    assignTo: 'owner',
    daysAgo: 15,
    body_html:
      '<p>Hello,</p><p>Following up from the cleanup — the board reviews community partnerships quarterly, and the next window opens in three weeks. I can walk you through the process.</p><p>Grace</p>',
  },
  {
    folder: 'sent',
    person: 'heather-macdonald',
    subject: 'Re: Sidewalk on Byron is still a tripping hazard',
    preview_text: 'Thanks Heather — the work order is filed as SW-4471 and public works has it for this season…',
    status: 'closed',
    daysAgo: 1,
    body_html:
      '<p>Thanks Heather,</p><p>The work order is filed as SW-4471 and public works has it for this season. I have asked for a scheduled week and will let you know the moment I have one.</p>',
  },
];

// ── Door knocking ───────────────────────────────────────────────────────────
// The same cut turfs and the same knocks — an office knocks year-round. Only the notes that talk
// about signs are rewritten, keyed by household (each appears in exactly one turf).

const OFFICE_TURF_NOTES: Record<string, string> = {
  'turf-somerset': 'First turf out the door this season — every door attempted.',
  'turf-kitchissippi': 'Being knocked right now — Saturday afternoon shift.',
};

const OFFICE_KNOCK_NOTES: Record<string, string> = {
  'hh-cooper': 'Asked about the dead tree out front — case opened for him.',
  'hh-byron': 'Raised the lifted sidewalk slab again — work order chased.',
};

export const OFFICE_TURFS: DemoTurfDef[] = DEMO_TURFS.map((turf) => ({
  ...turf,
  notes: OFFICE_TURF_NOTES[turf.key] ?? turf.notes,
  knocks: turf.knocks?.map((knock) => ({
    ...knock,
    notes: OFFICE_KNOCK_NOTES[knock.household] ?? knock.notes,
  })),
}));

// ── Deliveries ──────────────────────────────────────────────────────────────
// Same mechanism as the campaign's sign drops, different cargo: ward newsletters, meeting notices
// and consultation flyers. Every request is `manual` — office mode seeds no public request form
// (the campaign's yard-sign form is campaign-only), so a `web_form` source here would point at an
// intake path this workspace does not have.

export const OFFICE_DELIVERY_REQUESTS: DemoDeliveryRequestDef[] = [
  // New — waiting to be triaged (populates the New tab + selection bar).
  {
    key: 'dr-maclaren',
    household: 'hh-maclaren',
    person: 'priya-sharma',
    status: 'new',
    source: 'manual',
    createdDaysAgo: 1,
    notes: 'Asked for printed copies for the whole building.',
  },
  {
    key: 'dr-arlington',
    household: 'hh-arlington',
    person: 'devon-clarke',
    status: 'new',
    source: 'manual',
    createdDaysAgo: 2,
  },
  {
    key: 'dr-sweetland',
    household: 'hh-sweetland',
    person: 'julie-lavoie',
    status: 'new',
    source: 'manual',
    notes: 'Julie will hand the rest of Sweetland out herself if we drop a bundle.',
    createdDaysAgo: 2,
  },
  {
    key: 'dr-charlotte',
    household: 'hh-charlotte',
    person: 'liam-byrne',
    status: 'new',
    source: 'manual',
    createdDaysAgo: 3,
  },

  // Approved and ready to plan — geocoded, not yet on a route ("N ready").
  {
    key: 'dr-kilborn',
    household: 'hh-kilborn',
    person: 'ayesha-rahman',
    status: 'approved',
    source: 'manual',
    createdDaysAgo: 5,
  },
  {
    key: 'dr-holmwood',
    household: 'hh-holmwood',
    person: 'gordon-ferguson',
    status: 'approved',
    source: 'manual',
    createdDaysAgo: 5,
  },
  {
    key: 'dr-halifax',
    household: 'hh-halifax',
    person: 'carla-rossi',
    status: 'approved',
    source: 'manual',
    notes: 'Large print, please.',
    createdDaysAgo: 6,
  },
  {
    key: 'dr-marlborough',
    household: 'hh-marlborough',
    person: 'grace-okafor',
    status: 'approved',
    source: 'manual',
    createdDaysAgo: 6,
  },

  // Declined — not every household wants paper.
  {
    key: 'dr-bay',
    household: 'hh-bay',
    person: 'norma-wilson',
    status: 'declined',
    source: 'manual',
    notes: 'Asked for email only — no paper.',
    createdDaysAgo: 8,
  },
  {
    key: 'dr-pleasantpark',
    household: 'hh-pleasantpark',
    person: 'bruce-whitfield',
    status: 'declined',
    source: 'manual',
    notes: 'Do-not-contact — declined.',
    createdDaysAgo: 9,
  },

  // Delivered on the completed route (status is derived from the delivered stop).
  {
    key: 'dr-byron',
    household: 'hh-byron',
    person: 'heather-macdonald',
    status: 'delivered',
    source: 'manual',
    createdDaysAgo: 7,
  },
  {
    key: 'dr-armstrong',
    household: 'hh-armstrong',
    person: 'jake-morrison',
    status: 'delivered',
    source: 'manual',
    createdDaysAgo: 7,
  },
  {
    key: 'dr-kirkwood',
    household: 'hh-kirkwood',
    person: 'fatima-elsayed',
    status: 'delivered',
    source: 'manual',
    createdDaysAgo: 7,
  },

  // The in-progress route: one delivered, two still pending (approved + routed).
  {
    key: 'dr-fifth',
    household: 'hh-fifth',
    person: 'nadia-haddad',
    status: 'delivered',
    source: 'manual',
    createdDaysAgo: 4,
  },
  {
    key: 'dr-powell',
    household: 'hh-powell',
    person: 'rebecca-stein',
    status: 'approved',
    source: 'manual',
    createdDaysAgo: 4,
  },
  {
    key: 'dr-sunnyside',
    household: 'hh-sunnyside',
    person: 'harpreet-singh',
    status: 'approved',
    source: 'manual',
    createdDaysAgo: 4,
  },
];

export const OFFICE_DELIVERY_ROUTES: DemoDeliveryRouteDef[] = [
  {
    key: 'route-westboro',
    name: 'Westboro notice drop',
    status: 'completed',
    volunteerPerson: 'jake-morrison',
    startAddress: '1064 Wellington St W, Ottawa, ON K1Y 2Y3',
    startLat: 45.4012,
    startLng: -75.7196,
    scheduledInDays: -3,
    stops: [
      { request: 'dr-byron', status: 'delivered', actedVia: 'volunteer_link', actedHoursAgo: 72 },
      { request: 'dr-armstrong', status: 'delivered', actedVia: 'volunteer_link', actedHoursAgo: 71 },
      { request: 'dr-kirkwood', status: 'delivered', actedVia: 'volunteer_link', actedHoursAgo: 71 },
    ],
  },
  {
    key: 'route-glebe',
    name: 'Glebe & Old Ottawa South drop',
    status: 'in_progress',
    volunteerPerson: 'julie-lavoie',
    startAddress: '175 Third Ave, Ottawa, ON K1S 2K2',
    startLat: 45.4009,
    startLng: -75.6889,
    shared: true,
    scheduledInDays: 0,
    stops: [
      { request: 'dr-fifth', status: 'delivered', actedVia: 'volunteer_link', actedHoursAgo: 2 },
      { request: 'dr-powell', status: 'pending' },
      { request: 'dr-sunnyside', status: 'pending' },
    ],
  },
];

/** The constituency-office dataset, bundled for `demo-datasets.ts`. */
export const OFFICE_DEMO_DATASET: DemoDataset = {
  city: DEMO_CITY,
  state: DEMO_STATE,
  country: DEMO_COUNTRY,
  companies: DEMO_COMPANIES,
  households: OFFICE_HOUSEHOLDS,
  persons: DEMO_PERSONS,
  users: DEMO_USERS,
  tasks: OFFICE_TASKS,
  lists: OFFICE_LISTS,
  team: OFFICE_TEAM,
  volunteerEvents: OFFICE_VOLUNTEER_EVENTS,
  newsletters: OFFICE_NEWSLETTERS,
  submissions: DEMO_SUBMISSIONS,
  issueAssignments: DEMO_ISSUE_ASSIGNMENTS,
  emails: OFFICE_EMAILS,
  turfs: OFFICE_TURFS,
  deliveryRequests: OFFICE_DELIVERY_REQUESTS,
  deliveryRoutes: OFFICE_DELIVERY_ROUTES,
  // An office does not fundraise — its riding association does, on its own books. No gifts means
  // nothing to receipt, and office mode hides Donations at signup anyway.
  pledges: [],
  donations: [],
  receipts: [],
  receiptSettings: {},
  statementRun: null,
};
