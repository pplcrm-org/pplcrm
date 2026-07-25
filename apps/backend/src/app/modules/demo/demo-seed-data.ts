import type { SupportLevel, VotingStatus, VolunteerStatus, StaffStatus } from '../../../../../../libs/common/src';

/**
 * The hand-curated demo dataset seeded for every new tenant (demo mode).
 *
 * Ground rules (why the data looks the way it does):
 * - Addresses are real Ottawa, ON streets with pre-baked coordinates and real
 *   ward names, so map pins, the "Located" geocode chip, and ward-bounded turf
 *   cutting all work with zero Google API calls at signup.
 * - Emails are on RFC 2606 reserved domains (example.com/org/net) so nothing a
 *   user does with the demo data — including actually sending the draft
 *   newsletter — can ever reach a real inbox.
 * - Phone numbers use the fictional 555 exchange in Ottawa area codes.
 * - Tags and issues are STARTER vocabulary, seeded by seedStarterTags
 *   (modules/auth/onboarding-seed.ts) and kept when demo data is deleted. The
 *   demo data only ATTACHES persons/households to them by name — names here
 *   must match STARTER_TAGS / STARTER_ISSUES. Donor / supporter / subscriber
 *   are structured concepts in this product (donations table,
 *   campaign_person_facts, campaign_subscriptions) and were retired as tags —
 *   the demo data must not resurrect them.
 * - Newsletter aggregates are DERIVED from the engagement specs at seed time,
 *   so the report page numbers always add up.
 */

export interface DemoCompanyDef {
  key: string;
  name: string;
  description: string;
  website: string;
  email: string;
  phone: string;
  industry: string;
}

export interface DemoHouseholdDef {
  key: string;
  street_num: string;
  street1: string;
  zip: string;
  lat: number;
  lng: number;
  ward: string;
  home_phone?: string;
  notes?: string;
  /** Starter tag names (STARTER_TAGS) attached via map_households_tags. */
  tags?: string[];
}

export interface DemoPersonDef {
  key: string;
  first_name: string;
  last_name: string;
  /** Household key; omitted = lives on the tenant placeholder household (address unknown). */
  household?: string;
  /** Company key for persons.company_id. */
  company?: string;
  email?: string;
  mobile?: string;
  notes?: string;
  /** Staggers persons.created_at so the dashboard growth chart draws a real curve. */
  createdDaysAgo: number;
  /** Starter tag names (STARTER_TAGS) attached via map_peoples_tags. */
  tags?: string[];
  supportLevel?: SupportLevel;
  votingStatus?: VotingStatus;
  /** First-class volunteer/staff standing (§15) — sets persons.volunteer_status / staff_status. */
  volunteerStatus?: VolunteerStatus;
  staffStatus?: StaffStatus;
  /** Seeds a campaign_subscriptions row (status subscribed, consent_source import). */
  subscribed?: boolean;
  doNotContact?: boolean;
}

export interface DemoTaskDef {
  name: string;
  details: string;
  status: 'todo' | 'in_progress' | 'waiting' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  position: number;
  dueInDays?: number;
  completedDaysAgo?: number;
  assignToOwner?: boolean;
  /** Demo user key (DEMO_USERS) to assign the task to. */
  assignToUser?: string;
}

export interface DemoListDef {
  key: string;
  name: string;
  description: string;
  members: string[];
}

export interface DemoTeamDef {
  name: string;
  description: string;
  members: string[];
}

export interface DemoVolunteerEventDef {
  key: string;
  name: string;
  description: string;
  location_address: string;
  slug: string;
  /** Negative = in the past. */
  startInDays: number;
  durationHours: number;
  capacity: number;
  shifts: { person: string; status: 'signed_up' | 'attended' }[];
}

export interface DemoEngagementDef {
  person: string;
  opens: number;
  /** URLs clicked (must come from the newsletter's links). */
  clicks?: string[];
  unsubscribed?: boolean;
  bounce?: 'hard' | 'soft';
}

export interface DemoNewsletterDef {
  key: string;
  name: string;
  status: 'sent' | 'draft';
  subject: string;
  preview_text: string;
  audience_description: string;
  html_content: string;
  plain_text_content: string;
  sentDaysAgo?: number;
  links?: string[];
  /** Person keys the send went to; engagement entries must be a subset. */
  recipients?: string[];
  engagement?: DemoEngagementDef[];
}

export interface DemoSubmissionDef {
  /** Matches the starter form's slug (created by seedStarterForms). */
  formSlug: 'newsletter-sign-up' | 'issues-survey';
  person: string;
  daysAgo: number;
  answers: Record<string, unknown>;
}

/**
 * Demo teammates — real authusers rows so the Users page, task assignment, and
 * inbox triage look staffed. They get a random unguessable password at seed
 * time and reserved-domain emails, so they can never actually sign in.
 * `emailLocal` is composed with the tenant's slug at seed time
 * (`<local>@<tenant-slug>.example.com`) because authusers.email is globally
 * unique — a fixed address would break the second tenant's signup.
 */
export interface DemoUserDef {
  key: string;
  first_name: string;
  last_name: string;
  emailLocal: string;
  role: 'admin' | 'user';
}

/** Attaches demo persons to a starter issue (STARTER_ISSUES) via map_peoples_tags. */
export interface DemoIssueAssignmentDef {
  /** Starter issue name — must match a STARTER_ISSUES entry. */
  issue: string;
  /** Person keys this issue is attached to. */
  people: string[];
}

export interface DemoEmailDef {
  folder: 'inbox' | 'sent';
  /** Person key the email is from (inbox) or to (sent) — ties the thread to a CRM contact. */
  person: string;
  subject: string;
  preview: string;
  status: 'open' | 'closed';
  /** 'owner' or a demo user key. */
  assignTo?: string;
  daysAgo: number;
  is_favourite?: boolean;
  body_html: string;
}

export const DEMO_CITY = 'Ottawa';
export const DEMO_STATE = 'ON';
export const DEMO_COUNTRY = 'Canada';

export const DEMO_COMPANIES: DemoCompanyDef[] = [
  {
    key: 'co-bytown',
    name: 'Bytown Coffee Roasters',
    description: 'Small-batch roastery and café on Wellington West.',
    website: 'https://bytowncoffee.example.com',
    email: 'hello@bytowncoffee.example.com',
    phone: '613-555-0181',
    industry: 'Food & Beverage',
  },
  {
    key: 'co-rideau-dental',
    name: 'Rideau Valley Dental',
    description: 'Family dental practice near the canal.',
    website: 'https://rideauvalleydental.example.com',
    email: 'reception@rideauvalleydental.example.com',
    phone: '613-555-0114',
    industry: 'Healthcare',
  },
  {
    key: 'co-wwrealty',
    name: 'Wellington West Realty',
    description: 'Independent brokerage serving Kitchissippi and Westboro.',
    website: 'https://wwrealty.example.com',
    email: 'info@wwrealty.example.com',
    phone: '613-555-0147',
    industry: 'Real Estate',
  },
  {
    key: 'co-capland',
    name: 'Capital City Landscaping',
    description: 'Residential landscaping and snow removal crew.',
    website: 'https://capitalcitylandscaping.example.com',
    email: 'office@capitalcitylandscaping.example.com',
    phone: '613-555-0129',
    industry: 'Landscaping',
  },
  {
    key: 'co-glebephysio',
    name: 'Glebe Physiotherapy Clinic',
    description: 'Physiotherapy and sports rehab on Bank Street.',
    website: 'https://glebephysio.example.com',
    email: 'frontdesk@glebephysio.example.com',
    phone: '613-555-0166',
    industry: 'Healthcare',
  },
  {
    key: 'co-sometech',
    name: 'Somerset Tech Solutions',
    description: 'Managed IT and web development for small businesses.',
    website: 'https://somersettech.example.com',
    email: 'contact@somersettech.example.com',
    phone: '613-555-0192',
    industry: 'Technology',
  },
  {
    key: 'co-preston',
    name: 'Preston Hardware & Home',
    description: 'Third-generation hardware store in Little Italy.',
    website: 'https://prestonhardware.example.com',
    email: 'store@prestonhardware.example.com',
    phone: '613-555-0153',
    industry: 'Retail',
  },
  {
    key: 'co-riverkeepers',
    name: 'Ottawa Riverkeepers Alliance',
    description: 'Non-profit protecting the Ottawa River watershed.',
    website: 'https://riverkeepers.example.org',
    email: 'volunteer@riverkeepers.example.org',
    phone: '613-555-0175',
    industry: 'Non-profit',
  },
  {
    key: 'co-hintonprint',
    name: 'Hintonburg Print Co.',
    description: 'Digital and offset printing — signs, flyers, banners.',
    website: 'https://hintonburgprint.example.com',
    email: 'orders@hintonburgprint.example.com',
    phone: '613-555-0138',
    industry: 'Printing',
  },
  {
    key: 'co-lansdowne',
    name: 'Lansdowne Fitness Studio',
    description: 'Group fitness and personal training at Lansdowne Park.',
    website: 'https://lansdownefitness.example.com',
    email: 'team@lansdownefitness.example.com',
    phone: '613-555-0107',
    industry: 'Fitness',
  },
  // ── March import duplicate (Duplicates → Companies) ──────────────────────
  // Same name as co-bytown, so the sweep groups the pair on lower(trim(name)).
  // Contact details differ, which is what makes the merge worth doing.
  {
    key: 'co-bytown-import',
    name: 'Bytown Coffee Roasters',
    description: 'Café and roastery — Wellington West.',
    website: 'https://bytowncoffee.example.com',
    email: 'orders@bytowncoffee.example.com',
    phone: '613-555-0182',
    industry: 'Food & Beverage',
  },
];

export const DEMO_HOUSEHOLDS: DemoHouseholdDef[] = [
  // ── Somerset ward (Centretown) ──────────────────────────────────────────
  {
    key: 'hh-cooper',
    street_num: '174',
    street1: 'Cooper Street',
    zip: 'K2P 0E8',
    lat: 45.4136,
    lng: -75.691,
    ward: 'Somerset',
    home_phone: '613-555-0221',
    tags: ['lawn sign location'],
  },
  {
    key: 'hh-maclaren',
    street_num: '288',
    street1: 'MacLaren Street',
    zip: 'K2P 0M6',
    lat: 45.4152,
    lng: -75.696,
    ward: 'Somerset',
  },
  {
    key: 'hh-frank',
    street_num: '92',
    street1: 'Frank Street',
    zip: 'K2P 0X2',
    lat: 45.4126,
    lng: -75.6875,
    ward: 'Somerset',
  },
  {
    key: 'hh-arlington',
    street_num: '41',
    street1: 'Arlington Avenue',
    zip: 'K2P 1C1',
    lat: 45.4079,
    lng: -75.6944,
    ward: 'Somerset',
  },
  {
    key: 'hh-gladstone',
    street_num: '356',
    street1: 'Gladstone Avenue',
    zip: 'K2P 0Y9',
    lat: 45.4107,
    lng: -75.6987,
    ward: 'Somerset',
    notes: 'Buzzer broken — knock loudly.',
  },
  {
    key: 'hh-bay',
    street_num: '145',
    street1: 'Bay Street',
    zip: 'K1R 7T2',
    lat: 45.4155,
    lng: -75.705,
    ward: 'Somerset',
    home_phone: '613-555-0244',
  },

  // ── Kitchissippi ward (Westboro / Hintonburg) ───────────────────────────
  {
    key: 'hh-byron',
    street_num: '468',
    street1: 'Byron Avenue',
    zip: 'K2A 3G4',
    lat: 45.3925,
    lng: -75.7565,
    ward: 'Kitchissippi',
    tags: ['lawn sign location'],
  },
  {
    key: 'hh-kirkwood',
    street_num: '175',
    street1: 'Kirkwood Avenue',
    zip: 'K1Z 8K3',
    lat: 45.394,
    lng: -75.7495,
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-java',
    street_num: '33',
    street1: 'Java Street',
    zip: 'K1Y 3L2',
    lat: 45.4028,
    lng: -75.7291,
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-armstrong',
    street_num: '245',
    street1: 'Armstrong Street',
    zip: 'K1Y 2W3',
    lat: 45.4046,
    lng: -75.7247,
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-huron',
    street_num: '58',
    street1: 'Huron Avenue N',
    zip: 'K1Y 0W8',
    lat: 45.4013,
    lng: -75.7346,
    ward: 'Kitchissippi',
  },

  // ── Capital ward (Glebe / Old Ottawa South) ─────────────────────────────
  {
    key: 'hh-fifth',
    street_num: '87',
    street1: 'Fifth Avenue',
    zip: 'K1S 2M8',
    lat: 45.4009,
    lng: -75.6926,
    ward: 'Capital',
  },
  {
    key: 'hh-holmwood',
    street_num: '224',
    street1: 'Holmwood Avenue',
    zip: 'K1S 2P4',
    lat: 45.399,
    lng: -75.6858,
    ward: 'Capital',
    home_phone: '613-555-0268',
  },
  {
    key: 'hh-sunnyside',
    street_num: '145',
    street1: 'Sunnyside Avenue',
    zip: 'K1S 0R2',
    lat: 45.3949,
    lng: -75.6812,
    ward: 'Capital',
  },
  {
    key: 'hh-powell',
    street_num: '36',
    street1: 'Powell Avenue',
    zip: 'K1S 2A2',
    lat: 45.4046,
    lng: -75.6949,
    ward: 'Capital',
  },
  {
    key: 'hh-aylmer',
    street_num: '112',
    street1: 'Aylmer Avenue',
    zip: 'K1S 2X6',
    lat: 45.3952,
    lng: -75.6867,
    ward: 'Capital',
  },

  // ── Rideau-Vanier ward (Sandy Hill) ─────────────────────────────────────
  {
    key: 'hh-sweetland',
    street_num: '61',
    street1: 'Sweetland Avenue',
    zip: 'K1N 7T7',
    lat: 45.4266,
    lng: -75.6797,
    ward: 'Rideau-Vanier',
  },
  {
    key: 'hh-marlborough',
    street_num: '128',
    street1: 'Marlborough Avenue',
    zip: 'K1N 8G3',
    lat: 45.4229,
    lng: -75.6752,
    ward: 'Rideau-Vanier',
  },
  {
    key: 'hh-blackburn',
    street_num: '45',
    street1: 'Blackburn Avenue',
    zip: 'K1N 8A4',
    lat: 45.4245,
    lng: -75.6791,
    ward: 'Rideau-Vanier',
  },
  {
    key: 'hh-charlotte',
    street_num: '219',
    street1: 'Charlotte Street',
    zip: 'K1N 8L2',
    lat: 45.4287,
    lng: -75.6832,
    ward: 'Rideau-Vanier',
  },

  // ── Alta Vista ward ─────────────────────────────────────────────────────
  {
    key: 'hh-kilborn',
    street_num: '1128',
    street1: 'Kilborn Avenue',
    zip: 'K1H 6L1',
    lat: 45.3867,
    lng: -75.6544,
    ward: 'Alta Vista',
    tags: ['lawn sign location'],
  },
  {
    key: 'hh-pleasantpark',
    street_num: '645',
    street1: 'Pleasant Park Road',
    zip: 'K1H 5M2',
    lat: 45.3901,
    lng: -75.6608,
    ward: 'Alta Vista',
  },
  {
    key: 'hh-halifax',
    street_num: '88',
    street1: 'Halifax Drive',
    zip: 'K1G 0T6',
    lat: 45.3945,
    lng: -75.6377,
    ward: 'Alta Vista',
  },
  {
    key: 'hh-featherston',
    street_num: '1520',
    street1: 'Featherston Drive',
    zip: 'K1H 6P2',
    lat: 45.3846,
    lng: -75.6414,
    ward: 'Alta Vista',
  },

  // ── March import duplicate (Duplicates → Households) ────────────────────
  // The same address as hh-kilborn typed with an abbreviated street type:
  // address_normalize expands "Ave." to "avenue", so both rows land on one
  // address_fp_full and the sweep flags them as a matching-address pair.
  {
    key: 'hh-kilborn-import',
    street_num: '1128',
    street1: 'Kilborn Ave.',
    zip: 'K1H 6L1',
    lat: 45.3867,
    lng: -75.6544,
    ward: 'Alta Vista',
    notes: 'Came in on the March CSV import.',
  },
];

export const DEMO_PERSONS: DemoPersonDef[] = [
  // ── hh-cooper: the Tremblays ────────────────────────────────────────────
  {
    key: 'marc-tremblay',
    first_name: 'Marc',
    last_name: 'Tremblay',
    household: 'hh-cooper',
    email: 'marc.tremblay@example.com',
    mobile: '613-555-0101',
    createdDaysAgo: 29,
    notes: 'Offered his porch for a lawn sign. Prefers French for written material.',
    supportLevel: 'strong',
    votingStatus: 'will_vote',
    subscribed: true,
  },
  {
    key: 'sophie-tremblay',
    first_name: 'Sophie',
    last_name: 'Tremblay',
    household: 'hh-cooper',
    email: 'sophie.tremblay@example.com',
    mobile: '613-555-0102',
    createdDaysAgo: 29,
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'elise-tremblay',
    first_name: 'Élise',
    last_name: 'Tremblay',
    household: 'hh-cooper',
    email: 'elise.tremblay@example.net',
    createdDaysAgo: 22,
    tags: ['student'],
    supportLevel: 'leaning',
  },

  // ── hh-maclaren ─────────────────────────────────────────────────────────
  {
    key: 'priya-sharma',
    first_name: 'Priya',
    last_name: 'Sharma',
    household: 'hh-maclaren',
    company: 'co-sometech',
    email: 'priya.sharma@example.com',
    mobile: '613-555-0103',
    createdDaysAgo: 28,
    notes: 'Canvassed with us twice in the spring. Great on the doors.',
    volunteerStatus: 'active',
    supportLevel: 'strong',
    votingStatus: 'voted_advance',
    subscribed: true,
  },

  // ── hh-frank: the O'Briens ──────────────────────────────────────────────
  {
    key: 'kevin-obrien',
    first_name: 'Kevin',
    last_name: "O'Brien",
    household: 'hh-frank',
    email: 'kevin.obrien@example.com',
    mobile: '613-555-0104',
    createdDaysAgo: 27,
    tags: ['letter writer'],
    supportLevel: 'leaning',
    subscribed: true,
  },
  {
    key: 'maureen-obrien',
    first_name: 'Maureen',
    last_name: "O'Brien",
    household: 'hh-frank',
    company: 'co-rideau-dental',
    email: 'maureen.obrien@example.com',
    createdDaysAgo: 27,
    tags: ['senior'],
    supportLevel: 'neutral',
    subscribed: true,
  },

  // ── hh-arlington ────────────────────────────────────────────────────────
  {
    key: 'devon-clarke',
    first_name: 'Devon',
    last_name: 'Clarke',
    household: 'hh-arlington',
    company: 'co-bytown',
    email: 'devon.clarke@example.com',
    mobile: '613-555-0105',
    createdDaysAgo: 26,
    notes: 'Owns Bytown Coffee Roasters — open to hosting a meet-and-greet.',
    tags: ['small business owner'],
    supportLevel: 'leaning',
    subscribed: true,
  },

  // ── hh-gladstone: the Chens ─────────────────────────────────────────────
  {
    key: 'wei-chen',
    first_name: 'Wei',
    last_name: 'Chen',
    household: 'hh-gladstone',
    company: 'co-sometech',
    email: 'wei.chen@example.com',
    mobile: '613-555-0106',
    createdDaysAgo: 25,
    tags: ['small business owner'],
    supportLevel: 'undecided',
    subscribed: true,
  },
  {
    key: 'lin-chen',
    first_name: 'Lin',
    last_name: 'Chen',
    household: 'hh-gladstone',
    email: 'lin.chen@example.com',
    createdDaysAgo: 25,
    supportLevel: 'undecided',
  },
  {
    key: 'amy-chen',
    first_name: 'Amy',
    last_name: 'Chen',
    household: 'hh-gladstone',
    email: 'amy.chen@example.net',
    createdDaysAgo: 18,
    tags: ['student'],
  },

  // ── hh-bay: the Wilsons ─────────────────────────────────────────────────
  {
    key: 'ted-wilson',
    first_name: 'Ted',
    last_name: 'Wilson',
    household: 'hh-bay',
    email: 'ted.wilson@example.com',
    createdDaysAgo: 24,
    tags: ['senior'],
    supportLevel: 'leaning_against',
    votingStatus: 'will_vote',
  },
  {
    key: 'norma-wilson',
    first_name: 'Norma',
    last_name: 'Wilson',
    household: 'hh-bay',
    createdDaysAgo: 24,
    tags: ['senior'],
    supportLevel: 'against',
    notes: 'Asked not to be called during dinner hours.',
  },

  // ── hh-byron: the MacDonalds ────────────────────────────────────────────
  {
    key: 'heather-macdonald',
    first_name: 'Heather',
    last_name: 'MacDonald',
    household: 'hh-byron',
    email: 'heather.macdonald@example.com',
    mobile: '613-555-0107',
    createdDaysAgo: 23,
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'ross-macdonald',
    first_name: 'Ross',
    last_name: 'MacDonald',
    household: 'hh-byron',
    company: 'co-wwrealty',
    email: 'ross.macdonald@example.com',
    createdDaysAgo: 23,
    supportLevel: 'leaning',
    subscribed: true,
  },

  // ── hh-kirkwood ─────────────────────────────────────────────────────────
  {
    key: 'fatima-elsayed',
    first_name: 'Fatima',
    last_name: 'El-Sayed',
    household: 'hh-kirkwood',
    email: 'fatima.elsayed@example.com',
    mobile: '343-555-0108',
    createdDaysAgo: 21,
    notes: 'Runs the Westboro community association newsletter.',
    tags: ['community leader'],
    supportLevel: 'leaning',
    subscribed: true,
  },

  // ── hh-java: the Nguyens ────────────────────────────────────────────────
  {
    key: 'thanh-nguyen',
    first_name: 'Thanh',
    last_name: 'Nguyen',
    household: 'hh-java',
    email: 'thanh.nguyen@example.com',
    mobile: '613-555-0109',
    createdDaysAgo: 20,
    supportLevel: 'neutral',
    subscribed: true,
  },
  {
    key: 'mai-nguyen',
    first_name: 'Mai',
    last_name: 'Nguyen',
    household: 'hh-java',
    email: 'mai.nguyen@example.com',
    createdDaysAgo: 20,
    volunteerStatus: 'active',
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'bao-nguyen',
    first_name: 'Bao',
    last_name: 'Nguyen',
    household: 'hh-java',
    company: 'co-lansdowne',
    email: 'bao.nguyen@example.net',
    createdDaysAgo: 14,
    tags: ['student'],
  },

  // ── hh-armstrong ────────────────────────────────────────────────────────
  {
    key: 'jake-morrison',
    first_name: 'Jake',
    last_name: 'Morrison',
    household: 'hh-armstrong',
    company: 'co-capland',
    email: 'jake.morrison@example.com',
    mobile: '613-555-0110',
    createdDaysAgo: 19,
    volunteerStatus: 'active',
    supportLevel: 'strong',
    votingStatus: 'will_vote',
    subscribed: true,
  },

  // ── hh-huron: the Kowalskis ─────────────────────────────────────────────
  {
    key: 'anna-kowalski',
    first_name: 'Anna',
    last_name: 'Kowalski',
    household: 'hh-huron',
    email: 'anna.kowalski@example.com',
    createdDaysAgo: 18,
    tags: ['union member'],
    supportLevel: 'leaning',
    subscribed: true,
  },
  {
    key: 'piotr-kowalski',
    first_name: 'Piotr',
    last_name: 'Kowalski',
    household: 'hh-huron',
    email: 'piotr.kowalski@example.com',
    createdDaysAgo: 18,
    supportLevel: 'undecided',
  },

  // ── hh-fifth: the Haddads ───────────────────────────────────────────────
  {
    key: 'nadia-haddad',
    first_name: 'Nadia',
    last_name: 'Haddad',
    household: 'hh-fifth',
    email: 'nadia.haddad@example.com',
    mobile: '613-555-0111',
    createdDaysAgo: 17,
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'sami-haddad',
    first_name: 'Sami',
    last_name: 'Haddad',
    household: 'hh-fifth',
    email: 'sami.haddad@example.com',
    createdDaysAgo: 17,
    supportLevel: 'leaning',
  },
  {
    key: 'layla-haddad',
    first_name: 'Layla',
    last_name: 'Haddad',
    household: 'hh-fifth',
    company: 'co-lansdowne',
    email: 'layla.haddad@example.net',
    createdDaysAgo: 12,
    subscribed: true,
  },

  // ── hh-holmwood ─────────────────────────────────────────────────────────
  {
    key: 'gordon-ferguson',
    first_name: 'Gordon',
    last_name: 'Ferguson',
    household: 'hh-holmwood',
    email: 'gordon.ferguson@example.com',
    createdDaysAgo: 16,
    tags: ['senior'],
    supportLevel: 'neutral',
    votingStatus: 'voted_advance',
  },

  // ── hh-sunnyside: the Singhs ────────────────────────────────────────────
  {
    key: 'harpreet-singh',
    first_name: 'Harpreet',
    last_name: 'Singh',
    household: 'hh-sunnyside',
    email: 'harpreet.singh@example.com',
    mobile: '613-555-0112',
    createdDaysAgo: 15,
    notes: 'Coaches the Sunnyside youth soccer league — knows everyone on the street.',
    tags: ['community leader'],
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'simran-kaur',
    first_name: 'Simran',
    last_name: 'Kaur',
    household: 'hh-sunnyside',
    email: 'simran.kaur@example.com',
    createdDaysAgo: 15,
    supportLevel: 'leaning',
    subscribed: true,
  },
  {
    key: 'arjun-singh',
    first_name: 'Arjun',
    last_name: 'Singh',
    household: 'hh-sunnyside',
    email: 'arjun.singh@example.net',
    createdDaysAgo: 10,
    tags: ['student'],
  },

  // ── hh-powell ───────────────────────────────────────────────────────────
  {
    key: 'rebecca-stein',
    first_name: 'Rebecca',
    last_name: 'Stein',
    household: 'hh-powell',
    company: 'co-glebephysio',
    email: 'rebecca.stein@example.com',
    mobile: '613-555-0113',
    createdDaysAgo: 14,
    tags: ['letter writer'],
    supportLevel: 'leaning',
    subscribed: true,
  },

  // ── hh-aylmer: the Diallos ──────────────────────────────────────────────
  {
    key: 'amadou-diallo',
    first_name: 'Amadou',
    last_name: 'Diallo',
    household: 'hh-aylmer',
    company: 'co-riverkeepers',
    email: 'amadou.diallo@example.com',
    createdDaysAgo: 13,
    tags: ['faith community'],
    supportLevel: 'neutral',
    subscribed: true,
  },
  {
    key: 'mariam-diallo',
    first_name: 'Mariam',
    last_name: 'Diallo',
    household: 'hh-aylmer',
    email: 'mariam.diallo@example.com',
    createdDaysAgo: 13,
    supportLevel: 'undecided',
  },

  // ── hh-sweetland: the Lavoies ───────────────────────────────────────────
  {
    key: 'julie-lavoie',
    first_name: 'Julie',
    last_name: 'Lavoie',
    household: 'hh-sweetland',
    email: 'julie.lavoie@example.com',
    mobile: '613-555-0115',
    createdDaysAgo: 12,
    tags: ['community leader'],
    supportLevel: 'strong',
    votingStatus: 'will_vote',
    subscribed: true,
  },
  {
    key: 'pascal-lavoie',
    first_name: 'Pascal',
    last_name: 'Lavoie',
    household: 'hh-sweetland',
    email: 'pascal.lavoie@example.com',
    createdDaysAgo: 12,
    supportLevel: 'leaning',
  },
  {
    key: 'theo-lavoie',
    first_name: 'Théo',
    last_name: 'Lavoie',
    household: 'hh-sweetland',
    email: 'theo.lavoie@example.net',
    createdDaysAgo: 8,
    tags: ['student'],
    volunteerStatus: 'active',
  },

  // ── hh-marlborough ──────────────────────────────────────────────────────
  {
    key: 'grace-okafor',
    first_name: 'Grace',
    last_name: 'Okafor',
    household: 'hh-marlborough',
    company: 'co-riverkeepers',
    email: 'grace.okafor@example.com',
    mobile: '343-555-0116',
    createdDaysAgo: 11,
    notes: 'Board member at the Riverkeepers Alliance. Introduced us to three other volunteers.',
    tags: ['community leader'],
    supportLevel: 'strong',
    subscribed: true,
  },

  // ── hh-blackburn: the Petrovs ───────────────────────────────────────────
  {
    key: 'dmitri-petrov',
    first_name: 'Dmitri',
    last_name: 'Petrov',
    household: 'hh-blackburn',
    email: 'dmitri.petrov@example.com',
    createdDaysAgo: 10,
    supportLevel: 'leaning_against',
    subscribed: true,
  },
  {
    key: 'elena-petrova',
    first_name: 'Elena',
    last_name: 'Petrova',
    household: 'hh-blackburn',
    email: 'elena.petrova@example.com',
    createdDaysAgo: 10,
    supportLevel: 'undecided',
    subscribed: true,
  },

  // ── hh-charlotte ────────────────────────────────────────────────────────
  {
    key: 'liam-byrne',
    first_name: 'Liam',
    last_name: 'Byrne',
    household: 'hh-charlotte',
    email: 'liam.byrne@example.com',
    mobile: '613-555-0117',
    createdDaysAgo: 9,
    supportLevel: 'undecided',
  },

  // ── hh-kilborn: the Rahmans ─────────────────────────────────────────────
  {
    key: 'ayesha-rahman',
    first_name: 'Ayesha',
    last_name: 'Rahman',
    household: 'hh-kilborn',
    email: 'ayesha.rahman@example.com',
    mobile: '613-555-0118',
    createdDaysAgo: 8,
    tags: ['faith community'],
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'tariq-rahman',
    first_name: 'Tariq',
    last_name: 'Rahman',
    household: 'hh-kilborn',
    email: 'tariq.rahman@example.com',
    createdDaysAgo: 8,
    supportLevel: 'leaning',
    subscribed: true,
  },
  {
    key: 'zara-rahman',
    first_name: 'Zara',
    last_name: 'Rahman',
    household: 'hh-kilborn',
    email: 'zara.rahman@example.net',
    createdDaysAgo: 6,
    tags: ['student'],
  },

  // ── hh-pleasantpark ─────────────────────────────────────────────────────
  {
    key: 'bruce-whitfield',
    first_name: 'Bruce',
    last_name: 'Whitfield',
    household: 'hh-pleasantpark',
    email: 'bruce.whitfield@example.com',
    createdDaysAgo: 7,
    tags: ['senior'],
    supportLevel: 'against',
    votingStatus: 'not_voting',
    doNotContact: true,
    notes: 'Asked to be removed from all contact lists — do-not-contact flag set.',
  },

  // ── hh-halifax: the Rossis ──────────────────────────────────────────────
  {
    key: 'carla-rossi',
    first_name: 'Carla',
    last_name: 'Rossi',
    household: 'hh-halifax',
    email: 'carla.rossi@example.com',
    mobile: '613-555-0119',
    createdDaysAgo: 6,
    supportLevel: 'neutral',
    subscribed: true,
  },
  {
    key: 'vincenzo-rossi',
    first_name: 'Vincenzo',
    last_name: 'Rossi',
    household: 'hh-halifax',
    company: 'co-preston',
    email: 'vincenzo.rossi@example.com',
    createdDaysAgo: 6,
    tags: ['small business owner'],
    supportLevel: 'leaning',
  },

  // ── hh-featherston ──────────────────────────────────────────────────────
  {
    key: 'michelle-thibault',
    first_name: 'Michelle',
    last_name: 'Thibault',
    household: 'hh-featherston',
    email: 'michelle.thibault@example.com',
    mobile: '343-555-0120',
    createdDaysAgo: 5,
    notes: 'Former riding association president — invaluable institutional memory.',
    tags: ['community leader'],
    supportLevel: 'strong',
    subscribed: true,
  },

  // ── No household yet (placeholder) ──────────────────────────────────────
  {
    key: 'omar-khalil',
    first_name: 'Omar',
    last_name: 'Khalil',
    email: 'omar.khalil@example.com',
    mobile: '613-555-0121',
    createdDaysAgo: 4,
    tags: ['new to riding'],
    subscribed: true,
  },
  {
    key: 'jessica-lam',
    first_name: 'Jessica',
    last_name: 'Lam',
    company: 'co-bytown',
    email: 'jessica.lam@example.com',
    createdDaysAgo: 26,
    volunteerStatus: 'active',
    supportLevel: 'strong',
    subscribed: true,
  },
  {
    key: 'ryan-fitzgerald',
    first_name: 'Ryan',
    last_name: 'Fitzgerald',
    email: 'ryan.fitzgerald@example.com',
    mobile: '613-555-0122',
    createdDaysAgo: 21,
    volunteerStatus: 'active',
    supportLevel: 'leaning',
  },
  {
    key: 'chantal-bergeron',
    first_name: 'Chantal',
    last_name: 'Bergeron',
    company: 'co-rideau-dental',
    email: 'chantal.bergeron@example.com',
    createdDaysAgo: 19,
    supportLevel: 'neutral',
    subscribed: true,
  },
  {
    key: 'david-oduya',
    first_name: 'David',
    last_name: 'Oduya',
    email: 'david.oduya@example.com',
    createdDaysAgo: 16,
    tags: ['new to riding'],
    supportLevel: 'undecided',
  },
  {
    key: 'karen-mackenzie',
    first_name: 'Karen',
    last_name: 'Mackenzie',
    company: 'co-wwrealty',
    email: 'karen.mackenzie@example.com',
    mobile: '613-555-0123',
    createdDaysAgo: 15,
    supportLevel: 'leaning_against',
    subscribed: true,
  },
  {
    key: 'steve-papadopoulos',
    first_name: 'Steve',
    last_name: 'Papadopoulos',
    email: 'steve.papadopoulos@example.com',
    createdDaysAgo: 13,
    tags: ['union member'],
    supportLevel: 'leaning',
    subscribed: true,
  },
  {
    key: 'hana-yoshida',
    first_name: 'Hana',
    last_name: 'Yoshida',
    company: 'co-glebephysio',
    email: 'hana.yoshida@example.com',
    createdDaysAgo: 11,
    supportLevel: 'neutral',
  },
  {
    key: 'marcus-webb',
    first_name: 'Marcus',
    last_name: 'Webb',
    company: 'co-hintonprint',
    email: 'marcus.webb@example.com',
    mobile: '613-555-0124',
    createdDaysAgo: 9,
    notes: 'Prints our signs at cost — invoice through Hintonburg Print Co.',
    tags: ['small business owner'],
    supportLevel: 'strong',
  },
  {
    key: 'isabelle-fortin',
    first_name: 'Isabelle',
    last_name: 'Fortin',
    email: 'isabelle.fortin@example.com',
    mobile: '343-555-0125',
    createdDaysAgo: 7,
    notes: 'Freelance reporter — covers community affairs. Keep on the media list.',
    tags: ['media contact'],
  },
  {
    key: 'tom-reilly',
    first_name: 'Tom',
    last_name: 'Reilly',
    company: 'co-capland',
    email: 'tom.reilly@example.com',
    createdDaysAgo: 5,
    supportLevel: 'undecided',
  },
  {
    key: 'aiko-tanaka',
    first_name: 'Aiko',
    last_name: 'Tanaka',
    email: 'aiko.tanaka@example.com',
    createdDaysAgo: 3,
    tags: ['new to riding'],
    subscribed: true,
  },
  {
    key: 'brian-kelly',
    first_name: 'Brian',
    last_name: 'Kelly',
    email: 'brian.kelly@example.com',
    createdDaysAgo: 2,
    tags: ['union member'],
    supportLevel: 'against',
    votingStatus: 'ineligible',
  },
  {
    key: 'lucia-mendes',
    first_name: 'Lucia',
    last_name: 'Mendes',
    email: 'lucia.mendes@example.com',
    mobile: '613-555-0126',
    createdDaysAgo: 2,
    tags: ['new to riding'],
    subscribed: true,
  },
  {
    key: 'samir-gupta',
    first_name: 'Samir',
    last_name: 'Gupta',
    company: 'co-sometech',
    email: 'samir.gupta@example.com',
    createdDaysAgo: 1,
    supportLevel: 'leaning',
  },

  // ── March CSV import duplicates (Duplicates page, §9.3) ─────────────────
  // Thin rows the March volunteer CSV re-created for people already on file —
  // the mess the "Clean up duplicate entries from the spring import" task
  // points at. Each pairs with exactly ONE existing person, so every group on
  // the Duplicates page is a two-card pair with a target/source pre-selected:
  //   • same name in the same household            → "possible" confidence
  //   • same name at the same address (hh-kilborn  → "high" confidence
  //     + hh-kilborn-import, one address_fp_full)
  // Person emails are unique per tenant (idx_persons_tenant_email_unique), so
  // an email-match group can't be seeded — these rows instead carry partly
  // conflicting, partly missing contact details, which is what a merge fixes.
  {
    key: 'kevin-obrien-import',
    first_name: 'Kevin',
    last_name: "O'Brien",
    household: 'hh-frank',
    email: 'k.obrien@example.net',
    mobile: '613-555-0231',
    createdDaysAgo: 12,
    notes: 'March CSV import — a different mobile and email than the record already on file.',
  },
  {
    key: 'ayesha-rahman-import',
    first_name: 'Ayesha',
    last_name: 'Rahman',
    household: 'hh-kilborn-import',
    email: 'a.rahman@example.org',
    mobile: '613-555-0232',
    createdDaysAgo: 11,
    tags: ['faith community'],
    notes: 'March CSV import — same address as the Rahman household, typed as "Kilborn Ave.".',
  },
  {
    key: 'bruce-whitfield-import',
    first_name: 'Bruce',
    last_name: 'Whitfield',
    household: 'hh-pleasantpark',
    mobile: '613-555-0233',
    createdDaysAgo: 10,
    notes: 'March CSV import — this row is missing the do-not-contact flag the older record carries.',
  },
];

export const DEMO_TASKS: DemoTaskDef[] = [
  {
    name: 'Call Marc Tremblay about the Cooper Street lawn sign',
    details:
      'He offered his porch at 174 Cooper Street — confirm size and drop-off day. He prefers French for written follow-up.',
    status: 'todo',
    priority: 'high',
    position: 1,
    dueInDays: 2,
    assignToOwner: true,
  },
  {
    name: 'Replace the damaged sign at 468 Byron Avenue',
    details:
      'Heather MacDonald reported the sign blew over in the weekend storm. Grab a replacement from the office on the way.',
    status: 'todo',
    priority: 'urgent',
    position: 2,
    dueInDays: 1,
    assignToOwner: true,
  },
  {
    name: 'Order 250 door hangers for the Westboro canvass',
    details:
      'Marcus Webb at Hintonburg Print Co. prints at cost — send him the artwork and confirm pickup before Saturday.',
    status: 'in_progress',
    priority: 'medium',
    position: 3,
    dueInDays: 4,
    assignToUser: 'u-emma',
  },
  {
    name: 'Recruit three more canvassers for Sandy Hill',
    details:
      'Julie Lavoie offered to ask around Sweetland Avenue. Check the volunteer prospects list for anyone near Rideau-Vanier.',
    status: 'in_progress',
    priority: 'high',
    position: 4,
    dueInDays: 5,
    assignToUser: 'u-carlos',
  },
  {
    name: 'Ask Devon Clarke about hosting a meet-and-greet',
    details:
      'Bytown Coffee Roasters has space for ~30 people on a weeknight. Devon was open to it when we spoke in May.',
    status: 'todo',
    priority: 'medium',
    position: 5,
    dueInDays: 7,
  },
  {
    name: 'Book the community hall for town hall night',
    details: 'Waiting to hear back from the Glebe Community Centre about availability in the last week of the month.',
    status: 'waiting',
    priority: 'high',
    position: 6,
    dueInDays: 10,
  },
  {
    name: 'Update the phone-bank script with survey feedback',
    details: 'The issues survey shows housing and transit leading — move those to the top of the script.',
    status: 'todo',
    priority: 'low',
    position: 7,
  },
  {
    name: 'Print name badges for the Saturday canvass launch',
    details: 'Six volunteers signed up so far — print a few blanks too.',
    status: 'todo',
    priority: 'medium',
    position: 8,
    dueInDays: 3,
    assignToOwner: true,
  },
  {
    name: 'Coffee with Michelle Thibault',
    details: 'Former riding association president. Pick her brain on the ward captains model before we grow the team.',
    status: 'todo',
    priority: 'medium',
    position: 9,
    dueInDays: 6,
  },
  {
    name: 'Follow up with Isabelle Fortin on the profile piece',
    details: 'She asked for two supporter interviews and a photo. Suggest Grace Okafor and Harpreet Singh.',
    status: 'waiting',
    priority: 'medium',
    position: 10,
    dueInDays: 8,
  },
  {
    name: 'Send welcome notes to this month’s new contacts',
    details: 'Omar, Aiko, Lucia and David all came in through the website this month.',
    status: 'done',
    priority: 'low',
    position: 11,
    completedDaysAgo: 3,
  },
  {
    name: 'Thank the Brewer Park cleanup volunteers',
    details: 'Julie, Grace, Harpreet and Amadou all showed — a short personal email each goes a long way.',
    status: 'done',
    priority: 'medium',
    position: 12,
    completedDaysAgo: 17,
  },
  {
    name: 'Draft the June newsletter outline',
    details: 'Lead with the canvass launch, then the transit survey results, then volunteer spotlights.',
    status: 'in_progress',
    priority: 'medium',
    position: 13,
    dueInDays: 6,
    assignToUser: 'u-emma',
  },
  {
    name: 'Clean up duplicate entries from the spring import',
    details:
      'The March CSV import created a handful of near-duplicates — review the Duplicates page and merge or dismiss.',
    status: 'todo',
    priority: 'low',
    position: 14,
  },
];

export const DEMO_LISTS: DemoListDef[] = [
  {
    key: 'list-volunteers',
    name: 'Volunteer prospects',
    description: 'People who volunteered before or said they might — first call for canvass weekends.',
    members: [
      'priya-sharma',
      'jake-morrison',
      'mai-nguyen',
      'theo-lavoie',
      'jessica-lam',
      'ryan-fitzgerald',
      'julie-lavoie',
      'harpreet-singh',
    ],
  },
  {
    key: 'list-mainstreet',
    name: 'Main street businesses',
    description:
      'Business owners and managers along the commercial strips — sponsorships, window posters, meet-and-greets.',
    members: ['devon-clarke', 'vincenzo-rossi', 'marcus-webb', 'wei-chen', 'jessica-lam', 'karen-mackenzie'],
  },
  {
    key: 'list-subscribers',
    name: 'Newsletter subscribers',
    description: 'Everyone who has opted in to the email newsletter.',
    members: [
      'marc-tremblay',
      'sophie-tremblay',
      'priya-sharma',
      'kevin-obrien',
      'maureen-obrien',
      'devon-clarke',
      'wei-chen',
      'heather-macdonald',
      'ross-macdonald',
      'fatima-elsayed',
      'thanh-nguyen',
      'mai-nguyen',
      'jake-morrison',
      'anna-kowalski',
      'nadia-haddad',
      'layla-haddad',
      'harpreet-singh',
      'simran-kaur',
      'rebecca-stein',
      'amadou-diallo',
      'julie-lavoie',
      'grace-okafor',
      'dmitri-petrov',
      'elena-petrova',
      'ayesha-rahman',
      'tariq-rahman',
      'carla-rossi',
      'michelle-thibault',
      'omar-khalil',
      'jessica-lam',
      'chantal-bergeron',
      'karen-mackenzie',
      'steve-papadopoulos',
      'aiko-tanaka',
      'lucia-mendes',
    ],
  },
];

export const DEMO_TEAM: DemoTeamDef = {
  name: 'Canvassing crew',
  description: 'The regulars who knock doors most weekends.',
  members: ['priya-sharma', 'jake-morrison', 'julie-lavoie'],
};

export const DEMO_VOLUNTEER_EVENTS: DemoVolunteerEventDef[] = [
  {
    key: 'ev-canvass',
    name: 'Saturday canvass launch',
    description:
      'Kick-off canvass for the season. Meet at the Hintonburg Community Centre for a 30-minute training, then pairs head out with turf packets. Coffee and snacks provided.',
    location_address: '1064 Wellington St W, Ottawa, ON K1Y 2Y3',
    slug: 'saturday-canvass-launch',
    startInDays: 18,
    durationHours: 3,
    capacity: 25,
    shifts: [
      { person: 'priya-sharma', status: 'signed_up' },
      { person: 'jake-morrison', status: 'signed_up' },
      { person: 'mai-nguyen', status: 'signed_up' },
      { person: 'ryan-fitzgerald', status: 'signed_up' },
      { person: 'jessica-lam', status: 'signed_up' },
      { person: 'theo-lavoie', status: 'signed_up' },
    ],
  },
  {
    key: 'ev-cleanup',
    name: 'Brewer Park cleanup morning',
    description: 'Community cleanup along the canal side of Brewer Park, followed by coffee. Gloves and bags provided.',
    location_address: '100 Brewer Way, Ottawa, ON K1S 5T1',
    slug: 'brewer-park-cleanup-morning',
    startInDays: -20,
    durationHours: 2,
    capacity: 15,
    shifts: [
      { person: 'julie-lavoie', status: 'attended' },
      { person: 'grace-okafor', status: 'attended' },
      { person: 'harpreet-singh', status: 'attended' },
      { person: 'amadou-diallo', status: 'attended' },
    ],
  },
];

const SPRING_LINKS = {
  cleanup: 'https://example.org/park-cleanup-recap',
  volunteer: 'https://example.org/volunteer-signup',
  transit: 'https://example.org/transit-survey',
};

const WELCOME_LINKS = {
  hours: 'https://example.org/office-hours',
  subscribe: 'https://example.org/newsletter',
};

export const DEMO_NEWSLETTERS: DemoNewsletterDef[] = [
  {
    key: 'nl-spring',
    name: 'Spring community update',
    status: 'sent',
    subject: 'Spring update: park cleanup, transit changes, and how to help',
    preview_text: 'What we heard at the doors this month, plus two ways to pitch in.',
    audience_description: 'Newsletter subscribers',
    sentDaysAgo: 10,
    links: [SPRING_LINKS.cleanup, SPRING_LINKS.volunteer, SPRING_LINKS.transit],
    html_content:
      '<h1>Spring community update</h1>' +
      '<p>Thirty of us spent Saturday morning at Brewer Park — <a href="https://example.org/park-cleanup-recap">see the photos</a>. ' +
      'Thank you to everyone who came out.</p>' +
      '<p>At the doors this month, transit reliability came up more than any other issue. ' +
      'We put together a <a href="https://example.org/transit-survey">two-minute survey</a> so we can bring your answers to the next community association meeting.</p>' +
      '<p>Canvass season starts soon — <a href="https://example.org/volunteer-signup">sign up here</a> if you can give a Saturday morning.</p>',
    plain_text_content:
      'Spring community update — Brewer Park cleanup recap, a two-minute transit survey, and canvass season sign-up. ' +
      'Survey: https://example.org/transit-survey — Volunteer: https://example.org/volunteer-signup',
    recipients: [
      'marc-tremblay',
      'sophie-tremblay',
      'priya-sharma',
      'kevin-obrien',
      'maureen-obrien',
      'devon-clarke',
      'wei-chen',
      'heather-macdonald',
      'ross-macdonald',
      'fatima-elsayed',
      'thanh-nguyen',
      'mai-nguyen',
      'jake-morrison',
      'anna-kowalski',
      'nadia-haddad',
      'layla-haddad',
      'harpreet-singh',
      'simran-kaur',
      'rebecca-stein',
      'amadou-diallo',
      'julie-lavoie',
      'grace-okafor',
      'dmitri-petrov',
      'elena-petrova',
      'ayesha-rahman',
      'tariq-rahman',
      'carla-rossi',
      'michelle-thibault',
      'karen-mackenzie',
      'steve-papadopoulos',
    ],
    engagement: [
      { person: 'marc-tremblay', opens: 3, clicks: [SPRING_LINKS.volunteer, SPRING_LINKS.cleanup] },
      { person: 'sophie-tremblay', opens: 1 },
      { person: 'priya-sharma', opens: 2, clicks: [SPRING_LINKS.volunteer] },
      { person: 'kevin-obrien', opens: 2, clicks: [SPRING_LINKS.transit] },
      { person: 'maureen-obrien', opens: 1 },
      { person: 'devon-clarke', opens: 1 },
      { person: 'heather-macdonald', opens: 4, clicks: [SPRING_LINKS.cleanup, SPRING_LINKS.volunteer] },
      { person: 'fatima-elsayed', opens: 2, clicks: [SPRING_LINKS.transit] },
      { person: 'mai-nguyen', opens: 1, clicks: [SPRING_LINKS.volunteer] },
      { person: 'jake-morrison', opens: 2 },
      { person: 'anna-kowalski', opens: 1 },
      { person: 'nadia-haddad', opens: 2, clicks: [SPRING_LINKS.transit] },
      { person: 'harpreet-singh', opens: 3, clicks: [SPRING_LINKS.cleanup] },
      { person: 'rebecca-stein', opens: 1, clicks: [SPRING_LINKS.transit] },
      { person: 'julie-lavoie', opens: 2 },
      { person: 'grace-okafor', opens: 2 },
      { person: 'ayesha-rahman', opens: 1 },
      { person: 'carla-rossi', opens: 1 },
      { person: 'michelle-thibault', opens: 2 },
      { person: 'dmitri-petrov', opens: 1, unsubscribed: true },
      { person: 'steve-papadopoulos', opens: 0, bounce: 'hard' },
      { person: 'karen-mackenzie', opens: 0, bounce: 'soft' },
    ],
  },
  {
    key: 'nl-welcome',
    name: 'Welcome from our new community office',
    status: 'sent',
    subject: 'We have opened a community office — come say hello',
    preview_text: 'New office hours, and a newsletter you can forward to a neighbour.',
    audience_description: 'Early subscribers',
    sentDaysAgo: 45,
    links: [WELCOME_LINKS.hours, WELCOME_LINKS.subscribe],
    html_content:
      '<h1>We have opened a community office</h1>' +
      '<p>Drop in and say hello — <a href="https://example.org/office-hours">office hours are posted here</a>. ' +
      'If a neighbour would enjoy these updates, <a href="https://example.org/newsletter">the sign-up form is here</a>.</p>',
    plain_text_content:
      'We have opened a community office. Office hours: https://example.org/office-hours — Newsletter sign-up: https://example.org/newsletter',
    recipients: [
      'marc-tremblay',
      'sophie-tremblay',
      'priya-sharma',
      'kevin-obrien',
      'devon-clarke',
      'heather-macdonald',
      'ross-macdonald',
      'fatima-elsayed',
      'thanh-nguyen',
      'mai-nguyen',
      'jake-morrison',
      'nadia-haddad',
      'harpreet-singh',
      'simran-kaur',
      'rebecca-stein',
      'julie-lavoie',
      'grace-okafor',
      'ayesha-rahman',
      'michelle-thibault',
      'jessica-lam',
      'chantal-bergeron',
      'elena-petrova',
      'carla-rossi',
      'amadou-diallo',
    ],
    engagement: [
      { person: 'marc-tremblay', opens: 2, clicks: [WELCOME_LINKS.hours] },
      { person: 'priya-sharma', opens: 1 },
      { person: 'heather-macdonald', opens: 2, clicks: [WELCOME_LINKS.subscribe] },
      { person: 'fatima-elsayed', opens: 1 },
      { person: 'mai-nguyen', opens: 1 },
      { person: 'nadia-haddad', opens: 1, clicks: [WELCOME_LINKS.hours] },
      { person: 'harpreet-singh', opens: 2 },
      { person: 'julie-lavoie', opens: 1 },
      { person: 'grace-okafor', opens: 3, clicks: [WELCOME_LINKS.hours] },
      { person: 'michelle-thibault', opens: 1 },
      { person: 'jessica-lam', opens: 1 },
      { person: 'chantal-bergeron', opens: 0, bounce: 'hard' },
    ],
  },
  {
    key: 'nl-june',
    name: 'June community update',
    status: 'draft',
    subject: 'June update: canvass launch and your transit survey results',
    preview_text: 'The canvass season opens this Saturday — plus what 200 of you said about transit.',
    audience_description: 'Newsletter subscribers',
    html_content:
      '<h1>June community update</h1>' +
      '<p>Canvass season opens this Saturday at the Hintonburg Community Centre — training at 10:00, doors by 10:30.</p>' +
      '<p>Transit survey results are in: reliability beat frequency two to one. Full breakdown next issue.</p>',
    plain_text_content:
      'June community update — canvass season opens Saturday (training 10:00, Hintonburg CC). Transit survey: reliability beat frequency two to one.',
  },
];

/** Answer keys match the starter-form templates (fieldsForTemplate in web-forms.schema.ts). */
export const DEMO_SUBMISSIONS: DemoSubmissionDef[] = [
  {
    formSlug: 'newsletter-sign-up',
    person: 'omar-khalil',
    daysAgo: 4,
    answers: { full_name: 'Omar Khalil', email: 'omar.khalil@example.com', mobile: '613-555-0121' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'aiko-tanaka',
    daysAgo: 3,
    answers: { full_name: 'Aiko Tanaka', email: 'aiko.tanaka@example.com' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'lucia-mendes',
    daysAgo: 2,
    answers: { full_name: 'Lucia Mendes', email: 'lucia.mendes@example.com', mobile: '613-555-0126' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'david-oduya',
    daysAgo: 12,
    answers: { full_name: 'David Oduya', email: 'david.oduya@example.com' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'hana-yoshida',
    daysAgo: 9,
    answers: { full_name: 'Hana Yoshida', email: 'hana.yoshida@example.com' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'isabelle-fortin',
    daysAgo: 6,
    answers: { full_name: 'Isabelle Fortin', email: 'isabelle.fortin@example.com' },
  },
  {
    formSlug: 'issues-survey',
    person: 'rebecca-stein',
    daysAgo: 8,
    answers: {
      full_name: 'Rebecca Stein',
      email: 'rebecca.stein@example.com',
      issues: ['Housing', 'Transit'],
      open: 'The 6 bus is unusable in winter — reliability matters more than new routes.',
    },
  },
  {
    formSlug: 'issues-survey',
    person: 'kevin-obrien',
    daysAgo: 7,
    answers: {
      full_name: "Kevin O'Brien",
      email: 'kevin.obrien@example.com',
      issues: ['Transit', 'Parks'],
      open: 'Please push for the Frank Street traffic calming pilot to be made permanent.',
    },
  },
  {
    formSlug: 'issues-survey',
    person: 'fatima-elsayed',
    daysAgo: 5,
    answers: {
      full_name: 'Fatima El-Sayed',
      email: 'fatima.elsayed@example.com',
      issues: ['Housing', 'Schools'],
      open: 'Westboro needs more three-bedroom rentals — young families are being pushed out.',
    },
  },
  {
    formSlug: 'issues-survey',
    person: 'liam-byrne',
    daysAgo: 3,
    answers: {
      full_name: 'Liam Byrne',
      email: 'liam.byrne@example.com',
      issues: ['Safety'],
      open: 'Better lighting on Charlotte Street between Rideau and Laurier, please.',
    },
  },
];

export const DEMO_USERS: DemoUserDef[] = [
  {
    key: 'u-natalie',
    first_name: 'Natalie',
    last_name: 'Brooks',
    emailLocal: 'natalie.brooks',
    role: 'admin',
  },
  {
    key: 'u-carlos',
    first_name: 'Carlos',
    last_name: 'Rivera',
    emailLocal: 'carlos.rivera',
    role: 'user',
  },
  {
    key: 'u-emma',
    first_name: 'Emma',
    last_name: 'Sinclair',
    emailLocal: 'emma.sinclair',
    role: 'user',
  },
];

export const DEMO_ISSUE_ASSIGNMENTS: DemoIssueAssignmentDef[] = [
  {
    issue: 'housing affordability',
    people: ['fatima-elsayed', 'rebecca-stein', 'ayesha-rahman', 'omar-khalil'],
  },
  {
    issue: 'transit reliability',
    people: ['rebecca-stein', 'kevin-obrien', 'steve-papadopoulos', 'anna-kowalski'],
  },
  {
    issue: 'road safety',
    people: ['liam-byrne', 'harpreet-singh', 'julie-lavoie'],
  },
  {
    issue: 'parks & greenspace',
    people: ['marc-tremblay', 'kevin-obrien', 'grace-okafor'],
  },
  {
    issue: 'small business support',
    people: ['wei-chen', 'devon-clarke', 'vincenzo-rossi', 'marcus-webb'],
  },
  {
    issue: 'climate action',
    people: ['amadou-diallo', 'grace-okafor', 'theo-lavoie'],
  },
];

export const DEMO_EMAILS: DemoEmailDef[] = [
  {
    folder: 'inbox',
    person: 'marc-tremblay',
    subject: 'Lawn sign for our porch',
    preview: 'Bonjour! We talked at the market on Saturday — we would love a sign for our porch on Cooper…',
    status: 'open',
    daysAgo: 2,
    is_favourite: true,
    body_html:
      '<p>Bonjour!</p><p>We talked at the market on Saturday — we would love a sign for our porch at 174 Cooper Street. A larger one if you have them.</p><p>Merci,<br>Marc</p>',
  },
  {
    folder: 'inbox',
    person: 'devon-clarke',
    subject: 'Meet-and-greet at the café — possible dates',
    preview: 'Happy to host the evening you mentioned. The café can take about 30 people on a weeknight…',
    status: 'open',
    assignTo: 'owner',
    daysAgo: 1,
    body_html:
      '<p>Hi,</p><p>Happy to host the evening you mentioned. The café can take about 30 people on a weeknight — the last two Thursdays of the month are open right now.</p><p>Devon<br>Bytown Coffee Roasters</p>',
  },
  {
    folder: 'inbox',
    person: 'fatima-elsayed',
    subject: 'Newsletter swap with the community association?',
    preview: 'Our association newsletter goes to about 900 households in Westboro. Would you be open to…',
    status: 'open',
    assignTo: 'u-emma',
    daysAgo: 3,
    body_html:
      '<p>Hello,</p><p>Our association newsletter goes to about 900 households in Westboro. Would you be open to trading a short intro blurb next month?</p><p>Fatima</p>',
  },
  {
    folder: 'inbox',
    person: 'isabelle-fortin',
    subject: 'Interview request: community profile piece',
    preview: 'I am putting together a profile on new community organizations for the weekly. Could we set up…',
    status: 'open',
    assignTo: 'u-natalie',
    daysAgo: 5,
    body_html:
      '<p>Hi,</p><p>I am putting together a profile on new community organizations for the weekly. Could we set up 30 minutes this week? I would also love to speak with two of your volunteers.</p><p>Isabelle Fortin</p>',
  },
  {
    folder: 'inbox',
    person: 'harpreet-singh',
    subject: 'Soccer league fundraiser — table for you',
    preview: 'The league fundraiser is on the 22nd and we can hold a table for your team if you want it…',
    status: 'closed',
    assignTo: 'u-carlos',
    daysAgo: 12,
    body_html:
      '<p>Hi,</p><p>The league fundraiser is on the 22nd and we can hold a table for your team if you want it. Setup from 5pm.</p><p>Harpreet</p>',
  },
  {
    folder: 'inbox',
    person: 'grace-okafor',
    subject: 'Riverkeepers endorsement process',
    preview: 'Following up from the cleanup — the board reviews community partnerships quarterly, and the…',
    status: 'closed',
    assignTo: 'owner',
    daysAgo: 15,
    body_html:
      '<p>Hello,</p><p>Following up from the cleanup — the board reviews community partnerships quarterly, and the next window opens in three weeks. I can walk you through the process.</p><p>Grace</p>',
  },
  {
    folder: 'sent',
    person: 'marc-tremblay',
    subject: 'Re: Lawn sign for our porch',
    preview: 'Merci Marc! A large sign is yours — we will drop it off this week and confirm the day by text…',
    status: 'closed',
    daysAgo: 1,
    body_html:
      '<p>Merci Marc!</p><p>A large sign is yours — we will drop it off this week and confirm the day by text. Thanks for the support.</p>',
  },
];

// ── Canvassing (§13) ────────────────────────────────────────────────────────
// Pre-cut turfs over the demo households so the /canvassing page opens with a
// real field operation instead of an empty state. Turfs never cross a ward
// (the cutting engine's only barrier), so each turf's households all share one
// ward. Progress ("In field now", "Complete") is DERIVED from the knocks at
// read time — we store only the lifecycle status + the knock rows, never
// counters. Timings are relative to seed time (`knockedHoursAgo`) so the
// derived state is the same however long after signup the user looks:
//   • active + every door knocked, last knock long ago → "Complete"
//   • active + a knock within the last 6h            → "In field now"
//   • active + some/no knocks, nothing recent        → "Assigned"
//   • draft (not handed out)                         → "Draft"

export interface DemoKnockDef {
  /** Household key — must belong to the turf. */
  household: string;
  /** Resident spoken to (conversation outcomes); links the knock to a contact. */
  person?: string;
  outcome: 'conversation' | 'no_answer' | 'not_home' | 'refused' | 'inaccessible';
  /** The voter's stance — only meaningful on a conversation. */
  response?: 'strong_support' | 'lean_support' | 'undecided' | 'opposed';
  /** Display name written to the knock (the volunteer who logged it). */
  canvasser: string;
  notes?: string;
  /** Hours before seed time — drives the derived in-field / complete window. */
  knockedHoursAgo: number;
}

export interface DemoTurfDef {
  key: string;
  name: string;
  /** All households must sit in this ward (turfs are ward-bounded). */
  ward: string;
  /** Stored lifecycle: 'active' = handed out/knocked, 'draft' = cut, not yet assigned. */
  status: 'draft' | 'active';
  /** Whether a tokenised Companion assignment exists (active turfs only). */
  assigned: boolean;
  /** Household keys (from DEMO_HOUSEHOLDS) that make up the door list. */
  households: string[];
  knocks?: DemoKnockDef[];
  notes?: string;
}

export const DEMO_TURFS: DemoTurfDef[] = [
  {
    key: 'turf-somerset',
    name: 'Centretown core (Somerset)',
    ward: 'Somerset',
    status: 'active',
    assigned: true,
    households: ['hh-cooper', 'hh-maclaren', 'hh-frank', 'hh-arlington', 'hh-gladstone', 'hh-bay'],
    notes: 'First turf out the door this cycle — fully canvassed.',
    knocks: [
      {
        household: 'hh-cooper',
        person: 'marc-tremblay',
        outcome: 'conversation',
        response: 'strong_support',
        canvasser: 'Priya S.',
        notes: 'Wants a large lawn sign — dropping one off Thursday.',
        knockedHoursAgo: 50,
      },
      {
        household: 'hh-maclaren',
        person: 'priya-sharma',
        outcome: 'conversation',
        response: 'strong_support',
        canvasser: 'Jake M.',
        knockedHoursAgo: 49,
      },
      {
        household: 'hh-frank',
        person: 'kevin-obrien',
        outcome: 'conversation',
        response: 'lean_support',
        canvasser: 'Priya S.',
        knockedHoursAgo: 49,
      },
      {
        household: 'hh-arlington',
        person: 'devon-clarke',
        outcome: 'conversation',
        response: 'lean_support',
        canvasser: 'Jake M.',
        knockedHoursAgo: 48,
      },
      {
        household: 'hh-gladstone',
        outcome: 'no_answer',
        canvasser: 'Priya S.',
        notes: 'Buzzer broken — try back in the evening.',
        knockedHoursAgo: 48,
      },
      {
        household: 'hh-bay',
        person: 'norma-wilson',
        outcome: 'refused',
        canvasser: 'Jake M.',
        notes: 'Not interested — asked us not to return.',
        knockedHoursAgo: 47,
      },
    ],
  },
  {
    key: 'turf-kitchissippi',
    name: 'Westboro east (Kitchissippi)',
    ward: 'Kitchissippi',
    status: 'active',
    assigned: true,
    households: ['hh-byron', 'hh-kirkwood', 'hh-java', 'hh-armstrong', 'hh-huron'],
    notes: 'Being knocked right now — Saturday afternoon shift.',
    knocks: [
      {
        household: 'hh-byron',
        person: 'heather-macdonald',
        outcome: 'conversation',
        response: 'strong_support',
        canvasser: 'Mai N.',
        notes: 'Sign blew over in the storm — flagged for a replacement.',
        knockedHoursAgo: 3,
      },
      {
        household: 'hh-java',
        person: 'mai-nguyen',
        outcome: 'conversation',
        response: 'strong_support',
        canvasser: 'Julie L.',
        knockedHoursAgo: 2,
      },
      {
        household: 'hh-huron',
        person: 'anna-kowalski',
        outcome: 'conversation',
        response: 'lean_support',
        canvasser: 'Mai N.',
        knockedHoursAgo: 1,
      },
      {
        household: 'hh-armstrong',
        outcome: 'not_home',
        canvasser: 'Julie L.',
        knockedHoursAgo: 2,
      },
    ],
  },
  {
    key: 'turf-capital',
    name: 'The Glebe (Capital)',
    ward: 'Capital',
    status: 'active',
    assigned: true,
    households: ['hh-fifth', 'hh-holmwood', 'hh-sunnyside', 'hh-powell', 'hh-aylmer'],
    notes: 'Assigned to the crew — not started yet.',
    knocks: [],
  },
  {
    key: 'turf-rideau-vanier',
    name: 'Sandy Hill (Rideau-Vanier)',
    ward: 'Rideau-Vanier',
    status: 'active',
    assigned: true,
    households: ['hh-sweetland', 'hh-marlborough', 'hh-blackburn', 'hh-charlotte'],
    notes: 'A first pass went out yesterday — two doors left.',
    knocks: [
      {
        household: 'hh-sweetland',
        person: 'julie-lavoie',
        outcome: 'conversation',
        response: 'strong_support',
        canvasser: 'Julie L.',
        knockedHoursAgo: 26,
      },
      {
        household: 'hh-blackburn',
        person: 'dmitri-petrov',
        outcome: 'conversation',
        response: 'opposed',
        canvasser: 'Jake M.',
        notes: 'Leaning the other way — do not follow up.',
        knockedHoursAgo: 25,
      },
    ],
  },
  {
    key: 'turf-alta-vista',
    name: 'Alta Vista',
    ward: 'Alta Vista',
    status: 'draft',
    assigned: false,
    households: ['hh-kilborn', 'hh-pleasantpark', 'hh-halifax', 'hh-featherston'],
    notes: 'Cut and ready to hand out next weekend.',
    knocks: [],
  },
];

// ── Deliveries (§14) ────────────────────────────────────────────────────────
// Yard-sign requests → driving routes → volunteers. "Routed" is NEVER stored:
// a request is on a route iff it has an active (pending) stop, so a request's
// stored status is 'approved' while it sits on a pending stop and 'delivered'
// once its stop is delivered. The seed spreads requests across every tab (new
// to triage, approved-and-ready to plan, declined) and ships two routes — one
// completed, one in progress — so the routes list and detail open populated.
// Route leg/estimate numbers are computed from the real household coordinates
// at seed time (same geo helpers as the routing engine), never hand-faked.

export interface DemoDeliveryRequestDef {
  key: string;
  household: string;
  person?: string;
  status: 'new' | 'approved' | 'declined' | 'delivered';
  source?: 'web_form' | 'manual';
  notes?: string;
  skipReason?: string;
  /** Days before seed time for created_at (spreads the intake timeline). */
  createdDaysAgo: number;
}

export interface DemoDeliveryStopDef {
  /** Request key — the request this stop serves. */
  request: string;
  status: 'pending' | 'delivered' | 'skipped';
  actedVia?: 'volunteer_link' | 'staff';
  reason?: string;
  /** Hours before seed time the stop was acted on (delivered/skipped only). */
  actedHoursAgo?: number;
}

export interface DemoDeliveryRouteDef {
  key: string;
  name: string;
  status: 'assigned' | 'in_progress' | 'completed';
  /** Volunteer driving it (person key). */
  volunteerPerson?: string;
  startAddress: string;
  startLat: number;
  startLng: number;
  /** Whether a share link is still live (sets share_token_hash). */
  shared?: boolean;
  scheduledInDays?: number;
  /** Ordered stops — seq is assigned by position. */
  stops: DemoDeliveryStopDef[];
}

export const DEMO_DELIVERY_REQUESTS: DemoDeliveryRequestDef[] = [
  // New — waiting to be triaged (populates the New tab + selection bar).
  {
    key: 'dr-maclaren',
    household: 'hh-maclaren',
    person: 'priya-sharma',
    status: 'new',
    source: 'web_form',
    createdDaysAgo: 1,
  },
  {
    key: 'dr-arlington',
    household: 'hh-arlington',
    person: 'devon-clarke',
    status: 'new',
    source: 'web_form',
    createdDaysAgo: 2,
  },
  {
    key: 'dr-sweetland',
    household: 'hh-sweetland',
    person: 'julie-lavoie',
    status: 'new',
    source: 'manual',
    notes: 'Julie asked for a sign for the corner lot — good visibility.',
    createdDaysAgo: 2,
  },
  {
    key: 'dr-charlotte',
    household: 'hh-charlotte',
    person: 'liam-byrne',
    status: 'new',
    source: 'web_form',
    createdDaysAgo: 3,
  },

  // Approved and ready to plan — geocoded, not yet on a route ("N ready").
  {
    key: 'dr-kilborn',
    household: 'hh-kilborn',
    person: 'ayesha-rahman',
    status: 'approved',
    source: 'web_form',
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
    source: 'web_form',
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

  // Declined — not everyone wants a sign.
  {
    key: 'dr-bay',
    household: 'hh-bay',
    person: 'norma-wilson',
    status: 'declined',
    source: 'manual',
    notes: 'Declined at the door — no sign.',
    createdDaysAgo: 8,
  },
  {
    key: 'dr-pleasantpark',
    household: 'hh-pleasantpark',
    person: 'bruce-whitfield',
    status: 'declined',
    source: 'web_form',
    notes: 'Do-not-contact — declined.',
    createdDaysAgo: 9,
  },

  // Delivered on the completed route (status is derived from the delivered stop).
  {
    key: 'dr-byron',
    household: 'hh-byron',
    person: 'heather-macdonald',
    status: 'delivered',
    source: 'web_form',
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
    source: 'web_form',
    createdDaysAgo: 7,
  },

  // The in-progress route: one delivered, two still pending (approved + routed).
  {
    key: 'dr-fifth',
    household: 'hh-fifth',
    person: 'nadia-haddad',
    status: 'delivered',
    source: 'web_form',
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
    source: 'web_form',
    createdDaysAgo: 4,
  },
];

export const DEMO_DELIVERY_ROUTES: DemoDeliveryRouteDef[] = [
  {
    key: 'route-westboro',
    name: 'Westboro run',
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
    name: 'Glebe & Old Ottawa South run',
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

// ── Fundraising / Donations (spec §12) ──────────────────────────────────────
// The two donation "giving page" web_forms (One-time / Recurring donation) are
// created by seedStarterForms and SURVIVE exit-demo — they are the fundraising
// forms, and they live on the Donations page, not the Forms page (donation
// types are filtered out of Forms by design). What was missing is a populated
// ledger, so the Donations page reads as a real operation instead of zeros.
// These recorded gifts + monthly pledges ARE demo data and are removed on exit.
//
// Amounts are in CENTS (matching donations.amount / donation_pledges.monthly_amount).
// Only status 'succeeded' gifts and 'active' pledges count toward the page stats,
// so every seeded row uses those. created_at is spread across this month and last
// month so the month-over-month tile has a real delta.

export interface DemoPledgeDef {
  key: string;
  /** Person key — the monthly donor (also snapshotted onto the row). */
  person: string;
  monthlyAmountCents: number;
  startedDaysAgo: number;
  /** Days from now the next charge is due. */
  nextBillingInDays: number;
}

export interface DemoDonationDef {
  /** Person key — the donor (name/email are snapshotted from the person). */
  person: string;
  amountCents: number;
  method: 'card' | 'check' | 'cash' | 'bank_transfer';
  createdDaysAgo: number;
  receiptSent?: boolean;
  /** Pledge key — set when this gift is a monthly recurring charge. */
  pledge?: string;
}

export const DEMO_PLEDGES: DemoPledgeDef[] = [
  { key: 'pledge-mai', person: 'mai-nguyen', monthlyAmountCents: 2000, startedDaysAgo: 95, nextBillingInDays: 12 },
  { key: 'pledge-jessica', person: 'jessica-lam', monthlyAmountCents: 2500, startedDaysAgo: 70, nextBillingInDays: 6 },
  { key: 'pledge-theo', person: 'theo-lavoie', monthlyAmountCents: 1000, startedDaysAgo: 40, nextBillingInDays: 19 },
];

export const DEMO_DONATIONS: DemoDonationDef[] = [
  // This month.
  { person: 'marc-tremblay', amountCents: 10000, method: 'card', createdDaysAgo: 3 },
  { person: 'priya-sharma', amountCents: 5000, method: 'card', createdDaysAgo: 5 },
  { person: 'harpreet-singh', amountCents: 7500, method: 'card', createdDaysAgo: 6 },
  { person: 'michelle-thibault', amountCents: 20000, method: 'card', createdDaysAgo: 8 },
  { person: 'nadia-haddad', amountCents: 6000, method: 'card', createdDaysAgo: 9 },
  { person: 'devon-clarke', amountCents: 12000, method: 'check', createdDaysAgo: 10 },
  { person: 'ayesha-rahman', amountCents: 3000, method: 'card', createdDaysAgo: 12 },
  // Recurring charges from active pledges (linked via pledge_id).
  { person: 'mai-nguyen', amountCents: 2000, method: 'card', createdDaysAgo: 7, pledge: 'pledge-mai' },
  { person: 'jessica-lam', amountCents: 2500, method: 'card', createdDaysAgo: 4, pledge: 'pledge-jessica' },
  // Last month (drives the month-over-month comparison).
  { person: 'heather-macdonald', amountCents: 25000, method: 'card', createdDaysAgo: 34 },
  { person: 'grace-okafor', amountCents: 50000, method: 'check', createdDaysAgo: 37 },
  { person: 'julie-lavoie', amountCents: 15000, method: 'card', createdDaysAgo: 40 },
  { person: 'jake-morrison', amountCents: 4000, method: 'cash', createdDaysAgo: 42 },
  { person: 'fatima-elsayed', amountCents: 4500, method: 'card', createdDaysAgo: 45 },
  { person: 'mai-nguyen', amountCents: 2000, method: 'card', createdDaysAgo: 37, pledge: 'pledge-mai' },
];
