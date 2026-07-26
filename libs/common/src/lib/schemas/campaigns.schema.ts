import { z } from 'zod';
import { descriptionSchema, idSchema, nameSchema, notesSchema } from './core.schema';

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

export const AddCampaignObj = z.object({
  name: nameSchema('Name', 100),
  description: descriptionSchema(1000),
  notes: notesSchema,
  kind: z.enum(CAMPAIGN_KINDS).default('election'),
  startdate: campaignDateSchema,
  enddate: campaignDateSchema,
});

export const UpdateCampaignObj = z.object({
  name: nameSchema('Name', 100).optional(),
  description: descriptionSchema(1000),
  notes: notesSchema,
  startdate: campaignDateSchema,
  enddate: campaignDateSchema,
});

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
