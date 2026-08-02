import { z } from 'zod';

// Type-only, so this does not create a runtime cycle with auth.schema.ts (which imports
// AUTH_ROLES from here). One definition of the preference keys, not two.
import type { NotificationPreferencesType } from './schemas/auth.schema';
import { DATA_REGION_CHOICES, DEFAULT_DATA_REGION_CHOICE } from './data-residency';
import { DEFAULT_ORG_MODE, ORG_MODES, type ModuleId, type OrgMode } from './org-mode';
import type { PlanKey } from './billing/plans';

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

  /**
   * Resolved plan key ('free' when unknown/absent — fails closed). Rides on the session so the
   * sidebar and plan-gated pages (the shared inbox is Grassroots+) can present a lock honestly
   * before any billing query resolves. Refreshed the same way as `tenant_plan_selected` after a
   * plan change.
   */
  tenant_plan?: PlanKey;

  /** The tenant's public subdomain label — used to build public form URLs (`<slug>.<baseDomain>`). */
  tenant_slug?: string | null;

  /**
   * Organization mode and the sparse module-visibility overrides, mirrored from the
   * `settings` rows onto the session.
   *
   * They ride here rather than being read from the settings snapshot because
   * `SettingsService.load()` is not called at boot — the sidebar renders before any
   * page requests it. The session is resolved in `provideAppInitializer` ahead of the
   * first paint, so a label sourced from here never flickers. See OrgModeService.
   */
  tenant_org_mode?: OrgMode;

  tenant_module_overrides?: Partial<Record<ModuleId, boolean>>;
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
  /**
   * The user's own mobile (profiles.mobile), stored E.164-normalized. Only ever used to text
   * this person: companion approval alerts and the organizer link they send to themselves.
   */
  mobile?: string | null;
  notification_preferences?: NotificationPreferencesType;
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
 * Machine-readable marker on the 403 thrown when a tenant is not approved for the beta.
 * Rides along on the tRPC error's `data` (AppError.data is forwarded by the error
 * formatter), so the sign-in page can render the waitlist panel instead of sniffing the
 * message text.
 */
export const TENANT_PENDING_APPROVAL_REASON = 'TENANT_PENDING_APPROVAL';

/**
 * What someone whose workspace has not been let into the beta sees when they try to sign
 * in. Shared by the backend (the thrown 403) and the frontend panel so the copy is written
 * once.
 *
 * Deliberately identical for 'pending' and 'declined': during a closed beta the honest
 * answer to both is "not yet, we're full" — and a distinct "you were rejected" message
 * would be a worse experience for no benefit, since ops can still approve later.
 */
export const TENANT_PENDING_APPROVAL_MESSAGE =
  'Your account is waiting for approval. pplCRM is in beta and we already have as many beta ' +
  'workspaces as we can support well, so we are letting new ones in gradually. Yours is on the ' +
  'list, and we will email you the moment there is room.';

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
  /**
   * Organization type. Asked at signup rather than later because the starter tags,
   * starter forms and demo dataset are all seeded inside the signup transaction — a
   * mode chosen afterwards would be too late to change any of them. Defaulted so every
   * existing caller keeps working.
   */
  mode: z.enum(ORG_MODES).default(DEFAULT_ORG_MODE),
  /**
   * Where the workspace's data is stored, or 'any' for no requirement. Asked at signup
   * because it is a property of how the workspace is provisioned — once records exist,
   * changing it is a data migration. Accepted from anyone regardless of plan: naming a
   * region needs Movement (DATA_RESIDENCY_MIN_PLAN), but nobody has chosen a plan yet at
   * signup, so this records the answer and the form states the requirement.
   */
  data_region: z.enum(DATA_REGION_CHOICES).default(DEFAULT_DATA_REGION_CHOICE),
});
