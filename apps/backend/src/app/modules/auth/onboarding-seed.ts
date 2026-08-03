import type { Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import {
  DEFAULT_ORG_MODE,
  FORM_TEMPLATES,
  ORG_MODE_IS_ELECTORAL,
  ORG_MODE_MODULE_DEFAULTS,
  fieldsForTemplate,
  seatLabelFor,
} from '../../../../../../libs/common/src';
import type { FormType, JurisdictionId, OrgMode } from '../../../../../../libs/common/src';

export interface StarterTagDef {
  name: string;
  description: string;
  color: string;
}

/**
 * What the starter vocabulary needs to know about the race this workspace is running.
 *
 * Collected in step 2 of the signup wizard and written to the office campaign's columns; passed
 * here so the tags a workspace opens with use its own word for its own territory.
 */
export interface StarterOffice {
  jurisdiction: JurisdictionId;
  /** Province, territory or state code — some regions use a different word for the same thing. */
  region: string | null;
  /** The campaign's own word for its seat area, when it set one. */
  seatLabelOverride: string | null;
}

/** The word a non-electoral organization's starter tags use for the area it works in. */
const NON_ELECTORAL_AREA_WORD = 'community';

/**
 * The word the starter tag descriptions use for the territory the organization works in.
 *
 * A church and a food bank serve a community, not a seat area, so they never get an electoral
 * word at all. An electoral workspace gets its own jurisdiction's word — riding in Ottawa, ward in
 * Toronto, congressional district in Ohio, constituency in Alberta — and falls back to the generic
 * "district" when signup's office step was skipped, which is exactly what `seatLabelFor` returns
 * for the `other` jurisdiction.
 *
 * Only the DESCRIPTIONS vary. Tag NAMES are deliberately jurisdiction-independent, because the demo
 * datasets attach demo people and households to starter tags by name (modules/demo/demo-seed.ts)
 * and one dataset is seeded for every jurisdiction that shares its org mode — a name that changed
 * per jurisdiction could not be referenced by any fixed string.
 */
export function starterAreaWord(mode: OrgMode, office?: StarterOffice | null): string {
  if (!ORG_MODE_IS_ELECTORAL[mode]) return NON_ELECTORAL_AREA_WORD;
  if (!office) return seatLabelFor('other', null, null).toLowerCase();
  return seatLabelFor(office.jurisdiction, office.region, office.seatLabelOverride).toLowerCase();
}

export interface StarterFormDef {
  key: FormType;
  formType: 'standard' | 'donation' | 'recurring_donation';
  name: string;
  slug: string;
  description: string;
  submitLabel: string;
  thanksBody: string;
  confirmSubject: string;
  confirmBody: string;
}

/**
 * Starter tag vocabulary (freeform organizational labels). Donor / supporter /
 * subscriber are structured concepts in this product (donations table,
 * campaign_person_facts, campaign_subscriptions) and were retired as tags —
 * the starter vocabulary must not resurrect them.
 *
 * The demo dataset (modules/demo/demo-seed-data.ts) attaches demo persons and
 * households to these by NAME — keep the two in sync when renaming.
 */
function sharedStarterTags(area: string): StarterTagDef[] {
  return [
    {
      name: 'community leader',
      description: 'Runs or anchors a local association, league, or board.',
      color: '#8b5cf6',
    },
    { name: 'small business owner', description: `Owns or operates a business in the ${area}.`, color: '#f97316' },
    { name: 'senior', description: 'Prefers daytime calls and print material.', color: '#64748b' },
    { name: 'student', description: 'Student — usually reachable evenings and weekends.', color: '#22c55e' },
    { name: 'letter writer', description: 'Has written letters to the editor or to council.', color: '#eab308' },
    { name: 'media contact', description: 'Journalist or newsletter editor — route through comms.', color: '#ef4444' },
    { name: 'union member', description: 'Active local union member.', color: '#3b82f6' },
    { name: 'faith community', description: 'Active in a local faith community.', color: '#a855f7' },
  ];
}

/** The shared set as it reads for an organization with no seat area — the words a church sees. */
export const SHARED_STARTER_TAGS: StarterTagDef[] = sharedStarterTags(NON_ELECTORAL_AREA_WORD);

function campaignStarterTags(area: string): StarterTagDef[] {
  return [{ name: 'new resident', description: `Moved into the ${area} within the last year.`, color: '#06b6d4' }];
}

/**
 * Starter tags for an organization that runs elections (see ORG_MODE_IS_ELECTORAL) — a
 * constituency office as much as a campaign. Both track who just moved in.
 *
 * The tag used to be called `new to riding`, which handed Canadian federal vocabulary to a
 * Toronto ward campaign and to an Ohio congressional campaign. The name is now the same
 * everywhere and says nothing about geography; the description carries the jurisdiction's own word
 * (see {@link starterAreaWord}). The name has to be fixed rather than derived because the demo
 * datasets reference starter tags by name and one dataset serves every jurisdiction in its mode.
 *
 * This constant is the description as it reads when signup's office step was skipped. Use
 * {@link starterTagsFor} to get the wording an actual workspace is seeded with.
 *
 * Signs are NOT here. A lawn sign needs a candidate, so 'lawn sign location' lives in the
 * campaign column of MODE_EXTRA_TAGS below; the electoral demo datasets attach households to
 * it BY NAME, and `demo-datasets.spec.ts` is what proves a dataset only references vocabulary
 * its own mode seeds.
 */
export const CAMPAIGN_STARTER_TAGS: StarterTagDef[] = campaignStarterTags(
  seatLabelFor('other', null, null).toLowerCase(),
);

/** The sign-operation tag — campaign only, and referenced by name from that mode's dataset. */
export const SIGN_STARTER_TAGS: StarterTagDef[] = [
  { name: 'lawn sign location', description: 'Household that has agreed to display a lawn sign.', color: '#16a34a' },
];

/** Every starter tag a campaign gets — the widest set, in seeding order. */
export const STARTER_TAGS: StarterTagDef[] = [...SHARED_STARTER_TAGS, ...CAMPAIGN_STARTER_TAGS, ...SIGN_STARTER_TAGS];

/** Mode-specific additions on top of the shared set. */
export const MODE_EXTRA_TAGS: Record<OrgMode, StarterTagDef[]> = {
  office: [],
  campaign: SIGN_STARTER_TAGS,
  nonprofit: [
    { name: 'major donor', description: 'Gives at a level worth a personal thank-you.', color: '#16a34a' },
    { name: 'program participant', description: 'Takes part in a program you run.', color: '#06b6d4' },
  ],
  church: [
    { name: 'member', description: 'Formally joined the congregation.', color: '#16a34a' },
    { name: 'regular attender', description: 'Comes often but has not formally joined.', color: '#06b6d4' },
    { name: 'newcomer', description: 'First visited within the last few months.', color: '#f97316' },
  ],
};

/**
 * Starter issue vocabulary (tags with type 'issue' — the structured
 * what-do-they-care-about list). Deliberately generic doorstep topics; the
 * demo dataset attaches demo persons to these by NAME.
 */
export const STARTER_ISSUES: StarterTagDef[] = [
  {
    name: 'housing affordability',
    description: 'Rents, missing-middle supply, and three-bedroom family units.',
    color: '#f43f5e',
  },
  {
    name: 'transit reliability',
    description: 'On-time performance, frequency, and coverage on the core routes.',
    color: '#0ea5e9',
  },
  {
    name: 'road safety',
    description: 'Traffic calming, crossings, and lighting on residential streets.',
    color: '#f59e0b',
  },
  {
    name: 'parks & greenspace',
    description: 'Park maintenance, trail access, and tree cover.',
    color: '#22c55e',
  },
  {
    name: 'small business support',
    description: 'Main-street vacancy, patio rules, and local procurement.',
    color: '#f97316',
  },
  {
    name: 'climate action',
    description: 'Retrofit programs, clean air and water, and active transportation.',
    color: '#14b8a6',
  },
];

/**
 * Creates the starter tag + issue vocabulary for a new tenant. Like the
 * starter forms below, these are deliberately separate from the demo dataset
 * (modules/demo/demo-seed.ts): exiting demo mode deletes the demo data but
 * keeps this vocabulary — a ready-made starting point that also shows what
 * tags and issues are for. All rows are `deletable: true` (suggestions, not
 * system data — the user can rename, recolor, merge, or delete them).
 *
 * Must run BEFORE seedDemoData: the demo seeder attaches demo persons and
 * households to these rows by name.
 */
export const MODE_ISSUES: Record<OrgMode, StarterTagDef[]> = {
  office: STARTER_ISSUES,
  campaign: STARTER_ISSUES,
  nonprofit: [
    { name: 'housing affordability', description: 'Rents, supply, and family-sized units.', color: '#f43f5e' },
    { name: 'food security', description: 'Access to affordable, reliable groceries and meals.', color: '#f59e0b' },
    { name: 'youth programs', description: 'After-school, mentorship, and summer programming.', color: '#22c55e' },
    { name: 'climate action', description: 'Retrofits, clean air and water, active transportation.', color: '#14b8a6' },
  ],
  church: [
    { name: 'benevolence', description: 'Households needing short-term practical help.', color: '#f43f5e' },
    { name: 'missions', description: 'Partners and trips the congregation supports.', color: '#0ea5e9' },
    { name: 'youth & families', description: 'Programming for children, teens, and parents.', color: '#22c55e' },
    { name: 'community outreach', description: 'Serving neighbours outside the congregation.', color: '#f97316' },
  ],
};

/**
 * Every starter tag a mode's signup creates, in seeding order.
 *
 * Exported so `demo-datasets.spec.ts` can check a dataset's tag references against the REAL list
 * rather than re-deriving it — a re-derived copy silently stops testing anything the day this
 * composition changes.
 */
export function starterTagsFor(mode: OrgMode, office?: StarterOffice | null): StarterTagDef[] {
  const area = starterAreaWord(mode, office);
  return [
    ...sharedStarterTags(area),
    ...(ORG_MODE_IS_ELECTORAL[mode] ? campaignStarterTags(area) : []),
    ...MODE_EXTRA_TAGS[mode],
  ];
}

export async function seedStarterTags(
  params: { tenant_id: string; user_id: string; mode?: OrgMode; office?: StarterOffice | null },
  trx: Transaction<Models>,
): Promise<void> {
  const mode = params.mode ?? DEFAULT_ORG_MODE;
  const tags = starterTagsFor(mode, params.office);
  const audit = { tenant_id: params.tenant_id, createdby_id: params.user_id, updatedby_id: params.user_id };
  await trx
    .insertInto('tags')
    .values([
      ...tags.map((t) => ({
        ...audit,
        name: t.name,
        description: t.description,
        color: t.color,
        deletable: true,
        type: 'tag' as const,
      })),
      ...MODE_ISSUES[mode].map((t) => ({
        ...audit,
        name: t.name,
        description: t.description,
        color: t.color,
        deletable: true,
        type: 'issue' as const,
      })),
    ])
    .execute();
}

/** The mode-appropriate request form each mode opens with — the first job it actually does. */
export const MODE_STARTER_FORMS: Record<OrgMode, StarterFormDef[]> = {
  office: [
    {
      key: 'request',
      formType: 'standard',
      name: 'Casework intake',
      slug: 'casework-intake',
      description:
        'Intake form for constituents asking the office for help. Requests arrive as tasks you can assign and track to a resolution.',
      submitLabel: FORM_TEMPLATES.request.submitLabel,
      thanksBody: 'Thanks — your request is with the office and someone will follow up.',
      confirmSubject: 'We received your request',
      confirmBody:
        'Hi [First name],\n\nThanks for contacting the office — we have your request and someone will follow up with you shortly.',
    },
  ],
  campaign: [
    {
      key: 'request',
      formType: 'standard',
      name: 'Yard sign request',
      slug: 'yard-sign-request',
      description: 'Yard sign request form for your website. Requests feed the Deliveries page for route planning.',
      submitLabel: FORM_TEMPLATES.request.submitLabel,
      thanksBody: 'We’ll deliver your yard sign soon.',
      confirmSubject: 'Your yard sign request',
      confirmBody: 'Hi [First name],\n\nThanks for your request — a volunteer will drop off your sign soon.',
    },
  ],
  nonprofit: [
    {
      key: 'request',
      formType: 'standard',
      name: 'Get help',
      slug: 'get-help',
      description: 'Intake form for people asking for support. Requests arrive as tasks you can assign.',
      submitLabel: FORM_TEMPLATES.request.submitLabel,
      thanksBody: 'Thanks for reaching out — someone will follow up with you.',
      confirmSubject: 'We received your request',
      confirmBody: 'Hi [First name],\n\nThanks for reaching out — someone from our team will follow up with you soon.',
    },
  ],
  church: [
    {
      key: 'request',
      formType: 'standard',
      name: 'Prayer request',
      slug: 'prayer-request',
      description: 'Prayer request form for your website. Requests arrive as tasks the care team can pick up.',
      submitLabel: FORM_TEMPLATES.request.submitLabel,
      thanksBody: 'Thank you — we’ll be praying with you.',
      confirmSubject: 'We received your prayer request',
      confirmBody: 'Hi [First name],\n\nThank you for sharing your request — our team will be praying with you.',
    },
  ],
};

/** The starter forms every organization gets, whatever it organizes. */
export const UNIVERSAL_STARTER_FORMS: StarterFormDef[] = [
  {
    key: 'signup',
    formType: 'standard',
    name: 'Volunteer sign-up',
    slug: 'volunteer-signup',
    description: 'Volunteer sign-up form for your website. Customize the fields, then publish to get a public link.',
    submitLabel: FORM_TEMPLATES.signup.submitLabel,
    thanksBody: 'You’re signed up — we’ll be in touch soon.',
    confirmSubject: 'Thanks for signing up',
    confirmBody: 'Hi [First name],\n\nThanks for signing up to volunteer — we’ll be in touch soon.',
  },
  {
    key: 'signup',
    formType: 'standard',
    name: 'Newsletter sign-up',
    slug: 'newsletter-sign-up',
    description: 'Sign-up form for your email newsletter. Customize the fields, then publish to get a public link.',
    submitLabel: FORM_TEMPLATES.signup.submitLabel,
    thanksBody: 'You’re on the list — thanks for signing up.',
    confirmSubject: 'Thanks for signing up',
    confirmBody: 'Hi [First name],\n\nThanks for signing up — we’ll be in touch soon.',
  },
];

/**
 * The fundraising starters: the two donation giving pages plus the no-payment pledge form.
 *
 * Withheld from any mode whose sidebar starts without Donations (see `fundraisingFormsFor`) —
 * seeding a giving page into a constituency office would be handing it a fundraising operation
 * it is not the legal entity for, and parking it on a page its own sidebar does not link to.
 * Turning Donations on in Workspace → Modules reveals the page; the forms are not retroactively
 * created there, which is the honest outcome: an office that fundraises for its association
 * builds the giving page it actually wants.
 */
export const FUNDRAISING_STARTER_FORMS: StarterFormDef[] = [
  {
    key: 'pledge',
    formType: 'recurring_donation',
    name: 'Recurring donation',
    slug: 'recurring-donation',
    description: 'Monthly-giving form. Customize the fields, then publish to start accepting recurring gifts.',
    submitLabel: 'Set up recurring gift',
    thanksBody: 'Your recurring gift means a lot to us.',
    confirmSubject: 'Thanks for your recurring gift',
    confirmBody: 'Hi [First name],\n\nThanks for setting up a recurring gift — we’ll send a receipt each month.',
  },
  {
    key: 'pledge',
    formType: 'donation',
    name: 'One-time donation',
    slug: 'one-time-donation',
    description: 'One-time donation form. Customize the fields, then publish to start accepting gifts.',
    submitLabel: 'Give now',
    thanksBody: 'Your gift means a lot to us.',
    confirmSubject: 'Thanks for your gift',
    confirmBody: 'Hi [First name],\n\nThanks for your gift — a receipt is on its way.',
  },
  {
    key: 'pledge',
    formType: 'standard',
    name: 'Fundraising pledge',
    slug: 'fundraising-pledge',
    description:
      'Collect pledges of support from your website. Responses become people you can follow up with — no payment is taken here (use the Fundraising donation pages for card gifts).',
    submitLabel: FORM_TEMPLATES.pledge.submitLabel,
    thanksBody: 'Thank you for pledging your support — we’ll be in touch about next steps.',
    confirmSubject: 'Thanks for your pledge',
    confirmBody: 'Hi [First name],\n\nThank you for pledging your support — we’ll be in touch about next steps soon.',
  },
];

/**
 * Per-mode renaming of the fundraising starters. SLUGS NEVER CHANGE — they are the public URL
 * and `onboarding-seed.spec.ts` asserts the giving page exists by slug for every mode that
 * fundraises. Only the words a congregation would not recognise change: a church takes an
 * offering, it does not run a fundraising campaign.
 *
 * Total, so adding a mode is a compile error here rather than a silent fallback to campaign
 * vocabulary.
 */
export const MODE_FUNDRAISING_TERMS: Record<OrgMode, Record<string, Pick<StarterFormDef, 'name' | 'description'>>> = {
  office: {},
  campaign: {},
  nonprofit: {},
  church: {
    'recurring-donation': {
      name: 'Monthly giving',
      description: 'Monthly-giving form. Customize the fields, then publish so members can give regularly.',
    },
    'one-time-donation': {
      name: 'Give online',
      description: 'Online giving form for one-time gifts and offerings. Customize the fields, then publish.',
    },
    'fundraising-pledge': {
      name: 'Giving pledge',
      description:
        'Collect giving pledges for the year. Responses become people you can follow up with — no payment is taken here (use Give online for card gifts).',
    },
  },
};

/**
 * The fundraising starters a mode gets, in that mode's words.
 *
 * Gated on the mode's own Donations default rather than a second flag: "does this organization's
 * sidebar open with Donations" and "should signup create giving pages" are the same question, and
 * two flags would eventually disagree.
 */
export function fundraisingFormsFor(mode: OrgMode): StarterFormDef[] {
  if (!ORG_MODE_MODULE_DEFAULTS[mode].donations) return [];
  const terms = MODE_FUNDRAISING_TERMS[mode];
  return FUNDRAISING_STARTER_FORMS.map((form) => ({ ...form, ...terms[form.slug] }));
}

/**
 * Starters for a mode that runs elections (see ORG_MODE_IS_ELECTORAL) — an office between
 * elections asks its constituents what matters exactly as a campaign does. The electoral demo
 * datasets attach sample submissions to 'issues-survey' BY SLUG and demo-seed.ts silently skips
 * a slug it cannot find, so a dataset referencing this must belong to an electoral mode.
 *
 * The yard-sign request form moved to the campaign column of MODE_STARTER_FORMS: it feeds a sign
 * operation, which needs a candidate, not merely an election.
 */
export const ELECTORAL_STARTER_FORMS: StarterFormDef[] = [
  {
    key: 'survey',
    formType: 'standard',
    name: 'Issues survey',
    slug: 'issues-survey',
    description: 'Issues survey for your website. Answers help you rank what your community cares about.',
    submitLabel: FORM_TEMPLATES.survey.submitLabel,
    thanksBody: 'Thanks for sharing your priorities with us.',
    confirmSubject: 'Thanks for your input',
    confirmBody: 'Hi [First name],\n\nThanks for filling out our survey — your input helps shape our priorities.',
  },
];

/**
 * Every starter form a mode's signup creates. Exported for the same reason as
 * {@link starterTagsFor}: the dataset spec checks the real list, not a re-derived one.
 */
export function starterFormsFor(mode: OrgMode): StarterFormDef[] {
  return [
    ...UNIVERSAL_STARTER_FORMS,
    ...fundraisingFormsFor(mode),
    ...(ORG_MODE_IS_ELECTORAL[mode] ? ELECTORAL_STARTER_FORMS : []),
    ...MODE_STARTER_FORMS[mode],
  ];
}

/**
 * Creates the starter web forms (all drafts) for a new tenant. These are deliberately separate
 * from the demo dataset (modules/demo/demo-seed.ts): exiting demo mode deletes the demo data but
 * keeps these forms — a ready-made starting point the user publishes when they're ready.
 *
 * Returns the created ids + slugs so the demo seeder can attach sample submissions to them.
 */
export async function seedStarterForms(
  params: {
    tenant_id: string;
    user_id: string;
    campaign_id: string | bigint;
    mode?: OrgMode;
  },
  trx: Transaction<Models>,
): Promise<{ id: string; slug: string }[]> {
  const { tenant_id, user_id } = params;
  const campaign_id = String(params.campaign_id);
  const starterForms = starterFormsFor(params.mode ?? DEFAULT_ORG_MODE);

  const created = await trx
    .insertInto('web_forms')
    .values(
      starterForms.map((f) => ({
        tenant_id: tenant_id,
        campaign_id,
        name: f.name,
        description: f.description,
        fields: JSON.stringify(fieldsForTemplate(f.key)),
        target_tags: JSON.stringify([]),
        target_lists: JSON.stringify([]),
        status: 'draft' as const,
        type: f.key,
        slug: f.slug,
        submit_label: f.submitLabel,
        thanks_title: 'Thank you!',
        thanks_body: f.thanksBody,
        confirm_subject: f.confirmSubject,
        confirm_body: f.confirmBody,
        send_confirmation: true,
        send_alert: false,
        notify_team_on: false,
        form_type: f.formType,
        createdby_id: user_id,
        updatedby_id: user_id,
      })),
    )
    .returning(['id', 'slug'])
    .execute();

  return created.map((f) => ({ id: String(f.id), slug: f.slug }));
}
