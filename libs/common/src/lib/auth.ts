import { z } from 'zod';

export interface IAuthKeyPayload {
  name?: string;

  session_id: string;

  tenant_id: string;

  user_id: string;

  role?: string | null;

  /**
   * Campaigns §15 — the campaign this caller is pinned to, resolved server-side from
   * their assignment. Null means they may work across campaigns (admin/owner). Set by
   * the `isAuthed` middleware; never taken from request input.
   */
  campaign_id?: string | null;

  source?: string;
}

export interface IAuthUser {
  email: string;

  first_name: string;

  last_name?: string;

  id: string;

  role?: string | null;

  avatar_url?: string | null;

  email_verified: boolean;

  passkey_setup_dismissed_at?: Date | null;

  tenant_deletion_scheduled_at?: Date | null;

  tenant_paused_at?: Date | null;

  /** Set while the tenant still has the seeded demo data (drives the demo-mode banner). */
  tenant_demo_mode_at?: Date | null;

  /**
   * The workspace has settled on a plan (Free counts). Sender/phone/domain verification is gated
   * on this rather than on demo mode, so the UI needs it to explain a lock without a billing
   * round-trip on every page.
   */
  tenant_plan_selected?: boolean;

  /** The tenant's public subdomain label — used to build public form URLs (`<slug>.<baseDomain>`). */
  tenant_slug?: string | null;
}

export interface IUserStatsSnapshot {
  emails_assigned: {
    total: number;
    open: number;
    closed: number;
  };
  contacts_added: {
    total: number;
    last_created_at: Date | null;
  };
  files_imported: {
    count: number;
    total_rows: number;
    last_activity_at: Date | null;
  };
  files_exported: {
    count: number;
    total_rows: number;
    last_activity_at: Date | null;
  };
}

export interface IAuthUserRecord extends IAuthUser {
  last_name: string;
  role: string | null;
  /** Campaigns §15 — admin-assigned campaign; null = office. Not enforced for admins/owners. */
  campaign_id: string | null;
  verified: boolean;
  two_factor_enabled: boolean;
  deletion_scheduled_at: Date | null;
  /** Admin deactivation: set = can't sign in until an admin/owner reactivates. */
  deactivated_at?: Date | null;
  /** Most recent session activity; null until the user has signed in at least once. */
  last_active_at?: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  previous_email?: string | null;
  previous_role?: string | null;
  avatar_url?: string | null;
  notification_preferences?: {
    mention_in_comment: boolean;
    mention_in_comment_in_app: boolean;
    task_assigned: boolean;
    task_assigned_in_app: boolean;
    task_due: boolean;
    task_due_in_app: boolean;
    person_assigned: boolean;
    person_assigned_in_app: boolean;
    export_ready: boolean;
    export_ready_in_app: boolean;
    import_summary: boolean;
    import_summary_in_app: boolean;
  };
}

export interface IAuthUserDetail extends IAuthUserRecord {
  stats: IUserStatsSnapshot;
}

export interface IToken {
  auth_token: string | null;
  refresh_token: string | null;
}

/**
 * The one generic message shown for any failed sign-in attempt, regardless of
 * whether the email or the password was wrong — never reveal which, so that
 * sign-in cannot be used to probe which emails have accounts. Shared by the
 * backend error formatter and the frontend so the copy never drifts.
 */
export const GENERIC_SIGNIN_ERROR = 'Please check your email and password and try again.';

/**
 * Product names for the stored role values — the working role 'user' is shown as
 * "Editor" everywhere (Users list, user page, Profile). Shared so the label never drifts.
 */
export const AUTH_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  user: 'Editor',
  viewer: 'Viewer',
};

export function authRoleLabel(role: string | null | undefined): string {
  return role ? (AUTH_ROLE_LABELS[role] ?? role) : '—';
}

/** Every role an account may hold, most privileged first. */
export const AUTH_ROLES = ['owner', 'admin', 'user', 'viewer'] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

/**
 * The role an account gets when none was chosen.
 *
 * SECURITY: never leave a role unset. `authusers.role` is nullable for historical
 * reasons, and permission checks written as "deny if role === 'user'" silently pass
 * for a null role — which made an unroled invitee more privileged than an Editor.
 * Checks must ask {@link isPrivilegedRole}, and writes must land a real role.
 */
export const DEFAULT_AUTH_ROLE: AuthRole = 'user';

export function isAuthRole(role: unknown): role is AuthRole {
  return typeof role === 'string' && (AUTH_ROLES as readonly string[]).includes(role);
}

/**
 * True only for roles that may administer a workspace (invite, change roles, assign
 * campaigns, manage billing). Fails closed: anything unrecognised or absent is not
 * privileged.
 */
export function isPrivilegedRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export type signInInputType = z.infer<typeof signInInputObj>;

export type signUpInputType = z.infer<typeof signUpInputObj>;

export const signInInputObj = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  rememberMe: z.boolean().optional(),
});

export const signUpInputObj = z.object({
  organization: z.string(),
  email: z.string().max(100),
  password: z.string().min(8).max(72),
  first_name: z.string().max(100),
});
