import type {
  DemoCompanyDef,
  DemoDataset,
  DemoEmailDef,
  DemoIssueAssignmentDef,
  DemoListDef,
  DemoNewsletterDef,
  DemoPersonDef,
  DemoReceiptDef,
  DemoStatementRunDef,
  DemoSubmissionDef,
  DemoTaskDef,
  DemoTeamDef,
  DemoUserDef,
  DemoVolunteerEventDef,
  DemoDonationDef,
  DemoPledgeDef,
} from './demo-data-types';
import { CANADA_PLACE_PACK, storyHouseholds } from './demo-data-places';

/**
 * The demo workspace for NON-PROFIT mode: the Rideau Community Table, a fictional Ottawa charity
 * running a food program, a newcomer settlement desk and a volunteer crew.
 *
 * What makes it a non-profit dataset rather than the campaign one with the words swapped:
 * - Nobody has a support level or a voting status. A charity does not canvass for votes, and
 *   `campaign_person_facts` stays empty rather than being filled with a concept it cannot use.
 * - No turfs and no delivery routes — non-profit mode hides both modules by default
 *   (ORG_MODE_MODULE_DEFAULTS), and seeding data behind a hidden page is worse than seeding none.
 * - The story is programs and gifts: who is on a waitlist, who volunteers Thursdays, which grant
 *   report is due, and a giving ledger with monthly donors in it.
 *
 * Vocabulary is constrained to what non-profit signup actually seeds: SHARED_STARTER_TAGS plus
 * MODE_EXTRA_TAGS.nonprofit ('major donor', 'program participant'), MODE_ISSUES.nonprofit, and the
 * starter forms including 'get-help'. `demo-datasets.spec.ts` enforces every one of those.
 */

const COMPANIES: DemoCompanyDef[] = [
  {
    key: 'co-riverside-grocers',
    name: 'Riverside Grocers',
    description: 'Independent grocer — donates surplus produce every Tuesday and Friday.',
    website: 'https://riverside-grocers.example.com',
    email: 'hello@riverside-grocers.example.com',
    phone: '613-555-0310',
    industry: 'Grocery',
  },
  {
    key: 'co-bytown-credit',
    name: 'Bytown Credit Union',
    description: 'Community credit union — matches staff giving and sponsors the winter drive.',
    website: 'https://bytown-credit.example.com',
    email: 'community@bytown-credit.example.com',
    phone: '613-555-0311',
    industry: 'Financial services',
  },
  {
    key: 'co-carleton-health',
    name: 'Carleton Community Health Centre',
    description: 'Referral partner — sends clients to the food program and the settlement desk.',
    website: 'https://carleton-health.example.org',
    email: 'referrals@carleton-health.example.org',
    phone: '613-555-0312',
    industry: 'Healthcare',
  },
  {
    key: 'co-elgin-law',
    name: 'Elgin Street Legal',
    description: 'Small firm — pro bono immigration clinic one evening a month.',
    website: 'https://elgin-legal.example.com',
    email: 'reception@elgin-legal.example.com',
    phone: '613-555-0313',
    industry: 'Legal',
  },
  {
    key: 'co-glebe-print',
    name: 'Glebe Print Co-op',
    description: 'Prints the annual report and the food-program flyers at cost.',
    website: 'https://glebe-print.example.com',
    email: 'orders@glebe-print.example.com',
    phone: '613-555-0314',
    industry: 'Printing',
  },
  {
    key: 'co-westboro-school',
    name: 'Westboro Secondary School',
    description: 'Student volunteers earn community-service hours on the Saturday sort.',
    website: 'https://westboro-secondary.example.org',
    email: 'office@westboro-secondary.example.org',
    phone: '613-555-0315',
    industry: 'Education',
  },
];

const HOUSEHOLDS = storyHouseholds({
  'hh-gladstone': { notes: 'Buzzer broken — call from the lobby.' },
  'hh-kilborn-import': { notes: 'Came in on the March intake spreadsheet.' },
  'hh-powell': { notes: 'Hamper drop-off goes to the side door.' },
});

const PERSONS: DemoPersonDef[] = [
  // ── The board and the long-standing supporters ────────────────────────────
  {
    key: 'ruth-abbott',
    first_name: 'Ruth',
    last_name: 'Abbott',
    household: 'hh-cooper',
    email: 'ruth.abbott@example.com',
    mobile: '613-555-0101',
    notes: 'Board chair. Founded the food program out of her garage in 2009.',
    createdDaysAgo: 340,
    tags: ['community leader'],
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'desmond-abbott',
    first_name: 'Desmond',
    last_name: 'Abbott',
    household: 'hh-cooper',
    email: 'des.abbott@example.com',
    createdDaysAgo: 340,
    subscribed: true,
  },
  {
    key: 'margaret-shore',
    first_name: 'Margaret',
    last_name: 'Shore',
    household: 'hh-maclaren',
    email: 'm.shore@example.com',
    mobile: '613-555-0102',
    notes: 'Gives every December without being asked. Prefers a phone call to an email.',
    createdDaysAgo: 320,
    tags: ['major donor', 'senior'],
    subscribed: true,
  },
  {
    key: 'alan-shore',
    first_name: 'Alan',
    last_name: 'Shore',
    household: 'hh-maclaren',
    email: 'alan.shore@example.com',
    createdDaysAgo: 320,
    tags: ['senior'],
    subscribed: true,
  },
  {
    key: 'priya-raman',
    first_name: 'Priya',
    last_name: 'Raman',
    household: 'hh-frank',
    company: 'co-bytown-credit',
    email: 'priya.raman@example.com',
    mobile: '613-555-0103',
    notes: 'Runs the credit union’s community fund — the match cheque comes through her.',
    createdDaysAgo: 295,
    tags: ['major donor', 'community leader'],
    subscribed: true,
  },
  {
    key: 'tom-farrell',
    first_name: 'Tom',
    last_name: 'Farrell',
    household: 'hh-arlington',
    company: 'co-riverside-grocers',
    email: 'tom@riverside-grocers.example.com',
    mobile: '613-555-0104',
    notes: 'Owns Riverside Grocers. Calls Tuesday mornings when there is surplus produce to collect.',
    createdDaysAgo: 280,
    tags: ['small business owner'],
    subscribed: true,
  },

  // ── Volunteers ────────────────────────────────────────────────────────────
  {
    key: 'jess-lam',
    first_name: 'Jess',
    last_name: 'Lam',
    household: 'hh-gladstone',
    email: 'jess.lam@example.com',
    mobile: '613-555-0105',
    notes: 'Thursday hamper packing, every week since February. Will drive if asked.',
    createdDaysAgo: 240,
    tags: ['program participant'],
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'ben-osei',
    first_name: 'Ben',
    last_name: 'Osei',
    household: 'hh-bay',
    email: 'ben.osei@example.com',
    mobile: '613-555-0106',
    notes: 'Has a van. The obvious first call for a pickup.',
    createdDaysAgo: 232,
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'sara-okonkwo',
    first_name: 'Sara',
    last_name: 'Okonkwo',
    household: 'hh-byron',
    email: 'sara.okonkwo@example.com',
    mobile: '613-555-0107',
    notes: 'Speaks Twi and French — interprets at the settlement desk.',
    createdDaysAgo: 228,
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'marco-bianchi',
    first_name: 'Marco',
    last_name: 'Bianchi',
    household: 'hh-kirkwood',
    email: 'marco.bianchi@example.com',
    createdDaysAgo: 215,
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'holly-tran',
    first_name: 'Holly',
    last_name: 'Tran',
    household: 'hh-java',
    company: 'co-westboro-school',
    email: 'holly.tran@example.com',
    notes: 'Grade 12 — needs 40 community-service hours by June.',
    createdDaysAgo: 96,
    tags: ['student'],
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'nathan-cole',
    first_name: 'Nathan',
    last_name: 'Cole',
    household: 'hh-java',
    company: 'co-westboro-school',
    email: 'nathan.cole@example.com',
    createdDaysAgo: 94,
    tags: ['student'],
    volunteerStatus: 'prospective',
  },
  {
    key: 'gail-mcintyre',
    first_name: 'Gail',
    last_name: 'McIntyre',
    household: 'hh-armstrong',
    email: 'gail.mcintyre@example.com',
    mobile: '613-555-0108',
    notes: 'Retired teacher. Runs the Saturday sort and keeps the volunteer sign-in sheet.',
    createdDaysAgo: 260,
    tags: ['senior', 'community leader'],
    subscribed: true,
    volunteerStatus: 'active',
  },

  // ── Program participants ──────────────────────────────────────────────────
  {
    key: 'amina-yusuf',
    first_name: 'Amina',
    last_name: 'Yusuf',
    household: 'hh-huron',
    email: 'amina.yusuf@example.com',
    mobile: '613-555-0109',
    notes: 'Settlement desk — arrived in January, working through credential recognition.',
    createdDaysAgo: 168,
    tags: ['program participant'],
    subscribed: true,
  },
  {
    key: 'hassan-yusuf',
    first_name: 'Hassan',
    last_name: 'Yusuf',
    household: 'hh-huron',
    email: 'hassan.yusuf@example.com',
    createdDaysAgo: 168,
    tags: ['program participant'],
  },
  {
    key: 'leila-yusuf',
    first_name: 'Leila',
    last_name: 'Yusuf',
    household: 'hh-huron',
    createdDaysAgo: 168,
    notes: 'Age 9 — in the after-school reading group.',
  },
  {
    key: 'dorothy-price',
    first_name: 'Dorothy',
    last_name: 'Price',
    household: 'hh-fifth',
    email: 'dorothy.price@example.com',
    notes: 'Weekly hamper, delivered. Lives alone; the Thursday call matters as much as the food.',
    createdDaysAgo: 210,
    tags: ['senior', 'program participant'],
  },
  {
    key: 'victor-price',
    first_name: 'Victor',
    last_name: 'Price',
    household: 'hh-fifth',
    createdDaysAgo: 210,
    tags: ['senior'],
  },
  {
    key: 'fatima-khoury',
    first_name: 'Fatima',
    last_name: 'Khoury',
    household: 'hh-holmwood',
    email: 'f.khoury@example.com',
    mobile: '613-555-0110',
    createdDaysAgo: 152,
    tags: ['program participant'],
    subscribed: true,
  },
  {
    key: 'samir-khoury',
    first_name: 'Samir',
    last_name: 'Khoury',
    household: 'hh-holmwood',
    email: 'samir.khoury@example.com',
    createdDaysAgo: 152,
    subscribed: true,
  },
  {
    key: 'joyce-nakamura',
    first_name: 'Joyce',
    last_name: 'Nakamura',
    household: 'hh-sunnyside',
    email: 'joyce.n@example.com',
    createdDaysAgo: 190,
    tags: ['senior', 'program participant'],
    subscribed: true,
  },
  {
    key: 'raymond-dubois',
    first_name: 'Raymond',
    last_name: 'Dubois',
    household: 'hh-powell',
    email: 'r.dubois@example.com',
    mobile: '613-555-0111',
    notes: 'Hamper goes to the side door — mobility.',
    createdDaysAgo: 175,
    tags: ['program participant'],
  },

  // ── Donors ────────────────────────────────────────────────────────────────
  {
    key: 'eleanor-vance',
    first_name: 'Eleanor',
    last_name: 'Vance',
    household: 'hh-aylmer',
    email: 'eleanor.vance@example.com',
    mobile: '613-555-0112',
    notes: 'Monthly donor since the first winter drive. Asks for the annual report in print.',
    createdDaysAgo: 300,
    tags: ['major donor', 'senior'],
    subscribed: true,
  },
  {
    key: 'colin-vance',
    first_name: 'Colin',
    last_name: 'Vance',
    household: 'hh-aylmer',
    email: 'colin.vance@example.com',
    createdDaysAgo: 300,
    subscribed: true,
  },
  {
    key: 'wei-zhang',
    first_name: 'Wei',
    last_name: 'Zhang',
    household: 'hh-sweetland',
    company: 'co-elgin-law',
    email: 'wei.zhang@example.com',
    mobile: '613-555-0113',
    notes: 'Runs the monthly pro bono immigration clinic.',
    createdDaysAgo: 205,
    tags: ['community leader'],
    subscribed: true,
    volunteerStatus: 'active',
  },
  {
    key: 'olivia-brant',
    first_name: 'Olivia',
    last_name: 'Brant',
    household: 'hh-marlborough',
    email: 'olivia.brant@example.com',
    createdDaysAgo: 140,
    subscribed: true,
  },
  {
    key: 'daniel-brant',
    first_name: 'Daniel',
    last_name: 'Brant',
    household: 'hh-marlborough',
    email: 'daniel.brant@example.com',
    mobile: '613-555-0114',
    createdDaysAgo: 140,
    subscribed: true,
  },
  {
    key: 'nadia-petrov',
    first_name: 'Nadia',
    last_name: 'Petrov',
    household: 'hh-blackburn',
    email: 'nadia.petrov@example.com',
    createdDaysAgo: 128,
    subscribed: true,
  },
  {
    key: 'simon-adeyemi',
    first_name: 'Simon',
    last_name: 'Adeyemi',
    household: 'hh-charlotte',
    company: 'co-glebe-print',
    email: 'simon@glebe-print.example.com',
    mobile: '613-555-0115',
    notes: 'Prints the annual report at cost. Invoice always arrives late — that is fine.',
    createdDaysAgo: 118,
    tags: ['small business owner'],
    subscribed: true,
  },
  {
    key: 'helen-carr',
    first_name: 'Helen',
    last_name: 'Carr',
    household: 'hh-kilborn',
    email: 'helen.carr@example.com',
    createdDaysAgo: 105,
    tags: ['letter writer'],
    subscribed: true,
  },
  {
    key: 'ian-carr',
    first_name: 'Ian',
    last_name: 'Carr',
    household: 'hh-kilborn',
    createdDaysAgo: 105,
  },
  {
    key: 'rosa-delgado',
    first_name: 'Rosa',
    last_name: 'Delgado',
    household: 'hh-pleasantpark',
    company: 'co-carleton-health',
    email: 'rosa.delgado@example.org',
    mobile: '613-555-0116',
    notes: 'Sends most of our food-program referrals. Worth a thank-you at the AGM.',
    createdDaysAgo: 98,
    tags: ['community leader'],
    subscribed: true,
  },
  {
    key: 'grace-mbeki',
    first_name: 'Grace',
    last_name: 'Mbeki',
    household: 'hh-halifax',
    email: 'grace.mbeki@example.com',
    createdDaysAgo: 74,
    tags: ['faith community'],
    subscribed: true,
  },
  {
    key: 'peter-mbeki',
    first_name: 'Peter',
    last_name: 'Mbeki',
    household: 'hh-halifax',
    email: 'peter.mbeki@example.com',
    createdDaysAgo: 74,
    tags: ['faith community'],
    subscribed: true,
  },
  {
    key: 'yuki-sato',
    first_name: 'Yuki',
    last_name: 'Sato',
    household: 'hh-featherston',
    email: 'yuki.sato@example.com',
    createdDaysAgo: 58,
    subscribed: true,
  },
  {
    key: 'oren-mizrahi',
    first_name: 'Oren',
    last_name: 'Mizrahi',
    household: 'hh-kilborn-import',
    email: 'oren.mizrahi@example.com',
    createdDaysAgo: 44,
    subscribed: true,
  },
  {
    key: 'claudia-reyes',
    first_name: 'Claudia',
    last_name: 'Reyes',
    email: 'claudia.reyes@example.com',
    mobile: '613-555-0117',
    notes: 'Signed up on the website — no address yet.',
    createdDaysAgo: 21,
    subscribed: true,
    volunteerStatus: 'prospective',
  },
  {
    key: 'martin-leblanc',
    first_name: 'Martin',
    last_name: 'Leblanc',
    email: 'martin.leblanc@example.com',
    createdDaysAgo: 12,
    subscribed: true,
  },
  {
    key: 'anne-fournier',
    first_name: 'Anne',
    last_name: 'Fournier',
    email: 'anne.fournier@example.com',
    notes: 'Asked to be removed from all mail after the spring appeal.',
    createdDaysAgo: 9,
    doNotContact: true,
  },
];

const USERS: DemoUserDef[] = [
  { key: 'u-programs', first_name: 'Dana', last_name: 'Whitfield', emailLocal: 'dana', role: 'admin' },
  { key: 'u-volunteers', first_name: 'Curtis', last_name: 'Ntale', emailLocal: 'curtis', role: 'user' },
  { key: 'u-giving', first_name: 'Bea', last_name: 'Solomon', emailLocal: 'bea', role: 'user' },
];

const TASKS: DemoTaskDef[] = [
  {
    name: 'Send the Q2 grant report to the Community Foundation',
    details: 'Numbers are in the giving ledger; Dana has the narrative half drafted. Due before the 30th.',
    status: 'in_progress',
    priority: 'urgent',
    position: 1,
    dueInDays: 4,
    assignToOwner: true,
  },
  {
    name: 'Confirm Tuesday produce pickup with Riverside Grocers',
    details: 'Tom calls when there is surplus. Ben has the van — check he is free.',
    status: 'todo',
    priority: 'high',
    position: 2,
    dueInDays: 2,
    assignToUser: 'u-volunteers',
  },
  {
    name: 'Call Margaret Shore about the December gift',
    details: 'She gives every year without being asked. Prefers a phone call — do not send the appeal letter.',
    status: 'todo',
    priority: 'medium',
    position: 3,
    dueInDays: 9,
    assignToUser: 'u-giving',
  },
  {
    name: 'Follow up on the Yusuf family credential paperwork',
    details: 'Amina is waiting on the assessment body. Wei offered to look at the file at the next clinic.',
    status: 'waiting',
    priority: 'high',
    position: 4,
    dueInDays: 6,
    assignToUser: 'u-programs',
  },
  {
    name: 'Sign Holly Tran’s community-service hours form',
    details: 'She needs 40 by June and is at 26. School office wants it on their letterhead.',
    status: 'todo',
    priority: 'low',
    position: 5,
    dueInDays: 14,
    assignToUser: 'u-volunteers',
  },
  {
    name: 'Book the church hall for the winter drive',
    details: 'Second Saturday in November. Last year we outgrew the basement.',
    status: 'todo',
    priority: 'medium',
    position: 6,
    dueInDays: 21,
    assignToOwner: true,
  },
  {
    name: 'Thank the Bytown Credit Union match donors',
    details: 'Priya sent the list of staff who gave. Handwritten cards, not email.',
    status: 'todo',
    priority: 'medium',
    position: 7,
    dueInDays: 11,
    assignToUser: 'u-giving',
  },
  {
    name: 'Update the hamper waitlist after Thursday',
    details: 'Four new referrals from Carleton Health. Check capacity before saying yes.',
    status: 'todo',
    priority: 'high',
    position: 8,
    dueInDays: 3,
    assignToUser: 'u-programs',
  },
  {
    name: 'Send spring appeal to the newsletter list',
    details: 'Draft is written and waiting in Newsletters.',
    status: 'done',
    priority: 'medium',
    position: 9,
    completedDaysAgo: 8,
    assignToOwner: true,
  },
  {
    name: 'Renew the food-handling certificates',
    details: 'Gail, Jess and Ben all expired this spring. City runs the course monthly.',
    status: 'done',
    priority: 'high',
    position: 10,
    completedDaysAgo: 19,
    assignToUser: 'u-volunteers',
  },
  {
    name: 'Get a mailing address for Claudia Reyes',
    details:
      'She gave $150 through the website and left the address blank. A CRA receipt has to print the ' +
      'donor’s address, so hers is the one gift this week we cannot receipt. Call before Friday.',
    status: 'todo',
    priority: 'high',
    position: 11,
    dueInDays: 2,
    assignToUser: 'u-giving',
  },
];

const LISTS: DemoListDef[] = [
  {
    key: 'list-volunteers',
    name: 'Active volunteers',
    description: 'The crew who show up — Thursday packing, the Saturday sort, and the clinic.',
    members: ['jess-lam', 'ben-osei', 'sara-okonkwo', 'marco-bianchi', 'holly-tran', 'gail-mcintyre', 'wei-zhang'],
  },
  {
    key: 'list-major-donors',
    name: 'Major donors',
    description: 'Gives at a level worth a personal thank-you and a phone call, not a form letter.',
    members: ['margaret-shore', 'priya-raman', 'eleanor-vance'],
  },
  {
    key: 'list-hampers',
    name: 'Weekly hamper households',
    description: 'Households on the standing Thursday delivery, plus the two on the waitlist.',
    members: ['dorothy-price', 'raymond-dubois', 'joyce-nakamura', 'fatima-khoury', 'amina-yusuf'],
  },
  {
    key: 'list-subscribers',
    name: 'Newsletter subscribers',
    description: 'Everyone who has opted in to the email newsletter.',
    members: [
      'ruth-abbott',
      'desmond-abbott',
      'margaret-shore',
      'alan-shore',
      'priya-raman',
      'tom-farrell',
      'jess-lam',
      'ben-osei',
      'sara-okonkwo',
      'marco-bianchi',
      'holly-tran',
      'gail-mcintyre',
      'amina-yusuf',
      'fatima-khoury',
      'samir-khoury',
      'joyce-nakamura',
      'eleanor-vance',
      'colin-vance',
      'wei-zhang',
      'olivia-brant',
      'daniel-brant',
      'nadia-petrov',
      'simon-adeyemi',
      'helen-carr',
      'rosa-delgado',
      'grace-mbeki',
      'peter-mbeki',
      'yuki-sato',
      'oren-mizrahi',
      'claudia-reyes',
      'martin-leblanc',
    ],
  },
];

const TEAM: DemoTeamDef = {
  name: 'Thursday crew',
  description: 'The regulars who pack and deliver hampers every Thursday afternoon.',
  members: ['jess-lam', 'ben-osei', 'gail-mcintyre'],
};

const VOLUNTEER_EVENTS: DemoVolunteerEventDef[] = [
  {
    key: 'ev-winter-drive',
    name: 'Winter food drive — sorting day',
    description:
      'Everything collected over the two-week drive gets sorted, dated and shelved. Bring a friend; the more hands the shorter the day. Coffee and lunch provided.',
    venue: 'hq',
    slug: 'winter-drive-sorting-day',
    startInDays: 16,
    durationHours: 4,
    capacity: 30,
    shifts: [
      { person: 'jess-lam', status: 'signed_up' },
      { person: 'ben-osei', status: 'signed_up' },
      { person: 'gail-mcintyre', status: 'signed_up' },
      { person: 'holly-tran', status: 'signed_up' },
      { person: 'marco-bianchi', status: 'signed_up' },
    ],
  },
  {
    key: 'ev-clinic',
    name: 'Pro bono immigration clinic',
    description:
      'Monthly evening clinic with Elgin Street Legal. Interpreters needed for Arabic, Twi and Spanish — say so when you sign up.',
    venue: 'annex',
    slug: 'immigration-clinic',
    startInDays: -12,
    durationHours: 3,
    capacity: 12,
    shifts: [
      { person: 'wei-zhang', status: 'attended' },
      { person: 'sara-okonkwo', status: 'attended' },
      { person: 'amina-yusuf', status: 'attended' },
    ],
  },
];

const APPEAL_LINKS = {
  give: 'https://example.org/give',
  volunteer: 'https://example.org/volunteer',
  report: 'https://example.org/annual-report',
};

const NEWSLETTERS: DemoNewsletterDef[] = [
  {
    key: 'nl-spring-appeal',
    name: 'Spring appeal',
    status: 'sent',
    subject: '1,840 hampers later — and what comes next',
    preview_text: 'What your giving did this winter, and the one thing we need for spring.',
    audience_description: 'Newsletter subscribers',
    sentDaysAgo: 8,
    links: [APPEAL_LINKS.give, APPEAL_LINKS.volunteer, APPEAL_LINKS.report],
    html_content:
      '<h1>1,840 hampers later</h1>' +
      '<p>Between November and March this community packed and delivered 1,840 hampers. Not a number we planned for — ' +
      'the referrals kept coming and you kept showing up.</p>' +
      '<p>The whole year is in the <a href="https://example.org/annual-report">annual report</a>, including where every ' +
      'dollar went. The short version: 87 cents of each dollar reached a household directly.</p>' +
      '<p>Spring is quieter for donations and busier for need. If you can give monthly, even $10, it is the thing that ' +
      'lets us say yes in June — <a href="https://example.org/give">set it up here</a>. If you would rather give a ' +
      'Thursday afternoon, <a href="https://example.org/volunteer">we will take that too</a>.</p>',
    plain_text_content:
      '1,840 hampers between November and March. The annual report is at https://example.org/annual-report — ' +
      '87 cents of each dollar reached a household directly. Give monthly: https://example.org/give — ' +
      'Volunteer: https://example.org/volunteer',
    recipients: [
      'ruth-abbott',
      'desmond-abbott',
      'margaret-shore',
      'alan-shore',
      'priya-raman',
      'tom-farrell',
      'jess-lam',
      'ben-osei',
      'sara-okonkwo',
      'marco-bianchi',
      'holly-tran',
      'gail-mcintyre',
      'amina-yusuf',
      'fatima-khoury',
      'samir-khoury',
      'joyce-nakamura',
      'eleanor-vance',
      'colin-vance',
      'wei-zhang',
      'olivia-brant',
      'daniel-brant',
      'nadia-petrov',
      'simon-adeyemi',
      'helen-carr',
      'rosa-delgado',
      'grace-mbeki',
      'peter-mbeki',
      'yuki-sato',
    ],
    engagement: [
      { person: 'ruth-abbott', opens: 4, clicks: [APPEAL_LINKS.report, APPEAL_LINKS.give] },
      { person: 'margaret-shore', opens: 3, clicks: [APPEAL_LINKS.give] },
      { person: 'priya-raman', opens: 2, clicks: [APPEAL_LINKS.report] },
      { person: 'eleanor-vance', opens: 3, clicks: [APPEAL_LINKS.give] },
      { person: 'tom-farrell', opens: 1 },
      { person: 'jess-lam', opens: 2, clicks: [APPEAL_LINKS.volunteer] },
      { person: 'ben-osei', opens: 1 },
      { person: 'gail-mcintyre', opens: 2, clicks: [APPEAL_LINKS.volunteer] },
      { person: 'sara-okonkwo', opens: 1 },
      { person: 'holly-tran', opens: 1, clicks: [APPEAL_LINKS.volunteer] },
      { person: 'wei-zhang', opens: 2 },
      { person: 'olivia-brant', opens: 1, clicks: [APPEAL_LINKS.give] },
      { person: 'daniel-brant', opens: 1 },
      { person: 'rosa-delgado', opens: 2, clicks: [APPEAL_LINKS.report] },
      { person: 'grace-mbeki', opens: 1 },
      { person: 'simon-adeyemi', opens: 1 },
      { person: 'joyce-nakamura', opens: 1 },
      { person: 'nadia-petrov', opens: 0, unsubscribed: true },
      { person: 'yuki-sato', opens: 0, bounce: 'soft' },
      { person: 'alan-shore', opens: 1 },
      { person: 'colin-vance', opens: 1 },
      { person: 'helen-carr', opens: 2 },
    ],
  },
  {
    key: 'nl-winter-drive',
    name: 'Winter drive — save the date',
    status: 'draft',
    subject: 'Two Saturdays in November',
    preview_text: 'The drive is back, and the sorting day needs thirty pairs of hands.',
    audience_description: 'Newsletter subscribers',
    links: [APPEAL_LINKS.volunteer],
    html_content:
      '<h1>The winter drive is back</h1>' +
      '<p>Collection runs the first two weeks of November, and everything lands in one room on the second Saturday. ' +
      'That day is the whole drive: thirty people, four hours, a year of shelving.</p>' +
      '<p><a href="https://example.org/volunteer">Claim a shift</a> — no experience needed, and the students among you ' +
      'get a signed hours form on the way out.</p>',
    plain_text_content:
      'The winter drive runs the first two weeks of November; sorting day is the second Saturday. ' +
      'Claim a shift: https://example.org/volunteer',
  },
];

const SUBMISSIONS: DemoSubmissionDef[] = [
  {
    formSlug: 'newsletter-sign-up',
    person: 'claudia-reyes',
    daysAgo: 21,
    answers: { first_name: 'Claudia', last_name: 'Reyes', email: 'claudia.reyes@example.com' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'martin-leblanc',
    daysAgo: 12,
    answers: { first_name: 'Martin', last_name: 'Leblanc', email: 'martin.leblanc@example.com' },
  },
  {
    formSlug: 'newsletter-sign-up',
    person: 'oren-mizrahi',
    daysAgo: 44,
    answers: { first_name: 'Oren', last_name: 'Mizrahi', email: 'oren.mizrahi@example.com' },
  },
  {
    formSlug: 'get-help',
    person: 'raymond-dubois',
    daysAgo: 30,
    answers: {
      first_name: 'Raymond',
      last_name: 'Dubois',
      email: 'r.dubois@example.com',
      message: 'I am asking about the weekly hamper. I have trouble with stairs — is a drop-off possible?',
    },
  },
  {
    formSlug: 'get-help',
    person: 'fatima-khoury',
    daysAgo: 47,
    answers: {
      first_name: 'Fatima',
      last_name: 'Khoury',
      email: 'f.khoury@example.com',
      message: 'We were referred by the health centre. Two adults and two children at home.',
    },
  },
  {
    formSlug: 'get-help',
    person: 'amina-yusuf',
    daysAgo: 61,
    answers: {
      first_name: 'Amina',
      last_name: 'Yusuf',
      email: 'amina.yusuf@example.com',
      message: 'Looking for help understanding a credential assessment letter. Arabic or English both fine.',
    },
  },
];

const ISSUE_ASSIGNMENTS: DemoIssueAssignmentDef[] = [
  { issue: 'food security', people: ['ruth-abbott', 'gail-mcintyre', 'tom-farrell', 'rosa-delgado', 'jess-lam'] },
  { issue: 'housing affordability', people: ['amina-yusuf', 'fatima-khoury', 'wei-zhang'] },
  { issue: 'youth programs', people: ['holly-tran', 'nathan-cole', 'grace-mbeki'] },
  { issue: 'climate action', people: ['olivia-brant', 'simon-adeyemi'] },
];

// Charity mail: referrals, donors, volunteers and suppliers. The ownership and completeness mix
// every dataset holds to is described once on `DemoEmailDef` (demo-data-types.ts) — read that
// before adding or moving a message here.
const EMAILS: DemoEmailDef[] = [
  {
    folder: 'inbox',
    person: 'rosa-delgado',
    subject: 'Four referrals for the hamper program',
    preview_text: 'Sending these over before the Thursday cut-off —',
    status: 'open',
    assignTo: 'u-programs',
    daysAgo: 1,
    is_favourite: true,
    attachments: ['hamper-referrals'],
    body_html:
      '<p>Hi,</p><p>Sending these over before the Thursday cut-off — four households, all seen at the centre this ' +
      'week. Two are single seniors, one is a family of five, one is a young couple with a newborn.</p>' +
      '<p>I know you are close to capacity. If you can only take two this week, take the seniors — the others have ' +
      'some runway.</p><p>Rosa</p>',
  },
  {
    folder: 'inbox',
    person: 'tom-farrell',
    subject: 'Surplus produce Tuesday — a lot of it',
    preview_text: 'We over-ordered on squash and the case lot is going to turn —',
    status: 'open',
    assignTo: 'u-volunteers',
    daysAgo: 2,
    attachments: ['surplus-pallet'],
    body_html:
      '<p>We over-ordered on squash and the case lot is going to turn by the weekend. About 200 lbs if you want it — ' +
      'photo of the pallet attached.</p>' +
      '<p>Can someone come Tuesday before 10? After that it goes in the compactor and I hate that.</p><p>Tom</p>',
  },
  {
    folder: 'inbox',
    person: 'margaret-shore',
    subject: 'This year’s gift',
    preview_text: 'Alan and I would like to do the same as last December —',
    status: 'open',
    assignTo: 'owner',
    daysAgo: 3,
    body_html:
      '<p>Alan and I would like to do the same as last December, and a little more if the winter drive needs it.</p>' +
      '<p>Please do call rather than email — I miss things in here. The number you have is right.</p>' +
      '<p>Warmly,<br />Margaret</p>',
  },
  {
    folder: 'inbox',
    person: 'holly-tran',
    subject: 'Community service hours form',
    preview_text: 'My school needs this signed on your letterhead —',
    status: 'closed',
    assignTo: 'u-volunteers',
    daysAgo: 6,
    attachments: ['service-hours-form'],
    body_html:
      '<p>My school needs this signed on your letterhead by the end of the month — scan attached. I think I am at ' +
      '26 hours but you have the sign-in sheet.</p>' +
      '<p>Thanks for letting me help with the sort — I like the Saturdays.</p><p>Holly</p>',
  },
  {
    folder: 'sent',
    person: 'amina-yusuf',
    subject: 'Re: credential assessment letter',
    preview_text: 'Wei can look at this at the clinic on the 14th —',
    status: 'closed',
    assignTo: 'u-programs',
    daysAgo: 9,
    body_html:
      '<p>Hi Amina,</p><p>Wei can look at this at the clinic on the 14th, 6pm at the Somerset office. Bring the letter ' +
      'and anything the assessment body has sent you.</p><p>Sara will be there and can interpret if you would ' +
      'prefer.</p><p>Dana</p>',
  },
  {
    folder: 'sent',
    person: 'priya-raman',
    subject: 'Match cheque — thank you',
    preview_text: 'The match came through this morning —',
    status: 'closed',
    assignTo: 'u-giving',
    daysAgo: 14,
    body_html:
      '<p>Priya,</p><p>The match came through this morning. That is the winter drive fully funded before it starts, ' +
      'which has never once happened.</p><p>Send me the list of staff who gave and we will write to each of them.</p>' +
      '<p>Bea</p>',
  },

  // Not yet triaged. The van note is intentionally more than a week old — it is the one nobody
  // owns, and the list shows it as an overdue first response.
  {
    folder: 'inbox',
    person: 'claudia-reyes',
    subject: 'Signed up online — what do you actually need?',
    preview_text: 'I put my name in on the website and then heard nothing, which is fine —',
    status: 'open',
    daysAgo: 0,
    body_html:
      '<p>Hello,</p><p>I put my name in on the website a while ago and then heard nothing, which is fine — I know how it goes.</p>' +
      '<p>I have Saturdays and I can lift. What do you actually need, and where do I turn up?</p><p>Claudia</p>',
  },
  {
    folder: 'inbox',
    person: 'ben-osei',
    subject: 'Van safety is due — I need a day without it',
    preview_text: 'The certificate runs out at the end of the month and the garage wants it for a full day —',
    status: 'open',
    daysAgo: 9,
    body_html:
      '<p>The certificate runs out at the end of the month and the garage wants the van for a full day.</p>' +
      '<p>Tell me which day hurts least. Not a Tuesday and not a Thursday, and that is most of the problem.</p><p>Ben</p>',
  },

  // Assigned, being worked, not answered yet.
  {
    folder: 'inbox',
    person: 'gail-mcintyre',
    subject: 'Saturday sort — sheet, and two no-shows',
    preview_text: 'Sign-in sheet attached. Two of the school group did not turn up again —',
    status: 'open',
    assignTo: 'u-volunteers',
    daysAgo: 1,
    attachments: ['volunteer-signin'],
    body_html:
      '<p>Sign-in sheet attached, hours totalled.</p>' +
      '<p>Two of the school group did not turn up again. I am not chasing teenagers, but if their hours forms come to you at the end of term, you should know what is on the sheet and what is not.</p>' +
      '<p>Gail</p>',
  },
  {
    folder: 'inbox',
    person: 'ruth-abbott',
    subject: 'Board pack for the 14th — move one item',
    preview_text: 'Put the hamper waitlist first, before the finance report —',
    status: 'open',
    assignTo: 'owner',
    daysAgo: 2,
    is_favourite: true,
    body_html:
      '<p>Put the hamper waitlist first, before the finance report. If it goes after, we will discuss it for six minutes with our coats on.</p>' +
      '<p>It is the only item on that agenda about people rather than money.</p><p>Ruth</p>',
  },
  {
    folder: 'inbox',
    person: 'wei-zhang',
    subject: 'Clinic on the 14th — six booked, room for two',
    preview_text: 'Six confirmed, two slots left, and one of the six needs an interpreter —',
    status: 'open',
    assignTo: 'u-programs',
    daysAgo: 3,
    body_html:
      '<p>Six confirmed and two slots still open. One of the six needs Arabic — is Sara able to be there, or should I bring someone?</p>' +
      '<p>If the last two slots go unfilled, I would rather give the time to the Yusuf paperwork than sit idle.</p>' +
      '<p>Wei</p>',
  },
  {
    folder: 'inbox',
    person: 'dorothy-price',
    subject: 'Thursday delivery — I will be out until three',
    preview_text: 'Appointment at the health centre and the bus back is not reliable —',
    status: 'open',
    assignTo: 'u-volunteers',
    daysAgo: 4,
    body_html:
      '<p>Appointment at the health centre on Thursday and the bus back is not reliable.</p>' +
      '<p>Anything after three is fine. Please do not leave it in the porch — last time the box was wet through by the evening.</p>' +
      '<p>Dorothy</p>',
  },
  {
    folder: 'inbox',
    person: 'eleanor-vance',
    subject: 'Two printed reports this year, please',
    preview_text: 'One for me and one for my neighbour, who has started asking about you —',
    status: 'open',
    assignTo: 'u-giving',
    daysAgo: 5,
    body_html:
      '<p>One for me and one for my neighbour, who has started asking what it is I give to every month.</p>' +
      '<p>I know the printing costs you. I would rather you posted me one than sent me four emails about it.</p>' +
      '<p>Eleanor Vance</p>',
  },
  {
    folder: 'inbox',
    person: 'simon-adeyemi',
    subject: 'Annual report proof — sign off by Friday',
    preview_text: 'Proof attached. Page six is the one to read properly —',
    status: 'open',
    assignTo: 'u-giving',
    daysAgo: 7,
    attachments: ['annual-report-proof'],
    body_html:
      '<p>Proof attached. Page six is the one to read properly — that is where the donor names are, and a wrong name there is worse than a late report.</p>' +
      '<p>Friday and it is on the press next week. The invoice will be late, as usual.</p><p>Simon</p>',
  },

  // Answered, waiting on them.
  {
    folder: 'sent',
    person: 'margaret-shore',
    subject: 'Re: This year’s gift',
    preview_text: 'I will call Thursday morning rather than write — the winter drive does need it…',
    status: 'open',
    assignTo: 'owner',
    daysAgo: 2,
    body_html:
      '<p>Margaret,</p><p>I will call Thursday morning rather than write, as you asked.</p>' +
      '<p>The short answer to your question is yes, the winter drive will need it — we are starting the season with a longer waitlist than we finished the last one with.</p>' +
      '<p>Bea</p>',
  },
  {
    folder: 'sent',
    person: 'nathan-cole',
    subject: 'Saturday sort — what to bring',
    preview_text: 'Closed shoes and something you do not mind getting dusty — that is the whole list…',
    status: 'open',
    assignTo: 'u-volunteers',
    daysAgo: 6,
    body_html:
      '<p>Nathan,</p><p>Closed shoes and something you do not mind getting dusty. That is the whole list.</p>' +
      '<p>Nine to one, and Gail will sign your hours at the end. Tell us the week before if you cannot make it — the sort is planned around who is coming.</p>' +
      '<p>Curtis</p>',
  },

  // Finished.
  {
    folder: 'inbox',
    person: 'joyce-nakamura',
    subject: 'Thank you for January',
    preview_text: 'The Thursday call is worth as much as the box, and you can tell whoever needs telling —',
    status: 'closed',
    assignTo: 'u-programs',
    daysAgo: 15,
    body_html:
      '<p>The Thursday call is worth as much as the box. You can tell whoever needs telling that, next time someone asks what the money buys.</p>' +
      '<p>Joyce</p>',
  },
  {
    folder: 'sent',
    person: 'jess-lam',
    subject: 'Re: driving the Thursday route',
    preview_text: 'Yes please — Ben will hand over the keys and the list on Wednesday evening…',
    status: 'closed',
    assignTo: 'u-volunteers',
    daysAgo: 12,
    body_html:
      '<p>Jess,</p><p>Yes please. Ben will leave the keys and the printed list with the Wednesday packing crew.</p>' +
      '<p>Two of the stops want a knock and a word rather than a doorstep drop — they are marked on the list, and they are the reason the route takes as long as it does.</p>' +
      '<p>Curtis</p>',
  },
  {
    folder: 'inbox',
    person: 'helen-carr',
    subject: 'The letter ran on Saturday',
    preview_text: 'They cut the last paragraph, which was the only one that asked for anything —',
    status: 'closed',
    assignTo: 'owner',
    daysAgo: 20,
    body_html:
      '<p>They ran it on Saturday and cut the last paragraph, which was the only one that asked for anything.</p>' +
      '<p>Still, it ran. If you want a second one before the winter drive, I will write it and leave the ask in the middle where they cannot find it.</p>' +
      '<p>Helen</p>',
  },
];

const PLEDGES: DemoPledgeDef[] = [
  { key: 'pl-vance', person: 'eleanor-vance', monthlyAmountCents: 5000, startedDaysAgo: 280, nextBillingInDays: 6 },
  { key: 'pl-abbott', person: 'ruth-abbott', monthlyAmountCents: 2500, startedDaysAgo: 210, nextBillingInDays: 12 },
  { key: 'pl-brant', person: 'olivia-brant', monthlyAmountCents: 1000, startedDaysAgo: 96, nextBillingInDays: 19 },
];

const DONATIONS: DemoDonationDef[] = [
  { person: 'margaret-shore', amountCents: 100000, method: 'check', createdDaysAgo: 4 },
  { person: 'priya-raman', amountCents: 250000, method: 'bank_transfer', createdDaysAgo: 14 },
  {
    person: 'eleanor-vance',
    amountCents: 5000,
    method: 'card',
    createdDaysAgo: 6,
    pledge: 'pl-vance',
  },
  {
    person: 'eleanor-vance',
    amountCents: 5000,
    method: 'card',
    createdDaysAgo: 36,
    pledge: 'pl-vance',
  },
  {
    person: 'ruth-abbott',
    amountCents: 2500,
    method: 'card',
    createdDaysAgo: 12,
    pledge: 'pl-abbott',
  },
  {
    person: 'ruth-abbott',
    amountCents: 2500,
    method: 'card',
    createdDaysAgo: 42,
    pledge: 'pl-abbott',
  },
  {
    person: 'olivia-brant',
    amountCents: 1000,
    method: 'card',
    createdDaysAgo: 19,
    pledge: 'pl-brant',
  },
  // Gave through the website and never filled in an address — the giving desk cannot receipt
  // this one until someone gets it, which is what the "Get a mailing address" task is about.
  { person: 'claudia-reyes', amountCents: 15000, method: 'card', createdDaysAgo: 8 },
  { person: 'daniel-brant', amountCents: 7500, method: 'card', createdDaysAgo: 9 },
  { person: 'simon-adeyemi', amountCents: 15000, method: 'card', createdDaysAgo: 22 },
  // A $250 seat at the fall benefit dinner. The $60 meal is an advantage the donor received
  // back, so only $190 is receiptable — the one gift in any demo that splits the two.
  { person: 'nadia-petrov', amountCents: 25000, method: 'card', createdDaysAgo: 24 },
  { person: 'helen-carr', amountCents: 5000, method: 'card', createdDaysAgo: 27 },
  { person: 'grace-mbeki', amountCents: 3000, method: 'cash', createdDaysAgo: 31 },
  { person: 'peter-mbeki', amountCents: 3000, method: 'cash', createdDaysAgo: 31 },
  { person: 'wei-zhang', amountCents: 20000, method: 'card', createdDaysAgo: 45 },
  { person: 'colin-vance', amountCents: 10000, method: 'check', createdDaysAgo: 52 },
  { person: 'yuki-sato', amountCents: 2500, method: 'card', createdDaysAgo: 58 },
  { person: 'tom-farrell', amountCents: 50000, method: 'bank_transfer', createdDaysAgo: 66 },
];

/**
 * Official CRA TAX receipts over DONATIONS (by index) — separate from, and in addition to, the
 * acknowledgement the seeder writes for every gift in the ledger.
 *
 * The desk rule this data encodes: Bea issues a tax receipt on request for a one-time gift of $100
 * or more, and everything below that — plus every monthly pledge charge — waits for the year-end
 * run. So a gift with no tax receipt is not a backlog: it is a gift whose donor has not asked and
 * whose receipt comes in January.
 *
 * Two of them carry the cases a charity actually runs into: Nadia Petrov's benefit-dinner seat is
 * split into gift, advantage and eligible amount, and Claudia Reyes' $150 online gift is the one
 * the desk CANNOT tax-receipt, because she has no mailing address on file and a CRA receipt requires
 * one. She is still acknowledged — an acknowledgement needs no address. Church mode covers the
 * cancel-and-replace pair; this dataset deliberately does not repeat it.
 */
const RECEIPTS: DemoReceiptDef[] = [
  { donation: 0, ref: 1, issuedDaysAgo: 3, emailed: false }, // margaret-shore $1,000 — prefers paper, gets mailed
  { donation: 1, ref: 2, issuedDaysAgo: 13, emailed: true }, // priya-raman $2,500 — the credit-union match
  { donation: 9, ref: 3, issuedDaysAgo: 21, emailed: true }, // simon-adeyemi $150
  {
    donation: 10, // nadia-petrov — $250 benefit-dinner seat, $60 of it a meal she received
    ref: 4,
    issuedDaysAgo: 23,
    advantageCents: 6000,
    advantageDescription: 'Dinner at the fall benefit',
    emailed: true,
  },
  { donation: 14, ref: 5, issuedDaysAgo: 44, emailed: true }, // wei-zhang $200
  { donation: 15, ref: 6, issuedDaysAgo: 51, emailed: true }, // colin-vance $100
  { donation: 17, ref: 7, issuedDaysAgo: 65, emailed: true }, // tom-farrell $500
];

/**
 * CRA charitable receipting for a small charity.
 *
 * Every gift here is acknowledged automatically, like everywhere else; these settings are what let
 * Bea also issue an official TAX receipt on request, and what the year-end run will use to issue
 * them in bulk.
 *
 * The registered address is written with the Canadian pack's city on purpose. These settings are
 * seeded ONLY into a Canadian workspace — every receipt regime the product implements is Canadian,
 * so `PlacePack.seedsReceipts` is false for the United States pack and this block is skipped there.
 * Composing the address from the seeded pack instead would produce a Canada Revenue Agency receipt
 * bearing a Chicago address, which is a false document.
 */
const RECEIPT_SETTINGS: Record<string, string | boolean> = {
  'receipts.regime': 'cra_charity',
  'receipts.org_legal_name': 'Rideau Community Table',
  'receipts.org_address': `1064 Wellington Street West, ${CANADA_PLACE_PACK.city}, ${CANADA_PLACE_PACK.state}`,
  'receipts.registration_number': '867539021 RR 0001',
  'receipts.signatory_name': 'Bea Solomon',
  'receipts.signatory_title': 'Director of Giving',
  'receipts.number_prefix': 'RCT',
  'receipts.place_of_issue': CANADA_PLACE_PACK.city,
};

/** Last year's giving statements — where every gift too small to receipt individually ended up. */
const STATEMENT_RUN: DemoStatementRunDef = {
  yearsAgo: 1,
  donorsTotal: 26,
  generated: 26,
  emailed: 22,
  toPrint: 4,
};

export const NONPROFIT_DEMO_DATASET: DemoDataset = {
  companies: COMPANIES,
  households: HOUSEHOLDS,
  persons: PERSONS,
  users: USERS,
  tasks: TASKS,
  lists: LISTS,
  team: TEAM,
  volunteerEvents: VOLUNTEER_EVENTS,
  newsletters: NEWSLETTERS,
  submissions: SUBMISSIONS,
  issueAssignments: ISSUE_ASSIGNMENTS,
  emails: EMAILS,
  // Non-profit mode hides canvassing and deliveries by default.
  turfs: [],
  deliveryRequests: [],
  deliveryRoutes: [],
  pledges: PLEDGES,
  donations: DONATIONS,
  receipts: RECEIPTS,
  receiptSettings: RECEIPT_SETTINGS,
  statementRun: STATEMENT_RUN,
};
