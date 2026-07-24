// tsco:ignore
/* eslint-disable @typescript-eslint/no-explicit-any */
//
// ====================================================================
// When adding a new table, you have to  :-
// 1. Add a model and add it to the interface Models

// ====================================================================
import type {
  ColumnType,
  Insertable,
  OperandValueExpressionOrList,
  SelectExpression,
  Selectable,
  Updateable,
} from 'kysely';
import type { EmailStatus } from './emails';
import type { z } from 'zod';
import type { addressSchema } from './schema';

export type Keys<T> = keyof T;
type Json = ColumnType<JsonValue, string, string>;
type JsonArray = JsonValue[];
type JsonObject = { [K in string]?: JsonValue };
type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonArray | JsonObject | JsonPrimitive;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U> ? ColumnType<S, I | undefined, U> : ColumnType<T, T | undefined, T>;

export interface Models {
  authusers: AuthUsers;
  campaign_person_facts: CampaignPersonFacts;
  campaign_subscriptions: CampaignSubscriptions;
  campaigns: Campaigns;
  email_suppressions: EmailSuppressions;
  households: Households;
  map_campaigns_users: MapCampaignsUsers;
  map_households_tags: MapHouseholdsTags;
  map_peoples_tags: MapPeoplesTags;
  map_roles_users: MapRolesUsers;
  lists: Lists;
  map_lists_persons: MapListsPersons;
  map_lists_households: MapListsHouseholds;
  teams: Teams;
  map_teams_persons: MapTeamsPersons;
  map_teams_lists: MapTeamsLists;
  map_newsletters_lists: MapNewslettersLists;
  map_web_forms_lists: MapWebFormsLists;
  tasks: Tasks;
  persons: Persons;
  profiles: Profiles;
  roles: Roles;
  sessions: Sessions;
  tags: Tags;
  tenants: Tenants;
  workspace_api_keys: WorkspaceApiKeys;
  settings: Settings;
  donations: Donations;
  donation_periods: DonationPeriods;
  donation_pledges: DonationPledges;
  emails: Emails;
  newsletters: Newsletters;
  newsletter_templates: NewsletterTemplates;
  newsletter_events: NewsletterEvents;
  newsletter_send_log: NewsletterSendLog;
  newsletter_content_checks: NewsletterContentChecks;
  person_newsletter_engagements: PersonNewsletterEngagements;
  email_comments: EmailComments;
  email_bodies: EmailBodies;
  email_headers: EmailHeaders;
  email_recipients: EmailRecipients;
  email_attachments: EmailAttachments;
  email_drafts: EmailDrafts;
  email_trash: EmailTrash;
  email_read_states: EmailReadStates;
  task_comments: TaskComments;
  task_subtasks: TaskSubtasks;
  task_attachments: TaskAttachments;
  user_activity: UserActivity;
  ms_oauth_tokens: MsOauthTokens;
  google_oauth_tokens: GoogleOauthTokens;
  data_imports: DataImports;
  companies: Companies;
  files: Files;
  bug_reports: BugReports;
  notifications: Notifications;
  volunteer_events: VolunteerEvents;
  volunteer_shifts: VolunteerShifts;
  events: Events;
  event_ticket_types: EventTicketTypes;
  event_registrations: EventRegistrations;
  web_forms: WebForms;
  form_submissions: FormSubmissions;
  background_jobs: BackgroundJobs;
  webhook_events: WebhookEvents;
  ops_heartbeats: OpsHeartbeats;
  data_exports: DataExports;
  potential_duplicates: PotentialDuplicates;
  dismissed_duplicate_groups: DismissedDuplicateGroups;
  workflows: Workflows;
  workflow_steps: WorkflowSteps;
  workflow_enrollments: WorkflowEnrollments;
  workflow_runs: WorkflowRuns;
  person_connections: PersonConnections;
  passkeys: Passkeys;
  zapier_subscriptions: ZapierSubscriptions;
  turfs: Turfs;
  turf_households: TurfHouseholds;
  turf_assignments: TurfAssignments;
  turf_knocks: TurfKnocks;
  delivery_requests: DeliveryRequests;
  delivery_routes: DeliveryRoutes;
  delivery_route_stops: DeliveryRouteStops;
  companion_volunteers: CompanionVolunteers;
  companion_sessions: CompanionSessions;
  companion_ops: CompanionOps;
}

export type AuthUsersType = Omit<AuthUsers, 'id'> & { id: string };

export type GetOperandType<
  T extends Keys<TablesOperationMap>,
  Op extends Keys<TablesOperationMap[T]>,
  Key extends Keys<TablesOperationMap[T][Op]>,
> = unknown extends TablesOperationMap[T][Op][Key]
  ? never
  : TablesOperationMap[T][Op][Key] extends never
    ? never
    : TablesOperationMap[T][Op][Key];

export type OperationDataType<
  T extends Keys<Models>,
  Op extends 'select' | 'update' | 'insert',
> = TablesOperationMap[T][Op];

export type TypeId<T extends keyof Models> = string & { _table?: T };
export type TypeTenantId<T extends keyof Models> = string & { _table?: T };

type ExtractTableAlias<DB, TE> = TE extends `${string} as ${infer TA}`
  ? TA extends keyof DB
    ? TA
    : never
  : TE extends keyof DB
    ? TE
    : never;

export type TypeColumn<T extends keyof Models, U> = OperandValueExpressionOrList<
  Models,
  ExtractTableAlias<Models, T>,
  U
>;
export type TypeTableColumns<T extends keyof Models> = T extends keyof Models
  ? SelectExpression<Models, ExtractTableAlias<Models, T>>
  : never;

export type TablesOperationMap = {
  [K in Keys<Models>]: {
    select: Selectable<Models[K]>;
    insert: Insertable<Models[K]> & { tenant_id: string };
    update: Updateable<Models[K]>;
  };
};

export type TypeColumnValue<TTable extends keyof Models, TColumn extends keyof Models[TTable]> = UnwrapSelect<
  Models[TTable][TColumn]
>;

/*
type TableType = {
  [K in Keys<Models>]: K;
};
*/

// ====================================================================
// The following are the type definitions for the database schema
// Since I use a base controller to handle the CRUD operations, I don't
// know the exact type of the table until runtime. So I use the following
// type definitions to help me out.
// ====================================================================
interface RecordType {
  id: Generated<string>;
  tenant_id: string;
  createdby_id: string;
  updatedby_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
interface JunctionRecordType {
  tenant_id: string;
  createdby_id: string;
  updatedby_id: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}
export type AddressType = z.infer<typeof addressSchema>;

interface AuthUsers extends RecordType {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  password_reset_code: string | null;
  // TODO: move to Sessions
  password_reset_code_created_at: Timestamp | null;
  role: string | null;
  verified: boolean;
  two_factor_enabled: boolean;
  two_factor_code: string | null;
  two_factor_expires_at: Timestamp | null;
  two_factor_attempts: Generated<number>;
  deletion_scheduled_at: Timestamp | null;
  /** Admin deactivation: set = can't sign in until an admin/owner reactivates. NULL = active. */
  deactivated_at: Timestamp | null;
  previous_email: string | null;
  previous_role: string | null;
  passkey_setup_dismissed_at: Timestamp | null;
  /**
   * Campaigns §15 — admin-assigned campaign for Editors/Viewers; NULL = the
   * permanent office context. Ignored for admins/owners (they see every campaign).
   */
  campaign_id: string | null;
}

/** Per-campaign email CONSENT (§15). Address health lives in EmailSuppressions; DNC on Persons. */
interface CampaignSubscriptions extends RecordType {
  campaign_id: string;
  person_id: string;
  email: string;
  /** 'subscribed' | 'pending' (double opt-in) | 'unsubscribed'. Sendable = subscribed. */
  status: Generated<string>;
  /** 'form' (express) | 'import' | 'manual' (implied) | 'copied' (carry-over). */
  consent_source: Generated<string>;
  consent_at: Timestamp | null;
  unsubscribed_at: Timestamp | null;
}

/** Global per-address suppression (§15): a hard bounce / spam complaint kills the address everywhere. */
interface EmailSuppressions {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  reason: string;
  occurred_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

/** Campaign-scoped person facts (§15): support level + voting status. No row / NULL = Unknown. */
interface CampaignPersonFacts extends RecordType {
  campaign_id: string;
  person_id: string;
  support_level: string | null;
  support_source: string | null;
  support_recorded_by: string | null;
  support_recorded_at: Timestamp | null;
  voting_status: string | null;
  voting_source: string | null;
  voting_recorded_by: string | null;
  voting_recorded_at: Timestamp | null;
}

interface Campaigns extends Omit<RecordType, 'createdby_id'> {
  admin_id: string;
  createdby_id: string;
  description: string | null;
  startdate: string | null;
  enddate: string | null;
  name: string;
  notes: string | null;
  /** 'office' = the permanent constituency-office context; 'election' = a time-bounded run. */
  kind: Generated<string>;
  /** 'active' | 'archived' — archived campaigns are read-only history. */
  status: Generated<string>;
  /** Issue-chip vocabulary shown in the canvass companion survey (spec §3.5). */
  canvass_issues: Generated<string[]>;
  /** Door script shown (collapsible) at the top of the companion survey. */
  canvass_script: string | null;
}

export interface Households extends Omit<RecordType, 'createdby_id'>, AddressType {
  /** Provenance only ("first captured in") — households are tenant-wide, never campaign-scoped. */
  campaign_id: string | null;
  createdby_id: string;
  file_id: string | null;
  home_phone: string | null;
  notes: string | null;
  address_fp_street: string | null;
  address_fp_full: string | null;
  is_placeholder?: boolean;
  district: string | null;
  precinct: string | null;
  ward: string | null;
  geocoding_status: string | null;
  /** URL slug, unique per tenant (spec §1). Generated app-side — see lib/slug.ts. */
  slug: string | null;
}

interface MapCampaignsUsers extends Omit<JunctionRecordType, 'createdby_id' | 'updatedby_id'> {
  campaign_id: string;
  user_id: string;
}

interface MapHouseholdsTags extends JunctionRecordType {
  household_id: string;
  tag_id: string;
}

export interface MapPeoplesTags extends JunctionRecordType {
  person_id: string;
  tag_id: string;
  deletable: Generated<boolean>;
}

interface MapRolesUsers extends JunctionRecordType {
  role_id: string;
  user_id: string;
}

interface Teams extends RecordType {
  name: string;
  description: string | null;
  team_captain_id: string | null;
  team_lead_user_id: string | null;
}

interface MapTeamsPersons extends JunctionRecordType {
  team_id: string;
  person_id: string;
}

// Deliveries (spec §14). "routed" is intentionally NOT a column on delivery_requests — it is
// derived from an active (pending) delivery_route_stops row (one source of truth).
export interface DeliveryRequests extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  household_id: string;
  person_id: string | null;
  web_form_id: string | null;
  // 'canvass' = raised at the door via the Canvass Companion survey (spec §3.6). The DB CHECK
  // (migration 2026-07-12-companion-apps.ts) allows it; keep this union in lockstep with that CHECK.
  source: Generated<'web_form' | 'manual' | 'canvass'>;
  status: Generated<'new' | 'approved' | 'declined' | 'delivered'>;
  notes: string | null;
  skip_reason: string | null;
}

export interface DeliveryRoutes extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  status: Generated<'draft' | 'assigned' | 'in_progress' | 'completed' | 'canceled'>;
  volunteer_person_id: string | null;
  start_address: string;
  start_lat: number;
  start_lng: number;
  est_minutes: Generated<number>;
  est_km: Generated<number>;
  scheduled_for: Timestamp | null;
  // Only the sha256 hash of the raw capability token is ever stored; the raw token is returned once.
  share_token_hash: string | null;
  share_token_expires_at: Timestamp | null;
  params: Generated<Json>;
}

export interface DeliveryRouteStops extends RecordType {
  route_id: string;
  request_id: string;
  seq: number;
  leg_minutes: Generated<number>;
  status: Generated<'pending' | 'delivered' | 'skipped'>;
  reason: string | null;
  acted_at: Timestamp | null;
  acted_via: 'volunteer_link' | 'staff' | null;
}

interface MapTeamsLists extends JunctionRecordType {
  team_id: string;
  list_id: string;
}

/**
 * Canvassing §13. A turf is a geographic slice of a smart-list universe cut into
 * a walkable door list. `status` is the stored lifecycle only —
 * 'draft' (unassigned) | 'active' (assigned/in the field) | 'retired'. Display
 * state ("In field now", "Complete") and all progress numbers are DERIVED from
 * turf_knocks at read time, never stored here (§22.6).
 */
interface Turfs extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  status: string;
  list_id: string | null;
  target_doors: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  ward: string | null;
  notes: string | null;
}

/** The doors of a turf — one row per household. */
interface TurfHouseholds extends JunctionRecordType {
  turf_id: string;
  household_id: string;
  /** Suggested visiting order (1-based), computed at cut/assign time. A hint, never a lock. */
  walk_order: number | null;
}

/** A turf handed to a team and/or opened via a tokenised Companion link. */
interface TurfAssignments extends RecordType {
  turf_id: string;
  team_id: string | null;
  token: string;
  status: string;
  assigned_at: Timestamp;
  /** The person this link belongs to — the companion access layer verifies against them. */
  volunteer_person_id: string | null;
  /** Optional hard expiry for the capability link (companion access layer). */
  expires_at: Timestamp | null;
}

/**
 * Companion access layer (COMPANION-APPS-PLAN.md §2): one row per (tenant,
 * person) who has ever been sent a companion link. `status` is the approval
 * lifecycle — 'invited' → 'verified' (code confirmed, awaiting admin) →
 * 'approved' | 'revoked'. Approval is per volunteer, not per assignment.
 */
interface CompanionVolunteers {
  id: Generated<string>;
  tenant_id: string;
  person_id: string;
  status: Generated<string>;
  verify_code_hash: string | null;
  verify_code_expires_at: Timestamp | null;
  verify_attempts: Generated<number>;
  verify_channel: 'email' | 'sms' | null;
  verified_at: Timestamp | null;
  approved_by: string | null;
  approved_at: Timestamp | null;
  revoked_at: Timestamp | null;
  createdby_id: string | null;
  updatedby_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** A verified companion device — only the sha256 of the session token is stored. */
interface CompanionSessions {
  id: Generated<string>;
  tenant_id: string;
  volunteer_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * Write-once idempotency ledger for volunteer actions (both companions).
 * Insert ON CONFLICT DO NOTHING; a conflict means "op already applied".
 */
interface CompanionOps {
  tenant_id: string;
  op_id: string;
  scope: 'canvass' | 'deliveries';
  created_at: Generated<Timestamp>;
}

/** One door interaction, synced live from a Canvass Companion. */
interface TurfKnocks extends RecordType {
  turf_id: string;
  household_id: string;
  person_id: string | null;
  outcome: string;
  response: string | null;
  notes: string | null;
  source: string;
  canvasser_name: string | null;
  client_knock_id: string | null;
  knocked_at: Timestamp;
  /** Issue chips picked in the survey (campaign-configured vocabulary). */
  issues: Generated<string[]>;
  /** Follow-up toggles from the survey (spec §3.5). */
  wants_volunteer: Generated<boolean>;
  wants_yard_sign: Generated<boolean>;
  set_dnc: Generated<boolean>;
  /** Contact info captured at the door (also applied to the person if blank there). */
  contact_phone: string | null;
  contact_email: string | null;
  subscribe: Generated<boolean>;
}

export interface MapListsPersons extends JunctionRecordType {
  list_id: string;
  person_id: string;
}

interface MapListsHouseholds extends JunctionRecordType {
  list_id: string;
  household_id: string;
}

/**
 * Normalized newsletter list targeting (replaces the JSONB
 * newsletters.target_lists document as the source of truth). `mode` carries
 * the {include, exclude} split; list_id/newsletter_id cascade on delete.
 */
export interface MapNewslettersLists extends JunctionRecordType {
  newsletter_id: string;
  list_id: string;
  mode: Generated<'include' | 'exclude'>;
}

/**
 * Normalized web-form list targeting (replaces the JSONB
 * web_forms.target_lists document as the source of truth).
 */
export interface MapWebFormsLists extends JunctionRecordType {
  web_form_id: string;
  list_id: string;
}

export interface Persons extends Omit<RecordType, 'createdby_id'> {
  /** Provenance only ("first captured in") — persons are tenant-wide, never campaign-scoped. */
  campaign_id: string | null;
  /** Global compliance override (§15): suppresses contact in every campaign context. */
  do_not_contact: Generated<boolean>;
  /** Channels the DNC applies to ('email' | 'phone' | 'door'); null = all channels. */
  do_not_contact_channels: string[] | null;
  /** Global volunteer standing (§15); null = not a volunteer. Retired the volunteer system tag (2026-07-12). */
  volunteer_status: string | null;
  /** Global staff standing (§15); null = not staff. Retired the staff system tag (2026-07-12). */
  staff_status: string | null;
  household_id: string | null;
  createdby_id: string;
  first_name: string | null;
  middle_names: string | null;
  last_name: string | null;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  home_phone: string | null;
  file_id: string | null;
  company_id: string | null;
  notes: string | null;
  linkedin: string | null;
  twitter: string | null;
  facebook: string | null;
  instagram: string | null;
  assigned_to: string | null;
  preferred_contact: string | null;
  /**
   * Opaque public identifier — 8 Crockford Base32 chars (40 CSPRNG bits),
   * unique per tenant, the canonical person lookup key (spec §1). Generated
   * app-side and NEVER changes — see lib/person-public-id.ts.
   */
  public_id: string | null;
  /**
   * URL display slug `{name}-{xxxx}-{xxxx}` (spec §1: /people/joseph-4t9k-2xpm).
   * The name is decorative; resolution is by public_id. Regenerated on rename,
   * app-side — see lib/person-public-id.ts.
   */
  slug: string | null;
}

interface Profiles extends RecordType, AddressType {
  auth_id: string;
  avatar_file_id: string | null;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  home_phone: string | null;
  /** Typed contract: ProfilePreferencesObj ({ notifications: {...} }). */
  preferences: Json | null;
}

interface Settings extends Omit<RecordType, 'createdby_id' | 'updatedby_id'> {
  key: string;
  value: JsonValue;
  createdby_id: string | null;
  updatedby_id: string | null;
}

export interface Donations extends Omit<RecordType, 'createdby_id' | 'updatedby_id'> {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  person_id: string | null;
  amount: number;
  status: Generated<string>;
  stripe_session_id: string | null;
  /** Stripe PaymentIntent id, used to correlate refund/dispute webhooks back to this gift. */
  stripe_payment_intent_id: string | null;
  /** When a refund or lost chargeback reversed this gift; null while it stands. */
  refunded_at: ColumnType<Date, Date | string, Date | string> | null;
  pledge_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  street: string | null;
  apt: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  method: Generated<string>;
  receipt_sent: Generated<boolean>;
}

export interface DonationPeriods extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  start_date: ColumnType<Date, Date | string, Date | string>;
  end_date: ColumnType<Date, Date | string, Date | string> | null;
  limit_amount: number;
  is_active: Generated<boolean>;
}

export interface DonationPledges extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  person_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  monthly_amount: number;
  status: Generated<string>;
  started_at: Generated<Timestamp>;
  cancelled_at: Timestamp | null;
  next_billing_date: ColumnType<Date, Date | string, Date | string> | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  state: string | null;
  country: string | null;
}

interface Roles extends RecordType {
  name: string;
  description: string | null;
  permissions: Json | null;
}

interface Sessions extends Omit<RecordType, 'createdby_id' | 'updatedby_id' | 'updated_at'> {
  session_id: Generated<string>;
  user_id: string;
  ip_address: string;
  last_accessed: Generated<Timestamp>;
  other_properties: Json | null;
  refresh_token: Generated<string>;
  status: string;
  user_agent: string;
  expires_at: Timestamp | null;
  last_used_at: Timestamp | null;
}

export interface Lists extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  description: string | null;
  object: 'people' | 'households';
  is_dynamic: boolean;
  definition: Json | null;
  last_refreshed_at: Timestamp | null;
  status: Generated<'idle' | 'refreshing' | 'failed'>;
}

export interface Tags extends RecordType {
  name: string;
  description: string | null;
  color: string | null;
  deletable: boolean;
  type: Generated<'tag' | 'issue'>;
}

export interface Tasks extends RecordType {
  name: string;
  details?: string;
  due_at: Timestamp | null;
  /** Canonical vocabulary: TASK_STATUSES in libs/common/src/lib/schemas/tasks.schema.ts. */
  status: 'todo' | 'in_progress' | 'waiting' | 'done' | 'archived' | null;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  completed_at: Timestamp | null;
  position: number | null;
  assigned_to: string | null;
  team_id: string | null;
  file_id: string | null;
  /** Optional link to the contact the task is about — the person the task_sla_breach automation enrolls. */
  person_id: string | null;
  /** Once-only marker: when the hourly scan first found this task past its working-hours SLA target. */
  sla_breached_at: Timestamp | null;
}

// Unlike every other record table, tenants.createdby_id is NULLABLE in the schema — the tenant
// row is created before its first user, and the hard-delete job nulls it to break the
// fk_createdby_id cycle before wiping authusers.
interface Tenants extends Omit<RecordType, 'createdby_id'>, AddressType {
  createdby_id: string | null;
  name: string;
  slug: string | null;
  admin_id: string | null;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  notes: string | null;
  placeholder_household_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  /** Billed Stripe quantity (1-based bracket index — see libs/common/src/lib/billing/plans.ts).
   * Authoritatively synced from the Stripe webhook; defaults to 1. */
  subscription_quantity: number;
  /** Billing interval of the current subscription: 'month' (default) or 'year' (annual = 10×
   * monthly, "2 months free"). Synced from the Stripe price on webhooks. */
  subscription_interval: string;
  subscription_ends_at: Timestamp | null;
  deletion_scheduled_at: Timestamp | null;
  suspended_at: Timestamp | null;
  paused_at: Timestamp | null;
  /** Demo mode: set while the seeded test-drive data is present; NULL = exited/never. */
  demo_mode_at: Timestamp | null;
  /** Automated anti-abuse pause (hard-bounce tripwire): blocks newsletter sending only.
   * Distinct from the user-initiated `paused_at` and the sign-in-blocking `suspended_at`. */
  sending_paused_at: Timestamp | null;
  sending_paused_reason: string | null;
  /** Verified sending phone (E.164) — free tenants must verify one before their first bulk send. */
  sending_phone: string | null;
  sending_phone_verified_at: Timestamp | null;
  pending_phone: string | null;
  phone_verification_code_hash: string | null;
  phone_verification_expires_at: Timestamp | null;
  phone_verification_attempts: Generated<number>;
}

interface WorkspaceApiKeys {
  id: Generated<string>;
  tenant_id: string;
  key_hash: string;
  key_preview: string;
  created_at: Generated<Timestamp>;
  last_used_at: Timestamp | null;
}

interface Emails extends RecordType {
  /** The campaign context this email was synced into (§15). */
  campaign_id: string;
  folder_id: string;
  from_email: string | null;
  /** Display-only cache of the To list; email_recipients is the source of truth (D-10). */
  to_email: string | null;
  subject: string | null;
  preview: string | null;
  assigned_to: string | null;
  is_favourite: boolean;
  deleted_at: Timestamp | null;
  status: EmailStatus | null;
}

interface Newsletters extends RecordType {
  /** The context this newsletter belongs to (§15); recipients are filtered by its consent. */
  campaign_id: string;
  name: string;
  status: string;
  subject: string | null;
  preview_text: string | null;
  audience_description: string | null;
  target_lists: Json | null;
  segments: Json | null;
  total_recipients: Generated<number>;
  delivered_count: Generated<number>;
  bounce_count: Generated<number>;
  open_rate: Generated<number>;
  click_rate: Generated<number>;
  unique_opens: Generated<number>;
  unique_clicks: Generated<number>;
  unsubscribe_count: Generated<number>;
  spam_complaint_count: Generated<number>;
  reply_count: Generated<number>;
  send_date: Timestamp | null;
  last_engagement_at: Timestamp | null;
  summary: string | null;
  html_content: string | null;
  plain_text_content: string | null;
  top_links: Json | null;
  /** Resume point recorded when a send is paused mid-batch (tripwire/rate-cap); NULL otherwise. */
  send_offset: number | null;
  /** Keyset cursor for the batch send: the last email address successfully sent. The worker
   * resumes with `WHERE email > send_cursor` so a live audience change can't skip/duplicate at a
   * batch boundary. NULL before the first batch and after completion. */
  send_cursor: string | null;
  /** The sent newsletter this row is a non-opener follow-up of; NULL for originals. At most
   * one resend per original (partial unique index). */
  resend_of_id: string | null;
}

/** A user-saved newsletter design. Tenant-wide (no campaign_id — pure content, no audience or
 * consent, so it is a shared asset per Campaigns §15). html_content stores the compiled document
 * verbatim, including the PPLCRM_VISUAL_BLOCKS_DATA comment the visual editor round-trips on. */
interface NewsletterTemplates extends RecordType {
  name: string;
  html_content: string;
  plain_text_content: Generated<string>;
}

export interface NewsletterEvents {
  id: Generated<string>;
  tenant_id: string;
  newsletter_id: string;
  email: string;
  event_type: string;
  sg_event_id: string;
  sg_message_id: string | null;
  url: string | null;
  ip: string | null;
  user_agent: string | null;
  /** SendGrid's human-readable failure reason (bounce/dropped events only). */
  reason: string | null;
  /** SendGrid bounce sub-type: 'bounce' = hard, 'blocked' = soft. */
  bounce_type: string | null;
  timestamp: Timestamp;
  created_at: Generated<Timestamp>;
}

/** One row per delivered newsletter batch — SUM(recipient_count) over a window drives the
 * free-tier warm-up cap and the per-tenant hourly send cap in the outbox worker. Automation
 * send_email steps also log here (source 'automation', no newsletter_id) so automated volume
 * counts toward the same caps. */
export interface NewsletterSendLog {
  id: Generated<string>;
  tenant_id: string;
  newsletter_id: string | null;
  recipient_count: number;
  source: Generated<'newsletter' | 'automation'>;
  created_at: Generated<Timestamp>;
}

/** Cached newsletter preflight result, one row per (tenant, content_hash). The composer's
 * on-demand check upserts here and the send-time content gate reuses the row on a hash match. */
export interface NewsletterContentChecks {
  id: Generated<string>;
  tenant_id: string;
  /** Null until a send (or a check on an existing newsletter) ties the content to a row. */
  newsletter_id: string | null;
  /** sha256 hex over the raw stored subject/html/plain-text fields. */
  content_hash: string;
  score: number;
  band: string;
  /** PreflightFinding[] as JSON. */
  findings: unknown;
  /** AiPreflightVerdict as JSON, null when the AI layer was skipped. */
  ai_verdict: unknown | null;
  ai_model: string | null;
  created_at: Generated<Timestamp>;
}

export interface PersonNewsletterEngagements {
  tenant_id: string;
  newsletter_id: string;
  email: string;
  open_count: number;
  click_count: number;
  has_unsubscribed: boolean;
  hard_bounced: boolean;
  soft_bounced: boolean;
  first_opened_at: Timestamp | null;
  last_opened_at: Timestamp | null;
  first_clicked_at: Timestamp | null;
  last_clicked_at: Timestamp | null;
  bounced_at: Timestamp | null;
  unsubscribed_at: Timestamp | null;
}

interface WebForms extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  description: string | null;
  redirect_url: string | null;
  target_tags: Json | null;
  target_lists: Json | null;
  status: 'draft' | 'published' | 'archived';
  fields: Json | null;
  send_confirmation: boolean;
  send_alert: boolean;
  form_type: string;
  type: string | null;
  slug: string;
  submit_label: string | null;
  thanks_title: string | null;
  thanks_body: string | null;
  confirm_subject: string | null;
  confirm_body: string | null;
  notify_team_on: Generated<boolean>;
  archived_at: Timestamp | null;
}

interface FormSubmissions {
  id: Generated<string>;
  tenant_id: string;
  form_id: string;
  person_id: string;
  answers: Json;
  created_at: Generated<Timestamp>;
}

interface EmailComments extends RecordType {
  email_id: string;
  author_id: string;
  comment: string;
}

interface EmailBodies extends RecordType {
  email_id: string;
  body_html: string;
}

interface EmailHeaders extends RecordType {
  email_id: string;
  headers_json: Json | null;
  raw_headers: string | null;
  date_sent: Timestamp | null;
}

interface EmailRecipients extends RecordType {
  email_id: string;
  kind: 'to' | 'cc' | 'bcc';
  name: string | null;
  email: string;
  pos: number;
}

interface EmailAttachments extends RecordType {
  email_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  cid: string | null;
  is_inline: boolean;
  pos: number;
  file_id: string | null;
}

interface EmailDrafts extends RecordType {
  /** The campaign context this draft belongs to (§15). */
  campaign_id: string;
  user_id: string;
  thread_id: string | null;
  to_list: JsonValue | null;
  cc_list: JsonValue | null;
  bcc_list: JsonValue | null;
  subject: string | null;
  body_html: string | null;
  body_delta: JsonValue | null;
  meta: JsonValue | null;
  is_locked: boolean;
}

interface EmailTrash extends RecordType {
  email_id: string;
  from_folder_id: string;
  trashed_at: Timestamp;
}

export interface EmailReadStates {
  tenant_id: string;
  user_id: string;
  email_id: string;
  is_read: boolean;
  created_at: Generated<Timestamp>;
}

interface UserActivity extends RecordType {
  user_id: string;
  activity: string;
  entity: string;
  entity_id: string | null;
  quantity: number;
  metadata: Json | null;
}

interface DataImports extends RecordType {
  file_name: string;
  source: string;
  /**
   * Tag name requested at import time; label of record once the tag is deleted
   * (tag deletion nulls tag_id). While the tag exists, tags.name via tag_id is
   * the source of truth (D-10).
   */
  tag_name: string | null;
  tag_id: string | null;
  row_count: number;
  inserted_count: number;
  error_count: number;
  skipped_count: number;
  households_created: number;
  metadata: Json | null;
  processed_at: Timestamp;
  status: Generated<string>;
  error_message: string | null;
  /** Rows folded into an existing person via the "Merge into existing" duplicate decision (spec §17). */
  merged_count: Generated<number>;
  /** All tags applied by this import (the wizard allows several comma-separated tags, not just the auto tag). */
  tags_applied: Generated<Json>;
  /** Storage key for the retained original upload — kept 90 days so History can offer a re-download. */
  source_file_key: string | null;
  source_file_size: number | null;
  /** Per-row reasons for skipped rows, so History can offer a "download skipped rows" CSV. */
  skip_reasons: Generated<Json>;
}

export interface DataExports {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  entity: string;
  file_name: string;
  status: Generated<'pending' | 'processing' | 'completed' | 'failed'>;
  row_count: number | null;
  storage_key: string | null;
  columns: ColumnType<string[] | null, string | null, string | null>;
  error: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface BackgroundJobs {
  id: Generated<string>;
  tenant_id: string | null;
  queue: Generated<string>;
  status: Generated<string>;
  payload: Json;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  error: string | null;
  run_at: Generated<Timestamp>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/**
 * Global (non-tenant) liveness markers for the in-process background worker. The `ops_watchdog`
 * cron job updates `beat_at` every cycle; `GET /healthz/worker` reports 503 when it goes stale
 * (dead-man's switch for the external availability probe).
 */
export interface OpsHeartbeats {
  name: string;
  beat_at: Generated<Timestamp>;
  details: Json | null;
}

export interface WebhookEvents {
  id: Generated<string>;
  tenant_id: string | null;
  stripe_event_id: string;
  type: string;
  payload: Json;
  status: Generated<string>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  error: string | null;
  run_at: Generated<Timestamp>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  processed_at: Timestamp | null;
}

export interface PotentialDuplicates {
  id: Generated<string>;
  tenant_id: string;
  group_key: string;
  person_id: string | null;
  household_id?: string | null;
  company_id?: string | null;
  reason: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** §9.3 Duplicates: a "Not duplicates" dismissal, keyed by the same `group_key` the nightly
 * sweep uses. No surrogate id — `(tenant_id, group_key)` is the natural primary key. */
export interface DismissedDuplicateGroups {
  tenant_id: string;
  group_key: string;
  dismissed_by_id: string;
  dismissed_at: Generated<Timestamp>;
}

interface MsOauthTokens {
  id: Generated<string>;
  tenant_id: string;
  /** The campaign context this mailbox connection belongs to (§15). */
  campaign_id: string;
  user_id: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: Timestamp;
  ms_email: string | null;
  delta_link: string | null;
  synced_at: Timestamp | null;
  last_sync_error: string | null;
  last_sync_error_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface GoogleOauthTokens {
  id: Generated<string>;
  tenant_id: string;
  /** The campaign context this mailbox connection belongs to (§15). */
  campaign_id: string;
  user_id: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: Timestamp;
  google_email: string | null;
  delta_link: string | null;
  synced_at: Timestamp | null;
  last_sync_error: string | null;
  last_sync_error_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TaskComments extends RecordType {
  task_id: string;
  author_id: string;
  comment: string;
}

export interface TaskSubtasks extends RecordType {
  task_id: string;
  name: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled' | null;
  position: number | null;
}

export interface TaskAttachments extends RecordType {
  task_id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  url: string | null;
}

export interface Companies extends RecordType {
  name: string;
  description: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  notes: string | null;
  /** Typed contract: CompanyEnrichmentObj (Google Places enrichment payload). */
  enrichment: Json | null;
  file_id: string | null;
  /** URL slug, unique per tenant (spec §1). Generated app-side — see lib/slug.ts. */
  slug: string | null;
}

export interface Files {
  id: Generated<string>;
  tenant_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_key: string;
  sha256_hex: string | null;
  uploaded_by: string | null;
  /** Polymorphic link — what this file belongs to (e.g. 'newsletter', 'team'). Null for untethered uploads. */
  entity_type: string | null;
  entity_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

/** User-submitted bug report (fire-and-forget) — stored for the ops record, emailed to OPS_ALERT_EMAIL. */
export interface BugReports {
  id: Generated<string>;
  tenant_id: string;
  created_by: string;
  description: string;
  page_url: string | null;
  user_agent: string | null;
  viewport: string | null;
  screenshot_file_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface Notifications {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface VolunteerEvents extends RecordType {
  name: string;
  description: string | null;
  location_address: string | null;
  start_time: Timestamp;
  end_time: Timestamp;
  capacity: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_private: boolean;
  send_reminder: boolean;
  slug: string;
  send_signup_confirmation: boolean;
  send_volunteer_alert: boolean;
  fields: Generated<string[]>;
}

export interface VolunteerShifts extends RecordType {
  event_id: string;
  person_id: string;
  status: 'signed_up' | 'attended' | 'no_show' | 'cancelled';
  hours_worked: number | null;
  notes: string | null;
}

export interface Events extends RecordType {
  /** The context this record belongs to (Campaigns §15); backfilled to the office. */
  campaign_id: string;

  name: string;
  description: string | null;
  location_address: string | null;
  start_time: Timestamp;
  end_time: Timestamp;
  capacity: number | null;
  contact_email: string | null;
  contact_phone: string | null;
  slug: string;
  is_published: Generated<boolean>;
  send_reminder: Generated<boolean>;
  send_registration_confirmation: Generated<boolean>;
  fields: Generated<string[]>;
}

export interface EventTicketTypes extends RecordType {
  event_id: string;
  name: string;
  description: string | null;
  price_cents: Generated<number>;
  capacity: number | null;
  sort_order: Generated<number>;
}

export interface EventRegistrations extends RecordType {
  event_id: string;
  person_id: string;
  ticket_type_id: string | null;
  status: Generated<'registered' | 'attended' | 'no_show' | 'cancelled'>;
  checked_in_at: Timestamp | null;
  notes: string | null;
}

export interface Workflows extends RecordType {
  name: string;
  description: string | null;
  trigger_type: string;
  status: string;
  trigger_event_id: string | null;
  // Spec §16 ONLY ENROLL IF — a QueryBuilder group node (see core.schema QueryBuilderGroupNode).
  conditions: Json | null;
  /** Sequence-level goals (WorkflowExitCondition[] as jsonb) that end an enrollment early. */
  exit_conditions: Json | null;
}

export interface WorkflowSteps {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  step_number: number;
  delay_days: number;
  delay_unit: 'days' | 'hours';
  // Spec §16: steps are polymorphic. `kind` discriminates; the value each kind carries lives
  // in `config` (send_email uses subject/html/text columns; wait uses delay_days/delay_unit).
  kind: 'wait' | 'send_email' | 'add_tag' | 'create_task' | 'notify_team';
  config: Json | null;
  subject: string | null;
  preview_text: string | null;
  html_content: string | null;
  plain_text_content: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

// Spec §16: one row per executed step (success, failure, or consent skip) — feeds the list's
// RUNS 30D / LAST RUN and the editor's RECENT RUNS. A failed run records the failing step for
// narration; a skipped run records why the recipient was withheld (unsubscribed/suppressed/DNC).
export interface WorkflowRuns {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  enrollment_id: string | null;
  person_id: string | null;
  step_number: number | null;
  step_kind: string | null;
  status: 'success' | 'failed' | 'skipped';
  error: string | null;
  /** First open/click of the automation email this run sent (stamped by the SendGrid event
   * webhook via the workflow_run_id custom arg). Step conditions and exit goals read these. */
  opened_at: Timestamp | null;
  clicked_at: Timestamp | null;
  /** First hard bounce / spam complaint for the automation email this run sent (stamped by the
   * same webhook). The automation abuse tripwires aggregate these per tenant. */
  bounced_at: Timestamp | null;
  spam_reported_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface WorkflowEnrollments {
  id: Generated<string>;
  tenant_id: string;
  workflow_id: string;
  person_id: string;
  status: string;
  current_step_number: number;
  next_run_at: Timestamp | null;
  enrolled_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type RelationType =
  | 'referred_by'
  | 'referred_to'
  | 'close_friend'
  | 'family_member'
  | 'spouse'
  | 'colleague'
  | 'org_affiliation'
  | 'introduced_by'
  | 'introduced_to'
  | 'custom';

export interface PersonConnections extends RecordType {
  from_person_id: string;
  to_person_id: string;
  relation_type: RelationType;
  custom_label: string | null;
  is_mutual: Generated<boolean>;
  notes: string | null;
}

interface Passkeys {
  id: Generated<string>;
  user_id: string;
  tenant_id: string;
  credential_id: string;
  public_key: string;
  counter: Generated<number>;
  device_type: string;
  backed_up: Generated<boolean>;
  transports: string[] | null;
  aaguid: string | null;
  friendly_name: string | null;
  created_at: Generated<Timestamp>;
}

interface ZapierSubscriptions {
  id: Generated<string>;
  tenant_id: string;
  event_type: string;
  webhook_url: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

type UnwrapSelect<T> = T extends ColumnType<infer S, any, any> ? S : T;

type SelectShape<T> = { [K in keyof T]: UnwrapSelect<T[K]> };

export type HouseholdCol = keyof Models['households'];
export type PersonsdCol = keyof Models['persons'];

export type HouseholdWithExtras = SelectShape<Models['households']> & {
  persons_count: number;
  tags: string[] | null;
};
