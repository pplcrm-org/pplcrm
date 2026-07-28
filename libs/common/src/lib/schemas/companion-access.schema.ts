import { z } from 'zod';

/**
 * Companion access layer (COMPANION-APPS-PLAN.md §2). A companion capability
 * link (/t/:token canvass turf, /r/:token delivery route) is not enough on its
 * own: the volunteer must verify a one-time code sent to their email/SMS on
 * file, be approved once by an admin, and then hold a device session that
 * accompanies every companion request.
 */

export const COMPANION_LINK_KINDS = ['turf', 'route'] as const;
export type CompanionLinkKind = (typeof COMPANION_LINK_KINDS)[number];

/**
 * What the gate is being asked about. Wider than a capability link, because two of
 * these are not links at all:
 * - 'join'    — a shareable QR/typeable code (`campaign_join_codes`), which anyone may
 *               scan. It names an organization, never a person, so it grants nothing on
 *               its own; the volunteer still verifies a contact and waits for approval.
 * - 'session' — no token. The device session alone answers "who is this and are they
 *               approved", which is what a volunteer who joined by QR arrives with once
 *               they are through the gate (their turf link is hashed and unrecoverable).
 */
export const COMPANION_ACCESS_KINDS = ['turf', 'route', 'join', 'session'] as const;
export type CompanionAccessKind = (typeof COMPANION_ACCESS_KINDS)[number];

/** The kinds that can send + confirm a one-time code. 'session' is already past that point. */
export const COMPANION_VERIFY_KINDS = ['turf', 'route', 'join'] as const;
export type CompanionVerifyKind = (typeof COMPANION_VERIFY_KINDS)[number];

export const COMPANION_VERIFY_CHANNELS = ['email', 'sms'] as const;
export type CompanionVerifyChannel = (typeof COMPANION_VERIFY_CHANNELS)[number];

export const COMPANION_VOLUNTEER_STATUSES = ['invited', 'verified', 'approved', 'revoked'] as const;
export type CompanionVolunteerStatus = (typeof COMPANION_VOLUNTEER_STATUSES)[number];

/**
 * What the gate UI renders:
 * - dead: unknown/expired/revoked link — friendly dead-link page
 * - unassigned: link has no volunteer person attached — ask the organizer to re-send
 * - need_identity: a live join code, but we don't know who is holding the phone yet —
 *   ask for a name and one contact. Only reachable on the 'join' kind, because it is
 *   the only kind whose token names an organization rather than a person.
 * - need_verification: pick a channel, get a code
 * - pending_approval: verified, waiting for an admin — the page polls
 * - ready: approved with a valid device session — load the app
 */
export const COMPANION_ACCESS_STATES = [
  'dead',
  'unassigned',
  'need_identity',
  'need_verification',
  'pending_approval',
  'ready',
] as const;
export type CompanionAccessState = (typeof COMPANION_ACCESS_STATES)[number];

/** `token` is absent only for kind 'session', where the device session IS the credential. */
export const CompanionAccessQueryObj = z.object({
  kind: z.enum(COMPANION_ACCESS_KINDS),
  token: z.string().min(6).max(200).optional(),
});

export const CompanionVerifyStartObj = z.object({
  kind: z.enum(COMPANION_VERIFY_KINDS),
  token: z.string().min(6).max(200),
  channel: z.enum(COMPANION_VERIFY_CHANNELS),
});

export const CompanionVerifyConfirmObj = z.object({
  kind: z.enum(COMPANION_VERIFY_KINDS),
  token: z.string().min(6).max(200),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/**
 * The identity step of a QR join: a name plus exactly one contact we can send a code to.
 *
 * One contact, not both, because this is a stranger typing on a phone in a parking lot —
 * and because every extra field is another thing that can be wrong. `.refine` enforces
 * "exactly one" rather than making the client choose a discriminator.
 */
export const CompanionJoinStartObj = z
  .object({
    code: z.string().trim().min(6).max(32),
    first_name: z.string().trim().min(1, 'Enter your name').max(100),
    last_name: z.string().trim().max(100).optional(),
    email: z.string().trim().email('Enter a valid email').max(200).optional(),
    mobile: z.string().trim().min(7, 'Enter a valid mobile number').max(40).optional(),
  })
  .refine((v) => Boolean(v.email) !== Boolean(v.mobile), {
    message: 'Give either an email or a mobile number.',
    path: ['email'],
  });

export type CompanionAccessQueryType = z.infer<typeof CompanionAccessQueryObj>;
export type CompanionVerifyStartType = z.infer<typeof CompanionVerifyStartObj>;
export type CompanionVerifyConfirmType = z.infer<typeof CompanionVerifyConfirmObj>;
export type CompanionJoinStartType = z.infer<typeof CompanionJoinStartObj>;

/** POST /api/companion/approve/:token — the admin's decision, one tap from an SMS. */
export const CompanionApprovalDecisionObj = z.object({
  decision: z.enum(['approve', 'decline']),
});
export type CompanionApprovalDecisionType = z.infer<typeof CompanionApprovalDecisionObj>;

/** A verifiable contact on file, masked for display — never the raw value. */
export interface CompanionContact {
  channel: CompanionVerifyChannel;
  masked: string;
}

/** Response of GET /api/companion/access. */
export interface CompanionAccessPayload {
  state: CompanionAccessState;
  /** Volunteer first name — identity card ("Walking as Jordan"). */
  volunteerName?: string;
  /** Who to contact about a dead/unassigned link. */
  organizerName?: string;
  /** Organization name for the gate header. */
  organizationName?: string;
  contacts?: CompanionContact[];
  /**
   * What a join code puts them on ("Maple Ward — turf 3", or the campaign name when
   * the code isn't turf-scoped). Answers "what am I signing up for?" before they type
   * anything. Only set on the 'join' kind.
   */
  joiningLabel?: string;
}

/** Response of POST /api/companion/verify/confirm. */
export interface CompanionVerifyConfirmResult {
  status: 'ready' | 'pending_approval';
  sessionToken: string;
  expiresAt: string;
}

/**
 * Response of POST /api/companion/join/start.
 *
 * `claim` is a one-shot bearer credential standing in for the capability link the QR
 * path never had: it names the volunteer row that was just matched or created, so the
 * verify step knows who is confirming. It is returned to the scanner and never sent
 * anywhere else, and only its sha256 is stored.
 *
 * The shape and the work behind it are identical whether or not the person already
 * existed — otherwise this endpoint answers "is this email in your database?".
 */
export interface CompanionJoinStartResult {
  masked: string;
  channel: CompanionVerifyChannel;
  claim: string;
}

/** GET /api/companion/approve/:token — what the admin sees before deciding. */
export interface CompanionApprovalPayload {
  state: 'pending' | 'decided' | 'dead';
  volunteerName?: string;
  /** Masked email/phone — enough to recognize someone, never enough to harvest. */
  volunteerContact?: string;
  organizationName?: string;
  /** What they'd be joining, when the join code named a turf or campaign. */
  joiningLabel?: string;
  requestedAt?: string;
  /** Set once someone has decided — including "someone else got here first". */
  decision?: 'approved' | 'revoked';
  decidedByName?: string;
  decidedAt?: string;
}

/** One row of the admin Volunteer access page. */
export interface CompanionVolunteerRow {
  id: string;
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  status: CompanionVolunteerStatus;
  verify_channel: CompanionVerifyChannel | null;
  verified_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  created_at: string;
  /**
   * Per-volunteer override for `app.canvass_volunteer_roam`; null = follow the
   * workspace setting. Lets one person be pinned to their assigned turfs (or trusted
   * to roam) without changing the policy for everyone.
   */
  can_roam: boolean | null;
}
