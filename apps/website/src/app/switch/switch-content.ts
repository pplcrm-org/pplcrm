/**
 * Copy for the /switch hub and the four /switch/<tool> migration guides.
 *
 * Every claim here is bounded by what the CSV import wizard actually does
 * (people/companies/households/tasks, 5,000 rows per file, merge-by-email,
 * tags + one list, the DNS/disposable email check-up) — see
 * `libs/uxcommon/src/components/csv-import/persons-field-mapping.ts` for
 * which header spellings auto-match. Two limits are stated deliberately and
 * must stay stated: giving history has no bulk import, and no import writes
 * newsletter consent. Do not soften either without the product changing first.
 */

export type SwitchSlug = 'breeze' | 'planning-center' | 'nationbuilder' | 'mailchimp';

export interface SwitchMappingRow {
  readonly theirs: string;
  readonly lands: string;
  readonly note?: string;
}

export interface SwitchLimit {
  readonly title: string;
  readonly body: string;
}

export interface SwitchGuide {
  readonly slug: SwitchSlug;
  readonly name: string;
  /** Short category label for the hub card and the guide eyebrow. */
  readonly kind: string;
  /** One-liner on the hub card. */
  readonly hubLine: string;
  /** Paragraph under the guide page's H1. */
  readonly heroSub: string;
  /** "Get your file out" steps, in order. */
  readonly exportSteps: readonly string[];
  readonly mappings: readonly SwitchMappingRow[];
  /** The honest section: what stays behind, stated plainly. */
  readonly limits: readonly SwitchLimit[];
}

/** The four wizard steps, shared verbatim by the hub and every guide. */
export const WIZARD_STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'Upload',
    body: 'A CSV with a header row — Excel’s save-as-CSV is fine. Up to 5,000 rows per file; split a bigger list and run the parts one after another.',
  },
  {
    title: 'Map',
    body: 'Every column gets a best-guess match you can correct with a dropdown. Unmapped columns are left out — nothing imports by accident.',
  },
  {
    title: 'Review',
    body: 'Rows matching an existing person by email can merge (fills blanks, never overwrites), be skipped, or import as new. You can also tag everyone in the file and add them to a list, so the import stays findable afterwards.',
  },
  {
    title: 'Import',
    body: 'Runs in the background and reports back how many rows landed — with skipped rows downloadable as a CSV that names the reason for each.',
  },
];

/** The import-time email check-up, shared by the hub and every guide. */
export const EMAIL_CHECK =
  'Every people import also runs a quiet check on each email address — whether its domain can actually ' +
  'receive mail, and whether it belongs to a throwaway-address provider. Failing addresses stay on the ' +
  'record but are suppressed from sending, so dead addresses from an old export are never sent to.';

const SUBSCRIPTION_LIMIT: SwitchLimit = {
  title: 'Mailing-list status does not import',
  body:
    'The import creates and updates contacts; it never marks anyone as a newsletter subscriber. pplCRM ' +
    'records consent on each person separately, so after the import people are subscribed one at a time ' +
    'from their record — there is no one-click bulk subscribe — or they confirm themselves through one of ' +
    'your signup forms. Plan for this step before your first send.',
};

const GIVING_LIMIT_BODY_TAIL =
  'Going forward, offline gifts (cash, cheque, bank transfer) are recorded one at a time on the ' +
  'person’s record, and online giving runs through pplCRM donation pages.';

export const SWITCH_GUIDES: readonly SwitchGuide[] = [
  {
    slug: 'breeze',
    name: 'Breeze',
    kind: 'Church management',
    hubLine:
      'People, families, tags and notes come across in one CSV. Giving history does not, and the guide says so up front.',
    heroSub:
      'Breeze can export your people to a spreadsheet in a few clicks, and pplCRM imports that file through a ' +
      'guided wizard. People, families, tags and notes come across; this guide also says plainly what does not.',
    exportSteps: [
      'In Breeze, open People and export everyone to a spreadsheet. If it opens in Excel, save it as a CSV — the import wizard reads CSV files, not .xlsx.',
      'Keep the header row. Columns named things like First Name, Last Name, Email, Mobile, Street Address, City, State and Zip are matched to pplCRM fields automatically; anything else gets a dropdown on the mapping step.',
      'One file imports up to 5,000 rows. If your list is bigger, split the file and run the parts one after another.',
    ],
    mappings: [
      {
        theirs: 'First and last name',
        lands: 'The person’s name',
        note: 'Matched automatically under most spellings.',
      },
      {
        theirs: 'Email',
        lands: 'The person’s email address',
        note: 'Also the duplicate key: a row matching an existing person can merge into their record instead of duplicating it.',
      },
      { theirs: 'Mobile / cell phone', lands: 'The person’s mobile number' },
      { theirs: 'Home phone', lands: 'The household’s phone' },
      {
        theirs: 'Street, city, state/province, zip',
        lands: 'A household at that address',
        note: 'Rows sharing an address land in the same household, so families arrive together.',
      },
      { theirs: 'Tags', lands: 'Tags on each person', note: 'Comma-separated values become individual tags.' },
      { theirs: 'Notes', lands: 'The person’s notes' },
      {
        theirs: 'Custom profile fields',
        lands: 'No matching field',
        note: 'Combine what you want to keep into your Notes column before exporting, or map a column to Tags to keep each value as a filterable tag.',
      },
    ],
    limits: [
      {
        title: 'Giving history does not import',
        body:
          'There is no donation import in pplCRM. Past gifts stay in Breeze — keep the giving export as your ' +
          'archive of record. ' +
          GIVING_LIMIT_BODY_TAIL,
      },
      SUBSCRIPTION_LIMIT,
    ],
  },
  {
    slug: 'planning-center',
    name: 'Planning Center',
    kind: 'Church management',
    hubLine:
      'Your People list comes across, column by column. Giving and service plans stay behind — the guide says which.',
    heroSub:
      'Planning Center People can export your list as a CSV, and pplCRM imports it through a guided wizard. ' +
      'People, households, tags and notes come across; giving and service plans do not, and this guide says so plainly.',
    exportSteps: [
      'In Planning Center People, make a list of the people you want (or everyone) and export it as a CSV.',
      'Keep the header row. Name, email, phone and address columns are matched to pplCRM fields automatically under most common spellings; anything else gets a dropdown on the mapping step.',
      'One file imports up to 5,000 rows; split a bigger list and run the parts one after another.',
    ],
    mappings: [
      {
        theirs: 'First and last name',
        lands: 'The person’s name',
        note: 'Matched automatically under most spellings.',
      },
      {
        theirs: 'Email',
        lands: 'The person’s email address',
        note: 'Also the duplicate key: a row matching an existing person can merge into their record instead of duplicating it.',
      },
      { theirs: 'Phone', lands: 'The person’s mobile number' },
      {
        theirs: 'Street, city, state/province, zip',
        lands: 'A household at that address',
        note: 'Rows sharing an address land in the same household, so families arrive together.',
      },
      {
        theirs: 'Campus, group or list columns',
        lands: 'Tags on each person',
        note: 'Map the column to Tags on the mapping step and each value becomes a tag you can filter and segment by.',
      },
      { theirs: 'Notes', lands: 'The person’s notes' },
      {
        theirs: 'Custom fields',
        lands: 'No matching field',
        note: 'Combine what you want to keep into your Notes column before exporting, or map a column to Tags.',
      },
    ],
    limits: [
      {
        title: 'Giving history does not import',
        body:
          'There is no donation import in pplCRM. Past gifts recorded in Planning Center Giving stay there — ' +
          'keep that export as your archive of record. ' +
          GIVING_LIMIT_BODY_TAIL,
      },
      {
        title: 'Service plans and scheduling do not import',
        body:
          'Planning Center Services rosters and plans have no counterpart here. pplCRM tracks the people side — ' +
          'households, volunteer status, tasks and follow-ups — not service scheduling.',
      },
      SUBSCRIPTION_LIMIT,
    ],
  },
  {
    slug: 'nationbuilder',
    name: 'NationBuilder',
    kind: 'Organizing platform',
    hubLine:
      'Bring the whole database — contacts and households are unlimited on every plan here. Tags come across; support levels start fresh.',
    heroSub:
      'NationBuilder exports your people as a CSV, and pplCRM imports it through a guided wizard. One difference ' +
      'is structural: NationBuilder prices by the size of your database. Here contacts and households are ' +
      'unlimited on every plan, and you pay only for the people you email.',
    exportSteps: [
      'In NationBuilder, filter People down to the set you want (or take everyone) and export a CSV.',
      'NationBuilder exports carry dozens of columns. The wizard matches the common ones — first_name, last_name, email, mobile, city, state, zip — automatically; columns it does not recognize get a dropdown, and anything left unmapped is simply left out.',
      'One file imports up to 5,000 rows; split a bigger export and run the parts one after another.',
    ],
    mappings: [
      { theirs: 'first_name / last_name', lands: 'The person’s name', note: 'Matched automatically.' },
      {
        theirs: 'email',
        lands: 'The person’s email address',
        note: 'Also the duplicate key: a row matching an existing person can merge into their record instead of duplicating it.',
      },
      { theirs: 'mobile / phone', lands: 'The person’s mobile number' },
      {
        theirs: 'Address columns with a primary_ prefix',
        lands: 'A household at that address',
        note: 'The prefix is not one of the spellings the wizard guesses — pick Street, City, State and Zip for those columns on the mapping step. Rows sharing an address land in the same household.',
      },
      {
        theirs: 'tag_list',
        lands: 'Tags on each person',
        note: 'Map it to Tags on the mapping step; the comma-separated list becomes individual tags.',
      },
      {
        theirs: 'Notes or background columns',
        lands: 'The person’s notes',
        note: 'Map the column to Notes on the mapping step.',
      },
      {
        theirs: 'Support level, districts, voter data',
        lands: 'No matching field',
        note: 'Support is recorded per campaign here, not imported — see below.',
      },
    ],
    limits: [
      {
        title: 'Support levels and voter history do not import',
        body:
          'In pplCRM, support level and voting status are recorded per campaign — from the person’s record, or ' +
          'from the doorstep in the canvassing companion — so they attach to the campaign you are running now ' +
          'rather than arriving as history from someone else’s race.',
      },
      {
        title: 'Donation history does not import',
        body:
          'There is no donation import in pplCRM. Past gifts stay in your NationBuilder export — keep it as ' +
          'your archive of record. ' +
          GIVING_LIMIT_BODY_TAIL,
      },
      SUBSCRIPTION_LIMIT,
    ],
  },
  {
    slug: 'mailchimp',
    name: 'Mailchimp',
    kind: 'Email marketing',
    hubLine:
      'Your audience becomes people you actually know — contacts and tags import in one CSV. Consent is recorded here, and the guide shows how.',
    heroSub:
      'Mailchimp holds an audience; pplCRM holds the people behind it, with newsletters built in. The audience ' +
      'export comes across in one CSV. One thing does not copy over — subscription status — and this guide ' +
      'explains exactly what to do about it.',
    exportSteps: [
      'In Mailchimp, open your audience and export it as a CSV. Export only subscribed contacts — leave unsubscribed and cleaned addresses out of the file entirely. pplCRM cannot import an unsubscribe flag, so the safe, compliant move is to never import those rows at all.',
      'Keep the header row. Email Address, First Name, Last Name, Phone Number and Tags are matched to pplCRM fields automatically.',
      'One file imports up to 5,000 rows; split a bigger audience and run the parts one after another.',
    ],
    mappings: [
      {
        theirs: 'Email Address',
        lands: 'The person’s email address',
        note: 'Also the duplicate key: a row matching an existing person can merge into their record instead of duplicating it.',
      },
      { theirs: 'First Name / Last Name', lands: 'The person’s name', note: 'Matched automatically.' },
      { theirs: 'Phone Number', lands: 'The person’s mobile number' },
      {
        theirs: 'Address',
        lands: 'The street line of a household',
        note: 'Mailchimp keeps the whole address in one column, so it lands on the street line unsplit. Separate city, state and zip columns, if your export has them, map cleanly.',
      },
      { theirs: 'Tags', lands: 'Tags on each person', note: 'Comma-separated values become individual tags.' },
      {
        theirs: 'Subscription status, opt-in dates, member ratings',
        lands: 'No matching field',
        note: 'Status is the honest limit of this move — see below. Ratings and dates can go into a Notes column if you want to keep them.',
      },
    ],
    limits: [
      {
        title: 'Subscription status does not import — plan for this first',
        body:
          'The import creates contacts, not subscribers. pplCRM records newsletter consent on each person ' +
          'separately, and no import writes it, so freshly imported people are not yet sendable. Today that ' +
          'means subscribing each person from their record — there is no one-click bulk subscribe — or ' +
          'inviting people to confirm through one of your pplCRM signup forms. Do this before your first send.',
      },
      {
        title: 'Unsubscribes cannot be imported either',
        body:
          'There is no way to load an unsubscribe or suppression list, which is why step one says to leave ' +
          'those rows out of the file entirely. Once people are subscribed here, every unsubscribe is recorded ' +
          'and honored automatically.',
      },
      {
        title: 'Campaign history stays behind',
        body:
          'Past campaigns, opens and clicks stay in Mailchimp — keep the account export as your archive. Going ' +
          'forward, every newsletter here runs a deliverability check before it can send.',
      },
    ],
  },
];

/** Guide for the slug, falling back to the first guide on an unknown slug. */
export function switchGuideBySlug(slug: string): SwitchGuide {
  const guide = SWITCH_GUIDES.find((g) => g.slug === slug) ?? SWITCH_GUIDES.at(0);
  if (!guide) throw new Error('SWITCH_GUIDES is empty');
  return guide;
}
