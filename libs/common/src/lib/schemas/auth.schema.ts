import { z } from 'zod';
import { emailSchema, nameSchema } from './core.schema';

export const InviteAuthUserObj = z.object({
  email: emailSchema,
  first_name: nameSchema('First name'),
  last_name: nameSchema('Last name').nullable().optional(),
  role: z.string().max(100).nullable().optional(),
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
  import_summary: z.boolean().default(true),
  import_summary_in_app: z.boolean().default(true),
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
  role: z.string().max(100).nullable().optional(),
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
