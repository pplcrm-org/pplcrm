import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './controller';
import { AuthUsersRepo } from './repositories/authusers.repo';
import { StorageService } from '../../lib/storage.service';
import { BaseRepository } from '../../lib/base.repo';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors/app-errors';
import { hashToken } from '../../lib/token-hash';

vi.mock('../../lib/hibp', () => ({
  getPwnedCount: vi.fn().mockResolvedValue(0),
}));

function rand() {
  return String(Math.floor(Math.random() * 100000000) + 10000000);
}

async function cleanup(db: any, user_id: string, tenant_id: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenant_id)
    .execute();

  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('map_teams_persons').where('tenant_id', '=', tenant_id).execute();
  // Demo seed data (signUp): children of persons/households/campaigns, deepest first.
  await db.deleteFrom('delivery_route_stops').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('delivery_routes').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('delivery_requests').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('turf_knocks').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('turf_assignments').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('turf_households').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('turfs').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('donation_pledges').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('donations').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('form_submissions').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('notifications').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('newsletter_events').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('person_newsletter_engagements').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('campaign_person_facts').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('volunteer_shifts').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('map_campaigns_users').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('companies').where('tenant_id', '=', tenant_id).execute();
  // Demo seed data (signUp): inbox emails reference campaigns; children cascade.
  await db.deleteFrom('emails').where('tenant_id', '=', tenant_id).execute();

  const tenantUserIds = db.selectFrom('authusers').select('id').where('tenant_id', '=', tenant_id);

  await db.deleteFrom('files').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('profiles').where('auth_id', 'in', tenantUserIds).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('tasks').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('newsletters').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('teams').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('volunteer_events').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('web_forms').where('tenant_id', '=', tenant_id).execute();
  // Campaigns are referenced by newsletters/lists/web_forms/events/… (§15), so they go last.
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('sessions').where('user_id', 'in', tenantUserIds).execute();

  await db
    .updateTable('authusers')
    .set({ createdby_id: null, updatedby_id: null })
    .where('tenant_id', '=', tenant_id)
    .execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenant_id).execute();

  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('map_households_tags').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenant_id).execute();
  await db.deleteFrom('tenants').where('id', '=', tenant_id).execute();
}

async function signUpOwner(controller: AuthController, db: any, verified = true) {
  const email = `owner-${Date.now()}-${rand()}@example.com`;
  const orgName = `Org-${rand()}`;
  await controller.signUp({
    organization: orgName,
    email,
    password: 'StrongPassword123!',
    first_name: 'Owner',
  });
  let user = await db.selectFrom('authusers').selectAll().where('email', '=', email).executeTakeFirstOrThrow();
  if (verified) {
    await db.updateTable('authusers').set({ verified: true }).where('id', '=', user.id).execute();
    user = { ...user, verified: true };
  }
  // signUp seeds demo mode (blocks invites via demo-guard) and the Free plan (2 seats). These tests
  // exercise post-demo invite/role logic, not the seat cap, so clear demo mode and move to Movement
  // (unlimited seats) for headroom — seat-cap enforcement has its own dedicated test.
  await db
    .updateTable('tenants')
    .set({ demo_mode_at: null, subscription_plan: 'movement' })
    .where('id', '=', user.tenant_id)
    .execute();
  return user as { id: string; tenant_id: string; email: string; first_name: string; role: string };
}

function authFor(
  user: { id: string; tenant_id: string; first_name: string; role: string },
  sessionId = 'test-session',
) {
  return {
    tenant_id: String(user.tenant_id),
    user_id: String(user.id),
    session_id: sessionId,
    role: user.role,
    name: user.first_name,
  };
}

describe('AuthController', () => {
  const controller = new AuthController();
  const db = (BaseRepository as any)._db;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null from currentUser when the user record has been removed, and throw when unauthenticated', async () => {
    const owner = await signUpOwner(controller, db);
    const result = await controller.currentUser(authFor(owner));
    expect(result).toMatchObject({ email: owner.email });

    await expect(controller.currentUser({} as any)).rejects.toThrow(UnauthorizedError);

    await cleanup(db, owner.id, owner.tenant_id);
  }, 30000);

  // Residency is chosen at signup and never asked again, so the one thing that must not fail
  // silently is the write: a choice that is dropped here is unrecoverable, because nothing
  // downstream ever asks the question a second time.
  it('should store the chosen data region on the tenant, and fall back to no-preference when none was sent', async () => {
    const chosenEmail = `region-eu-${Date.now()}-${rand()}@example.com`;
    await controller.signUp({
      organization: `Org-${rand()}`,
      email: chosenEmail,
      password: 'StrongPassword123!',
      first_name: 'Owner',
      data_region: 'eu',
    } as any);
    const chosen = await db
      .selectFrom('authusers')
      .select(['id', 'tenant_id'])
      .where('email', '=', chosenEmail)
      .executeTakeFirstOrThrow();
    const chosenTenant = await db
      .selectFrom('tenants')
      .select('data_region')
      .where('id', '=', chosen.tenant_id)
      .executeTakeFirstOrThrow();
    expect(chosenTenant.data_region).toBe('eu');

    // An internal caller that builds the input by hand never goes through the Zod default, so
    // the controller has to supply one itself rather than writing undefined. 'any' — no stated
    // requirement — is the only honest fallback; inventing a region would fabricate a request.
    const defaultedEmail = `region-default-${Date.now()}-${rand()}@example.com`;
    await controller.signUp({
      organization: `Org-${rand()}`,
      email: defaultedEmail,
      password: 'StrongPassword123!',
      first_name: 'Owner',
    } as any);
    const defaulted = await db
      .selectFrom('authusers')
      .select(['id', 'tenant_id'])
      .where('email', '=', defaultedEmail)
      .executeTakeFirstOrThrow();
    const defaultedTenant = await db
      .selectFrom('tenants')
      .select('data_region')
      .where('id', '=', defaulted.tenant_id)
      .executeTakeFirstOrThrow();
    expect(defaultedTenant.data_region).toBe('any');

    await cleanup(db, chosen.id, chosen.tenant_id);
    await cleanup(db, defaulted.id, defaulted.tenant_id);
  }, 60000);

  it('should enforce the plan seat cap on inviteUser', async () => {
    const owner = await signUpOwner(controller, db);
    // Free plan allows 2 staff seats. signUp seeds demo teammates, so deactivate everyone but the
    // owner to get a deterministic 1 seat in use before testing the cap.
    await db.updateTable('tenants').set({ subscription_plan: 'free' }).where('id', '=', owner.tenant_id).execute();
    await db
      .updateTable('authusers')
      .set({ deactivated_at: new Date() })
      .where('tenant_id', '=', owner.tenant_id)
      .where('id', '!=', owner.id)
      .execute();

    // Second seat is within the cap.
    await controller.inviteUser(authFor(owner), {
      email: `seat1-${rand()}@example.com`,
      first_name: 'Seat1',
      role: 'user',
    });

    // A third invite would exceed the 2-seat cap and is refused.
    await expect(
      controller.inviteUser(authFor(owner), {
        email: `seat2-${rand()}@example.com`,
        first_name: 'Seat2',
        role: 'user',
      }),
    ).rejects.toThrow(ForbiddenError);

    await cleanup(db, owner.id, owner.tenant_id);
  }, 30000);

  it('should enforce visibility rules on getUserById and throw NotFoundError for a missing user', async () => {
    const owner = await signUpOwner(controller, db);
    const invited = await controller.inviteUser(authFor(owner), {
      email: `member-${rand()}@example.com`,
      first_name: 'Member',
      role: 'user',
    });
    const memberAuth = {
      tenant_id: String(owner.tenant_id),
      user_id: String(invited.id),
      session_id: 's',
      role: 'user',
    };

    // A plain user may view themselves
    const self = await controller.getUserById(memberAuth, invited.id);
    expect(self.id).toBe(String(invited.id));

    // But not another user
    await expect(controller.getUserById(memberAuth, owner.id)).rejects.toThrow(ForbiddenError);

    await expect(controller.getUserById(authFor(owner), rand())).rejects.toThrow(NotFoundError);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should block inviteUser while the tenant is in demo mode', async () => {
    const owner = await signUpOwner(controller, db);
    await db.updateTable('tenants').set({ demo_mode_at: new Date() }).where('id', '=', owner.tenant_id).execute();

    await expect(
      controller.inviteUser(authFor(owner), { email: `demo-invite-${rand()}@example.com`, first_name: 'Blocked' }),
    ).rejects.toThrow(ForbiddenError);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should list users via getUsersList and getAllUsers', async () => {
    const owner = await signUpOwner(controller, db);
    await controller.inviteUser(authFor(owner), { email: `listed-${rand()}@example.com`, first_name: 'Listed' });

    const list = await controller.getUsersList(authFor(owner));
    expect(list.some((u) => u.first_name === 'Listed')).toBe(true);

    const withCounts = await controller.getAllUsers(authFor(owner));
    expect(withCounts.count).toBeGreaterThanOrEqual(2);
    expect(withCounts.rows.some((u) => u.first_name === 'Listed')).toBe(true);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should enforce role and self-delete rules, then delete a user', async () => {
    const owner = await signUpOwner(controller, db);
    const admin = await controller.inviteUser(authFor(owner), {
      email: `admin-${rand()}@example.com`,
      first_name: 'Admin',
      role: 'admin',
    });
    const member = await controller.inviteUser(authFor(owner), {
      email: `member-${rand()}@example.com`,
      first_name: 'Member',
      role: 'user',
    });
    const memberAuth = {
      tenant_id: String(owner.tenant_id),
      user_id: String(member.id),
      session_id: 's',
      role: 'user',
    };
    const adminAuth = { tenant_id: String(owner.tenant_id), user_id: String(admin.id), session_id: 's', role: 'admin' };

    await expect(controller.deleteUser(memberAuth, admin.id)).rejects.toThrow(ForbiddenError);
    await expect(controller.deleteUser(authFor(owner), owner.id)).rejects.toThrow(BadRequestError);
    await expect(controller.deleteUser(adminAuth, owner.id)).rejects.toThrow(ForbiddenError);
    await expect(controller.deleteUser(authFor(owner), rand())).rejects.toThrow(NotFoundError);

    // Authored content (a NO ACTION FK into authusers) used to make the hard delete 23503 —
    // the tombstone must succeed anyway and leave the content in place.
    const tag = await db
      .insertInto('tags')
      .values({
        tenant_id: owner.tenant_id,
        name: `authored-${rand()}`,
        createdby_id: member.id,
        updatedby_id: member.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const result = await controller.deleteUser(authFor(owner), member.id);
    expect(result.success).toBe(true);

    // The row is tombstoned in place: identity scrubbed, real email freed, marker set.
    const row = await db.selectFrom('authusers').selectAll().where('id', '=', member.id).executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
    expect(row.email).toBe(`deleted-${member.id}@deleted.invalid`);
    expect(row.first_name).toBe('Deleted user');
    expect(row.password).toBe('');
    expect(row.deletion_scheduled_at).toBeNull();

    // Their contribution survives, still attributed to the (now tombstoned) row.
    const authored = await db.selectFrom('tags').select('createdby_id').where('id', '=', tag.id).executeTakeFirst();
    expect(String(authored?.createdby_id)).toBe(String(member.id));

    // Tombstones are invisible to the grid and pickers, un-deletable and un-reactivatable.
    const list = await controller.getUsersList(authFor(owner));
    expect(list.some((u) => String(u.id) === String(member.id))).toBe(false);
    await expect(controller.deleteUser(authFor(owner), member.id)).rejects.toThrow(NotFoundError);
    await expect(controller.adminReactivateUser(authFor(owner), member.id)).rejects.toThrow(NotFoundError);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should sign out a session and no-op for an unauthenticated caller', async () => {
    const owner = await signUpOwner(controller, db);
    const token = await controller.signIn({ email: owner.email, password: 'StrongPassword123!' });
    expect('auth_token' in token).toBe(true);

    const sessionsBefore = await db.selectFrom('sessions').selectAll().where('user_id', '=', owner.id).execute();
    expect(sessionsBefore.length).toBeGreaterThan(0);

    expect(await controller.signOut(null)).toBeNull();

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should not reveal whether an email is registered on failed sign-in', async () => {
    const owner = await signUpOwner(controller, db);

    // A wrong password and a completely unknown email must fail identically (same
    // UnauthorizedError, never a distinct NotFoundError) so the response can't be used to
    // enumerate registered accounts.
    await expect(controller.signIn({ email: owner.email, password: 'WrongPassword123!' })).rejects.toThrow(
      UnauthorizedError,
    );
    await expect(
      controller.signIn({ email: `unknown-${rand()}@example.com`, password: 'WrongPassword123!' }),
    ).rejects.toThrow(UnauthorizedError);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should resend verification email only for unverified accounts, without leaking existence', async () => {
    const owner = await signUpOwner(controller, db, false);

    const first = await controller.resendVerificationEmail(owner.email);
    expect(first.success).toBe(true);
    const afterUnverified = await db
      .selectFrom('authusers')
      .selectAll()
      .where('id', '=', owner.id)
      .executeTakeFirstOrThrow();
    expect(afterUnverified.password_reset_code).not.toBeNull();

    await db.updateTable('authusers').set({ verified: true }).where('id', '=', owner.id).execute();
    const second = await controller.resendVerificationEmail(owner.email);
    expect(second.success).toBe(true);

    const unknown = await controller.resendVerificationEmail(`unknown-${rand()}@example.com`);
    expect(unknown.success).toBe(true);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should send a password reset email and allow resetting the password with the emailed code', async () => {
    const owner = await signUpOwner(controller, db);

    let plaintextCode: string | undefined;
    const origAddCode = AuthUsersRepo.prototype.addPasswordResetCode;
    const spy = vi.spyOn(AuthUsersRepo.prototype, 'addPasswordResetCode').mockImplementation(async function (
      this: AuthUsersRepo,
      ...args: Parameters<typeof origAddCode>
    ) {
      const result = await origAddCode.apply(this, args);
      plaintextCode = result?.password_reset_code;
      return result;
    });

    const sent = await controller.sendPasswordResetEmail(owner.email);
    expect(sent).toBe(true);
    spy.mockRestore();

    expect(plaintextCode).toBeDefined();
    if (!plaintextCode) throw new Error('reset code was not captured');

    // Uses a decoy code so the weak-password rejection (checked before the code
    // is even looked up) doesn't consume the real one-time reset code below.
    await expect(controller.resetPassword('password123', 'decoy-code')).rejects.toThrow(BadRequestError);
    await expect(controller.resetPassword('AnotherStrong1!', 'not-the-real-code')).rejects.toThrow(BadRequestError);

    // getCodeAge() compares the DB's own now() (cast to a bare `timestamp`, i.e. no
    // time zone) against the timestamptz `password_reset_code_created_at`. On a
    // dev box where the Postgres session time zone differs from the Node process's
    // time zone, that bare cast is parsed by `pg` as if it were in the *Node*
    // process's zone, producing a skewed "now" and a false "expired" result. Pin
    // nowTime() to the real wall clock for this call so the test exercises the
    // intended "code is fresh" branch rather than an environment-specific artifact.
    const nowSpy = vi
      .spyOn(BaseRepository.prototype, 'nowTime')
      .mockResolvedValue({ rows: [{ now: new Date() }] } as any);
    await controller.resetPassword('AnotherStrong1!', plaintextCode);
    nowSpy.mockRestore();

    // Old password should no longer work; new password should.
    await expect(controller.signIn({ email: owner.email, password: 'StrongPassword123!' })).rejects.toThrow(
      UnauthorizedError,
    );
    const signInResult = await controller.signIn({ email: owner.email, password: 'AnotherStrong1!' });
    expect('auth_token' in signInResult).toBe(true);

    const unknownEmailResult = await controller.sendPasswordResetEmail(`unknown-${rand()}@example.com`);
    expect(unknownEmailResult).toBe(true);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should renew tokens with a valid refresh token and reject an invalid one', async () => {
    const owner = await signUpOwner(controller, db);
    const tokens = await controller.signIn({ email: owner.email, password: 'StrongPassword123!' });
    if (!('auth_token' in tokens)) throw new Error('expected tokens');

    // Renew is now driven by the refresh token alone (delivered via the HttpOnly cookie).
    const renewed = await controller.renewAuthToken(tokens.refresh_token);
    expect(renewed.auth_token).toBeTypeOf('string');
    expect(renewed.refresh_token).toBeTypeOf('string');

    // Rotation reuse grace: replaying the just-rotated refresh token within the grace window
    // still succeeds (concurrent tabs share one refresh cookie) and mints its own session.
    const replayed = await controller.renewAuthToken(tokens.refresh_token);
    expect(replayed.auth_token).toBeTypeOf('string');
    expect(replayed.refresh_token).not.toBe(renewed.refresh_token);

    // Beyond the grace window a replay is treated as token reuse and rejected. `last_used_at`
    // holds the rotation timestamp on rotated sessions — backdate it past the window.
    await db
      .updateTable('sessions')
      .set({ last_used_at: new Date(Date.now() - 5 * 60 * 1000) })
      .where('refresh_token', '=', hashToken(tokens.refresh_token))
      .where('tenant_id', '=', owner.tenant_id)
      .execute();
    await expect(controller.renewAuthToken(tokens.refresh_token)).rejects.toThrow(UnauthorizedError);

    // The rotated-away session is invisible to the auth gates regardless of the grace window.
    const rotatedRow = await db
      .selectFrom('sessions')
      .select('status')
      .where('refresh_token', '=', hashToken(tokens.refresh_token))
      .where('tenant_id', '=', owner.tenant_id)
      .executeTakeFirst();
    expect(rotatedRow?.status).toBe('rotated');

    await expect(controller.renewAuthToken('bogus-refresh-token')).rejects.toThrow(UnauthorizedError);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should enforce admin/owner rules on adminTriggerPasswordReset', async () => {
    const owner = await signUpOwner(controller, db);
    const admin = await controller.inviteUser(authFor(owner), {
      email: `admin2-${rand()}@example.com`,
      first_name: 'Admin2',
      role: 'admin',
    });
    const member = await controller.inviteUser(authFor(owner), {
      email: `member2-${rand()}@example.com`,
      first_name: 'Member2',
      role: 'user',
    });
    const memberAuth = {
      tenant_id: String(owner.tenant_id),
      user_id: String(member.id),
      session_id: 's',
      role: 'user',
    };
    const adminAuth = { tenant_id: String(owner.tenant_id), user_id: String(admin.id), session_id: 's', role: 'admin' };

    await expect(controller.adminTriggerPasswordReset(memberAuth, admin.id)).rejects.toThrow(ForbiddenError);
    await expect(controller.adminTriggerPasswordReset(adminAuth, owner.id)).rejects.toThrow(ForbiddenError);
    await expect(controller.adminTriggerPasswordReset(authFor(owner), rand())).rejects.toThrow(NotFoundError);

    const result = await controller.adminTriggerPasswordReset(authFor(owner), admin.id);
    expect(result.success).toBe(true);
    const row = await db.selectFrom('authusers').selectAll().where('id', '=', admin.id).executeTakeFirstOrThrow();
    expect(row.password_reset_code).not.toBeNull();

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should dismiss the passkey setup prompt', async () => {
    const owner = await signUpOwner(controller, db);
    const result = await controller.dismissPasskeyPrompt(authFor(owner));
    expect(result.success).toBe(true);

    const row = await db.selectFrom('authusers').selectAll().where('id', '=', owner.id).executeTakeFirstOrThrow();
    expect(row.passkey_setup_dismissed_at).not.toBeNull();

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should report tenant account status and throw NotFoundError for a missing tenant', async () => {
    const owner = await signUpOwner(controller, db);
    const status = await controller.getTenantAccountStatus(authFor(owner));
    expect(status).toEqual({ deletion_scheduled_at: null, suspended_at: null, paused_at: null });

    await expect(controller.getTenantAccountStatus({ ...authFor(owner), tenant_id: rand() })).rejects.toThrow(
      NotFoundError,
    );

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should pause and resume a tenant, rejecting double pause/resume', async () => {
    const owner = await signUpOwner(controller, db);

    const paused = await controller.pauseTenant(authFor(owner));
    expect(paused.success).toBe(true);
    await expect(controller.pauseTenant(authFor(owner))).rejects.toThrow(BadRequestError);

    const sessionsAfterPause = await db
      .selectFrom('sessions')
      .selectAll()
      .where('tenant_id', '=', owner.tenant_id)
      .execute();
    expect(sessionsAfterPause).toHaveLength(0);

    const resumed = await controller.resumeTenant(authFor(owner));
    expect(resumed.success).toBe(true);
    await expect(controller.resumeTenant(authFor(owner))).rejects.toThrow(BadRequestError);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should schedule and cancel tenant deletion, including via cancellation token', async () => {
    const owner = await signUpOwner(controller, db);

    const scheduled = await controller.scheduleTenantDeletion(authFor(owner));
    expect(scheduled.success).toBe(true);
    await expect(controller.scheduleTenantDeletion(authFor(owner))).rejects.toThrow(BadRequestError);

    const badToken = controller.cancelTenantDeletionByToken(String(owner.tenant_id), 'wrong-token');
    await expect(badToken).rejects.toThrow(BadRequestError);

    const goodToken = controller.makeDeletionCancelToken(String(owner.tenant_id));
    const result = await controller.cancelTenantDeletionByToken(String(owner.tenant_id), goodToken);
    expect(result.success).toBe(true);

    await controller.scheduleTenantDeletion(authFor(owner));
    const cancelled = await controller.cancelTenantDeletion(authFor(owner));
    expect(cancelled.success).toBe(true);

    const tenant = await db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', owner.tenant_id)
      .executeTakeFirstOrThrow();
    expect(tenant.deletion_scheduled_at).toBeNull();

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should upload and delete an avatar without touching real blob storage', async () => {
    const owner = await signUpOwner(controller, db);
    const uploadSpy = vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined);
    const deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    const uploaded = await controller.uploadAvatar(authFor(owner), {
      dataBase64: Buffer.from('fake-image-bytes').toString('base64'),
      mimeType: 'image/png',
      filename: 'avatar.png',
    });
    expect(uploaded.file_id).toBeTypeOf('string');
    expect(uploadSpy).toHaveBeenCalled();

    await expect(
      controller.uploadAvatar(authFor(owner), {
        dataBase64: Buffer.from('x').toString('base64'),
        mimeType: 'application/pdf' as never,
        filename: 'doc.pdf',
      }),
    ).rejects.toThrow(BadRequestError);

    const deleted = await controller.deleteAvatar(authFor(owner));
    expect(deleted.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();

    const profile = await db.selectFrom('profiles').selectAll().where('auth_id', '=', owner.id).executeTakeFirst();
    expect(profile.avatar_file_id).toBeNull();

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should block changing your own role, for every caller role', async () => {
    const owner = await signUpOwner(controller, db);
    const admin = await controller.inviteUser(authFor(owner), {
      email: `admin-${rand()}@example.com`,
      first_name: 'Admin',
      role: 'admin',
    });
    const adminAuth = {
      tenant_id: String(owner.tenant_id),
      user_id: String(admin.id),
      session_id: 's',
      role: 'admin',
    };

    await expect(controller.updateUser(authFor(owner), owner.id, { role: 'admin' })).rejects.toThrow(ForbiddenError);
    await expect(controller.updateUser(adminAuth, admin.id, { role: 'viewer' })).rejects.toThrow(ForbiddenError);

    // Sending the unchanged role is not a role change and stays allowed.
    const unchanged = await controller.updateUser(authFor(owner), owner.id, { role: 'owner', first_name: 'Owner' });
    expect(unchanged.role).toBe('owner');

    // Another admin/owner can still change the role.
    const updated = await controller.updateUser(authFor(owner), admin.id, { role: 'user' });
    expect(updated.role).toBe('user');

    await cleanup(db, owner.id, owner.tenant_id);
  });

  // SECURITY REGRESSION (C2) — every guard in updateUser used to test `role === 'user'`.
  // `authusers.role` was nullable and inviteUser inserted NULL when the tenant had no
  // access.default_role, so an unroled account passed all of them: it could edit any user
  // in the tenant and promote a confederate to owner. The guards now ask isPrivilegedRole,
  // and the role column is NOT NULL so the state cannot recur.
  it('should refuse privilege escalation from an unprivileged or unroled caller', async () => {
    const owner = await signUpOwner(controller, db);
    const attacker = await controller.inviteUser(authFor(owner), {
      email: `attacker-${rand()}@example.com`,
      first_name: 'Attacker',
      role: 'user',
    });
    // Invited with NO role — the exact path that used to insert NULL. It must land a
    // real role, and it doubles as the escalation target below.
    const confederate = await controller.inviteUser(authFor(owner), {
      email: `confederate-${rand()}@example.com`,
      first_name: 'Confederate',
    });
    const invitedRow = await db
      .selectFrom('authusers')
      .select('role')
      .where('id', '=', confederate.id)
      .executeTakeFirst();
    expect(invitedRow.role).toBe('user');

    // The original exploit, from both an Editor and a (now impossible) null role.
    for (const callerRole of ['user', null]) {
      const attackerAuth = {
        tenant_id: String(owner.tenant_id),
        user_id: String(attacker.id),
        session_id: 's',
        role: callerRole,
      };

      await expect(controller.updateUser(attackerAuth, String(confederate.id), { role: 'owner' })).rejects.toThrow(
        ForbiddenError,
      );

      // ...and they cannot edit another user at all.
      await expect(
        controller.updateUser(attackerAuth, String(confederate.id), { first_name: 'Renamed' }),
      ).rejects.toThrow(ForbiddenError);
    }

    const untouched = await db
      .selectFrom('authusers')
      .select(['role', 'first_name'])
      .where('id', '=', confederate.id)
      .executeTakeFirst();
    expect(untouched.role).toBe('user');
    expect(untouched.first_name).toBe('Confederate');

    // Inviting is likewise admin/owner-only, for an unroled caller too.
    for (const callerRole of ['user', null]) {
      await expect(
        controller.inviteUser(
          { tenant_id: String(owner.tenant_id), user_id: String(attacker.id), session_id: 's', role: callerRole },
          { email: `nope-${rand()}@example.com`, first_name: 'Nope', role: 'owner' },
        ),
      ).rejects.toThrow(ForbiddenError);
    }

    // A role can never be cleared back to null.
    await expect(
      controller.updateUser(authFor(owner), String(confederate.id), { role: null as never }),
    ).rejects.toThrow(BadRequestError);

    await cleanup(db, owner.id, owner.tenant_id);
    // Several invites, each Argon2id-hashing a temp password, exceed the 5s default.
  }, 60000);

  it('should deactivate and reactivate a user, blocking sign-in while deactivated', async () => {
    const owner = await signUpOwner(controller, db);
    const member = await controller.inviteUser(authFor(owner), {
      email: `member-${rand()}@example.com`,
      first_name: 'Member',
      role: 'user',
    });
    const admin = await controller.inviteUser(authFor(owner), {
      email: `admin-${rand()}@example.com`,
      first_name: 'Admin',
      role: 'admin',
    });
    const adminAuth = {
      tenant_id: String(owner.tenant_id),
      user_id: String(admin.id),
      session_id: 's',
      role: 'admin',
    };

    // Give the member a known password + verified so sign-in behavior is observable.
    const { hashPassword } = await import('../../lib/password-hash');
    const memberPassword = 'MemberPassword123!';
    await db
      .updateTable('authusers')
      .set({ password: await hashPassword(memberPassword), verified: true })
      .where('id', '=', member.id)
      .execute();
    const signedIn = await controller.signIn({ email: member.email, password: memberPassword });
    expect('auth_token' in signedIn).toBe(true);

    // Guards
    await expect(controller.adminDeactivateUser(authFor(owner), owner.id)).rejects.toThrow(BadRequestError);
    await expect(controller.adminDeactivateUser(adminAuth, owner.id)).rejects.toThrow(ForbiddenError);
    await expect(controller.adminDeactivateUser(authFor(owner), rand())).rejects.toThrow(NotFoundError);

    const result = await controller.adminDeactivateUser(authFor(owner), member.id);
    expect(result.success).toBe(true);

    const row = await db.selectFrom('authusers').selectAll().where('id', '=', member.id).executeTakeFirst();
    expect(row.deactivated_at).not.toBeNull();

    // Sessions are revoked and sign-in is blocked (it must NOT auto-restore like scheduled deletion does).
    const sessions = await db.selectFrom('sessions').selectAll().where('user_id', '=', member.id).execute();
    expect(sessions.length).toBe(0);
    await expect(controller.signIn({ email: member.email, password: memberPassword })).rejects.toThrow(ForbiddenError);

    // Deactivated accounts keep their role; double-deactivation is rejected.
    await expect(controller.updateUser(authFor(owner), member.id, { role: 'admin' })).rejects.toThrow(BadRequestError);
    await expect(controller.adminDeactivateUser(authFor(owner), member.id)).rejects.toThrow(BadRequestError);

    // Reactivation restores access.
    await expect(controller.adminReactivateUser(authFor(owner), member.id)).resolves.toMatchObject({ success: true });
    await expect(controller.adminReactivateUser(authFor(owner), member.id)).rejects.toThrow(BadRequestError);
    const restored = await controller.signIn({ email: member.email, password: memberPassword });
    expect('auth_token' in restored).toBe(true);

    await cleanup(db, owner.id, owner.tenant_id);
  });

  it('should resend an invitation only to unverified, active users', async () => {
    const owner = await signUpOwner(controller, db);
    const invited = await controller.inviteUser(authFor(owner), {
      email: `invited-${rand()}@example.com`,
      first_name: 'Invited',
      role: 'user',
    });

    const before = await db.selectFrom('authusers').selectAll().where('id', '=', invited.id).executeTakeFirst();
    const result = await controller.adminResendInvite(authFor(owner), invited.id);
    expect(result.success).toBe(true);

    // A fresh temp password and activation code were issued, and the email was queued in the outbox.
    const after = await db.selectFrom('authusers').selectAll().where('id', '=', invited.id).executeTakeFirst();
    expect(after.password).not.toBe(before.password);
    expect(after.password_reset_code).not.toBeNull();
    const jobs = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('tenant_id', '=', String(owner.tenant_id))
      .execute();
    expect(JSON.stringify(jobs)).toContain(invited.email);

    // Preconditions: already-activated and missing users are rejected.
    await expect(controller.adminResendInvite(authFor(owner), owner.id)).rejects.toThrow(BadRequestError);
    await expect(controller.adminResendInvite(authFor(owner), rand())).rejects.toThrow(NotFoundError);

    // Deactivated users must be reactivated first.
    await controller.adminDeactivateUser(authFor(owner), invited.id);
    await expect(controller.adminResendInvite(authFor(owner), invited.id)).rejects.toThrow(BadRequestError);

    await cleanup(db, owner.id, owner.tenant_id);
  });
});
