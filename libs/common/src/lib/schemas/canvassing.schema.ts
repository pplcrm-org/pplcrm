import { z } from 'zod';

import { idSchema, nameSchema, notesSchema } from './core.schema';

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
 * "conversation" = a talk. `moved` is a person-level no-conversation code;
 * `cleared` is the append-only "door outcome toggled off" marker — the latest
 * outcome knock wins, and `cleared` means the door is back on the list.
 */
export const KNOCK_OUTCOMES = [
  'conversation',
  'no_answer',
  'not_home',
  'moved',
  'refused',
  'inaccessible',
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

/** Survey labels for the five support options (sentence case, spec §3.5). */
export const KNOCK_RESPONSE_LABELS: Record<KnockResponse, string> = {
  supporter: 'Supporter',
  undecided: 'Undecided',
  non_supporter: 'Non-supporter',
  not_voting: 'Not voting',
  already_voted: 'Already voted',
};

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

// ---------------------------------------------------------------------------
// Companion batched results (spec §3.5/§5) — POST /api/canvass/t/:token/results
// ---------------------------------------------------------------------------

/**
 * A full survey (spec §3.5). `person_id` null = the anonymous household-level
 * survey. `support` is the one required field — EXCEPT that toggling
 * "Do not contact" alone is saveable, which the refine below encodes.
 */
export const CompanionSurveyObj = z
  .object({
    household_id: idSchema,
    person_id: idSchema.nullable().optional(),
    support: knockResponseSchema.nullable().optional(),
    issues: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    wants_volunteer: z.boolean().default(false),
    wants_yard_sign: z.boolean().default(false),
    set_dnc: z.boolean().default(false),
    contact_phone: z.string().trim().max(40).nullable().optional(),
    contact_email: z.string().trim().email().max(200).nullable().optional(),
    subscribe: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.support != null || v.set_dnc, { message: 'Pick a support level to save' });

/** One-tap no-conversation codes for a person (spec §3.5). */
export const CompanionPersonResultObj = z.object({
  household_id: idSchema,
  person_id: idSchema,
  result: z.enum(['not_home', 'moved', 'refused']),
});

/** Door-level outcome (spec §3.4 quick actions). */
export const CompanionDoorOutcomeObj = z.object({
  household_id: idSchema,
  outcome: z.enum(['no_answer', 'inaccessible', 'refused']),
});

export const CompanionClearOutcomeObj = z.object({
  household_id: idSchema,
});

/** "+ Add someone at this door" (spec §3.4). */
export const CompanionPersonCreateObj = z.object({
  household_id: idSchema,
  name: z.string().trim().min(1).max(120),
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
]);

export const CompanionResultsObj = z.object({
  ops: z.array(CompanionOpObj).min(1).max(200),
});

export type CompanionSurveyType = z.infer<typeof CompanionSurveyObj>;
export type CompanionOpType = z.infer<typeof CompanionOpObj>;
export type CompanionResultsType = z.infer<typeof CompanionResultsObj>;

/** Per-op server acknowledgement — `duplicate` means "already applied, treat as success". */
export interface CompanionOpAck {
  op_id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  error?: string;
  /** For person_create: the real id to swap in for the client's temp person. */
  person_id?: string;
}

// ------------------------------------------------------------------------
// Companion GET payload (spec §3, §5) — shared by backend + apps/companion.
// Payload minimization is an acceptance criterion: names, walk data and prior
// door RESULTS only — never emails, phones, donation history, or notes.
// ------------------------------------------------------------------------

/** Pre-fill for re-editing a surveyed person/door. Deliberately excludes notes + contact info. */
export interface CompanionSurveyPrefill {
  support: KnockResponse | null;
  issues: string[];
  wants_volunteer: boolean;
  wants_yard_sign: boolean;
  set_dnc: boolean;
  subscribe: boolean;
}

export type CompanionPersonResult = 'canvassed' | 'not_home' | 'moved' | 'refused';

export interface CompanionPerson {
  id: string;
  name: string;
  /** Suppressed from all outreach — card renders dimmed and non-interactive. */
  dnc: boolean;
  result: CompanionPersonResult | null;
  survey: CompanionSurveyPrefill | null;
}

export type CompanionDoorOutcome = 'no_answer' | 'inaccessible' | 'refused';

export interface CompanionHousehold {
  id: string;
  walk_order: number;
  address: string;
  lat: number | null;
  lng: number | null;
  /** Whole-door do-not-contact (every resident is DNC) — skip, but it still counts. */
  dnc: boolean;
  door_outcome: CompanionDoorOutcome | null;
  /** The anonymous household-level survey, when one was recorded. */
  hh_survey: CompanionSurveyPrefill | null;
  people: CompanionPerson[];
}

/** One turf offered in the companion's picker. */
export interface CompanionTurfChoice {
  turf_id: string;
  name: string;
  ward: string | null;
  doors: number;
  attempted: number;
  /** Volunteers already walking it — joining a busy turf is the group-canvass case. */
  canvassers: number;
  centroid_lat: number | null;
  centroid_lng: number | null;
}

export interface CompanionTurfChoices {
  /** Whether this volunteer may self-claim; decides if `available` is shown at all. */
  may_roam: boolean;
  mine: CompanionTurfChoice[];
  available: CompanionTurfChoice[];
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
}

/** Staff-configured survey vocabulary (campaigns.canvass_issues/script). */
export const UpdateCompanionSettingsObj = z.object({
  campaign_id: idSchema.optional(),
  issues: z.array(z.string().trim().min(1).max(80)).max(30),
  script: z.string().trim().max(4000).nullable(),
});
export type UpdateCompanionSettingsType = z.infer<typeof UpdateCompanionSettingsObj>;
