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
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  mobile: 'Mobile',
  company_name: 'Company',
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
};

export function ruleFieldLabel(field: string): string {
  return RULE_FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

/** The stored value rendered the way the picker showed it ('leaning_against' → 'Leaning against'). */
export function ruleValueLabel(field: string, value: unknown): string {
  const raw = value == null ? '' : String(value);
  return RULE_FIELD_CHOICES[field]?.find((c) => c.value === raw)?.label ?? raw;
}
