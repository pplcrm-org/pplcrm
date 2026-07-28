import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { createSigner } from 'fast-jwt';
import type { QueryResult, Transaction } from 'kysely';
import {
  DEFAULT_ORG_MODE,
  MODULE_VISIBILITY_SETTINGS_KEY,
  ORG_MODE_SETTINGS_KEY,
  RESERVED_SUBDOMAINS,
  hasSettledPlan,
  isOrgMode,
  parseModuleOverrides,
  slugifyHandle,
} from '../../../../../../libs/common/src';
import { signedFileDownloadUrl } from '../../lib/signed-download';

import type {
  IAuthKeyPayload,
  INow,
  InviteAuthUserType,
  ModuleId,
  OrgMode,
  UpdateAuthUserType,
  getAllOptionsType,
  signInInputType,
  signUpInputType,
} from '../../../../../../libs/common/src';
import type {
  AuthUsersType,
  GetOperandType,
  Keys,
  Models,
  OperationDataType,
  TablesOperationMap,
} from '../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../env';
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  PreconditionFailedError,
  ServerMisconfigError,
  UnauthorizedError,
} from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import type { QueryParams } from '../../lib/base.repo';
import { COMMON_PASSWORDS } from '../../lib/common-passwords';
import { escapeHtml } from '../../lib/html-escape';
import { getPwnedCount } from '../../lib/hibp';
import { parseProfilePreferences } from '../../lib/profile-preferences';
import {
  DEFAULT_AUTH_ROLE,
  TourStateObj,
  isAuthRole,
  isPrivilegedRole,
  type TourStateType,
} from '../../../../../../libs/common/src';
import { getPlanLimits } from '../billing/usage-limits';
import { isDisposableEmail } from '../../lib/mail/disposable-email-domains';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { hashPassword, verifyPasswordConstantTime } from '../../lib/password-hash';
import { assertSignInAttemptsRemaining, clearSignInAttempts, recordFailedSignIn } from '../../lib/signin-attempts';
import { StorageService } from '../../lib/storage.service';
import { tombstoneAuthUser } from '../../lib/tombstone-user';
import { generateToken, hashToken } from '../../lib/token-hash';
import { logger } from '../../logger';
import { EmailRepo } from '../emails/repositories/email.repo';
import { PersonsRepo } from '../persons/repositories/persons.repo';
import { UserProfiles } from '../userprofiles/repositories/userprofiles.repo';
import { seedStarterForms, seedStarterTags } from './onboarding-seed';
import {
  assertTenantApprovedForSignIn,
  initialApprovalStatus,
  mintApprovalToken,
  type NewTenantApproval,
} from './tenant-approval';
import { ensureSystemLists, queueSystemListRefreshes } from '../lists/system-lists';
import { DEMO_MODE_INVITES_BLOCKED_MESSAGE, assertNotDemoMode } from '../demo/demo-guard';
import { seedDemoData } from '../demo/demo-seed';
import { demoDatasetFor } from '../demo/demo-datasets';
import { AuthUsersRepo } from './repositories/authusers.repo';
import { SessionsRepo } from './repositories/sessions.repo';
import { TenantsRepo } from './repositories/tenants.repo';

/** How long a scheduled-deletion cancellation link stays valid. Comfortably longer than
 *  the deletion grace period, so the link never dies before the window it belongs to. */
const DELETION_CANCEL_TOKEN_TTL_MS = 45 * 24 * 60 * 60 * 1000;

export class AuthController extends BaseController<'authusers', AuthUsersRepo> {
  private static readonly AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  private static readonly AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

  private emailsRepo: EmailRepo = new EmailRepo();
  private mailService = new TransactionalEmailService({ defaultAudience: 'account' });
  private personsRepo: PersonsRepo = new PersonsRepo();
  private profiles: UserProfiles = new UserProfiles();
  private sessions: SessionsRepo = new SessionsRepo();
  private storage = new StorageService();
  private tenants: TenantsRepo = new TenantsRepo();

  constructor() {
    super(new AuthUsersRepo());
  }

  /**
   * Admin deactivation: sets `deactivated_at` (indefinite, blocks sign-in, revokes sessions).
   * Deliberately NOT `deletion_scheduled_at` — that column hard-deletes via the deletion worker
   * and is auto-cleared when the user signs back in.
   */
  public async adminDeactivateUser(auth: IAuthKeyPayload, userId: string) {
    const callerRole = auth.role;
    if (callerRole !== 'admin' && callerRole !== 'owner') {
      throw new ForbiddenError('Only admins and owners can deactivate users.');
    }

    const targetId = String(userId);
    if (targetId === auth.user_id) {
      throw new BadRequestError('You cannot deactivate yourself.');
    }

    const repo = this.getRepo();
    const user = await repo.getOneBy('id', { tenant_id: auth.tenant_id, value: targetId });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;

    if (callerRole === 'admin' && authUser.role === 'owner') {
      throw new ForbiddenError('Admins cannot deactivate owner accounts.');
    }
    if (authUser.deactivated_at) {
      throw new BadRequestError('This account is already deactivated.');
    }

    const deactivatedAt = new Date();
    await repo.transaction().execute(async (trx) => {
      await trx
        .updateTable('authusers')
        .set({ deactivated_at: deactivatedAt, updated_at: deactivatedAt, updatedby_id: auth.user_id })
        .where('id', '=', targetId)
        .where('tenant_id', '=', auth.tenant_id)
        .execute();

      // Deactivation takes effect immediately, not at next token expiry.
      await this.sessions.deleteByUserId(targetId, auth.tenant_id, trx);

      await this.userActivity.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'authusers',
          entity_id: targetId,
          quantity: 1,
          metadata: {
            id: targetId,
            entity_label: `${authUser.first_name} ${authUser.last_name || ''}`.trim(),
            changes: { deactivated_at: { from: null, to: deactivatedAt.toISOString() } },
          },
        },
        trx,
      );
    });

    return { success: true, deactivated_at: deactivatedAt };
  }

  /** Reverses admin deactivation; also clears a self-scheduled deletion so there is one way back. */
  public async adminReactivateUser(auth: IAuthKeyPayload, userId: string) {
    const callerRole = auth.role;
    if (callerRole !== 'admin' && callerRole !== 'owner') {
      throw new ForbiddenError('Only admins and owners can reactivate users.');
    }

    const targetId = String(userId);
    const repo = this.getRepo();
    const user = await repo.getOneBy('id', { tenant_id: auth.tenant_id, value: targetId });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;

    // A tombstoned row is not an account — its identity is gone; clearing deactivated_at would
    // resurrect a credential-less shell. The grid hides tombstones, so guard the endpoint too.
    if (authUser.deleted_at) throw new NotFoundError('User not found');
    if (callerRole === 'admin' && authUser.role === 'owner') {
      throw new ForbiddenError('Admins cannot reactivate owner accounts.');
    }
    if (!authUser.deactivated_at && !authUser.deletion_scheduled_at) {
      throw new BadRequestError('This account is already active.');
    }

    await repo.transaction().execute(async (trx) => {
      await trx
        .updateTable('authusers')
        .set({ deactivated_at: null, deletion_scheduled_at: null, updated_at: new Date(), updatedby_id: auth.user_id })
        .where('id', '=', targetId)
        .where('tenant_id', '=', auth.tenant_id)
        .execute();

      await this.userActivity.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'authusers',
          entity_id: targetId,
          quantity: 1,
          metadata: {
            id: targetId,
            entity_label: `${authUser.first_name} ${authUser.last_name || ''}`.trim(),
            changes: {
              deactivated_at: { from: authUser.deactivated_at ?? null, to: null },
              ...(authUser.deletion_scheduled_at
                ? { deletion_scheduled_at: { from: authUser.deletion_scheduled_at, to: null } }
                : {}),
            },
          },
        },
        trx,
      );
    });

    return { success: true };
  }

  /** Re-sends the invitation email to a user who hasn't activated yet, with a fresh temp password + code. */
  public async adminResendInvite(auth: IAuthKeyPayload, userId: string) {
    // Same capability as inviteUser — locked during the demo (see demo-guard).
    await assertNotDemoMode(this.getRepo().db, auth.tenant_id, DEMO_MODE_INVITES_BLOCKED_MESSAGE);
    const callerRole = auth.role;
    if (callerRole !== 'admin' && callerRole !== 'owner') {
      throw new ForbiddenError('Only admins and owners can resend invitations.');
    }

    const repo = this.getRepo();
    const user = await repo.getOneBy('id', { tenant_id: auth.tenant_id, value: String(userId) });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;

    if (callerRole === 'admin' && authUser.role === 'owner') {
      throw new ForbiddenError('Admins cannot resend invitations for owners.');
    }
    if (authUser.verified) {
      throw new BadRequestError('This user has already activated their account.');
    }
    if (authUser.deactivated_at) {
      throw new BadRequestError('This account is deactivated. Reactivate it before resending the invitation.');
    }

    const tempPassword = this.generateTempPassword();
    const password = await hashPassword(tempPassword);

    await repo.transaction().execute(async (trx) => {
      // The old temp password stops working; the emailed activation link carries a fresh code.
      await trx
        .updateTable('authusers')
        .set({ password, updated_at: new Date(), updatedby_id: auth.user_id })
        .where('id', '=', String(authUser.id))
        .where('tenant_id', '=', auth.tenant_id)
        .execute();

      const codeObj = await repo.addPasswordResetCode(authUser.id, trx);
      await this.enqueueInviteEmail(trx, {
        to: authUser.email,
        tenantId: auth.tenant_id,
        firstName: authUser.first_name,
        inviterName: auth.name,
        tempPassword,
        code: codeObj?.password_reset_code,
      });

      await this.userActivity.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'authusers',
          entity_id: String(authUser.id),
          quantity: 1,
          metadata: {
            id: String(authUser.id),
            entity_label: `${authUser.first_name} ${authUser.last_name || ''}`.trim(),
            action: 'resend_invite',
          },
        },
        trx,
      );
    });

    return { success: true };
  }

  public async adminTriggerPasswordReset(auth: IAuthKeyPayload, userId: string) {
    const callerRole = auth.role;
    if (callerRole === 'user') {
      throw new ForbiddenError('You do not have permission to trigger password resets.');
    }

    const user = await this.getRepo().getOneBy('id', { tenant_id: auth.tenant_id, value: userId });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;

    if (callerRole === 'admin' && authUser.role === 'owner') {
      throw new ForbiddenError('Admins cannot trigger password resets for owners.');
    }

    return await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const codeObj = await this.getRepo().addPasswordResetCode(authUser.id, trx);
        const code = codeObj?.password_reset_code;

        await this.mailService.enqueueMail(
          {
            to: authUser.email,
            tenant_id: auth.tenant_id,
            subject: 'Reset your pplCRM password',
            text: `Hi ${authUser.first_name},\n\nAn administrator has requested a password reset for your pplCRM account.\n\nReset your password using this link:\n${env.appUrl}/new-password?code=${code}\n\nThis link is valid for 15 minutes.`,
            html: `<h2>Reset your password</h2>
<p>Hi ${authUser.first_name},</p>
<p>An administrator has requested a password reset for your pplCRM account. Click the button below to choose a new password:</p>
<div class="btn-container">
  <a href="${env.appUrl}/new-password?code=${code}" class="btn">Reset password</a>
</div>
<p class="warning">For security, this reset link is single-use and expires in 15 minutes.</p>`,
          },
          trx,
        );

        return { success: true };
      });
  }

  public async cancelAccountDeletion(auth: IAuthKeyPayload) {
    const user = await this.getRepo().getOneBy('id', { tenant_id: auth.tenant_id, value: auth.user_id });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;

    await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        await trx.updateTable('authusers').set({ deletion_scheduled_at: null }).where('id', '=', authUser.id).execute();

        await this.mailService.enqueueMail(
          {
            to: authUser.email,
            tenant_id: auth.tenant_id,
            subject: 'Your account deletion was canceled',
            text: `Your request to delete your account has been canceled, and your account is fully restored.`,
            html: `<h2>Account deletion canceled</h2>
<p>Your request to delete your account has been canceled, and your account is fully restored. Welcome back!</p>`,
          },
          trx,
        );
      });

    return { success: true };
  }

  public async cancelEmailChange(auth: IAuthKeyPayload) {
    if (!auth?.user_id) {
      throw new UnauthorizedError();
    }

    const repo = this.getRepo();
    const user = await repo.getOneBy('id', { tenant_id: auth.tenant_id, value: auth.user_id });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    const authUser = user as AuthUsersType;

    if (!authUser.previous_email) {
      throw new BadRequestError('No email change in progress.');
    }

    const previousEmail = authUser.previous_email;

    await repo.transaction().execute(async (trx) => {
      await trx
        .updateTable('authusers')
        .set({
          email: previousEmail,
          // previous_role is nullable; never restore a null role (see DEFAULT_AUTH_ROLE).
          role: isAuthRole(authUser.previous_role) ? authUser.previous_role : DEFAULT_AUTH_ROLE,
          verified: true,
          previous_email: null,
          previous_role: null,
          password_reset_code: null,
          password_reset_code_created_at: null,
          updated_at: new Date(),
          updatedby_id: auth.user_id,
        })
        .where('id', '=', authUser.id)
        .execute();
    });

    return { success: true };
  }

  public async cancelTenantDeletion(auth: IAuthKeyPayload) {
    const db = this.getRepo().db;

    const tenant = await db
      .selectFrom('tenants')
      .select(['id', 'deletion_scheduled_at'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundError('Tenant not found');
    if (!tenant.deletion_scheduled_at) throw new BadRequestError('No deletion is scheduled for this account.');
    if (tenant.deletion_scheduled_at <= new Date()) {
      throw new BadRequestError('The deletion window has already passed and data has been removed.');
    }

    const ownerEmail = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('role', '=', 'owner')
      .executeTakeFirst();

    await db.updateTable('tenants').set({ deletion_scheduled_at: null }).where('id', '=', auth.tenant_id).execute();

    if (ownerEmail?.email) {
      await this.mailService.sendMail({
        to: ownerEmail.email,
        tenant_id: String(auth.tenant_id),
        subject: 'Your account deletion was canceled',
        text: `Hi ${ownerEmail.first_name},\n\nYour account deletion request has been canceled. Your account and all data remain intact.`,
        html: `<h2>Account deletion canceled</h2>
<p>Hi ${ownerEmail.first_name},</p>
<p>Your account deletion request has been canceled. Your account and all data remain intact. Welcome back!</p>`,
      });
    }

    return { success: true };
  }

  public async cancelTenantDeletionByToken(tenantId: string, token: string) {
    const [expiresMs, mac] = token.split('.');
    if (!expiresMs || !mac || !/^\d+$/.test(expiresMs)) {
      throw new BadRequestError('Invalid or expired cancellation link.');
    }
    // Verify the signature over the SAME expiry the caller presented, then check that
    // expiry — so a tampered timestamp fails the MAC and a genuine but stale one fails here.
    const expectedToken = this.makeDeletionCancelToken(tenantId, new Date(Number(expiresMs)));
    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(token.length === expected.length ? token : expectedToken); // same length for safe compare
    if (token.length !== expectedToken.length || !timingSafeEqual(expected, provided)) {
      throw new BadRequestError('Invalid or expired cancellation link.');
    }
    if (Number(expiresMs) < Date.now()) {
      throw new BadRequestError('Invalid or expired cancellation link.');
    }

    const db = this.getRepo().db;
    const tenant = await db
      .selectFrom('tenants')
      .select(['id', 'deletion_scheduled_at'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundError('Account not found.');
    if (!tenant.deletion_scheduled_at) throw new BadRequestError('No deletion is pending for this account.');
    if (tenant.deletion_scheduled_at <= new Date()) {
      throw new BadRequestError('The deletion window has already passed and data has been removed.');
    }

    const ownerEmail = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'owner')
      .executeTakeFirst();

    await db.updateTable('tenants').set({ deletion_scheduled_at: null }).where('id', '=', tenantId).execute();

    if (ownerEmail?.email) {
      await this.mailService.sendMail({
        to: ownerEmail.email,
        subject: 'Your account deletion was canceled',
        text: `Hi ${ownerEmail.first_name},\n\nYour account deletion has been canceled. Your account and all data remain intact. You can sign back in at any time.`,
        html: `<h2>Account deletion canceled</h2>
<p>Hi ${ownerEmail.first_name},</p>
<p>Your account deletion has been canceled. Your account and all data remain intact.</p>
<p><a href="${env.appUrl}/signin">Sign back in</a> to continue using pplCRM.</p>`,
      });
    }

    return { success: true };
  }

  public async currentUser(auth: IAuthKeyPayload) {
    // There's no user ID, which means that the user is unauthorized
    if (!auth?.user_id) {
      throw new UnauthorizedError();
    }
    const options = {
      columns: ['id', 'email', 'first_name', 'role', 'campaign_id', 'verified', 'passkey_setup_dismissed_at'],
    } as QueryParams<'authusers'>;

    try {
      const user = await this.getRepo().getOneBy('id', {
        tenant_id: auth.tenant_id,
        value: auth.user_id,
        options,
      });
      if (!user) return null;

      const typedUser = user as { id: string; verified: boolean; passkey_setup_dismissed_at: Date | null };
      const profile = (await this.profiles.getOneByAuthId(String(typedUser.id))) as Models['profiles'] | undefined;
      const avatar_url = profile?.['avatar_file_id']
        ? signedFileDownloadUrl(String(profile['avatar_file_id']), auth.tenant_id)
        : null;

      let tenant_deletion_scheduled_at: Date | null = null;
      let tenant_paused_at: Date | null = null;
      let tenant_demo_mode_at: Date | null = null;
      let tenant_plan_selected = false;
      let tenant_slug: string | null = null;
      let tenant_org_mode: OrgMode = DEFAULT_ORG_MODE;
      let tenant_module_overrides: Partial<Record<ModuleId, boolean>> = {};
      if (auth.tenant_id) {
        const tenant = await this.getRepo()
          .db.selectFrom('tenants')
          .select(['deletion_scheduled_at', 'paused_at', 'demo_mode_at', 'slug', 'subscription_status'])
          .where('id', '=', auth.tenant_id)
          .executeTakeFirst();
        if (tenant?.deletion_scheduled_at) {
          tenant_deletion_scheduled_at = tenant.deletion_scheduled_at;
        }
        if (tenant?.paused_at) {
          tenant_paused_at = tenant.paused_at;
        }
        tenant_demo_mode_at = tenant?.demo_mode_at ?? null;
        tenant_plan_selected = hasSettledPlan(tenant?.subscription_status);
        tenant_slug = tenant?.slug ?? null;

        // Organization mode rides on the session so the sidebar can label itself before
        // the settings snapshot loads (which no page requests at boot). Both keys in one
        // read; either being absent is normal — every workspace predating modes has neither.
        const modeRows = await this.getRepo()
          .db.selectFrom('settings')
          .select(['key', 'value'])
          .where('tenant_id', '=', auth.tenant_id)
          .where('key', 'in', [ORG_MODE_SETTINGS_KEY, MODULE_VISIBILITY_SETTINGS_KEY])
          .execute();
        for (const row of modeRows) {
          if (row.key === ORG_MODE_SETTINGS_KEY && isOrgMode(row.value)) {
            tenant_org_mode = row.value;
          } else if (row.key === MODULE_VISIBILITY_SETTINGS_KEY) {
            tenant_module_overrides = parseModuleOverrides(row.value);
          }
        }
      }

      return {
        ...user,
        avatar_url,
        email_verified: this.coerceBoolean(typedUser.verified),
        passkey_setup_dismissed_at: typedUser.passkey_setup_dismissed_at ?? null,
        tenant_deletion_scheduled_at,
        tenant_paused_at,
        tenant_demo_mode_at,
        tenant_plan_selected,
        tenant_slug,
        tenant_org_mode,
        tenant_module_overrides,
      };
    } catch (err) {
      throw new InternalError('Something went wrong, please try again', undefined, { cause: err });
    }
  }

  /**
   * Product-tour progress for the signed-in user.
   *
   * Per user and on the profile, not in localStorage: a person learns the app once, not once per
   * browser. (The go-live wizard is the mirror image — per tenant, because a workspace is
   * configured once by whoever gets there first.)
   */
  public async getTourState(auth: IAuthKeyPayload): Promise<TourStateType> {
    const profile = await this.profiles.getOneByAuthId(auth.user_id);
    const prefs = parseProfilePreferences(profile?.preferences);
    return TourStateObj.parse(prefs?.tour ?? {});
  }

  /** Merge a patch into the stored tour state, leaving every other preference untouched. */
  public async setTourState(auth: IAuthKeyPayload, patch: Partial<TourStateType>): Promise<TourStateType> {
    const profile = await this.profiles.getOneByAuthId(auth.user_id);
    if (!profile) {
      // No profile row yet (a user who has never saved one). Tour progress is a convenience, not
      // a reason to create a profile as a side effect, so report the merged value without storing.
      return TourStateObj.parse(patch);
    }

    const existing = (parseProfilePreferences(profile.preferences) as Record<string, unknown> | null) ?? {};
    const next = TourStateObj.parse({ ...TourStateObj.parse(existing['tour'] ?? {}), ...patch });

    await this.profiles.update({
      tenant_id: auth.tenant_id,
      id: String(profile.id),
      row: { preferences: JSON.stringify({ ...existing, tour: next }) } as OperationDataType<'profiles', 'update'>,
    });

    return next;
  }

  public async deleteAvatar(auth: IAuthKeyPayload) {
    const existingProfile = await this.profiles.getOneByAuthId(auth.user_id);
    if (!existingProfile?.avatar_file_id) return { success: true };

    const fileId = existingProfile.avatar_file_id;

    await this.getRepo()
      .db.transaction()
      .execute(async (trx) => {
        try {
          const oldFile = await trx
            .selectFrom('files')
            .select('storage_key')
            .where('tenant_id', '=', auth.tenant_id)
            .where('id', '=', fileId)
            .executeTakeFirst();
          if (oldFile?.storage_key) await this.storage.delete(oldFile.storage_key);
          await trx.deleteFrom('files').where('tenant_id', '=', auth.tenant_id).where('id', '=', fileId).execute();
        } catch {
          /* non-critical */
        }

        await trx
          .updateTable('profiles')
          .set({ avatar_file_id: null, updated_at: new Date(), updatedby_id: auth.user_id })
          .where('tenant_id', '=', auth.tenant_id)
          .where('auth_id', '=', auth.user_id)
          .execute();
      });

    return { success: true };
  }

  public async deleteUser(auth: IAuthKeyPayload, userId: string) {
    const callerRole = auth.role;
    if (callerRole !== 'admin' && callerRole !== 'owner') {
      throw new ForbiddenError('Only admins and owners can delete users.');
    }

    const userIdToDelete = String(userId);
    if (userIdToDelete === auth.user_id) {
      throw new BadRequestError('You cannot delete yourself.');
    }

    const repo = this.getRepo();
    const user = await repo.getOneBy('id', { tenant_id: auth.tenant_id, value: userIdToDelete });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;
    if (authUser.deleted_at) throw new NotFoundError('User not found');

    if (callerRole === 'admin' && authUser.role === 'owner') {
      throw new ForbiddenError('Admins cannot delete owner accounts.');
    }

    return await repo.transaction().execute(async (trx) => {
      // Tombstone, not hard delete: ~61 NO ACTION FKs (createdby_id etc.) reference authusers,
      // so a DELETE 23503s for any user who ever authored content — which reached the admin as a
      // generic 500. The identity (email, name, credentials, avatar, sessions, passkeys) is
      // scrubbed/removed; their contributions stay with the workspace as "Deleted user". Same
      // semantics as self-service scheduled deletion. entity_label below was captured from
      // authUser BEFORE the scrub.
      await tombstoneAuthUser(trx, { tenantId: auth.tenant_id, userId: userIdToDelete, updatedbyId: auth.user_id });

      await this.ensureAtLeastOneOwner(auth.tenant_id, trx, false, userIdToDelete);

      await this.userActivity.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'delete',
          entity: 'authusers',
          entity_id: userIdToDelete,
          quantity: 1,
          metadata: {
            id: userIdToDelete,
            entity_label: `${authUser.first_name} ${authUser.last_name || ''}`.trim(),
          },
        },
        trx,
      );

      return { success: true };
    });
  }

  public async dismissPasskeyPrompt(auth: IAuthKeyPayload) {
    await this.getRepo()
      .db.updateTable('authusers')
      .set({ passkey_setup_dismissed_at: new Date() })
      .where('id', '=', auth.user_id)
      .where('tenant_id', '=', auth.tenant_id)
      .execute();
    return { success: true };
  }

  public async ensureAtLeastOneOwner(
    tenantId: string,
    trx: Transaction<Models>,
    isRoleChange = false,
    excludeUserId?: string,
  ) {
    const activeOwners = await trx
      .selectFrom('authusers')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where((eb) =>
        eb.or([eb('role', '=', 'owner'), eb.and([eb('role', '=', 'viewer'), eb('previous_role', '=', 'owner')])]),
      )
      .where('deletion_scheduled_at', 'is', null)
      .where('deactivated_at', 'is', null)
      .where('deleted_at', 'is', null)
      .execute();

    if (activeOwners.length > 0) {
      return;
    }

    // Find the oldest active user to promote — never a tombstoned (deleted) row.
    let query = trx
      .selectFrom('authusers')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('deletion_scheduled_at', 'is', null)
      .where('deactivated_at', 'is', null)
      .where('deleted_at', 'is', null);

    if (excludeUserId) {
      query = query.where('id', '!=', excludeUserId);
    }

    const oldestUser = await query.orderBy('created_at', 'asc').executeTakeFirst();

    if (oldestUser) {
      await trx.updateTable('authusers').set({ role: 'owner' }).where('id', '=', oldestUser.id).execute();
    } else if (isRoleChange) {
      throw new BadRequestError('The system must have at least one owner.');
    }
  }

  public async getAllUsers(auth: IAuthKeyPayload, options?: getAllOptionsType) {
    const sanitizedOptions = options ? ({ ...options, columns: undefined } as typeof options) : undefined;
    const result = await this.getRepo().getAllWithCounts({
      tenant_id: auth.tenant_id,
      options: sanitizedOptions as never,
    });
    return {
      rows: result.rows.map((row) => ({
        ...this.sanitizeUser(row),
        avatar_url: row['avatar_file_id'] ? signedFileDownloadUrl(String(row['avatar_file_id']), auth.tenant_id) : null,
      })),
      count: result.count,
    };
  }

  public async getTenantAccountStatus(auth: IAuthKeyPayload) {
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select(['deletion_scheduled_at', 'suspended_at', 'paused_at'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundError('Tenant not found');

    return {
      deletion_scheduled_at: tenant.deletion_scheduled_at ?? null,
      suspended_at: tenant.suspended_at ?? null,
      paused_at: tenant.paused_at ?? null,
    };
  }

  /** Seat usage for the invite/users UI: plan name, seat limit, and seats consumed (invited counts too). */
  public async getSeatUsage(auth: IAuthKeyPayload) {
    const db = this.getRepo().db;

    const tenant = await db
      .selectFrom('tenants')
      .select(['subscription_plan', 'subscription_quantity'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    if (!tenant) throw new NotFoundError('Tenant not found');

    const plan = (tenant.subscription_plan as string | null) || 'free';
    const limits = getPlanLimits(plan, tenant.subscription_quantity ?? 1);

    // Matches the billing usage check: every non-deactivated login (including pending invites) holds a seat.
    const seatRow = await db
      .selectFrom('authusers')
      .select((eb) => eb.fn.countAll().as('cnt'))
      .where('tenant_id', '=', auth.tenant_id)
      .where('deletion_scheduled_at', 'is', null)
      .where('deactivated_at', 'is', null)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return { plan, seatLimit: limits.seats, seatsUsed: Number(seatRow?.cnt ?? 0) };
  }

  public async getUserById(auth: IAuthKeyPayload, id: string) {
    const callerRole = auth.role;
    if (callerRole === 'user' && auth.user_id !== String(id)) {
      throw new ForbiddenError('You do not have permission to view this user.');
    }

    const record = await this.getRepo().getOneBy('id', { tenant_id: auth.tenant_id, value: id });
    if (!record) throw new NotFoundError('User not found');
    const authUser = record as AuthUsersType;
    const profile = (await this.profiles.getOneByAuthId(String(authUser.id))) as Models['profiles'] | undefined;
    const stats = await this.buildUserStats(auth, String(authUser.id));
    const sanitized = this.sanitizeUser({ ...authUser, profile });
    const avatar_url = profile?.['avatar_file_id']
      ? signedFileDownloadUrl(String(profile['avatar_file_id']), auth.tenant_id)
      : null;
    return { ...sanitized, avatar_url, stats };
  }

  public async getUsersList(auth: IAuthKeyPayload) {
    const result = await this.getRepo().getAllWithCounts({
      tenant_id: auth.tenant_id,
    });
    return result.rows.map((row) => ({
      ...this.sanitizeUser(row),
      avatar_url: row['avatar_file_id'] ? signedFileDownloadUrl(String(row['avatar_file_id']), auth.tenant_id) : null,
    }));
  }

  public async inviteUser(auth: IAuthKeyPayload, input: InviteAuthUserType) {
    // Demo teammates are seeded; real invites unlock with a plan (see demo-guard).
    await assertNotDemoMode(this.getRepo().db, auth.tenant_id, DEMO_MODE_INVITES_BLOCKED_MESSAGE);
    const callerRole = auth.role;
    // Deny by default: only admins and owners invite. Testing for `=== 'user'` let a
    // null-role account through, which is more access than an Editor has.
    if (!isPrivilegedRole(callerRole)) {
      throw new ForbiddenError('You do not have permission to invite users.');
    }
    if (callerRole === 'admin' && input.role === 'owner') {
      throw new ForbiddenError('Admins cannot invite users with the Owner role.');
    }

    const email = input.email.toLowerCase();
    await this.verifyUserDoesNotExist(email);

    // Seat cap: enforce the plan's staff-seat allowance up front. Every non-deactivated login,
    // including still-pending invites, holds a seat (matches getSeatUsage and the billing usage
    // check), so a full workspace must free or buy a seat before adding another — otherwise the
    // limit is only ever measured after the fact by the async usage job.
    const seatTenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select(['subscription_plan', 'subscription_quantity'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    const seatLimit = getPlanLimits(
      seatTenant?.subscription_plan ?? null,
      seatTenant?.subscription_quantity ?? 1,
    ).seats;
    if (Number.isFinite(seatLimit)) {
      const seatRow = await this.getRepo()
        .db.selectFrom('authusers')
        .select((eb) => eb.fn.countAll().as('cnt'))
        .where('tenant_id', '=', auth.tenant_id)
        .where('deletion_scheduled_at', 'is', null)
        .where('deactivated_at', 'is', null)
        .executeTakeFirst();
      if (Number(seatRow?.cnt ?? 0) >= seatLimit) {
        throw new ForbiddenError(
          `Your plan includes ${seatLimit} staff seat${seatLimit === 1 ? '' : 's'}, all of which are in use. ` +
            `Upgrade your plan or deactivate a user before inviting another.`,
        );
      }
    }

    // Fall back to the tenant's configured default invite role when the caller didn't specify
    // one, and to the least-privileged working role when the tenant has not configured one.
    // A null role must never reach the database — see DEFAULT_AUTH_ROLE.
    let role: string = input.role ?? '';
    if (!role) {
      const defaultRole = await this.getTenantSetting(auth.tenant_id, 'access.default_role');
      // Only honour a recognised role; an unknown setting value would land a role that
      // no permission check accounts for.
      if (isAuthRole(defaultRole?.toString().trim())) role = String(defaultRole).trim();
    }
    if (!role) role = DEFAULT_AUTH_ROLE;
    if (callerRole === 'admin' && role === 'owner') {
      throw new ForbiddenError('Admins cannot invite users with the Owner role.');
    }

    // Campaigns §15 — the invitee's admin-assigned campaign; null = office context.
    const campaignId = await this.resolveAssignableCampaignId(auth.tenant_id, input.campaign_id);

    const tempPassword = this.generateTempPassword();
    const password = await hashPassword(tempPassword);
    const repo = this.getRepo();

    const created = await repo.transaction().execute(async (trx) => {
      const row = {
        tenant_id: auth.tenant_id,
        email,
        password,
        first_name: input.first_name,
        role,
        campaign_id: campaignId,
        verified: false,
        createdby_id: auth.user_id,
        updatedby_id: auth.user_id,
      } as OperationDataType<'authusers', 'insert'>;
      const user = await repo.add({ row }, trx);
      if (!user) throw new InternalError('User creation failed');

      const profileRow = {
        id: user.id,
        tenant_id: auth.tenant_id,
        auth_id: user.id,
        last_name: input.last_name ?? null,
        createdby_id: auth.user_id,
        updatedby_id: auth.user_id,
      } as OperationDataType<'profiles', 'insert'>;
      await this.profiles.add({ row: profileRow }, trx);

      const codeObj = await repo.addPasswordResetCode(user.id, trx);
      await this.enqueueInviteEmail(trx, {
        to: email,
        tenantId: auth.tenant_id,
        firstName: input.first_name,
        inviterName: auth.name,
        tempPassword,
        code: codeObj?.password_reset_code,
      });

      await this.userActivity.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'create',
          entity: 'authusers',
          entity_id: String(user.id),
          quantity: 1,
          metadata: {
            id: String(user.id),
            entity_label: `${user.first_name} ${input.last_name || ''}`.trim(),
          },
        },
        trx,
      );

      return user;
    });

    const db = repo.db;
    try {
      const { queueUsageLimitCheck } = await import('../billing/usage-limits');
      await queueUsageLimitCheck(auth.tenant_id, db);
    } catch (err) {
      logger.error({ err }, 'Failed to trigger usage check in inviteUser');
    }

    return this.sanitizeUser({ ...created, last_name: input.last_name });
  }

  /**
   * Mint the "undo the scheduled deletion" link token.
   *
   * SECURITY (M5): this used to be a bare HMAC of the tenant id — deterministic and
   * therefore PERMANENT. One leaked cancellation email (a forwarded message, a shared
   * inbox, a mail archive) was a capability to un-delete that account forever, and the
   * procedure that consumes it is unauthenticated. The expiry is now inside the signed
   * payload, so the link stops working on its own.
   */
  public makeDeletionCancelToken(tenantId: string, expiresAt?: Date): string {
    const expiry = expiresAt ?? new Date(Date.now() + DELETION_CANCEL_TOKEN_TTL_MS);
    const expiresMs = String(expiry.getTime());
    const mac = createHmac('sha256', env.sharedSecret).update(`cancel-deletion:${tenantId}:${expiresMs}`).digest('hex');
    return `${expiresMs}.${mac}`;
  }

  public async pauseTenant(auth: IAuthKeyPayload) {
    const db = this.getRepo().db;

    const tenant = await db
      .selectFrom('tenants')
      .select(['id', 'paused_at'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundError('Tenant not found');
    if (tenant.paused_at) throw new BadRequestError('Account is already paused.');

    const ownerEmail = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('role', '=', 'owner')
      .executeTakeFirst();

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('tenants').set({ paused_at: new Date() }).where('id', '=', auth.tenant_id).execute();

      // Sign out all users immediately so the pause takes effect for active sessions
      await trx.deleteFrom('sessions').where('tenant_id', '=', auth.tenant_id).execute();
    });

    if (ownerEmail?.email) {
      await this.mailService.sendMail({
        to: ownerEmail.email,
        tenant_id: String(auth.tenant_id),
        subject: 'Your account has been paused',
        text: `Hi ${ownerEmail.first_name},\n\nYour account has been paused. Your data is preserved and billing has been paused. You can reactivate your account at any time by logging back in and visiting your account settings.`,
        html: `<h2>Account paused</h2>
<p>Hi ${ownerEmail.first_name},</p>
<p>Your account has been paused as requested. Your data is safely preserved and you will not be billed during this period.</p>
<p>You can reactivate your account at any time by signing back in and visiting your account settings.</p>`,
      });
    }

    return { success: true };
  }

  /**
   * Issue a fresh access token from the refresh token alone (delivered via the HttpOnly cookie,
   * SECURITY-REVIEW.md 2.1). It deliberately does NOT require the (possibly gone) access token, so
   * the client can silently re-auth on a cold page load using only the cookie. The refresh token is
   * the sole authenticator here, and it's rotated on every use.
   */
  public async renewAuthToken(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedError();
    }
    try {
      const refreshHash = hashToken(refreshToken);

      // Resolve the session by the refresh token hash. Cross-tenant by design — the refresh token
      // itself identifies which session (and therefore tenant) this is. Rotated sessions are
      // accepted here (their reuse window is checked below) so concurrent renewals replaying the
      // same cookie don't strand a tab.
      // eslint-disable-next-line local/no-unscoped-db-query
      const session = await this.sessions.db
        .selectFrom('sessions')
        .select(['id', 'user_id', 'tenant_id', 'session_id', 'expires_at', 'last_used_at', 'status'])
        .where('refresh_token', '=', refreshHash)
        .where('status', 'in', ['active', 'rotated'])
        .executeTakeFirst();

      if (!session) {
        throw new UnauthorizedError();
      }

      const now = new Date();

      // A rotated session's refresh token stays honored for a short reuse window so concurrent
      // renewals (two tabs cold-loading with the same cookie, or a rotation response lost to a
      // dev-server restart) succeed instead of signing a tab out. Beyond the window, a replay is
      // treated as a stolen/reused token. `last_used_at` was stamped at rotation time by
      // markRotatedBySessionHash, so here it is the rotation timestamp.
      if (session.status === 'rotated') {
        const rotatedAgoMs = session.last_used_at ? now.getTime() - session.last_used_at.getTime() : Infinity;
        if (rotatedAgoMs > ROTATION_REUSE_GRACE_MS) {
          throw new UnauthorizedError();
        }
      }

      if (session.expires_at && session.expires_at < now) {
        throw new UnauthorizedError('Session has expired. Please sign in again.');
      }

      if (session.last_used_at) {
        const idleMs = now.getTime() - session.last_used_at.getTime();
        if (idleMs > IDLE_TIMEOUT_MS) {
          throw new UnauthorizedError('Session timed out due to inactivity. Please sign in again.');
        }
      }

      // The JWT carries the user's display name; pull it from the account (scoped to the session's
      // tenant) since we no longer have the old token to read it from.
      const user = await this.getRepo()
        .db.selectFrom('authusers')
        .select(['first_name'])
        .where('id', '=', session.user_id)
        .where('tenant_id', '=', session.tenant_id)
        .executeTakeFirst();

      if (!user) {
        throw new UnauthorizedError();
      }

      // Rotate: mint a new session/refresh pair (preserving the original absolute expiry). The old
      // session is marked rotated rather than deleted: the auth gates stop accepting it
      // immediately, but its refresh token remains replayable within ROTATION_REUSE_GRACE_MS (see
      // above) so a sibling tab holding the same cookie can still re-auth. Access tokens that
      // still reference it recover via the client's refresh-and-retry on UNAUTHORIZED.
      const tokens = await this.createTokens({
        user_id: String(session.user_id),
        tenant_id: String(session.tenant_id),
        name: user.first_name ?? '',
        existingExpiresAt: session.expires_at ?? null,
      });
      if (session.status === 'active') {
        await this.sessions.markRotatedBySessionHash(session.session_id, String(session.tenant_id));
      }
      // Sweep this user's rotated sessions whose reuse window has passed — they're inert.
      await this.sessions.deleteRotatedBefore(
        String(session.user_id),
        String(session.tenant_id),
        new Date(now.getTime() - ROTATION_REUSE_GRACE_MS),
      );
      return tokens;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new UnauthorizedError();
    }
  }

  public async resendVerificationEmail(email: string) {
    // Never reveal whether an account exists (or is already verified): return a
    // uniform success for unknown/verified addresses to prevent enumeration.
    let user: AuthUsersType;
    try {
      user = await this.getUserByEmail(email);
    } catch (err) {
      if (err instanceof NotFoundError) return { success: true };
      throw err;
    }
    if (user.verified) {
      return { success: true };
    }
    return await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const codeObj = await this.getRepo().addPasswordResetCode(user.id, trx);
        const code = codeObj?.password_reset_code;

        await this.mailService.enqueueMail(
          {
            to: email,
            tenant_id: user.tenant_id ? String(user.tenant_id) : null,
            subject: 'Verify your email address',
            text: `We need to verify your email address so you can use your pplCRM account. Verify it using this link: ${env.appUrl}/verify-email?code=${code}`,
            html: `<h2>Verify your email address</h2>
<p>We need to verify your email address so you can use your pplCRM account. Click the button below to verify it:</p>
<div class="btn-container">
  <a href="${env.appUrl}/verify-email?code=${code}" class="btn">Verify email address</a>
</div>
<p class="warning">For security, this link expires in 24 hours.</p>`,
          },
          trx,
        );
        return { success: true };
      });
  }

  public async resetPassword(plaintextPassword: string, code: string) {
    await this.validateNewPassword(plaintextPassword);
    const password = await hashPassword(plaintextPassword);

    const user = await this.getRepo()
      .db.selectFrom('authusers')
      .select(['email', 'first_name', 'tenant_id', 'verified'])
      .where('password_reset_code', '=', hashToken(code))
      .executeTakeFirst();

    if (!user) {
      throw new BadRequestError('Invalid or expired password reset link.');
    }

    // Check if the code is valid. An unverified user is activating an invitation — that link
    // lives 7 days; a password reset for an established account stays short-lived.
    const msec = await this.getCodeAge(code);
    if (user.verified) {
      if (msec > PASSWORD_RESET_CODE_MAX_AGE_MS) {
        throw new BadRequestError('The code is expired. Please request a new code');
      }
    } else if (msec > INVITE_ACTIVATION_MAX_AGE_MS) {
      throw new BadRequestError('This invitation has expired. Ask an administrator to send a new one.');
    }

    await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // Invalidate all active sessions for this user
        const u = await trx
          .selectFrom('authusers')
          .select('id')
          .where('password_reset_code', '=', hashToken(code))
          .executeTakeFirst();
        if (u) {
          await trx.deleteFrom('sessions').where('user_id', '=', u.id).execute();
        }

        const result = await this.getRepo().updatePassword(password, code, trx);
        if (result.numUpdatedRows === BigInt(0)) {
          throw new UnauthorizedError();
        }

        await this.mailService.enqueueMail(
          {
            to: user.email,
            tenant_id: user.tenant_id ? String(user.tenant_id) : null,
            subject: 'Your pplCRM password was changed',
            text: `Hi ${user.first_name},\n\nThis is a confirmation that the password for your pplCRM account was recently changed. If you did not make this change, please contact support immediately.`,
            html: `<h2>Password changed</h2>
<p>Hi ${user.first_name},</p>
<p>This is a confirmation that the password for your pplCRM account was recently changed.</p>
<p class="warning">If you did not make this change, please contact support immediately.</p>`,
          },
          trx,
        );
      });
  }

  public async resumeTenant(auth: IAuthKeyPayload) {
    const db = this.getRepo().db;

    const tenant = await db
      .selectFrom('tenants')
      .select(['id', 'paused_at'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundError('Tenant not found');
    if (!tenant.paused_at) throw new BadRequestError('Account is not paused.');

    const ownerEmail = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('role', '=', 'owner')
      .executeTakeFirst();

    await db.updateTable('tenants').set({ paused_at: null }).where('id', '=', auth.tenant_id).execute();

    if (ownerEmail?.email) {
      await this.mailService.sendMail({
        to: ownerEmail.email,
        tenant_id: String(auth.tenant_id),
        subject: 'Your account has been reactivated',
        text: `Hi ${ownerEmail.first_name},\n\nYour account has been successfully reactivated. Welcome back!`,
        html: `<h2>Account reactivated</h2>
<p>Hi ${ownerEmail.first_name},</p>
<p>Your account has been reactivated. Everything is back to normal. Welcome back!</p>`,
      });
    }

    return { success: true };
  }

  public async scheduleAccountDeletion(auth: IAuthKeyPayload) {
    const repo = this.getRepo();
    const user = await repo.getOneBy('id', { tenant_id: auth.tenant_id, value: auth.user_id });
    if (!user) throw new NotFoundError('User not found');
    const authUser = user as AuthUsersType;
    const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await repo.transaction().execute(async (trx) => {
      await trx
        .updateTable('authusers')
        .set({ deletion_scheduled_at: deletionDate })
        .where('id', '=', authUser.id)
        .execute();

      await this.ensureAtLeastOneOwner(auth.tenant_id, trx, false, String(authUser.id));

      await this.mailService.enqueueMail(
        {
          to: authUser.email,
          tenant_id: auth.tenant_id,
          subject: 'Your account is scheduled for deletion',
          text: `Hi ${authUser.first_name},\n\nYour account has been scheduled for deletion on ${deletionDate.toLocaleDateString()}.\n\nIf this was a mistake, you can cancel the deletion at any time before this date by signing back in.`,
          html: `<h2>Account scheduled for deletion</h2>
<p>Hi ${authUser.first_name},</p>
<p>As requested, your pplCRM account has been scheduled for permanent deletion on <strong>${deletionDate.toLocaleDateString()}</strong>.</p>
<p>Your sign-in and personal details (email, name, credentials) will be permanently removed. Work you contributed to your organization's workspace stays with that workspace, attributed to "Deleted user". If you change your mind, you can cancel this request at any time before the deletion date by simply signing back in.</p>
<p class="warning">If you did not make this request, please sign in immediately to cancel the deletion and secure your account.</p>`,
        },
        trx,
      );
    });

    return { success: true, deletion_scheduled_at: deletionDate };
  }

  public async scheduleTenantDeletion(auth: IAuthKeyPayload) {
    const db = this.getRepo().db;

    const tenant = await db
      .selectFrom('tenants')
      .select(['id', 'name', 'deletion_scheduled_at'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!tenant) throw new NotFoundError('Tenant not found');
    if (tenant.deletion_scheduled_at) throw new BadRequestError('Account deletion is already scheduled.');

    const ownerEmail = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('role', '=', 'owner')
      .executeTakeFirst();

    const deletionDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const cancelToken = this.makeDeletionCancelToken(String(auth.tenant_id));
    const cancelUrl = `${env.appUrl}/cancel-deletion?tid=${auth.tenant_id}&token=${cancelToken}`;
    const deletionDateStr = deletionDate.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('tenants')
        .set({ deletion_scheduled_at: deletionDate })
        .where('id', '=', auth.tenant_id)
        .execute();

      // Invalidate every active session for the tenant so all users are signed out immediately
      await trx.deleteFrom('sessions').where('tenant_id', '=', auth.tenant_id).execute();

      if (ownerEmail?.email) {
        await this.mailService.enqueueMail(
          {
            to: ownerEmail.email,
            tenant_id: String(auth.tenant_id),
            subject: 'Your account is scheduled for deletion in 24 hours',
            text: `Hi ${ownerEmail.first_name},\n\nYour organization account has been scheduled for permanent deletion. All data will be permanently removed on ${deletionDateStr}.\n\nChanged your mind? You have 24 hours to cancel:\n${cancelUrl}\n\nAfter that, all data will be permanently removed and cannot be recovered.`,
            html: `<h2>Account scheduled for deletion</h2>
<p>Hi ${ownerEmail.first_name},</p>
<p>Your organization account has been scheduled for permanent deletion on <strong>${deletionDateStr}</strong>. All data associated with your account (contacts, emails, campaigns, and everything else) will be permanently and irreversibly removed.</p>
<p><strong>Changed your mind?</strong> You have 24 hours to cancel this request:</p>
<div class="btn-container">
  <a href="${cancelUrl}" class="btn">Cancel account deletion</a>
</div>
<p class="warning">After the 24-hour window, all data will be permanently deleted and cannot be recovered.</p>`,
          },
          trx,
        );
      }
    });

    return { success: true };
  }

  public async sendPasswordResetEmail(email: string) {
    // Never reveal whether an account exists: return success uniformly so an
    // attacker cannot enumerate registered emails via this endpoint.
    let user: AuthUsersType;
    try {
      user = await this.getUserByEmail(email);
    } catch (err) {
      if (err instanceof NotFoundError) return true;
      throw err;
    }
    await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const codeObj = await this.getRepo().addPasswordResetCode(user.id, trx);
        const code = codeObj?.password_reset_code;

        // send the reset email
        await this.mailService.enqueueMail(
          {
            to: email,
            tenant_id: user.tenant_id ? String(user.tenant_id) : null,
            subject: 'Reset your pplCRM password',
            text: `We received a request to reset the password for your pplCRM account. Reset it using this link: ${env.appUrl}/new-password?code=${code}`,
            html: `<h2>Reset your password</h2>
<p>We received a request to reset the password for your pplCRM account. Click the button below to choose a new password:</p>
<div class="btn-container">
  <a href="${env.appUrl}/new-password?code=${code}" class="btn">Reset password</a>
</div>
<p>If you did not request a password reset, no further action is required.</p>
<p class="warning">This reset link is single-use and expires in 15 minutes.</p>`,
          },
          trx,
        );
      });
    return true;
  }

  public async signIn(input: signInInputType, ipAddress?: string, userAgent?: string) {
    const email = input.email.toLowerCase();

    // SECURITY (M1): the only sign-in limit was per-IP, so a botnet spreading attempts
    // across addresses faced no ceiling at all against one known email. This counter is
    // keyed on the ACCOUNT and is durable (shared across replicas, survives deploys).
    //
    // The check runs before the lookup and the message is the generic sign-in error, so
    // "locked" and "wrong password" stay indistinguishable — a lockout that announces
    // itself is an enumeration oracle in its own right.
    const priorFailures = await assertSignInAttemptsRemaining(email);

    const user = await this.getUserByEmailOrNull(email);

    // Always run a password verification — against a dummy hash when the account does not exist —
    // so a non-existent email and a wrong password cost the same and fail with the same 401. This
    // closes the enumeration oracle: previously an unknown email threw NotFoundError (404) and
    // returned faster (no argon2), distinguishing registered emails despite the generic message.
    const valid = await verifyPasswordConstantTime(input.password, user?.password);
    if (!user || !valid) {
      await recordFailedSignIn(email);
      throw new UnauthorizedError();
    }

    // A correct password clears the counter, so an ordinary user who mistypes a few times
    // then succeeds is never left locked out.
    await clearSignInAttempts(email, priorFailures);

    // Checked before the verified/deletion branches: a deactivated account must not receive
    // "verify your email" guidance, and signing in must NOT auto-restore it (that shortcut is
    // only for self-scheduled deletion below).
    if (user.deactivated_at) {
      throw new ForbiddenError('This account has been deactivated. Contact an administrator to restore access.');
    }

    if (!user.verified) {
      throw new ForbiddenError(
        'Your email address is not verified yet. Please check your inbox (and spam folder) for a verification link.',
      );
    }

    // Tenant-wide MFA enforcement: when enabled, every user gets the email-OTP challenge on a new
    // device/location, even if they never individually enabled two-factor auth.
    const tenantMfaRequired = (await this.getTenantSetting(user.tenant_id, 'access.mfa_required')) === true;
    const requires2FA =
      (user.two_factor_enabled || tenantMfaRequired) &&
      (await this.isNewDeviceOrLocation(String(user.id), ipAddress, userAgent));

    if (requires2FA) {
      const otpCode = randomInt(100000, 1000000).toString();
      await this.getRepo()
        .db.updateTable('authusers')
        .set({
          // Store only the hash; the plaintext OTP is emailed to the user.
          two_factor_code: hashToken(otpCode),
          two_factor_expires_at: new Date(Date.now() + 5 * 60 * 1000),
          // Reset the failed-attempt counter for this fresh challenge.
          two_factor_attempts: 0,
        })
        .where('id', '=', user.id)
        .execute();

      await this.mailService.sendMail({
        to: user.email,
        tenant_id: user.tenant_id ? String(user.tenant_id) : null,
        subject: 'Your pplCRM sign-in code',
        text: `Your sign-in verification code is ${otpCode}. It expires in 5 minutes.`,
        html: `<h2>Your sign-in code</h2>
<p>Use the 6-digit code below to finish signing in. It is valid for 5 minutes.</p>
<div class="otp-container">
  <span class="otp-code">${otpCode}</span>
</div>
<p class="warning">If you did not try to sign in, please secure your account immediately.</p>`,
      });

      return { requires2FA: true, email: user.email };
    }

    if (user.deletion_scheduled_at) {
      await this.getRepo()
        .db.updateTable('authusers')
        .set({ deletion_scheduled_at: null })
        .where('id', '=', user.id)
        .execute();

      await this.mailService.sendMail({
        to: user.email,
        tenant_id: user.tenant_id ? String(user.tenant_id) : null,
        subject: 'Your account has been restored',
        text: `Welcome back! Your request to delete your account has been canceled, and your account is fully restored.`,
        html: `<h2>Account restored</h2>
<p>Welcome back! Your request to delete your account has been canceled, and your account is fully restored.</p>`,
      });
    }

    if (user.tenant_id) {
      const tenant = await this.getRepo()
        .db.selectFrom('tenants')
        .select(['suspended_at', 'paused_at'])
        .where('id', '=', user.tenant_id)
        .executeTakeFirst();

      if (tenant?.suspended_at) {
        throw new ForbiddenError(
          'This account has been suspended. Please contact support if you believe this is an error.',
        );
      }
      // Paused accounts (user-initiated) allow login so the owner can reactivate from settings
    }

    // Closed beta: last check before a session exists, so an unapproved workspace never holds
    // a token. Runs after the credential checks so it cannot be used to probe which
    // organizations have signed up.
    await assertTenantApprovedForSignIn(user.tenant_id ? String(user.tenant_id) : null);

    return this.createTokens({
      user_id: String(user.id),
      tenant_id: String(user.tenant_id),
      name: user.first_name,
      ipAddress,
      userAgent,
      rememberMe: input.rememberMe,
    });
  }

  public async signOut(auth: IAuthKeyPayload | null) {
    if (!auth?.session_id) {
      return null;
    }
    return this.sessions.deleteBySessionId(auth.session_id);
  }

  public async signUp(input: signUpInputType) {
    const email = input.email.toLowerCase();
    // Zod defaults this, but signUp is also reachable from tests and internal callers that
    // build the input by hand — fall back rather than seeding an undefined mode.
    const orgMode: OrgMode = isOrgMode(input.mode) ? input.mode : DEFAULT_ORG_MODE;
    let token: { auth_token: string; refresh_token: string; refresh_expires_at: Date | null } = {
      auth_token: '',
      refresh_token: '',
      refresh_expires_at: null,
    };

    // Closed beta: the workspace is built in full but held until pplCRM ops approves it
    // (see modules/auth/tenant-approval.ts). While it is pending, signUp deliberately
    // returns no session — the account exists, but nothing can sign into it yet.
    const approval = { status: initialApprovalStatus(), ...mintApprovalToken() };
    const approvalPending = approval.status === 'pending';

    // Anti-abuse: throwaway inboxes are the raw material of spam accounts. A real org signs up
    // with a mailbox it keeps; verification links also die with a temporary inbox anyway.
    if (isDisposableEmail(email)) {
      throw new BadRequestError(
        'Temporary or disposable email addresses cannot be used to sign up. Please use your organization or personal mailbox.',
      );
    }

    try {
      await this.verifyUserDoesNotExist(email);
      await this.validateNewPassword(input.password);
      const password = await hashPassword(input.password);

      await this.tenants.transaction().execute(async (trx) => {
        const tenant_id = await this.createTenant(trx, input.organization, approval);
        const user = await this.createUser(trx, tenant_id, password, email, input);
        const userId = String(user.id);
        const profile = await this.createProfile(trx, user.id, tenant_id, user.id);
        await this.updateTenantWithAdmin(trx, tenant_id, user.id, user.id);

        // Create the tenant's permanent office context (Campaigns §15). Election
        // campaigns are added later by the user; this one always exists.
        const campaign = await trx
          .insertInto('campaigns')
          .values({
            tenant_id,
            admin_id: user.id,
            createdby_id: user.id,
            updatedby_id: user.id,
            name: `${input.organization} Office`,
            kind: 'office',
            status: 'active',
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        // Create default settings (current_campaign and notifications)
        await trx
          .insertInto('settings')
          .values([
            {
              tenant_id,
              key: 'current_campaign',
              value: { id: Number(campaign.id) },
              createdby_id: user.id,
              updatedby_id: user.id,
            },
            {
              tenant_id,
              key: 'notifications',
              value: false,
              createdby_id: user.id,
              updatedby_id: user.id,
            },
            {
              tenant_id,
              // `settings.value` is jsonb: a bare string is not valid JSON, so this has to
              // go in as `"office"`, not `office`. The `false` above works only because a
              // JSON boolean and a JS boolean serialize identically.
              key: ORG_MODE_SETTINGS_KEY,
              value: JSON.stringify(orgMode),
              createdby_id: user.id,
              updatedby_id: user.id,
            },
          ])
          .execute();

        // Create the tenant's permanent placeholder household and store its ID on
        // the tenant so it can be quickly identified without scanning all households.
        const placeholderHousehold = await trx
          .insertInto('households')
          .values({
            tenant_id,
            campaign_id: campaign.id,
            createdby_id: user.id,
            updatedby_id: user.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await trx
          .updateTable('tenants')
          .set({ placeholder_household_id: placeholderHousehold.id })
          .where('id', '=', tenant_id)
          .execute();

        // Starter tags/issues and forms survive exit-demo; the demo dataset does
        // not — see modules/demo. Tags first: the demo seeder attaches to them by name.
        await seedStarterTags({ tenant_id, user_id: userId, mode: orgMode }, trx);
        const starterForms = await seedStarterForms(
          { tenant_id, user_id: userId, campaign_id: campaign.id, mode: orgMode },
          trx,
        );
        // Built-in lists (§8) — product-owned, so they are seeded here rather
        // than with the demo data and survive exiting demo mode.
        await ensureSystemLists({ tenant_id, user_id: userId, campaign_id: String(campaign.id) }, trx);
        // Each mode gets the demo workspace written for it (demo-datasets.ts). A mode with no
        // dataset yet starts clean — `demo_mode_at` stays null, which is already what
        // GoLiveService.demoDone reads.
        const demoDataset = demoDatasetFor(orgMode);
        if (demoDataset) {
          await seedDemoData(
            {
              tenant_id,
              user_id: userId,
              campaign_id: String(campaign.id),
              placeholder_household_id: String(placeholderHousehold.id),
              forms: starterForms,
              dataset: demoDataset,
            },
            trx,
          );
        }
        // Queue the built-ins' first membership refresh AFTER the demo people
        // exist (and in the same transaction — transactional outbox), so the
        // Lists page shows real counts on first visit instead of two zeroes.
        await queueSystemListRefreshes({ tenant_id, user_id: userId, campaign_id: String(campaign.id) }, trx);

        const codeObj = await this.getRepo().addPasswordResetCode(user.id, trx);
        const verificationCode = codeObj?.password_reset_code;
        // Verification is still worth doing while the workspace waits: by the time ops
        // approves, the address is already confirmed and the owner can sign straight in.
        const waitlistNote = approvalPending
          ? `<p>pplCRM is in beta, so new workspaces are reviewed before they open. Verify your address now and we will email you as soon as yours is ready.</p>`
          : '';
        await this.mailService.enqueueMail(
          {
            to: email,
            tenant_id,
            subject: 'Welcome to pplCRM! Verify your email address',
            text: `Welcome to pplCRM! We need to verify your email address so you can use your pplCRM account. Verify it using this link: ${env.appUrl}/verify-email?code=${verificationCode}${
              approvalPending
                ? '\n\npplCRM is in beta, so new workspaces are reviewed before they open. We will email you as soon as yours is ready.'
                : ''
            }`,
            html: `<h2>Verify your email address</h2>
<p>Welcome to pplCRM! We need to verify your email address so you can use your pplCRM account. Click the button below to verify it:</p>
<div class="btn-container">
  <a href="${env.appUrl}/verify-email?code=${verificationCode}" class="btn">Verify email address</a>
</div>
${waitlistNote}
<p class="warning">For security, this link expires in 24 hours.</p>`,
          },
          trx,
        );

        if (approvalPending) {
          // Enqueued in the same transaction as the tenant (transactional outbox): ops must
          // never get an approve link for a signup that rolled back, and a signup must never
          // land with nobody told to look at it.
          await this.enqueueTenantApprovalRequest(trx, {
            tenant_id,
            token: approval.token,
            organization: input.organization,
            first_name: input.first_name,
            email,
          });
        } else {
          token = await this.createTokens(
            {
              user_id: profile.id,
              tenant_id: user.tenant_id,
              name: user.first_name,
            },
            trx,
          );
        }
      });

      return { ...token, approval_pending: approvalPending };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Something went wrong, please try again', undefined, { cause: err });
    }
  }

  public async updateUser(auth: IAuthKeyPayload, id: string, data: UpdateAuthUserType) {
    const userId = String(id);
    const callerRole = auth.role;

    // Deny by default — anyone who is not an admin/owner may only edit themselves.
    // This previously tested `=== 'user'`, so a null-role account could edit anyone.
    if (!isPrivilegedRole(callerRole) && userId !== auth.user_id) {
      throw new ForbiddenError('You do not have permission to update other users.');
    }

    const existing = await this.getRepo().getOneBy('id', { tenant_id: auth.tenant_id, value: userId });
    if (!existing) throw new NotFoundError('User not found');
    const existingUser = existing as AuthUsersType;

    const isRoleChange = data.role !== undefined && data.role !== existingUser.role;

    // Nobody edits their own role — not even an owner. Losing owner/admin by accident is a
    // lockout risk, and granting yourself more access must go through another admin/owner.
    if (isRoleChange && userId === auth.user_id) {
      throw new ForbiddenError('You cannot change your own role.');
    }

    if (isRoleChange && existingUser.deactivated_at) {
      throw new BadRequestError('Deactivated accounts keep their role. Reactivate the account first.');
    }

    // Deny by default — granting privilege is an admin/owner decision.
    if (isRoleChange && !isPrivilegedRole(callerRole)) {
      throw new ForbiddenError('You do not have permission to change roles.');
    }

    // A role, once set, must stay a real role: clearing it back to null would
    // reintroduce the account that no permission check accounts for.
    if (data.role !== undefined && !isAuthRole(data.role)) {
      throw new BadRequestError('Choose a valid role.');
    }

    if (callerRole === 'admin') {
      if (existingUser.role === 'owner') {
        if (data.role !== undefined && data.role !== 'owner') {
          throw new ForbiddenError('Admins cannot demote an owner.');
        }
      } else {
        if (data.role === 'owner') {
          throw new ForbiddenError('Admins cannot promote a non-owner to an owner.');
        }
      }
    }

    if (data.verified !== undefined && Boolean(data.verified) !== Boolean(existingUser.verified)) {
      throw new ForbiddenError('Verification status cannot be changed manually.');
    }

    const row: Record<string, unknown> = {};

    const isOwnEmailChange =
      data.email && data.email.toLowerCase() !== existingUser.email.toLowerCase() && userId === auth.user_id;

    if (data.email) {
      const nextEmail = data.email.toLowerCase();
      if (nextEmail !== existingUser.email.toLowerCase()) {
        const other = await this.getRepo().getByEmail(nextEmail, { columns: ['id'] });
        const otherUser = other as AuthUsersType | undefined;
        if (otherUser && String(otherUser.id) !== userId) {
          throw new ConflictError('Email already exists');
        }
        row['email'] = nextEmail;
        row['verified'] = false;

        if (isOwnEmailChange) {
          row['previous_email'] = existingUser.email;
          row['previous_role'] = existingUser.role;
          row['role'] = 'viewer';
        }
      }
    }
    if (data.first_name !== undefined) row['first_name'] = data.first_name;
    if (data.last_name !== undefined) row['last_name'] = data.last_name ?? '';
    // Validated as a real role above — never coalesce to null here.
    if (data.role !== undefined) row['role'] = data.role;
    // Campaigns §15 — campaign assignment is an admin/owner decision; users never
    // reassign themselves (that would be self-service context switching).
    if (data.campaign_id !== undefined) {
      const nextAssignment = data.campaign_id != null ? String(data.campaign_id) : null;
      const currentAssignment = existingUser.campaign_id != null ? String(existingUser.campaign_id) : null;
      if (nextAssignment !== currentAssignment) {
        if (callerRole !== 'admin' && callerRole !== 'owner') {
          throw new ForbiddenError('Only admins and owners can assign users to campaigns.');
        }
        row['campaign_id'] = await this.resolveAssignableCampaignId(auth.tenant_id, nextAssignment);
      }
    }
    if (data.verified !== undefined) row['verified'] = data.verified;
    if (data.two_factor_enabled !== undefined) row['two_factor_enabled'] = data.two_factor_enabled;
    if (Object.keys(row).length > 0) {
      row['updated_at'] = new Date();
      row['updatedby_id'] = auth.user_id;
    }

    let updated = existingUser;
    if (Object.keys(row).length > 0) {
      updated = await this.getRepo()
        .transaction()
        .execute(async (trx) => {
          const result = await this.getRepo().update(
            {
              tenant_id: auth.tenant_id,
              id: userId,
              row: row as OperationDataType<'authusers', 'update'>,
            },
            trx,
          );
          if (!result) throw new InternalError('Update failed');
          const updatedUser = result as unknown as AuthUsersType;

          await this.ensureAtLeastOneOwner(auth.tenant_id, trx, true, userId);

          if (row['email']) {
            const oldEmail = existingUser.email;
            const nextEmail = row['email'];

            const codeObj = await this.getRepo().addPasswordResetCode(userId, trx);
            const code = codeObj?.password_reset_code;

            if (!isOwnEmailChange) {
              await this.sessions.deleteByUserId(userId, auth.tenant_id, trx);
            }

            await this.mailService.enqueueMail(
              {
                to: nextEmail as string,
                tenant_id: auth.tenant_id,
                subject: 'Verify your new email address',
                text: `We need to verify your new email address so you can keep using your pplCRM account. Verify it using this link: ${env.appUrl}/verify-email?code=${code}`,
                html: `<h2>Verify your new email address</h2>
<p>We need to verify your new email address so you can keep using your pplCRM account. Click the button below to verify it:</p>
<div class="btn-container">
  <a href="${env.appUrl}/verify-email?code=${code}" class="btn">Verify email address</a>
</div>
<p class="warning">For security, this link expires in 24 hours.</p>`,
              },
              trx,
            );

            await this.mailService.enqueueMail(
              {
                to: oldEmail,
                tenant_id: auth.tenant_id,
                subject: 'The email address on your pplCRM account is changing',
                text: `Hi ${existingUser.first_name},\n\nA request was made to change the email address for your pplCRM account to ${nextEmail}. If you did not make this change, please contact support immediately.`,
                html: `<h2>Email change requested</h2>
<p>Hi ${existingUser.first_name},</p>
<p>A request was made to change the email address for your pplCRM account to <strong>${nextEmail}</strong>.</p>
<p>We have sent a verification link to the new address. Until it is verified, sign-in under that address is inactive.</p>
<p class="warning">If you did not make this change, please contact support immediately to secure your account.</p>`,
              },
              trx,
            );
          }

          const skipKeys = ['id', 'tenant_id', 'createdby_id', 'updatedby_id', 'created_at', 'updated_at', 'password'];
          const changes: Record<string, unknown> = {};
          for (const key of Object.keys(row)) {
            if (skipKeys.includes(key)) continue;
            const oldVal = (existingUser as Record<string, unknown>)[key];
            const newVal = (row as Record<string, unknown>)[key];
            if (oldVal !== newVal) {
              changes[key] = { from: oldVal ?? null, to: newVal ?? null };
            }
          }
          await this.userActivity.log(
            {
              tenant_id: auth.tenant_id,
              user_id: auth.user_id,
              activity: 'update',
              entity: 'authusers',
              entity_id: userId,
              quantity: 1,
              metadata: {
                id: userId,
                entity_label: `${updatedUser.first_name} ${updatedUser.last_name || ''}`.trim(),
                changes,
              },
            },
            trx,
          );

          return updatedUser;
        });
    }

    await this.syncProfile(auth, userId, data);
    const profile = (await this.profiles.getOneByAuthId(userId)) as Models['profiles'] | undefined;
    return this.sanitizeUser({ ...updated, profile });
  }

  public async uploadAvatar(auth: IAuthKeyPayload, input: { dataBase64: string; mimeType: string; filename: string }) {
    const { dataBase64, mimeType, filename } = input;

    if (!AuthController.AVATAR_ALLOWED_TYPES.includes(mimeType)) {
      throw new BadRequestError(`Unsupported image type. Allowed: ${AuthController.AVATAR_ALLOWED_TYPES.join(', ')}`);
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length > AuthController.AVATAR_MAX_BYTES) {
      throw new BadRequestError('File too large. Maximum size is 5 MB.');
    }

    const storageFileUUID = randomUUID();
    const ext = mimeType.split('/')[1] || 'jpg';
    const storageKey = `avatars/${auth.tenant_id}/${auth.user_id}/${storageFileUUID}.${ext}`;
    const sha256_hex = createHash('sha256').update(buffer).digest('hex');

    await this.storage.upload(storageKey, buffer, mimeType);

    let finalFileId = '';

    await this.getRepo()
      .db.transaction()
      .execute(async (trx) => {
        const existingProfile = await this.profiles.getOneByAuthId(auth.user_id);

        // Clean up old avatar
        if (existingProfile?.avatar_file_id) {
          try {
            const oldFile = await trx
              .selectFrom('files')
              .select('storage_key')
              .where('tenant_id', '=', auth.tenant_id)
              .where('id', '=', existingProfile.avatar_file_id)
              .executeTakeFirst();
            if (oldFile?.storage_key) await this.storage.delete(oldFile.storage_key);
            await trx
              .deleteFrom('files')
              .where('tenant_id', '=', auth.tenant_id)
              .where('id', '=', existingProfile.avatar_file_id)
              .execute();
          } catch {
            /* non-critical */
          }
        }

        // Insert new file record
        const fileResult = await trx
          .insertInto('files')
          .values({
            tenant_id: auth.tenant_id,
            filename,
            mime_type: mimeType,
            size_bytes: buffer.length,
            storage_key: storageKey,
            sha256_hex,
            uploaded_by: auth.user_id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const fileId = String(fileResult.id);
        finalFileId = fileId;

        // Update or insert profile
        if (existingProfile) {
          await trx
            .updateTable('profiles')
            .set({ avatar_file_id: fileId, updated_at: new Date(), updatedby_id: auth.user_id })
            .where('tenant_id', '=', auth.tenant_id)
            .where('auth_id', '=', auth.user_id)
            .execute();
        } else {
          await trx
            .insertInto('profiles')
            .values({
              tenant_id: auth.tenant_id,
              auth_id: auth.user_id,
              avatar_file_id: fileId,
              createdby_id: auth.user_id,
              updatedby_id: auth.user_id,
            })
            .execute();
        }
      });

    return { file_id: finalFileId, avatar_url: signedFileDownloadUrl(String(finalFileId), auth.tenant_id) };
  }

  public async verify2FA(email: string, code: string, ipAddress?: string, userAgent?: string, rememberMe?: boolean) {
    // Do not reveal whether the email is registered: an unknown account fails with the same
    // "Invalid verification code" as a wrong code, not a distinct 404. (A user with no active
    // challenge already has a null stored code and hits the same failure below.)
    const user = await this.getUserByEmailOrNull(email.toLowerCase());
    if (!user) {
      throw new BadRequestError('Invalid verification code.');
    }

    // The OTP is stored hashed; hash the input and compare with a timing-safe
    // equality to eliminate the brute-force side-channel.
    const storedCode = user.two_factor_code ?? '';
    const inputHash = code ? hashToken(String(code)) : '';
    const codeMatch =
      storedCode.length > 0 &&
      storedCode.length === inputHash.length &&
      timingSafeEqual(Buffer.from(storedCode), Buffer.from(inputHash));
    if (!codeMatch) {
      // Per-account brute-force cap: after too many wrong guesses, invalidate the
      // OTP entirely so it can't be ground down within its validity window — the
      // user must sign in again to receive a fresh code.
      const attempts = Number(user.two_factor_attempts ?? 0) + 1;
      if (attempts >= MAX_2FA_ATTEMPTS) {
        await this.getRepo()
          .db.updateTable('authusers')
          .set({ two_factor_code: null, two_factor_expires_at: null, two_factor_attempts: 0 })
          .where('id', '=', user.id)
          .where('tenant_id', '=', user.tenant_id)
          .execute();
        throw new BadRequestError('Too many incorrect codes. Please sign in again to get a new code.');
      }
      await this.getRepo()
        .db.updateTable('authusers')
        .set({ two_factor_attempts: attempts })
        .where('id', '=', user.id)
        .where('tenant_id', '=', user.tenant_id)
        .execute();
      throw new BadRequestError('Invalid verification code.');
    }

    if (user.deactivated_at) {
      throw new ForbiddenError('This account has been deactivated. Contact an administrator to restore access.');
    }

    if (!user.verified) {
      throw new ForbiddenError(
        'Your email address is not verified yet. Please check your inbox (and spam folder) for a verification link.',
      );
    }

    if (!user.two_factor_expires_at || (user.two_factor_expires_at as unknown as Date).getTime() < Date.now()) {
      throw new BadRequestError('Verification code has expired. Please log in again.');
    }

    await this.getRepo()
      .db.updateTable('authusers')
      .set({
        two_factor_code: null,
        two_factor_expires_at: null,
        two_factor_attempts: 0,
      })
      .where('id', '=', user.id)
      .execute();

    if (user.deletion_scheduled_at) {
      await this.getRepo()
        .db.updateTable('authusers')
        .set({ deletion_scheduled_at: null })
        .where('id', '=', user.id)
        .execute();

      await this.mailService.sendMail({
        to: user.email,
        tenant_id: user.tenant_id ? String(user.tenant_id) : null,
        subject: 'Your account has been restored',
        text: `Welcome back! Your request to delete your account has been canceled, and your account is fully restored.`,
        html: `<h2>Account restored</h2>
<p>Welcome back! Your request to delete your account has been canceled, and your account is fully restored.</p>`,
      });
    }

    if (user.tenant_id) {
      const tenant = await this.getRepo()
        .db.selectFrom('tenants')
        .select(['suspended_at', 'paused_at'])
        .where('id', '=', user.tenant_id)
        .executeTakeFirst();

      if (tenant?.suspended_at) {
        throw new ForbiddenError(
          'This account has been suspended. Please contact support if you believe this is an error.',
        );
      }
      // Paused accounts (user-initiated) allow login so the owner can reactivate from settings
    }

    // Same beta gate as signIn — 2FA is the second half of a sign-in, and this is where that
    // path actually mints the session.
    await assertTenantApprovedForSignIn(user.tenant_id ? String(user.tenant_id) : null);

    return this.createTokens({
      user_id: String(user.id),
      tenant_id: String(user.tenant_id),
      name: user.first_name,
      ipAddress,
      userAgent,
      rememberMe,
    });
  }

  public async verifyEmail(code: string) {
    const msec = await this.getCodeAge(code);
    // 24 hours in milliseconds for verification links
    if (msec > 24 * 60 * 60 * 1000) {
      throw new BadRequestError('The verification link has expired. Please request a new one.');
    }

    const repo = this.getRepo();
    const user = await repo.db
      .selectFrom('authusers')
      .select(['id', 'previous_email', 'previous_role'])
      .where('password_reset_code', '=', hashToken(code))
      .executeTakeFirst();

    if (!user) {
      throw new BadRequestError('Invalid or expired verification link.');
    }

    await repo.transaction().execute(async (trx) => {
      const updateData: Record<string, unknown> = {
        verified: true,
        password_reset_code: null,
        password_reset_code_created_at: null,
      };

      if (user.previous_email) {
        // Email change confirmation: restore role and clear pending state.
        // Invalidate all existing sessions — an old-email session token
        // should not remain valid after the address has been changed.
        // previous_role is nullable; never restore a null role (see DEFAULT_AUTH_ROLE).
        updateData['role'] = isAuthRole(user.previous_role) ? user.previous_role : DEFAULT_AUTH_ROLE;
        updateData['previous_email'] = null;
        updateData['previous_role'] = null;
        await trx.deleteFrom('sessions').where('user_id', '=', user.id).execute();
      }

      await trx.updateTable('authusers').set(updateData).where('id', '=', user.id).execute();
    });

    return { success: true };
  }

  private async buildUserStats(auth: IAuthKeyPayload, userId: string) {
    const defaults = {
      emails_assigned: { total: 0, open: 0, closed: 0 },
      contacts_added: { total: 0, last_created_at: null as Date | null },
      files_imported: { count: 0, total_rows: 0, last_activity_at: null as Date | null },
      files_exported: { count: 0, total_rows: 0, last_activity_at: null as Date | null },
    };

    try {
      const [emails, contacts, activity] = await Promise.all([
        this.emailsRepo.getAssignmentStats({ tenant_id: auth.tenant_id, user_id: userId }),
        this.personsRepo.getCreatedStats({ tenant_id: auth.tenant_id, user_id: userId }),
        this.userActivity.getStats({ tenant_id: auth.tenant_id, user_id: userId }),
      ]);

      const importActivity = activity['import'] ?? { count: 0, total_quantity: 0, last_activity_at: null };
      const exportActivity = activity['export'] ?? { count: 0, total_quantity: 0, last_activity_at: null };

      return {
        emails_assigned: emails,
        contacts_added: contacts,
        files_imported: {
          count: importActivity.count ?? 0,
          total_rows: importActivity.total_quantity ?? 0,
          last_activity_at: importActivity.last_activity_at ?? null,
        },
        files_exported: {
          count: exportActivity.count ?? 0,
          total_rows: exportActivity.total_quantity ?? 0,
          last_activity_at: exportActivity.last_activity_at ?? null,
        },
      };
    } catch (err) {
      logger.error({ err }, 'Failed to build user stats');
      return defaults;
    }
  }

  private coerceBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return false;
  }

  private coerceDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return new Date(value.getTime());
    const date = new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async createProfile(trx: Transaction<Models>, id: string, tenant_id: string, auth_id: string) {
    const row = { id, tenant_id, auth_id } as OperationDataType<'profiles', 'insert'>;
    const profile = await this.profiles.add({ row }, trx);
    if (!profile) {
      throw new InternalError('Something went wrong, please try again');
    }
    return profile;
  }

  private async createTenant(trx: Transaction<Models>, name: string, approval: NewTenantApproval) {
    const slug = await this.generateTenantSlug(trx, name);
    const row = {
      name,
      slug,
      approval_status: approval.status,
      approval_requested_at: new Date(),
      // Only a workspace that still needs a decision carries a live ops link.
      approval_token_hash: approval.status === 'pending' ? approval.tokenHash : null,
      approved_at: approval.status === 'approved' ? new Date() : null,
    } as OperationDataType<'tenants', 'insert'>;
    const tenantAddResult = await this.tenants.add({ row }, trx);
    if (!tenantAddResult) {
      throw new InternalError('Something went wrong, please try again');
    }
    return tenantAddResult.id;
  }

  /**
   * Produce a globally-unique, DNS-safe subdomain label for a new tenant: slugify the org name, fall
   * back to a random `org-xxxxxx` when the name yields nothing usable or hits a reserved label, then
   * suffix on collision. The tenant id isn't known before insert, so the fallback is random rather
   * than id-derived.
   */
  private async generateTenantSlug(trx: Transaction<Models>, name: string): Promise<string> {
    let base = slugifyHandle(name);
    if (!base || RESERVED_SUBDOMAINS.has(base)) {
      base = `org-${randomBytes(4).toString('hex')}`;
    }
    let candidate = base;
    let n = 2;
    while (await this.tenantSlugTaken(trx, candidate)) {
      candidate = `${base}-${n++}`;
    }
    return candidate;
  }

  private async tenantSlugTaken(trx: Transaction<Models>, slug: string): Promise<boolean> {
    const row = await trx.selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst();
    return !!row;
  }

  private async createTokens(
    input: {
      user_id: string;
      tenant_id: string;
      name: string;
      oldSession?: string;
      ipAddress?: string;
      userAgent?: string;
      rememberMe?: boolean;
      existingExpiresAt?: Date | null;
    },
    trx?: Transaction<Models>,
  ) {
    // Delete the old session
    if (input.oldSession) await this.sessions.deleteBySessionId(input.oldSession, trx);

    // Generate plaintext tokens — only their hashes are persisted in the DB.
    const plainSessionId = generateToken();
    const plainRefreshToken = generateToken();

    const now = new Date();
    const expiresAt =
      input.existingExpiresAt !== undefined
        ? input.existingExpiresAt // renewal: preserve original absolute expiry
        : new Date(now.getTime() + (input.rememberMe ? REMEMBER_ME_EXPIRY_MS : SESSION_EXPIRY_MS));

    const row = {
      user_id: input.user_id,
      tenant_id: input.tenant_id,
      ip_address: input.ipAddress || '',
      user_agent: input.userAgent || '',
      status: 'active',
      session_id: hashToken(plainSessionId),
      refresh_token: hashToken(plainRefreshToken),
      expires_at: expiresAt,
      last_used_at: now,
    } as OperationDataType<'sessions', 'insert'>;

    const currentSession = await this.sessions.add({ row }, trx);

    if (!currentSession) {
      throw new InternalError('Session creation failed');
    }

    const key = process.env['SHARED_SECRET'];
    if (!key) {
      throw new ServerMisconfigError('Server misconfiguration');
    }

    const signer = createSigner({
      algorithm: 'HS256',
      key,
      expiresIn: '30m',
    });
    try {
      const auth_token = signer({
        user_id: input.user_id,
        tenant_id: input.tenant_id,
        name: input.name,
        session_id: plainSessionId, // plaintext in JWT; hash is in DB
      });
      // refresh_token goes to the client as an HttpOnly cookie (set by the router), never the body.
      return { auth_token, refresh_token: plainRefreshToken, refresh_expires_at: expiresAt };
    } catch (err) {
      throw new InternalError('Token creation failed', undefined, { cause: err });
    }
  }

  private async createUser(
    trx: Transaction<Models>,
    tenant_id: string,
    password: string,
    email: string,
    input: {
      email: string;
      first_name: string;
      password: string;
      organization: string;
    },
  ) {
    const row = {
      tenant_id,
      password,
      email,
      first_name: input.first_name,
      role: 'owner',
      verified: false,
    } as OperationDataType<'authusers', 'insert'>;
    try {
      const user = await this.getRepo().add({ row }, trx);
      if (!user) throw new InternalError('Something went wrong, please try again');
      return user;
    } catch (err) {
      throw new InternalError('Something went wrong, please try again', undefined, { cause: err });
    }
  }

  /**
   * Tell pplCRM ops that a workspace is waiting to be let into the beta.
   *
   * Goes to the ops inbox, not to a tenant, so it carries no `tenant_id` and is classified
   * 'account': it must never be withheld by the audience send-guard, and a bounce on our own
   * inbox must not be attributed to (and pause) the tenant it happens to be about.
   *
   * Everything interpolated here — org name, first name, email — is attacker-chosen, so it is
   * escaped. The one link is GET-only and merely renders the decision page; approving is a
   * POST from that page, so a mail scanner prefetching the link cannot approve anyone.
   */
  private async enqueueTenantApprovalRequest(
    trx: Transaction<Models>,
    opts: { tenant_id: string; token: string; organization: string; first_name: string; email: string },
  ) {
    const reviewUrl = `${env.apiUrl}/api/tenant-approval/${opts.token}`;
    const org = escapeHtml(opts.organization);
    const name = escapeHtml(opts.first_name);
    const mail = escapeHtml(opts.email);

    await this.mailService.enqueueMail(
      {
        to: env.opsAlertEmail ?? env.postmarkFromEmail,
        audience: 'account',
        subject: `pplCRM beta signup: ${opts.organization}`,
        text: `A new workspace is waiting for beta approval.\n\nOrganization: ${opts.organization}\nName: ${opts.first_name}\nEmail: ${opts.email}\nTenant: ${opts.tenant_id}\n\nApprove or decline: ${reviewUrl}`,
        html: `<h2>New beta signup</h2>
<p>A new workspace signed up and is waiting for approval. Nobody can sign into it until you decide.</p>
<p>
  <strong>Organization:</strong> ${org}<br />
  <strong>Name:</strong> ${name}<br />
  <strong>Email:</strong> ${mail}<br />
  <strong>Tenant:</strong> ${escapeHtml(opts.tenant_id)}
</p>
<div class="btn-container">
  <a href="${reviewUrl}" class="btn">Review this signup</a>
</div>
<p class="warning">This link works once. Approving emails the owner that their workspace is ready.</p>`,
      },
      trx,
    );
  }

  /** The invitation email — initial invite and admin resend share the copy. */
  private async enqueueInviteEmail(
    trx: Transaction<Models>,
    opts: {
      to: string;
      tenantId: string;
      firstName: string;
      inviterName: string | undefined;
      tempPassword: string;
      code: string | null | undefined;
    },
  ) {
    const inviter = opts.inviterName || 'your team';
    await this.mailService.enqueueMail(
      {
        to: opts.to,
        tenant_id: opts.tenantId,
        subject: `You've been invited to join ${inviter} on pplCRM`,
        text: `Hi ${opts.firstName},\n\nYou have been invited to join the campaign team by ${inviter}.\n\nYour temporary password is: ${opts.tempPassword}\n\nActivate your account at: ${env.appUrl}/new-password?code=${opts.code}\n\nThis invitation expires in 7 days.`,
        html: `<h2>You've been invited</h2>
<p>Hi ${opts.firstName},</p>
<p>You have been invited to join the campaign team by <strong>${inviter}</strong>.</p>
<p>To join the team, activate your account, and set up your password, click the button below:</p>
<div class="btn-container">
  <a href="${env.appUrl}/new-password?code=${opts.code}" class="btn">Activate account</a>
</div>
<p>Your temporary password is: <code>${opts.tempPassword}</code></p>
<p>This invitation expires in 7 days.</p>
<p class="warning">If you did not expect this invitation, you can safely ignore this email.</p>`,
      },
      trx,
    );
  }

  /**
   * Campaigns §15 — validate a campaign-assignment id: it must be a live (not
   * archived) campaign of this tenant. Returns null for "the office context"
   * (no explicit assignment stored).
   */
  private async resolveAssignableCampaignId(
    tenant_id: string,
    campaign_id: string | null | undefined,
  ): Promise<string | null> {
    if (campaign_id == null || campaign_id === '') return null;
    const campaign = await this.getRepo()
      .db.selectFrom('campaigns')
      .select(['id', 'status', 'kind'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', campaign_id)
      .executeTakeFirst();
    if (!campaign) throw new NotFoundError('Campaign not found');
    if (campaign.status === 'archived') {
      throw new BadRequestError('Users cannot be assigned to an archived campaign.');
    }
    // The office is the default context; store it as NULL so office members are
    // unaffected if the office row is ever recreated.
    if (campaign.kind === 'office') return null;
    return String(campaign.id);
  }

  private generateTempPassword(length = 18) {
    return randomBytes(Math.max(12, Math.ceil(length / 2)))
      .toString('base64url')
      .slice(0, length);
  }

  /** Reads a single tenant configuration value from the settings key/value table. */
  private async getTenantSetting(tenant_id: string | number | null | undefined, key: string): Promise<unknown> {
    if (tenant_id === null || tenant_id === undefined) return undefined;
    const row = await this.getRepo()
      .db.selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', String(tenant_id))
      .where('key', '=', key)
      .executeTakeFirst();
    return row?.value;
  }

  private async getCodeAge(code: string): Promise<number> {
    const nowData: QueryResult<INow> = await this.getRepo().nowTime();
    if (!nowData || !nowData?.rows[0]?.now) {
      throw new InternalError('Something went wrong, please try again');
    }

    const data: AuthUsersType = (await this.getRepo().getPasswordResetCodeTime(code)) as AuthUsersType;
    if (!data) {
      throw new PreconditionFailedError('Invalid password reset code');
    }
    const thenTimestamp = (data.password_reset_code_created_at || new Date().toString()) as string;
    const then = new Date(thenTimestamp);

    const now = new Date(nowData?.rows[0]?.now || new Date().toString());

    return now.getTime() - then.getTime();
  }

  // NOTE (SECURITY-REVIEW 4.7): `authusers.email` is UNIQUE globally, not per-tenant, and this lookup
  // is intentionally tenant-agnostic (sign-in has no tenant context yet). Consequence: one email
  // address belongs to exactly one tenant — a person cannot be a member of two organizations under
  // the same email. This is the current, intended product constraint; making email per-tenant would
  // be a schema-level change (drop the global unique, add UNIQUE(tenant_id, email), and thread a
  // tenant selector through sign-in).
  private async getUserByEmail(email: string) {
    const user = (await this.getRepo().getByEmail(email)) as AuthUsersType;

    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  // Same lookup as getUserByEmail but returns null instead of throwing, for the pre-auth flows
  // (sign-in, 2FA) that must not reveal — via a distinct error code or path — whether an email
  // is registered. Callers equalize behavior for the found/not-found cases themselves.
  private async getUserByEmailOrNull(email: string): Promise<AuthUsersType | null> {
    const user = (await this.getRepo().getByEmail(email)) as AuthUsersType | undefined;
    return user ?? null;
  }

  private async isNewDeviceOrLocation(userId: string, ipAddress?: string, userAgent?: string): Promise<boolean> {
    // Fail closed: if the client IP can't be determined, treat it as a new
    // device so the 2FA challenge is issued rather than silently skipped.
    if (!ipAddress) return true;
    const existing = await this.sessions.db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', userId)
      .where('ip_address', '=', ipAddress)
      .where('user_agent', '=', userAgent || '')
      .where('status', '=', 'active')
      .executeTakeFirst();
    return !existing;
  }

  private sanitizeUser(record: Record<string, unknown>) {
    const lastName: string =
      (record['last_name'] as string | null | undefined) ??
      (record['profile_last_name'] as string | null | undefined) ??
      (record['effective_last_name'] as string | null | undefined) ??
      ((record['profile'] as Record<string, unknown>)?.['last_name'] as string | null | undefined) ??
      '';

    let notificationPreferences = {
      mention_in_comment: true,
      mention_in_comment_in_app: true,
      task_assigned: true,
      task_assigned_in_app: true,
      task_due: true,
      task_due_in_app: true,
      person_assigned: true,
      person_assigned_in_app: true,
      email_assigned: true,
      email_assigned_in_app: true,
      export_ready: true,
      export_ready_in_app: true,
      import_summary: true,
      companion_approval_sms: true,
    };

    const rawPreferences = (record['profile'] as Record<string, unknown>)?.['preferences'] ?? record['preferences'];
    const parsedPreferences = parseProfilePreferences(rawPreferences);
    if (parsedPreferences?.notifications) {
      notificationPreferences = {
        ...notificationPreferences,
        ...parsedPreferences.notifications,
      };
    }

    return {
      id: record['id'] != null ? String(record['id']) : '',
      email: (record['email'] as string | null | undefined) ?? '',
      first_name: (record['first_name'] as string | null | undefined) ?? '',
      last_name: lastName,
      role: record['role'] != null ? String(record['role']) : null,
      campaign_id: record['campaign_id'] != null ? String(record['campaign_id']) : null,
      verified: this.coerceBoolean(record['verified']),
      email_verified: this.coerceBoolean(record['verified']),
      two_factor_enabled: this.coerceBoolean(record['two_factor_enabled']),
      deletion_scheduled_at: this.coerceDate(record['deletion_scheduled_at']),
      deactivated_at: this.coerceDate(record['deactivated_at']),
      last_active_at: this.coerceDate(record['last_active_at']),
      created_at: this.coerceDate(record['created_at']),
      updated_at: this.coerceDate(record['updated_at']),
      previous_email: (record['previous_email'] as string | null | undefined) ?? null,
      previous_role: (record['previous_role'] as string | null | undefined) ?? null,
      notification_preferences: notificationPreferences,
    };
  }

  private async syncProfile(auth: IAuthKeyPayload, authUserId: string, data: UpdateAuthUserType) {
    const existingProfile = (await this.profiles.getOneByAuthId(authUserId)) as Models['profiles'] | undefined;
    const profileId = existingProfile?.id != null ? String(existingProfile.id) : authUserId;

    let finalPreferences: Record<string, unknown> | null = existingProfile?.preferences
      ? ((parseProfilePreferences(existingProfile.preferences) as Record<string, unknown> | null) ?? null)
      : null;

    if (data.notification_preferences) {
      finalPreferences = {
        ...(finalPreferences || {}),
        notifications: {
          ...(((finalPreferences || {})['notifications'] as Record<string, unknown>) || {}),
          ...data.notification_preferences,
        },
      };
    }

    if (existingProfile) {
      const row: Record<string, unknown> = {
        updatedby_id: auth.user_id,
        updated_at: new Date(),
      };
      if (data.last_name !== undefined) {
        row['last_name'] = data.last_name ?? null;
      }
      if (finalPreferences !== null) {
        row['preferences'] = JSON.stringify(finalPreferences);
      }

      if (data.last_name !== undefined || data.notification_preferences !== undefined) {
        await this.profiles.update({ tenant_id: auth.tenant_id, id: profileId, row });
      }
      return;
    }

    const insertRow = {
      id: authUserId,
      tenant_id: auth.tenant_id,
      auth_id: authUserId,
      last_name: data.last_name ?? null,
      preferences: finalPreferences ? JSON.stringify(finalPreferences) : null,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    } as OperationDataType<'profiles', 'insert'>;
    await this.profiles.add({ row: insertRow });
  }

  private async updateTenantWithAdmin(
    trx: Transaction<Models>,
    tenant_id: string,
    admin_id: string,
    createdby_id: string,
  ) {
    const row = { admin_id, createdby_id } as OperationDataType<'tenants', 'update'>;
    const id = tenant_id as GetOperandType<'tenants', 'update', Keys<TablesOperationMap['tenants']['update']>>;
    await this.tenants.update({ id, tenant_id, row }, trx);
  }

  private async validateNewPassword(password: string): Promise<void> {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new BadRequestError('This password is too common. Please choose a different password.');
    }
    const count = await getPwnedCount(password);
    if (count > 0) {
      throw new BadRequestError(
        'This password has appeared in a known data breach. Please choose a different password.',
      );
    }
  }

  private async verifyUserDoesNotExist(email: string) {
    const exists = await this.getRepo().existsByEmail(email);
    if (exists) {
      throw new ConflictError('This email already exists. Did you want to sign in?');
    }
  }
}

const PASSWORD_RESET_CODE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const INVITE_ACTIVATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IDLE_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
// How long a rotated-away refresh token may still be replayed (concurrent tabs sharing one cookie).
const ROTATION_REUSE_GRACE_MS = 60 * 1000;
const REMEMBER_ME_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_2FA_ATTEMPTS = 5; // wrong OTP guesses before the code is invalidated
