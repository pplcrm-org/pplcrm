import type {
  KnockResponse,
  SupportLevel,
  VotingStatus,
  VolunteerStatus,
  StaffStatus,
} from '../../../../../../libs/common/src';
import type { DemoAttachmentKey } from './demo-attachment-assets';
import type { DemoAreaKey, DemoRouteStartKey, DemoStreetKey, DemoVenueKey } from './demo-data-places';

/**
 * Shapes for the hand-curated demo datasets, one per organization mode.
 *
 * These interfaces used to live in `demo-seed-data.ts` alongside the campaign data. They were
 * lifted out so a per-mode dataset file can describe itself without importing the campaign
 * fiction it has nothing to do with.
 *
 * Ground rules every dataset obeys (why the data looks the way it does):
 * - A dataset holds STORY ONLY, never a place. It names a household by its site key and the place
 *   pack chosen from the signup country supplies the street, the coordinates and the seat area (see
 *   `demo-data-places.ts`). Every address in every pack is a real street with pre-baked
 *   coordinates and a real seat-area name, so map pins, the "Located" geocode chip and
 *   boundary-bounded turf cutting all work with zero paid address lookups at signup.
 * - Emails are on RFC 2606 reserved domains (example.com/org/net) so nothing a user does with the
 *   demo data — including actually sending the draft newsletter — can ever reach a real inbox.
 * - Phone numbers use the fictional 555 exchange. The area code written here is the Canadian pack's
 *   (613); the seeder rewrites it to the seeded pack's area code, so a Chicago workspace does not
 *   open with a page of Ottawa numbers.
 * - Tags and issues are STARTER vocabulary, seeded by seedStarterTags (modules/auth/
 *   onboarding-seed.ts) and kept when demo data is deleted. A dataset only ATTACHES persons and
 *   households to them BY NAME, and submissions to starter forms BY SLUG — the seeder skips a
 *   name/slug it cannot match SILENTLY, so `demo-datasets.spec.ts` is what proves a mode seeds
 *   the vocabulary its dataset references. Donor / supporter / subscriber are structured concepts
 *   in this product (donations table, campaign_person_facts, campaign_subscriptions) and were
 *   retired as tags — no dataset may resurrect them.
 * - Newsletter aggregates are DERIVED from the engagement specs at seed time, so the report page
 *   numbers always add up.
 */

export interface DemoCompanyDef {
  key: string;
  name: string;
  description: string;
  website: string;
  email: string;
  phone: string;
  industry: string;
}

/**
 * One demo household: a site key plus this dataset's story about the people there.
 *
 * The address, coordinates, postal code and seat area are NOT here. They come from the place pack
 * the workspace was seeded with, looked up by `key` — which is what lets one story serve an Ottawa
 * workspace and a Chicago one.
 */
export interface DemoHouseholdDef {
  key: string;
  notes?: string;
  /** Starter tag names attached via map_households_tags. */
  tags?: string[];
}

export interface DemoPersonDef {
  key: string;
  first_name: string;
  last_name: string;
  /** Household key; omitted = lives on the tenant placeholder household (address unknown). */
  household?: string;
  /** Company key for persons.company_id. */
  company?: string;
  email?: string;
  mobile?: string;
  notes?: string;
  /** Staggers persons.created_at so the dashboard growth chart draws a real curve. */
  createdDaysAgo: number;
  /** Starter tag names attached via map_peoples_tags. */
  tags?: string[];
  supportLevel?: SupportLevel;
  votingStatus?: VotingStatus;
  /** First-class volunteer/staff standing (§15) — sets persons.volunteer_status / staff_status. */
  volunteerStatus?: VolunteerStatus;
  staffStatus?: StaffStatus;
  /** Seeds a campaign_subscriptions row (status subscribed, consent_source import). */
  subscribed?: boolean;
  doNotContact?: boolean;
}

export interface DemoTaskDef {
  name: string;
  details: string;
  status: 'todo' | 'in_progress' | 'waiting' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  position: number;
  dueInDays?: number;
  completedDaysAgo?: number;
  assignToOwner?: boolean;
  /** Demo user key to assign the task to. */
  assignToUser?: string;
}

export interface DemoListDef {
  key: string;
  name: string;
  description: string;
  members: string[];
}

export interface DemoTeamDef {
  name: string;
  description: string;
  members: string[];
}

export interface DemoVolunteerEventDef {
  key: string;
  name: string;
  description: string;
  /** Which of the place pack's addresses the event is held at. */
  venue: DemoVenueKey;
  slug: string;
  /** Negative = in the past. */
  startInDays: number;
  durationHours: number;
  capacity: number;
  shifts: { person: string; status: 'signed_up' | 'attended' }[];
}

export interface DemoEngagementDef {
  person: string;
  opens: number;
  /** URLs clicked (must come from the newsletter's links). */
  clicks?: string[];
  unsubscribed?: boolean;
  bounce?: 'hard' | 'soft';
}

export interface DemoNewsletterDef {
  key: string;
  name: string;
  status: 'sent' | 'draft';
  subject: string;
  preview_text: string;
  audience_description: string;
  html_content: string;
  plain_text_content: string;
  sentDaysAgo?: number;
  links?: string[];
  /** Person keys the send went to; engagement entries must be a subset. */
  recipients?: string[];
  engagement?: DemoEngagementDef[];
}

export interface DemoSubmissionDef {
  /** Matches a starter form's slug (created by seedStarterForms) for THIS mode. */
  formSlug: string;
  person: string;
  daysAgo: number;
  answers: Record<string, unknown>;
}

/**
 * Demo teammates — real authusers rows so the Users page, task assignment, and inbox triage look
 * staffed. They get a random unguessable password at seed time and reserved-domain emails, so
 * they can never actually sign in. `emailLocal` is composed with the tenant's slug at seed time
 * (`<local>@<tenant-slug>.example.com`) because authusers.email is globally unique — a fixed
 * address would break the second tenant's signup.
 */
export interface DemoUserDef {
  key: string;
  first_name: string;
  last_name: string;
  emailLocal: string;
  role: 'admin' | 'user';
}

/** Attaches demo persons to a starter issue via map_peoples_tags. */
export interface DemoIssueAssignmentDef {
  /** Starter issue name — must match an entry in MODE_ISSUES for this mode. */
  issue: string;
  /** Person keys this issue is attached to. */
  people: string[];
}

export interface DemoEmailDef {
  folder: 'inbox' | 'sent';
  /** Person key the email is from (inbox) or to (sent) — ties the thread to a CRM contact. */
  person: string;
  subject: string;
  /**
   * The snippet under the subject. Writes to `emails.preview_text` — NOT `emails.preview`,
   * which is the provider dedupe key and stays null for demo mail that no provider owns.
   */
  preview_text: string;
  status: 'open' | 'closed';
  /** 'owner' or a demo user key. */
  assignTo?: string;
  daysAgo: number;
  is_favourite?: boolean;
  body_html: string;
  /**
   * Asset keys from `demo-attachment-assets.ts`. Seeded as fully materialized
   * attachments (a real blob + `files` row), so the demo inbox can actually download
   * them; if storage is unavailable at signup the seeder degrades to a metadata-only
   * row rather than failing the signup.
   */
  attachments?: DemoAttachmentKey[];
}

export interface DemoKnockDef {
  /** Household key — must belong to the turf. */
  household: string;
  /** Resident spoken to (conversation outcomes); links the knock to a contact. */
  person?: string;
  outcome: 'conversation' | 'no_answer' | 'not_home' | 'refused' | 'inaccessible';
  /**
   * The voter's stance — only meaningful on a conversation.
   *
   * Typed against the live door vocabulary rather than spelled out here: this list drifted
   * once already and the seeded knocks kept an older spelling, which the Companion and the
   * field report both read as "no stance recorded".
   */
  response?: KnockResponse;
  /** Display name written to the knock (the volunteer who logged it). */
  canvasser: string;
  notes?: string;
  /** Hours before seed time — drives the derived in-field / complete window. */
  knockedHoursAgo: number;
}

export interface DemoTurfDef {
  key: string;
  /**
   * The pack area (cluster) this turf covers. Every household listed below must sit in it, because
   * the cutting engine never lets one turf span two boundaries.
   */
  area: DemoAreaKey;
  /**
   * The whole streets this turf walks — its door list is `housesOn(...streets)`. The turf's NAME
   * is built from the pack's own street names, so a Chicago workspace reads "Morse & Lunt
   * (Ward 49)" where an Ottawa one reads "Cooper & MacLaren (Somerset)".
   */
  streets: DemoStreetKey[];
  /** Stored lifecycle: 'active' = handed out/knocked, 'draft' = cut, not yet assigned. */
  status: 'draft' | 'active';
  /** Whether a tokenised Companion assignment exists (active turfs only). */
  assigned: boolean;
  /** Household keys that make up the door list. */
  households: string[];
  knocks?: DemoKnockDef[];
  notes?: string;
}

export interface DemoDeliveryRequestDef {
  key: string;
  household: string;
  person?: string;
  status: 'new' | 'approved' | 'declined' | 'delivered';
  source?: 'web_form' | 'manual';
  notes?: string;
  skipReason?: string;
  /** Days before seed time for created_at (spreads the intake timeline). */
  createdDaysAgo: number;
}

export interface DemoDeliveryStopDef {
  /** Request key — the request this stop serves. */
  request: string;
  status: 'pending' | 'delivered' | 'skipped';
  actedVia?: 'volunteer_link' | 'staff';
  reason?: string;
  /** Hours before seed time the stop was acted on (delivered/skipped only). */
  actedHoursAgo?: number;
}

export interface DemoDeliveryRouteDef {
  key: string;
  name: string;
  status: 'assigned' | 'in_progress' | 'completed';
  /** Volunteer driving it (person key). */
  volunteerPerson?: string;
  /** Which of the place pack's route starts the driver sets off from. */
  start: DemoRouteStartKey;
  /** Whether a share link is still live (sets share_token_hash). */
  shared?: boolean;
  scheduledInDays?: number;
  /** Ordered stops — seq is assigned by position. */
  stops: DemoDeliveryStopDef[];
}

export interface DemoPledgeDef {
  key: string;
  /** Person key — the monthly donor (also snapshotted onto the row). */
  person: string;
  monthlyAmountCents: number;
  startedDaysAgo: number;
  /** Days from now the next charge is due. */
  nextBillingInDays: number;
}

export interface DemoDonationDef {
  /** Person key — the donor (name/email are snapshotted from the person). */
  person: string;
  amountCents: number;
  method: 'card' | 'check' | 'cash' | 'bank_transfer';
  createdDaysAgo: number;
  /** Pledge key — set when this gift is a monthly recurring charge. */
  pledge?: string;
}

/** A seeded official donation receipt. `donation` is an INDEX into the dataset's donations array. */
export interface DemoReceiptDef {
  donation: number;
  /**
   * A dataset-local label, NOT the number that gets printed. The seeder assigns the real serials
   * itself — 1..n per ISSUE YEAR, oldest receipt first — so the printed sequence is gap-free and
   * runs forward in time no matter what day of the year the workspace is created on. Keep these
   * unique within a dataset; `replacesRef` points at one of them.
   */
  ref: number;
  issuedDaysAgo: number;
  status?: 'issued' | 'cancelled';
  cancelledReason?: string;
  /** `ref` of the receipt this one replaces (the cancel-and-replace demo pair). */
  replacesRef?: number;
  /**
   * Value the donor received back for the gift (a meal at a benefit dinner, an auction item).
   * Only the remainder is tax-receiptable, so the receipt prints gift, advantage and eligible
   * amount separately. Must be greater than zero and smaller than the gift.
   */
  advantageCents?: number;
  advantageDescription?: string;
  emailed?: boolean;
}

/** A finished year-end statement batch, so the statements panel tells a story on day one. */
export interface DemoStatementRunDef {
  /** Years back from the current year (1 = last year). */
  yearsAgo: number;
  donorsTotal: number;
  generated: number;
  emailed: number;
  toPrint: number;
}

/**
 * One organization mode's complete demo workspace.
 *
 * Every field is required — including the ones a mode leaves empty — so adding a section to the
 * seeder is a compile error in every dataset until each one decides what to do with it, rather
 * than silently seeding nothing for the modes nobody remembered to update.
 *
 * `turfs` and `deliveries*` are empty for modes whose signup hides those modules
 * (ORG_MODE_MODULE_DEFAULTS): a Canvassing page seeded with turfs the sidebar does not link to is
 * worse than no canvassing at all.
 */
export interface DemoDataset {
  readonly companies: readonly DemoCompanyDef[];
  readonly households: readonly DemoHouseholdDef[];
  readonly persons: readonly DemoPersonDef[];
  readonly users: readonly DemoUserDef[];
  readonly tasks: readonly DemoTaskDef[];
  readonly lists: readonly DemoListDef[];
  readonly team: DemoTeamDef;
  readonly volunteerEvents: readonly DemoVolunteerEventDef[];
  readonly newsletters: readonly DemoNewsletterDef[];
  readonly submissions: readonly DemoSubmissionDef[];
  readonly issueAssignments: readonly DemoIssueAssignmentDef[];
  readonly emails: readonly DemoEmailDef[];
  readonly turfs: readonly DemoTurfDef[];
  readonly deliveryRequests: readonly DemoDeliveryRequestDef[];
  readonly deliveryRoutes: readonly DemoDeliveryRouteDef[];
  readonly pledges: readonly DemoPledgeDef[];
  readonly donations: readonly DemoDonationDef[];
  /**
   * Official receipts over `donations` (empty when the mode's story has no receipting).
   *
   * Seeded only into a Canadian workspace. Every receipt regime the product implements is Canadian,
   * so a United States workspace gets the gifts and the ledger but no receipts — see
   * `PlacePack.seedsReceipts`.
   */
  readonly receipts: readonly DemoReceiptDef[];
  /** `receipts.*` settings seeded with the receipts (removed again on exit-demo). */
  readonly receiptSettings: Readonly<Record<string, string | boolean>>;
  readonly statementRun: DemoStatementRunDef | null;
}
