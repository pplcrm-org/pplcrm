import type { Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import {
  DEFAULT_ORG_MODE,
  FORM_TEMPLATES,
  ORG_MODE_SEEDS_DEMO,
  fieldsForTemplate,
} from '../../../../../../libs/common/src';
import type { FormType, OrgMode } from '../../../../../../libs/common/src';

export interface StarterTagDef {
  name: string;
  description: string;
  color: string;
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
export const SHARED_STARTER_TAGS: StarterTagDef[] = [
  { name: 'community leader', description: 'Runs or anchors a local association, league, or board.', color: '#8b5cf6' },
  { name: 'small business owner', description: 'Owns or operates a business in the riding.', color: '#f97316' },
  { name: 'senior', description: 'Prefers daytime calls and print material.', color: '#64748b' },
  { name: 'student', description: 'Student — usually reachable evenings and weekends.', color: '#22c55e' },
  { name: 'letter writer', description: 'Has written letters to the editor or to council.', color: '#eab308' },
  { name: 'media contact', description: 'Journalist or newsletter editor — route through comms.', color: '#ef4444' },
  { name: 'union member', description: 'Active local union member.', color: '#3b82f6' },
  { name: 'faith community', description: 'Active in a local faith community.', color: '#a855f7' },
];

/**
 * Starter tags that only make sense for an electoral organization. Seeded exactly when
 * the demo dataset is (see ORG_MODE_SEEDS_DEMO) — demo-seed-data.ts attaches demo
 * households to 'lawn sign location' BY NAME, so the two must never diverge.
 */
export const CAMPAIGN_STARTER_TAGS: StarterTagDef[] = [
  { name: 'new to riding', description: 'Moved into the riding within the last year.', color: '#06b6d4' },
  { name: 'lawn sign location', description: 'Household that has agreed to display a lawn sign.', color: '#16a34a' },
];

/** Every starter tag, in the order a demo-seeding mode gets them. */
export const STARTER_TAGS: StarterTagDef[] = [...SHARED_STARTER_TAGS, ...CAMPAIGN_STARTER_TAGS];

/** Mode-specific additions on top of the shared set. */
export const MODE_EXTRA_TAGS: Record<OrgMode, StarterTagDef[]> = {
  office: [],
  campaign: [],
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

export async function seedStarterTags(
  params: { tenant_id: string; user_id: string; mode?: OrgMode },
  trx: Transaction<Models>,
): Promise<void> {
  const mode = params.mode ?? DEFAULT_ORG_MODE;
  const tags = [
    ...SHARED_STARTER_TAGS,
    ...(ORG_MODE_SEEDS_DEMO[mode] ? CAMPAIGN_STARTER_TAGS : []),
    ...MODE_EXTRA_TAGS[mode],
  ];
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

/** One extra, mode-appropriate request form for the modes that skip the campaign starters. */
export const MODE_STARTER_FORMS: Record<OrgMode, StarterFormDef[]> = {
  office: [],
  campaign: [],
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

/**
 * Creates the starter web forms (all drafts) for a new tenant: one of
 * each standard kind (signup ×2, request, survey), a standard fundraising
 * pledge form, plus the two donation giving pages (one-time + recurring). These
 * are deliberately separate from the demo dataset
 * (modules/demo/demo-seed.ts): exiting demo mode deletes the demo data but
 * keeps these forms — a ready-made starting point the user publishes when
 * they're ready.
 *
 * Returns the created ids + slugs so the demo seeder can attach sample
 * submissions to two of them.
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
  const mode = params.mode ?? DEFAULT_ORG_MODE;

  const starterForms: StarterFormDef[] = [
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
    // The two campaign-shaped starters. Gated on the same flag as the demo dataset:
    // demo-seed.ts attaches sample submissions to 'issues-survey' BY SLUG and silently
    // skips a slug it cannot find, so seeding them apart would fail quietly.
    ...(ORG_MODE_SEEDS_DEMO[mode]
      ? ([
          {
            key: 'request' as const,
            formType: 'standard' as const,
            name: 'Yard sign request',
            slug: 'yard-sign-request',
            description:
              'Yard sign request form for your website. Requests feed the Deliveries page for route planning.',
            submitLabel: FORM_TEMPLATES.request.submitLabel,
            thanksBody: 'We’ll deliver your yard sign soon.',
            confirmSubject: 'Your yard sign request',
            confirmBody: 'Hi [First name],\n\nThanks for your request — a volunteer will drop off your sign soon.',
          },
          {
            key: 'survey' as const,
            formType: 'standard' as const,
            name: 'Issues survey',
            slug: 'issues-survey',
            description: 'Issues survey for your website. Answers help you rank what your community cares about.',
            submitLabel: FORM_TEMPLATES.survey.submitLabel,
            thanksBody: 'Thanks for sharing your priorities with us.',
            confirmSubject: 'Thanks for your input',
            confirmBody:
              'Hi [First name],\n\nThanks for filling out our survey — your input helps shape our priorities.',
          },
        ] as const)
      : []),
    ...MODE_STARTER_FORMS[mode],
  ];

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
