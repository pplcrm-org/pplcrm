import {
  STAFF_STATUSES,
  STAFF_STATUS_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  SUPPORT_LEVELS,
  SUPPORT_LEVEL_LABELS,
  VOLUNTEER_STATUSES,
  VOLUNTEER_STATUS_LABELS,
  VOTING_STATUSES,
  VOTING_STATUS_LABELS,
} from '../../../../../../../libs/common/src';

/**
 * The vocabulary of the list rule builder (§8), in one place.
 *
 * The builder (list-form) and the human "Definition" sentence (list-definition)
 * both read from here, so a field can't be offered under one label and rendered
 * under another. The `name` of each field is the key the backend's
 * `columnMapping` resolves — add a field here only when persons.repo /
 * households.repo can actually map it, or the rule is silently dropped.
 */

export interface RuleChoice {
  value: string;
  label: string;
}

const choicesFrom = <T extends string>(values: readonly T[], labels: Record<T, string>): RuleChoice[] =>
  values.map((value) => ({ value, label: labels[value] }));

export const VOLUNTEER_STATUS_CHOICES: RuleChoice[] = choicesFrom(VOLUNTEER_STATUSES, VOLUNTEER_STATUS_LABELS);
export const STAFF_STATUS_CHOICES: RuleChoice[] = choicesFrom(STAFF_STATUSES, STAFF_STATUS_LABELS);
export const SUBSCRIPTION_STATUS_CHOICES: RuleChoice[] = choicesFrom(SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABELS);
export const SUPPORT_LEVEL_CHOICES: RuleChoice[] = choicesFrom(SUPPORT_LEVELS, SUPPORT_LEVEL_LABELS);
export const VOTING_STATUS_CHOICES: RuleChoice[] = choicesFrom(VOTING_STATUSES, VOTING_STATUS_LABELS);

/** `persons.do_not_contact` is a boolean; rules compare it as text ('true'/'false'). */
export const DO_NOT_CONTACT_CHOICES: RuleChoice[] = [
  { value: 'true', label: 'Yes — do not contact' },
  { value: 'false', label: 'No — contactable' },
];

/**
 * `persons.senior` is deliberately tri-state: NULL means nobody has asked, which is not
 * the same as "under 65". "Not recorded" is therefore a real answer, reached with the
 * `is not` operator against either value.
 */
export const SENIOR_CHOICES: RuleChoice[] = [
  { value: 'true', label: 'Yes — 65 or older' },
  { value: 'false', label: 'No — under 65' },
];

/** Presence of `persons.deceased_at`, cast to a yes/no by the repo. */
export const DECEASED_CHOICES: RuleChoice[] = [
  { value: 'true', label: 'Yes — reported deceased' },
  { value: 'false', label: 'No' },
];

/**
 * The two electoral geography fields, which are separate because a household is inside several
 * boundaries at the same time: a federal riding AND a provincial riding AND a municipal ward AND a
 * precinct. One field cannot answer both questions people ask.
 *
 * `electoral_area` is the household's area on the ACTIVE CAMPAIGN'S OWN map, one value per
 * household, so it compares exactly and is the one to use for "everyone in Ward 4".
 *
 * `any_electoral_area` is every area the household falls in at any level, joined into one string by
 * the backend. It is what makes "everyone in precinct 12" answerable when precincts are not the
 * campaign's own map. Because it is a concatenation it must never be offered `equals`: a household
 * in three boundaries would never equal any single area name. See the operator sets in
 * `list-form.ts` and the backend note in `modules/households/electoral-areas.ts`.
 */
export const ELECTORAL_AREA_FIELD = 'electoral_area';
export const ANY_ELECTORAL_AREA_FIELD = 'any_electoral_area';

/**
 * The activity-history fields (2026-08-20), computed server-side per person (or household, for
 * knock recency): days since the last donation / door knock / newsletter open / event
 * registration / volunteer shift, plus dollars given this calendar year. All compare as
 * NUMBERS (the backend maps them with `numeric: true`), and NULL means "never happened", which
 * the is set / is not set operators read as has-happened / never. Donations, knocks and event
 * registrations are facts of the active campaign context; newsletter opens and shifts are
 * workspace-wide.
 */
export const NUMERIC_RULE_FIELDS = [
  'last_donation_days',
  'donation_total_year',
  'last_knock_days',
  'last_newsletter_open_days',
  'last_event_days',
  'last_shift_days',
] as const;

/** `EXISTS` over active recurring pledges, cast to a yes/no by the repo like do_not_contact. */
export const ACTIVE_PLEDGE_CHOICES: RuleChoice[] = [
  { value: 'true', label: 'Yes — active recurring pledge' },
  { value: 'false', label: 'No active pledge' },
];

/** Field name → the label shown in the picker and in the definition sentence. */
export const RULE_FIELD_LABELS: Record<string, string> = {
  tags: 'Tags',
  issues: 'Issues',
  volunteer_status: 'Volunteer status',
  subscription_status: 'Subscriber status',
  staff_status: 'Staff status',
  support_level: 'Support level',
  voting_status: 'Voting status',
  do_not_contact: 'Do not contact',
  senior: 'Senior (65+)',
  deceased: 'Deceased',
  // Activity history — the unit rides in the label so the number input needs no explaining.
  last_donation_days: 'Last donation (days ago)',
  donation_total_year: 'Donated this year ($)',
  has_active_pledge: 'Recurring pledge',
  last_knock_days: 'Last door knock (days ago)',
  last_newsletter_open_days: 'Last newsletter open (days ago)',
  last_event_days: 'Last event registration (days ago)',
  last_shift_days: 'Last volunteer shift (days ago)',
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  mobile: 'Mobile',
  company_name: 'Company',
  // Fallback wording for a workspace whose campaign declares no jurisdiction. When one is
  // declared, `ruleFieldLabel` swaps in that campaign's own word (Ward, Riding, Precinct).
  [ELECTORAL_AREA_FIELD]: 'Electoral area',
  [ANY_ELECTORAL_AREA_FIELD]: 'Any electoral boundary',
  city: 'City',
  state: 'State/Province',
  street1: 'Street 1',
  street2: 'Street 2',
  street_num: 'Street Number',
  zip: 'Zip Code',
  country: 'Country',
  home_phone: 'Home Phone',
  notes: 'Notes',
};

/** Field name → its picker choices, for fields whose values are a fixed set. */
export const RULE_FIELD_CHOICES: Record<string, RuleChoice[]> = {
  volunteer_status: VOLUNTEER_STATUS_CHOICES,
  subscription_status: SUBSCRIPTION_STATUS_CHOICES,
  staff_status: STAFF_STATUS_CHOICES,
  support_level: SUPPORT_LEVEL_CHOICES,
  voting_status: VOTING_STATUS_CHOICES,
  do_not_contact: DO_NOT_CONTACT_CHOICES,
  senior: SENIOR_CHOICES,
  deceased: DECEASED_CHOICES,
  has_active_pledge: ACTIVE_PLEDGE_CHOICES,
};

/**
 * Fields where an absent value means "nobody has recorded one", so the operators read
 * "is set" / "is not set" rather than "is empty" / "is not empty".
 *
 * Every field with a fixed choice list already qualifies (an absent volunteer status means "not a
 * volunteer", not "an empty string"). The two electoral fields qualify for the same reason: a
 * household with no boundary has not been placed on a map yet.
 */
export function ruleOpUsesSetWording(field: string): boolean {
  return (
    RULE_FIELD_CHOICES[field] != null ||
    field === ELECTORAL_AREA_FIELD ||
    field === ANY_ELECTORAL_AREA_FIELD ||
    // NULL on a recency/total field means "never happened" — has-happened / never wording.
    (NUMERIC_RULE_FIELDS as readonly string[]).includes(field)
  );
}

/**
 * The label shown in the picker and in the definition sentence.
 *
 * `seatLabel` is the active campaign's own word for the seat it contests, resolved by
 * `CampaignContextService`. Passing it makes the single-valued electoral field read "Ward" for a
 * Toronto council race and "Congressional district" for an Ohio one. It is deliberately NOT applied
 * to `any_electoral_area`, which spans every level at once and so belongs to no single word.
 */
export function ruleFieldLabel(field: string, seatLabel?: string | null): string {
  if (field === ELECTORAL_AREA_FIELD && seatLabel) return seatLabel;
  return RULE_FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

/** The stored value rendered the way the picker showed it ('leaning_against' → 'Leaning against'). */
export function ruleValueLabel(field: string, value: unknown): string {
  const raw = value == null ? '' : String(value);
  return RULE_FIELD_CHOICES[field]?.find((c) => c.value === raw)?.label ?? raw;
}
