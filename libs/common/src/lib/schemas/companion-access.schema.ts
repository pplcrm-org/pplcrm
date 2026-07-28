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

export const COMPANION_VERIFY_CHANNELS = ['email', 'sms'] as const;
export type CompanionVerifyChannel = (typeof COMPANION_VERIFY_CHANNELS)[number];

export const COMPANION_VOLUNTEER_STATUSES = ['invited', 'verified', 'approved', 'revoked'] as const;
export type CompanionVolunteerStatus = (typeof COMPANION_VOLUNTEER_STATUSES)[number];

/**
 * What the gate UI renders:
 * - dead: unknown/expired/revoked link — friendly dead-link page
 * - unassigned: link has no volunteer person attached — ask the organizer to re-send
 * - need_verification: pick a channel, get a code
 * - pending_approval: verified, waiting for an admin — the page polls
 * - ready: approved with a valid device session — load the app
 */
export const COMPANION_ACCESS_STATES = [
  'dead',
  'unassigned',
  'need_verification',
  'pending_approval',
  'ready',
] as const;
export type CompanionAccessState = (typeof COMPANION_ACCESS_STATES)[number];

export const CompanionAccessQueryObj = z.object({
  kind: z.enum(COMPANION_LINK_KINDS),
  token: z.string().min(8).max(200),
});

export const CompanionVerifyStartObj = CompanionAccessQueryObj.extend({
  channel: z.enum(COMPANION_VERIFY_CHANNELS),
});

export const CompanionVerifyConfirmObj = CompanionAccessQueryObj.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export type CompanionAccessQueryType = z.infer<typeof CompanionAccessQueryObj>;
export type CompanionVerifyStartType = z.infer<typeof CompanionVerifyStartObj>;
export type CompanionVerifyConfirmType = z.infer<typeof CompanionVerifyConfirmObj>;

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
}

/** Response of POST /api/companion/verify/confirm. */
export interface CompanionVerifyConfirmResult {
  status: 'ready' | 'pending_approval';
  sessionToken: string;
  expiresAt: string;
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
