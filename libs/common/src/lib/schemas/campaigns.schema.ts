import { z } from 'zod';
import { descriptionSchema, idSchema, nameSchema, notesSchema } from './core.schema';
import {
  CHAMBERS,
  JURISDICTIONS,
  JURISDICTION_IDS,
  SEAT_TYPES,
  regionsForCountry,
  seatLabelFor,
} from '../jurisdictions';
import type { Chamber, JurisdictionId, SeatType } from '../jurisdictions';

/**
 * Campaigns §15 — a campaign is a *context*: the permanent constituency office
 * ('office') or a time-bounded election run ('election'). Several can be active at
 * once; users pick the one they're working in via the header switcher. Archived
 * campaigns are read-only history.
 */
export const CAMPAIGN_KINDS = ['office', 'election'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

export const CAMPAIGN_STATUSES = ['active', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Plain calendar date (campaigns.startdate/enddate are Postgres `date` columns). */
const campaignDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional();

/**
 * Length caps for the free-text office fields. Region holds a two-letter code with headroom for a
 * longer subdivision code; the rest are display strings, sized to the longest real value plus room.
 * "Beauport—Limoilou" and "Prince Edward—Hastings—Northumberland—Peterborough South" are both real
 * riding names, which is why the seat-name cap is generous.
 */
const OFFICE_REGION_MAX = 10;
const OFFICE_LOCALITY_MAX = 120;
const SEAT_NAME_MAX = 160;
const SEAT_POSITION_MAX = 60;
const SEAT_LABEL_OVERRIDE_MAX = 60;
const OFFICE_TITLE_MAX = 80;

/** Optional office text: trimmed, capped, and accepting both null and an omitted key. */
const officeTextSchema = (max: number) =>
  z.string().trim().max(max, `Use ${max} characters or fewer.`).nullable().optional();

/**
 * How many map areas one seat may be made of.
 *
 * Generous because the real cases vary: most seats are one area, a regional councillor is elected
 * by two or three wards, and a county-wide seat can gather more. The cap exists to stop a paste
 * accident becoming a hundred rows, not to express a rule about elections.
 */
export const SEAT_AREAS_MAX = 25;

/**
 * One area a campaign represents, as the campaign form sends it.
 *
 * `set_id` is the map the name was chosen from, and is null when the name was typed by hand. That
 * is the ordinary case for municipal wards, which most municipalities do not publish, so free text
 * is a first-class answer here rather than a fallback.
 */
export const CampaignAreaInputObj = z.object({
  name: z.string().trim().min(1, 'Name the area.').max(SEAT_NAME_MAX, `Use ${SEAT_NAME_MAX} characters or fewer.`),
  set_id: idSchema.nullable().optional(),
});
export type CampaignAreaInputType = z.infer<typeof CampaignAreaInputObj>;

/**
 * What the campaign form asks for when it wants area names to suggest.
 *
 * Takes the office fields rather than a campaign id, because the form needs suggestions while the
 * campaign is still being created and has no id yet.
 */
export const SeatAreaSuggestionsObj = z.object({
  jurisdiction: z.enum(JURISDICTION_IDS),
  office_region: z.string().trim().max(OFFICE_REGION_MAX).nullable().optional(),
  chamber: z.enum(CHAMBERS).nullable().optional(),
});
export type SeatAreaSuggestionsType = z.infer<typeof SeatAreaSuggestionsObj>;

/** One suggestible area, and which map it came from so the form can say. */
export const SeatAreaSuggestionObj = z.object({
  name: z.string(),
  set_id: z.string(),
  set_label: z.string(),
});
export type SeatAreaSuggestionType = z.infer<typeof SeatAreaSuggestionObj>;

/** One stored area of a campaign, as read back for the form. */
export const CampaignAreaObj = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  /** The map it was chosen from, or null when it was typed by hand. */
  set_id: z.string().nullable(),
});
export type CampaignAreaRowType = z.infer<typeof CampaignAreaObj>;

/**
 * The nine office fields, shared by the add and update shapes so they cannot drift.
 *
 * `jurisdiction` and `seat_type` differ between the two: adding a campaign defaults them (matching
 * the column defaults), while updating leaves them out unless the caller is changing them.
 */
const officeFieldsForAdd = {
  /** Which country and level of government this campaign contests. See libs/common/src/lib/jurisdictions. */
  jurisdiction: z.enum(JURISDICTION_IDS).default('other'),
  /** Province, territory or state code — 'AB', 'OH'. Which one is valid depends on the jurisdiction. */
  office_region: officeTextSchema(OFFICE_REGION_MAX),
  /** Municipality or county, for local races — 'Toronto'. */
  office_locality: officeTextSchema(OFFICE_LOCALITY_MAX),
  /** Upper or lower house. Only US state legislatures need it; their two houses have two maps. */
  chamber: z.enum(CHAMBERS).nullable().optional(),
  /** Whether the seat has its own territory, or is elected across the whole region or locality. */
  seat_type: z.enum(SEAT_TYPES).default('district'),
  /**
   * The seat's official name, and the district printed on a donation tax receipt.
   *
   * NOT the same question as {@link officeFieldsForAdd.seat_areas}, and for a municipal candidate
   * not the same answer: someone running in Ward 12 is still a City of Toronto candidate, and the
   * receipt has to say the city. Asked separately for exactly that reason. Empty for an at-large
   * seat.
   */
  seat_name: officeTextSchema(SEAT_NAME_MAX),
  /**
   * The map areas this campaign represents — what decides whether a door is in its territory.
   *
   * Usually one. Several when one seat is elected by several areas, such as a regional councillor
   * elected by two wards; a door in either is in their territory. Empty for an at-large office,
   * which is elected across a whole city or state rather than by one area of it.
   *
   * Omitted (rather than an empty array) means "leave the areas alone", so an update that only
   * renames a campaign does not silently erase them.
   */
  seat_areas: z.array(CampaignAreaInputObj).max(SEAT_AREAS_MAX).optional(),
  /** Which seat, where one area elects several — 'Position 2', 'Seat B', 'Place 4'. */
  seat_position: officeTextSchema(SEAT_POSITION_MAX),
  /** Overrides the word shown for the seat area everywhere, beating the automatic regional word. */
  seat_label_override: officeTextSchema(SEAT_LABEL_OVERRIDE_MAX),
  /** What the person holding the seat is called — 'MP', 'Councillor', 'State Representative'. */
  office_title: officeTextSchema(OFFICE_TITLE_MAX),
};

const officeFieldsForUpdate = {
  ...officeFieldsForAdd,
  jurisdiction: z.enum(JURISDICTION_IDS).optional(),
  seat_type: z.enum(SEAT_TYPES).optional(),
};

/** The office fields as the cross-field check sees them: every one possibly absent. */
interface CampaignOfficeFields {
  jurisdiction?: JurisdictionId;
  office_region?: string | null;
  office_locality?: string | null;
  chamber?: Chamber | null;
  seat_type?: SeatType;
  seat_name?: string | null;
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

/**
 * Cross-field rules for the office block.
 *
 * These cannot live on the individual fields, because each one is only answerable once you know the
 * jurisdiction: a seat name is required federally in Canada and meaningless for a US Senate race,
 * and a chamber is required in an Arizona legislative race and wrong in every other jurisdiction.
 *
 * On an update, everything here is skipped when `jurisdiction` is absent, so a partial edit that
 * only touches the name or the dates is not forced to restate the office. Sending a jurisdiction
 * does mean restating the office block that goes with it, which is the intent — changing the level
 * of government invalidates the seat that was recorded for the old one.
 *
 * Messages name the jurisdiction's own word for the seat ("Name the riding…", "Name the
 * congressional district…") rather than a field name, so the person reading them recognises the
 * thing being asked for.
 */
function checkOfficeFields(value: CampaignOfficeFields, ctx: z.RefinementCtx): void {
  const jurisdiction = value.jurisdiction;
  if (jurisdiction === undefined) return;

  const spec = JURISDICTIONS[jurisdiction];
  const region = isBlank(value.office_region) ? null : (value.office_region ?? null);
  const seat = seatLabelFor(jurisdiction, region, null).toLowerCase();
  const regionTerm = spec.country === 'CA' ? 'province or territory' : 'state';

  if (value.seat_type === 'at_large') {
    if (!spec.supportsAtLarge) {
      ctx.addIssue({
        code: 'custom',
        path: ['seat_type'],
        message: `There are no at-large seats at this level of government — every seat is contested in a ${seat}. Pick a ${seat} instead.`,
      });
    }
    if (!isBlank(value.seat_name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['seat_name'],
        message: `An at-large seat covers the whole area, so it has no ${seat}. Clear the ${seat} name, or switch this campaign to a specific ${seat}.`,
      });
    }
  }

  // 'other' is exempt: the product does not know what body this is, so it cannot insist the seat
  // has a name. Every modelled jurisdiction can, and a district campaign with no seat has nothing
  // to match households against.
  if (value.seat_type === 'district' && jurisdiction !== 'other' && isBlank(value.seat_name)) {
    ctx.addIssue({
      code: 'custom',
      path: ['seat_name'],
      message: `Name the ${seat} this campaign is contesting.`,
    });
  }

  // A chamber is meaningful only for a district seat: knowing the chamber is what picks which of
  // the two district maps the seat is on. A statewide office — governor, attorney general — is
  // elected across the whole state and sits in no chamber, so demanding one would force a false
  // answer that then feeds boundary-set selection. Like the seat-name rule above, an update that
  // does not send seat_type asserts nothing about the seat, so neither branch fires without one.
  if (spec.usesChamber && value.seat_type === 'district' && value.chamber == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['chamber'],
      message:
        'Choose which chamber this seat is in. The upper and lower chambers are drawn on different maps, so we cannot tell which districts to use without it.',
    });
  }
  if (spec.usesChamber && value.seat_type === 'at_large' && value.chamber != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['chamber'],
      message:
        'A statewide office is elected across the whole state, so it sits in no chamber. Leave the chamber empty.',
    });
  }
  if (!spec.usesChamber && value.chamber != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['chamber'],
      message: 'This level of government has only one elected chamber, so leave the chamber empty.',
    });
  }

  const regionList = regionsForCountry(spec.country);
  if (spec.requiresRegion && region == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['office_region'],
      message: `Choose the ${regionTerm} this campaign runs in.`,
    });
  } else if (region != null && regionList.length > 0 && !regionList.some((r) => r.code === region)) {
    ctx.addIssue({
      code: 'custom',
      path: ['office_region'],
      message: `We do not recognize "${region}". Pick a ${regionTerm} from the list.`,
    });
  }

  if (spec.requiresLocality && isBlank(value.office_locality)) {
    ctx.addIssue({
      code: 'custom',
      path: ['office_locality'],
      message: 'Enter the city, town or county this campaign runs in.',
    });
  }
}

export const AddCampaignObj = z
  .object({
    name: nameSchema('Name', 100),
    description: descriptionSchema(1000),
    notes: notesSchema,
    kind: z.enum(CAMPAIGN_KINDS).default('election'),
    startdate: campaignDateSchema,
    enddate: campaignDateSchema,
    ...officeFieldsForAdd,
  })
  .superRefine(checkOfficeFields);

export const UpdateCampaignObj = z
  .object({
    name: nameSchema('Name', 100).optional(),
    description: descriptionSchema(1000),
    notes: notesSchema,
    startdate: campaignDateSchema,
    enddate: campaignDateSchema,
    ...officeFieldsForUpdate,
  })
  .superRefine(checkOfficeFields);

/**
 * Campaign-scoped person facts (Campaigns §15) — structured concepts, not tags.
 * One row per (campaign, person); a missing row / NULL field is "Unknown".
 * UI copy: Neutral = engaged but indifferent; Undecided = engaged, hasn't
 * decided; Unknown = never asked.
 */
export const SUPPORT_LEVELS = ['strong', 'leaning', 'neutral', 'leaning_against', 'against', 'undecided'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export const SUPPORT_LEVEL_LABELS: Record<SupportLevel, string> = {
  strong: 'Strong',
  leaning: 'Leaning',
  neutral: 'Neutral',
  leaning_against: 'Leaning against',
  against: 'Against',
  undecided: 'Undecided',
};

/** GOTV voting status. Advance voters are struck from later call/knock lists. */
export const VOTING_STATUSES = ['will_vote', 'voted_advance', 'voted_eday', 'not_voting', 'ineligible'] as const;
export type VotingStatus = (typeof VOTING_STATUSES)[number];

export const VOTING_STATUS_LABELS: Record<VotingStatus, string> = {
  will_vote: 'Will vote',
  voted_advance: 'Voted — advance',
  voted_eday: 'Voted — election day',
  not_voting: 'Not voting',
  ineligible: 'Ineligible',
};

export const FACT_SOURCES = ['manual', 'canvass', 'form', 'import', 'carryover'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/** Upsert one person's facts in one campaign. Omitted field = leave unchanged; explicit null = back to Unknown. */
export const UpsertCampaignPersonFactObj = z.object({
  campaign_id: idSchema,
  person_id: idSchema,
  support_level: z.enum(SUPPORT_LEVELS).nullable().optional(),
  voting_status: z.enum(VOTING_STATUSES).nullable().optional(),
});

/**
 * Per-campaign email consent (§15, layer 1 of 3). 'pending' is double opt-in
 * awaiting confirmation. Layers 2 & 3 (address suppressions, person DNC) are
 * global and live elsewhere; sendable = subscribed ∧ not suppressed ∧ not DNC.
 */
export const SUBSCRIPTION_STATUSES = ['subscribed', 'pending', 'unsubscribed'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  subscribed: 'Subscribed',
  pending: 'Pending confirmation',
  unsubscribed: 'Unsubscribed',
};

export const CONSENT_SOURCES = ['form', 'import', 'manual', 'copied'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** Staff-set subscription change; 'pending' is machine-only (double opt-in flow). */
export const SetCampaignSubscriptionObj = z.object({
  campaign_id: idSchema,
  person_id: idSchema,
  status: z.enum(['subscribed', 'unsubscribed']),
});

/**
 * Carry-over (§15): seed a campaign from a prior one. Support levels copy as a
 * starting assumption (source='carryover'); voting status NEVER copies (it is
 * election-specific by definition); subscriptions copy only when the caller has
 * explicitly confirmed the compliance warning (consent_source='copied',
 * original consent_at preserved).
 */
export const CarryOverCampaignObj = z.object({
  source_campaign_id: idSchema,
  target_campaign_id: idSchema,
  copy_support: z.boolean().default(true),
  copy_subscriptions: z.boolean().default(false),
});
