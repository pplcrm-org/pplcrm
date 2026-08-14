import { z } from 'zod';

import type { SupportLevel, VotingStatus } from './campaigns.schema';
import { MapViewportObj, idSchema, nameSchema, notesSchema } from './core.schema';

/**
 * Canvassing §13 schemas. The turf/knock status vocabularies are `as const` so
 * they drive both Zod validation and exhaustive discriminated-union switches on
 * the frontend and in the controller.
 */

/** Stored turf lifecycle. Display state ("In field now") is derived from knocks. */
export const TURF_STATUSES = ['draft', 'active', 'retired'] as const;
export type TurfStatus = (typeof TURF_STATUSES)[number];

/**
 * What happened at the door. "attempted" = any knock except `cleared`;
 * "conversation" = a talk. `moved` is recordable for one person or for the whole door
 * (nobody by that name lives here anymore); `deceased` and `data_error` are person-level
 * corrections to the file rather than reports of a visit, but they are still knocks — the
 * canvasser stood there. `cleared` is the append-only "door outcome toggled off" marker —
 * the latest outcome knock wins, and `cleared` means the door is back on the list.
 */
export const KNOCK_OUTCOMES = [
  'conversation',
  'no_answer',
  'not_home',
  'moved',
  'refused',
  'inaccessible',
  'deceased',
  'data_error',
  'cleared',
] as const;
export type KnockOutcome = (typeof KNOCK_OUTCOMES)[number];

/**
 * The voter's stance, when a conversation happened — the spec §3.5 five-option
 * support scale. `not_voting`/`already_voted` feed `voting_status` rather than
 * `support_level` on campaign_person_facts.
 */
export const KNOCK_RESPONSES = ['supporter', 'undecided', 'non_supporter', 'not_voting', 'already_voted'] as const;
export type KnockResponse = (typeof KNOCK_RESPONSES)[number];

/**
 * Staff-facing labels for what happened at a door. `cleared` is the append-only
 * marker a volunteer files when undoing an outcome, so it reads as "reset" rather
 * than as a visit.
 */
export const KNOCK_OUTCOME_LABELS: Record<KnockOutcome, string> = {
  conversation: 'Talked',
  no_answer: 'No answer',
  not_home: 'Not home',
  moved: 'Moved',
  refused: 'Refused',
  inaccessible: "Couldn't reach",
  deceased: 'Deceased',
  data_error: 'Error in data',
  cleared: 'Result cleared',
};

/** Survey labels for the five support options (sentence case, spec §3.5). */
export const KNOCK_RESPONSE_LABELS: Record<KnockResponse, string> = {
  supporter: 'Supporter',
  undecided: 'Undecided',
  non_supporter: 'Non-supporter',
  not_voting: 'Not voting',
  already_voted: 'Already voted',
};

/**
 * The three-way read a walk list is coloured by.
 *
 * Deliberately coarser than either `SUPPORT_LEVELS` (six) or `KNOCK_RESPONSES` (five): at a
 * doorstep, on a phone, in the sun, the only question the colour answers is "is this a
 * friendly door". Both vocabularies collapse into it here so the map, the list and the
 * household card can never disagree about what "leaning" looks like.
 */
export type CanvassStance = 'supporter' | 'undecided' | 'non_supporter';

export const SUPPORT_LEVEL_TO_STANCE: Record<SupportLevel, CanvassStance> = {
  strong: 'supporter',
  leaning: 'supporter',
  neutral: 'undecided',
  undecided: 'undecided',
  leaning_against: 'non_supporter',
  against: 'non_supporter',
};

/** `not_voting`/`already_voted` are turnout facts, not stances, so they map to nothing. */
export const KNOCK_RESPONSE_TO_STANCE: Partial<Record<KnockResponse, CanvassStance>> = {
  supporter: 'supporter',
  undecided: 'undecided',
  non_supporter: 'non_supporter',
};

/** Ballot already cast — the green check on a walk-list row. */
export const VOTED_STATUSES: readonly VotingStatus[] = ['voted_advance', 'voted_eday'];

/** Doors-per-turf presets from the Cut-new-turfs dialog. */
export const DOORS_PER_TURF_PRESETS = [30, 40, 50, 60] as const;

export const turfStatusSchema = z.enum(TURF_STATUSES);
export const knockOutcomeSchema = z.enum(KNOCK_OUTCOMES);
export const knockResponseSchema = z.enum(KNOCK_RESPONSES);

export const AddTurfObj = z.object({
  /** Campaigns §15 — the context this turf is knocked for; backend defaults to the office. */
  campaign_id: idSchema.optional(),
  name: nameSchema('Name', 120),
  list_id: idSchema.nullable().optional(),
  notes: notesSchema,
});

export const UpdateTurfObj = z.object({
  name: nameSchema('Name', 120).optional(),
  status: turfStatusSchema.optional(),
  notes: notesSchema,
});

/** Preview and Cut share this input; preview never writes. */
export const CutTurfsObj = z.object({
  list_id: idSchema,
  doors_per_turf: z.number().int().min(5).max(500),
});

export const AssignTurfObj = z.object({
  turf_id: idSchema,
  team_id: idSchema.nullable().optional(),
  /**
   * The person this Companion link belongs to. Required: the companion access
   * layer verifies the holder against this person's email/mobile on file, so
   * an assignment without a person produces a link nobody can open.
   */
  volunteer_person_id: idSchema,
});

/**
 * Take one volunteer off a turf. Scoped to the person rather than the turf because
 * a turf can hold several canvassers, and removing one must leave the rest walking.
 */
export const RemoveCanvasserObj = z.object({
  turf_id: idSchema,
  volunteer_person_id: idSchema,
});

export const FieldReportRangeObj = z.object({
  range: z.enum(['today', 'yesterday', 'week', 'month', 'campaign', 'custom']).default('week'),
  from: z.string().datetime().nullable().optional(),
  to: z.string().datetime().nullable().optional(),
});

/**
 * Most doors the coverage map draws one by one.
 *
 * Each door is a marker, and a marker is a DOM node. A campaign that has cut its whole riding into
 * turfs has as many doors as it has households — 35,000 or more for an Ontario provincial seat —
 * which no browser draws smoothly and nobody could read if it did.
 *
 * Past this many inside the rectangle on screen, the coverage answer carries no individual doors at
 * all. What it always carries instead is one outline per turf with that turf's exact counts, so the
 * zoomed-out map is a true picture of how far each turf has been walked rather than a sample of
 * whichever doors happened to be sent. Zooming in shrinks the rectangle until the doors come back.
 */
export const COVERAGE_MAX_DOORS = 2_000;

/**
 * What the coverage screen asks for: a date range for the knock counts, and optionally the
 * rectangle the map is showing. No rectangle means the first load, before the map has framed
 * itself; then the whole workspace is the rectangle.
 */
export const CoverageRequestObj = FieldReportRangeObj.extend({
  viewport: MapViewportObj.nullable().optional(),
});
export type CoverageRequestType = z.infer<typeof CoverageRequestObj>;

/**
 * Companion knock payload. Arrives over the tokenised public route (no account),
 * so the token authorises the turf and `client_knock_id` de-dupes offline
 * re-sends. Parsed from `unknown` at the REST boundary.
 */
export const LogKnockObj = z.object({
  token: z.string().min(10).max(200),
  client_knock_id: z.string().min(1).max(200),
  household_id: idSchema,
  person_id: idSchema.nullable().optional(),
  outcome: knockOutcomeSchema,
  response: knockResponseSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  canvasser_name: z.string().trim().max(120).nullable().optional(),
  knocked_at: z.string().datetime().nullable().optional(),
});

export function isTurfStatus(v: unknown): v is TurfStatus {
  return typeof v === 'string' && (TURF_STATUSES as readonly string[]).includes(v);
}

export function isKnockOutcome(v: unknown): v is KnockOutcome {
  return typeof v === 'string' && (KNOCK_OUTCOMES as readonly string[]).includes(v);
}

/**
 * `turf_knocks.response` is a plain text column and this vocabulary has changed once
 * already, so a stored row can hold a word the union no longer names. Narrow rather than
 * cast: an unrecognized value reads as "no stance recorded", which is the truth about it.
 */
export function isKnockResponse(v: unknown): v is KnockResponse {
  return typeof v === 'string' && (KNOCK_RESPONSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Companion batched results (spec §3.5/§5) — POST /api/canvass/t/:token/results
// ---------------------------------------------------------------------------

/**
 * A full survey (spec §3.5). `person_id` null = the anonymous household-level
 * survey. `support` is the one required field — EXCEPT that a save carrying only
 * "Do not contact" or only "65 or older" is still a save worth keeping, which the
 * refine below encodes. Any of the three is a fact learned at the door.
 */
export const CompanionSurveyObj = z
  .object({
    household_id: idSchema,
    person_id: idSchema.nullable().optional(),
    support: knockResponseSchema.nullable().optional(),
    issues: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    wants_volunteer: z.boolean().default(false),
    wants_yard_sign: z.boolean().default(false),
    /**
     * "…and I gave them one just now" — only meaningful alongside `wants_yard_sign`.
     *
     * A canvasser walking with signs in the car asks and hands one over in the same thirty
     * seconds. Making that two round trips (save the survey, wait for the sign request to
     * exist, tap again) is two chances to lose it at a doorstep, so the request is created
     * and marked delivered in one transaction. Not stored on the knock: the delivery record
     * is the truth about the sign, and re-opening the survey reads it from there.
     */
    yard_sign_delivered: z.boolean().default(false),
    set_dnc: z.boolean().default(false),
    /** 65 or older — person-level only; a household has no age. */
    senior: z.boolean().default(false),
    contact_phone: z.string().trim().max(40).nullable().optional(),
    contact_email: z.string().trim().email().max(200).nullable().optional(),
    subscribe: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.support != null || v.set_dnc || v.senior, { message: 'Pick a support level to save' });

/**
 * One-tap codes for a person when there was no survey to record (spec §3.5).
 *
 * `deceased` and `data_error` are corrections to the file rather than reports of a visit,
 * but they arrive the same way and are logged the same way. `note` exists for `data_error`
 * alone — "what is wrong here" is the whole content of that report, and a flag with no
 * explanation gives the organizer nothing to act on.
 */
export const CompanionPersonResultObj = z.object({
  household_id: idSchema,
  person_id: idSchema,
  result: z.enum(['not_home', 'moved', 'refused', 'deceased', 'data_error']),
  note: z.string().trim().max(2000).nullable().optional(),
});

/**
 * Door-level outcome (spec §3.4 quick actions).
 *
 * `moved` at the DOOR means "nobody on this list lives here anymore" — distinct from the
 * person-level `moved`, which means one named resident left a household that still exists.
 */
export const CompanionDoorOutcomeObj = z.object({
  household_id: idSchema,
  outcome: z.enum(['no_answer', 'inaccessible', 'refused', 'moved']),
});

export const CompanionClearOutcomeObj = z.object({
  household_id: idSchema,
});

/** "+ Add someone at this door" (spec §3.4). */
export const CompanionPersonCreateObj = z.object({
  household_id: idSchema,
  name: z.string().trim().min(1).max(120),
});

/**
 * The canvasser handed over the yard sign this door had asked for — or took that back.
 *
 * Door-level, because the sign goes in the lawn rather than to a person. It writes the same
 * `delivered` status a delivery driver writes, and routes through the pending route stop
 * when there is one, so a driver is never sent to a house whose sign is already there.
 */
export const CompanionYardSignObj = z.object({
  household_id: idSchema,
  delivered: z.boolean(),
});

const companionOpBase = {
  /** Client-generated UUID — the idempotency key (companion_ops ledger). */
  op_id: z.string().min(8).max(100),
  /** On-device timestamp so offline results keep their true door time. */
  recorded_at: z.string().datetime().nullable().optional(),
};

export const CompanionOpObj = z.discriminatedUnion('type', [
  z.object({ ...companionOpBase, type: z.literal('survey'), payload: CompanionSurveyObj }),
  z.object({ ...companionOpBase, type: z.literal('person_result'), payload: CompanionPersonResultObj }),
  z.object({ ...companionOpBase, type: z.literal('door_outcome'), payload: CompanionDoorOutcomeObj }),
  z.object({ ...companionOpBase, type: z.literal('clear_outcome'), payload: CompanionClearOutcomeObj }),
  z.object({ ...companionOpBase, type: z.literal('person_create'), payload: CompanionPersonCreateObj }),
  z.object({ ...companionOpBase, type: z.literal('yard_sign'), payload: CompanionYardSignObj }),
]);

/**
 * Most ops the server accepts in one results POST. The phone slices its outbound batch to this
 * same number — a queue past the cap used to send the whole thing, be rejected by this schema,
 * and re-send the identical over-limit body forever (REVIEW6 T2-16a).
 */
export const COMPANION_OPS_MAX_PER_BATCH = 200;

export const CompanionResultsObj = z.object({
  ops: z.array(CompanionOpObj).min(1).max(COMPANION_OPS_MAX_PER_BATCH),
});

/**
 * "I'm taking Scott Blvd" — POST /api/canvass/turf/:turfId/segment.
 *
 * `street_key` null releases whatever this volunteer held and means "I'm walking the whole
 * turf again". `street` is the spelling to show the rest of the group; the key is what
 * matches, so the two are sent together rather than the server re-deriving one from the
 * other and risking a mismatch with `segmentKeyOf`.
 */
export const CompanionClaimSegmentObj = z.object({
  street_key: z.string().trim().max(200).nullable(),
  street: z.string().trim().max(200).nullable().optional(),
});
export type CompanionClaimSegmentType = z.infer<typeof CompanionClaimSegmentObj>;

export type CompanionSurveyType = z.infer<typeof CompanionSurveyObj>;
export type CompanionOpType = z.infer<typeof CompanionOpObj>;
export type CompanionResultsType = z.infer<typeof CompanionResultsObj>;

/**
 * Everything an op hands back to the device beyond "it happened".
 *
 * Kept as an open record rather than a single column so the ledger that stores it
 * (`companion_ops.result`, jsonb) never needs another migration when a future op type
 * has to return an id of its own. Parsed on the way out of the ledger, so a row written
 * by an older or newer build degrades to "returned nothing" instead of throwing.
 */
export const CompanionOpResultObj = z.object({
  /** For person_create: the real id to swap in for the client's temp person. */
  person_id: idSchema.optional(),
  /**
   * The op applied, but one best-effort side effect did not — e.g. a survey's "I handed them a
   * sign" when another campaign holds the household's sign request. Shown to the volunteer once;
   * the op itself still counts as success.
   */
  warning: z.string().optional(),
});
export type CompanionOpResultType = z.infer<typeof CompanionOpResultObj>;

/** Per-op server acknowledgement — `duplicate` means "already applied, treat as success". */
export interface CompanionOpAck extends CompanionOpResultType {
  op_id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
}

// ------------------------------------------------------------------------
// Companion GET payload (spec §3, §5) — shared by backend + apps/companion.
// Payload minimization is an acceptance criterion: names, walk data and prior
// door RESULTS only — never emails, phones, donation history, or notes.
// ------------------------------------------------------------------------

/**
 * How far back a door still reads as "recently canvassed" on the Companion's door screen.
 *
 * Long enough that a second pass over the same universe finds the first pass, short enough
 * that "someone was here" is still a fact about this campaign rather than about last year.
 */
export const RECENT_KNOCK_WINDOW_DAYS = 30;

/**
 * The most recent visit to this door inside `RECENT_KNOCK_WINDOW_DAYS`, from ANY turf in the
 * same campaign — not just the turf the volunteer is holding.
 *
 * Two doors of one building, two turfs over the same street, or a second pass a fortnight
 * later all mean the same thing to the person standing there: somebody already came. The
 * name and the time are what let them decide whether to knock anyway, so both travel; the
 * conversation flag is here because "knocked and got no answer" and "had a conversation"
 * are different facts and one sentence must not claim the other.
 */
export interface CompanionLastKnock {
  /** Name recorded on the knock. Null when the row carried none — reads as "Someone". */
  canvasser_name: string | null;
  /** True when that visit was a conversation, false for any other recorded outcome. */
  conversation: boolean;
  /** ISO 8601 timestamp of the visit. */
  at: string;
}

/**
 * Where this door's yard sign has got to, when it has a request at all.
 *
 * `requested` covers both of the pre-delivery statuses a request can hold (waiting for
 * triage, and approved for routing): the difference is an office matter and changes nothing
 * a canvasser standing on the lawn can do. `delivered` is the same status a delivery driver
 * writes, so the two apps and the CRM cannot disagree about whether the sign arrived.
 */
export interface CompanionYardSign {
  status: 'requested' | 'delivered';
  /** ISO 8601 timestamp the request was made. Null when the row carried no created date. */
  requested_at: string | null;
}

/** Pre-fill for re-editing a surveyed person/door. Deliberately excludes notes + contact info. */
export interface CompanionSurveyPrefill {
  support: KnockResponse | null;
  issues: string[];
  wants_volunteer: boolean;
  wants_yard_sign: boolean;
  set_dnc: boolean;
  subscribe: boolean;
}

export type CompanionPersonResult = 'canvassed' | 'not_home' | 'moved' | 'refused' | 'deceased' | 'data_error';

export interface CompanionPerson {
  id: string;
  /** "Heather Gagnon" — the full name, because at a door the surname is half the identification. */
  name: string;
  /**
   * Sent alongside `name` so the walk list can collapse a shared surname ("Heather & Ross
   * Gagnon") instead of printing it twice on a phone-width row. Null when there is none.
   */
  last_name: string | null;
  /** Suppressed from all outreach — card renders dimmed and non-interactive. */
  dnc: boolean;
  /**
   * Support and turnout as the CRM knows them coming in — from ANY source (a phone bank,
   * an import, an earlier canvass), not just this turf's knocks.
   *
   * This is the one deliberate widening of payload minimization: a paper walk list has
   * always carried prior ID, it is the entire reason a canvasser prioritizes one door over
   * another, and "already voted" is essentially never something the door team recorded
   * themselves. Still no emails, phones, donations, or notes.
   */
  support: SupportLevel | null;
  voting_status: VotingStatus | null;
  /** Reported dead. The card is read-only and says so rather than quietly disappearing. */
  deceased: boolean;
  /** 65 or older, where somebody has said. Null = never asked. */
  senior: boolean | null;
  result: CompanionPersonResult | null;
  survey: CompanionSurveyPrefill | null;
}

export type CompanionDoorOutcome = 'no_answer' | 'inaccessible' | 'refused' | 'moved';

export interface CompanionHousehold {
  id: string;
  walk_order: number;
  address: string;
  /**
   * The address parts, alongside the flattened `address` rather than instead of it.
   *
   * `households.street_num` and `street1` are separate real columns; the payload used to
   * flatten them and throw the pieces away, which meant a volunteer standing on one
   * street could not scope the list to it. Additive and back-compatible — `address` is
   * still what every card renders.
   */
  street: string | null;
  street_num: string | null;
  /**
   * Unit/suite, when this door is one of many in a building.
   *
   * Apartments are ordinary household rows that happen to share a street number, so the
   * companion groups them back into one building row and opens the unit list on tap —
   * fifty rows that all read "58 Huron Avenue" is not a walk list.
   */
  apt: string | null;
  lat: number | null;
  lng: number | null;
  /** Whole-door do-not-contact (every resident is DNC) — skip, but it still counts. */
  dnc: boolean;
  /**
   * This door's yard sign, or null when nobody has asked for one.
   *
   * Carries the delivered state as well as the open one so a canvasser can hand a sign over
   * and see it confirmed, and so a door that already has its sign says so instead of
   * showing a request that looks outstanding.
   */
  yard_sign: CompanionYardSign | null;
  door_outcome: CompanionDoorOutcome | null;
  /** The anonymous household-level survey, when one was recorded. */
  hh_survey: CompanionSurveyPrefill | null;
  /** The last time anyone canvassed this door, if it was inside the recent window. */
  last_knock: CompanionLastKnock | null;
  people: CompanionPerson[];
}

/** One turf offered in the companion's picker. */
export interface CompanionTurfChoice {
  turf_id: string;
  name: string;
  /**
   * The area this turf covers — 'Ward 12', 'Poll 043'. Null means the turf has no area of its
   * own: no boundary map applied when it was cut, or its doors fell outside every area of the
   * map used; either way the doors were grouped on geography alone. The picker deliberately
   * shows nothing in its place (no blank line, no "unbounded" note): an area name is a locator
   * there, and how a turf was cut is the organizer's business, not something a volunteer at a
   * door can act on.
   */
  boundary_name: string | null;
  doors: number;
  attempted: number;
  /** Volunteers already walking it — joining a busy turf is the group-canvass case. */
  canvassers: number;
  centroid_lat: number | null;
  centroid_lng: number | null;
  /** Which campaign it belongs to — shown only when the picker spans more than one. */
  campaign_name: string | null;
}

export interface CompanionTurfChoices {
  /** Whether this volunteer may self-claim; decides if `available` is shown at all. */
  may_roam: boolean;
  mine: CompanionTurfChoice[];
  available: CompanionTurfChoice[];
  /**
   * The word for one boundary area — 'Polling division', 'Precinct', 'Ward', 'Riding'.
   *
   * The companion has no signed-in user and therefore no campaign context of its own, so the word
   * has to travel with the payload. It is resolved once for the workspace rather than per turf:
   * the picker uses it for a single heading ("Turfs are listed by polling division"), and a
   * workspace running races in two different jurisdictions at once is not a case this heading
   * tries to serve.
   */
  boundary_label: string;
  /** Plural of the same word. */
  boundary_label_plural: string;
}

/**
 * Somebody else is already on this street.
 *
 * Advisory in the strongest sense: nothing on the server or the client treats a claim as
 * permission, and every door stays knockable by everyone. It exists so that five people
 * splitting one turf can see how it has been split, instead of discovering it at a door
 * someone already knocked.
 */
export interface CompanionSegmentClaim {
  /** Matches `segmentKeyOf(household)` — the normalized street. */
  street_key: string;
  /** The spelling to display, as the claiming volunteer's doors spell it. */
  street: string;
  canvasser_name: string;
  claimed_at: string;
  /** This device's own claim, so the UI can say "You're here" instead of naming them. */
  mine: boolean;
}

export interface CompanionTurfPayload {
  campaign_name: string;
  /**
   * Which turf this is. The companion posts results against it once the device has a
   * session, so switching turfs never needs another capability link (turf tokens are
   * hashed and can't be handed back out).
   */
  turf_id: string;
  turf_name: string;
  /** Whose name results save under — the assignment's volunteer. */
  canvasser_name: string;
  /** Collapsible door script (campaign-configured; empty string = none). */
  script: string;
  /** Issue-chip vocabulary (campaign-configured). */
  issues: string[];
  expires_at: string | null;
  households: CompanionHousehold[];
  /** Who else is on which street right now. Empty when nobody has claimed anything. */
  segment_claims: CompanionSegmentClaim[];
}

/** Staff-configured survey vocabulary (campaigns.canvass_issues/script). */
export const UpdateCompanionSettingsObj = z.object({
  campaign_id: idSchema.optional(),
  issues: z.array(z.string().trim().min(1).max(80)).max(30),
  script: z.string().trim().max(4000).nullable(),
});
export type UpdateCompanionSettingsType = z.infer<typeof UpdateCompanionSettingsObj>;
