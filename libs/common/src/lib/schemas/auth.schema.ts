import { z } from 'zod';
import { AUTH_ROLES } from '../auth';
import { emailSchema, nameSchema, phoneSchema } from './core.schema';

/**
 * A role arriving from a client. Constrained to AUTH_ROLES because an unrecognised role is
 * worse than a missing one: it lands in `authusers.role` where every permission check falls
 * through it. (A free-form string here previously let the label 'editor' — the display name
 * for the `user` role — be written verbatim.)
 */
const authRoleSchema = z.enum(AUTH_ROLES);

export const InviteAuthUserObj = z.object({
  email: emailSchema,
  first_name: nameSchema('First name'),
  last_name: nameSchema('Last name').nullable().optional(),
  role: authRoleSchema.nullable().optional(),
  /** Campaigns §15 — assign the invitee to a campaign; null/absent = the office context. */
  campaign_id: z.string().nullable().optional(),
});

export const NotificationPreferencesObj = z.object({
  mention_in_comment: z.boolean().default(true),
  mention_in_comment_in_app: z.boolean().default(true),
  task_assigned: z.boolean().default(true),
  task_assigned_in_app: z.boolean().default(true),
  task_due: z.boolean().default(true),
  task_due_in_app: z.boolean().default(true),
  person_assigned: z.boolean().default(true),
  person_assigned_in_app: z.boolean().default(true),
  email_assigned: z.boolean().default(true),
  email_assigned_in_app: z.boolean().default(true),
  export_ready: z.boolean().default(true),
  export_ready_in_app: z.boolean().default(true),
  /** Year-end giving statement batch finished (email + bell) — sent to the admin who ran it. */
  statements_ready: z.boolean().default(true),
  statements_ready_in_app: z.boolean().default(true),
  // No `import_summary_in_app` twin: imports have never produced an in-app notification, only
  // the email (see import.handlers.ts). A toggle governing nothing is worse than no toggle.
  import_summary: z.boolean().default(true),
  /**
   * Text me when a volunteer is waiting for companion-app approval.
   *
   * Still the only SMS preference — a third channel, not the other half of an email/bell pair,
   * so it has no `_in_app` twin and the email and bell alerts for this event fire regardless.
   *
   * Defaults ON despite the cost of a text, because the failure it prevents is worse than the
   * interruption it causes: an unapproved volunteer is standing at a door unable to work, and
   * nobody finds out until an admin happens to check. Anyone who disagrees turns it off in
   * Settings, and an admin with no mobile on file is never texted either way.
   */
  companion_approval_sms: z.boolean().default(true),
});

/**
 * Product-tour progress. Per USER rather than per tenant, and stored on the profile rather than
 * in localStorage, because a person learns the app once — not once per browser. (Workspace setup
 * is the mirror image: one workspace, configured once, so it lives in tenant settings.)
 */
export const TourStateObj = z.object({
  /** Index of the last stop reached, so a resumed tour picks up where it left off. */
  lastStep: z.number().int().min(0).default(0),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  /** Set when the user skips. Distinct from completedAt: both stop the auto-start, but only one
   * of them means they saw the whole thing. */
  dismissedAt: z.string().nullable().default(null),
});

/**
 * Shape of the profiles.preferences jsonb column (formerly the untyped
 * profiles.json grab-bag). Unknown keys from older rows are preserved rather than rejected.
 */
export const ProfilePreferencesObj = z
  .object({
    notifications: NotificationPreferencesObj.partial().optional(),
    /** Campaigns §15 — the context (campaign id) this user is working in; per-user, cross-device. */
    active_campaign_id: z.string().optional(),
    tour: TourStateObj.partial().optional(),
  })
  .catchall(z.unknown());

export const UpdateAuthUserObj = z.object({
  email: emailSchema.optional(),
  first_name: nameSchema('First name').optional(),
  last_name: nameSchema('Last name').nullable().optional(),
  role: authRoleSchema.nullable().optional(),
  /**
   * The user's own mobile, stored on their profile. Its only job is being texted: companion
   * approval alerts and "send the organizer link to my phone". Empty string clears it, and
   * the backend stores it E.164-normalized (a number we cannot text is refused there rather
   * than saved to fail silently later).
   */
  mobile: phoneSchema('Mobile number'),
  verified: z.boolean().optional(),
  two_factor_enabled: z.boolean().optional(),
  notification_preferences: NotificationPreferencesObj.optional(),
  /** Campaigns §15 — admin-assigned campaign; null = the office context. Admin/owner callers only. */
  campaign_id: z.string().nullable().optional(),
});

export const Verify2FAObj = z.object({
  email: emailSchema,
  code: z.string().length(6),
  rememberMe: z.boolean().optional(),
});

/**
 * The resolved preference set (every key present). `IAuthUserRecord` imports this rather than
 * restating the keys — the hand-written copy had silently fallen two keys behind.
 */
export type NotificationPreferencesType = z.infer<typeof NotificationPreferencesObj>;
