import {
  InviteAuthUserObj,
  Verify2FAObj,
  getAllOptions,
  signInInputObj,
  signUpInputObj,
  idSchema,
  UpdateAuthUserObj,
} from '../../../../../../libs/common/src';

import z from 'zod';

import { authProcedure, adminOrOwnerProcedure, publicProcedure, router } from '../../../trpc';
import { TourStateObj } from '../../../../../../libs/common/src';
import { AuthController } from './controller';
import { PasskeyController } from './passkey.controller';
import { clearRefreshCookie, getRefreshTokenFromCookie, setRefreshCookie } from './auth-cookie';
import { checkRateLimit } from '../../lib/rate-limiter';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types';

const MIN15 = 15 * 60 * 1000;
const HOUR1 = 60 * 60 * 1000;

function currentUser() {
  return authProcedure.query(({ ctx }) => controller.currentUser(ctx.auth));
}

function count() {
  return adminOrOwnerProcedure.query(({ ctx }) => controller.getCount(ctx.auth.tenant_id));
}

function getAllWithCounts() {
  return adminOrOwnerProcedure.input(getAllOptions).query(({ input, ctx }) => controller.getAllUsers(ctx.auth, input));
}

function getById() {
  return authProcedure.input(idSchema).query(({ input, ctx }) => controller.getUserById(ctx.auth, input));
}

function update() {
  return authProcedure
    .input(z.object({ id: idSchema, data: UpdateAuthUserObj }))
    .mutation(({ input, ctx }) => controller.updateUser(ctx.auth, input.id, input.data));
}

function renewAuthToken() {
  // The refresh token arrives via the HttpOnly cookie, not the body (SECURITY-REVIEW 2.1). Rotate
  // it, hand back only the new access token, and re-set the refreshed cookie.
  return publicProcedure.mutation(async ({ ctx }) => {
    // Was entirely unthrottled (finding M8). Generous — a legitimate client refreshes a
    // few times an hour — but not unbounded.
    checkRateLimit(`${ctx.req?.ip ?? 'unknown'}:renewAuthToken`, 60, MIN15);
    const refreshToken = getRefreshTokenFromCookie(ctx.req);
    const result = await controller.renewAuthToken(refreshToken);
    setRefreshCookie(ctx.res, result.refresh_token, result.refresh_expires_at);
    return { auth_token: result.auth_token };
  });
}

function resetPassword() {
  return publicProcedure.input(z.object({ password: z.string(), code: z.string() })).mutation(({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    checkRateLimit(`${ip}:resetPassword`, 5, MIN15);
    return controller.resetPassword(input.password, input.code);
  });
}

function sendPasswordResetEmail() {
  return publicProcedure
    .input(z.object({ email: z.string().trim().email('Invalid email address') }))
    .mutation(({ input, ctx }) => {
      const ip = ctx.req?.ip ?? 'unknown';
      checkRateLimit(`${ip}:sendPasswordResetEmail`, 3, HOUR1);
      // Per-EMAIL as well as per-IP (finding M8): the IP limit alone let an attacker
      // rotating source addresses mail-bomb one victim. resendVerificationEmail already
      // limited both axes; this one did not.
      checkRateLimit(`email:${input.email.toLowerCase()}:sendPasswordResetEmail`, 3, HOUR1);
      return controller.sendPasswordResetEmail(input.email);
    });
}

function signIn() {
  return publicProcedure.input(signInInputObj).mutation(async ({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    checkRateLimit(`${ip}:signIn`, 10, MIN15);
    const ua = ctx.req?.headers?.['user-agent'] || '';
    const result = await controller.signIn(input, ip, ua);
    // 2FA challenge → no tokens yet; otherwise stash the refresh token in the cookie.
    if ('auth_token' in result) {
      setRefreshCookie(ctx.res, result.refresh_token, result.refresh_expires_at);
      return { auth_token: result.auth_token };
    }
    return result;
  });
}

function verify2FA() {
  return publicProcedure.input(Verify2FAObj).mutation(async ({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    checkRateLimit(`${ip}:verify2FA`, 5, MIN15);
    const ua = ctx.req?.headers?.['user-agent'] || '';
    const result = await controller.verify2FA(input.email, input.code, ip, ua, input.rememberMe);
    setRefreshCookie(ctx.res, result.refresh_token, result.refresh_expires_at);
    return { auth_token: result.auth_token };
  });
}

function scheduleAccountDeletion() {
  return authProcedure.mutation(({ ctx }) => controller.scheduleAccountDeletion(ctx.auth));
}

function cancelAccountDeletion() {
  return authProcedure.mutation(({ ctx }) => controller.cancelAccountDeletion(ctx.auth));
}

function getTenantAccountStatus() {
  return adminOrOwnerProcedure.query(({ ctx }) => controller.getTenantAccountStatus(ctx.auth));
}

function getSeatUsage() {
  return adminOrOwnerProcedure.query(({ ctx }) => controller.getSeatUsage(ctx.auth));
}

function cancelTenantDeletionByToken() {
  return publicProcedure
    .input(z.object({ tenantId: z.string(), token: z.string() }))
    .mutation(({ input }) => controller.cancelTenantDeletionByToken(input.tenantId, input.token));
}

function scheduleTenantDeletion() {
  return adminOrOwnerProcedure.mutation(({ ctx }) => controller.scheduleTenantDeletion(ctx.auth));
}

function cancelTenantDeletion() {
  return adminOrOwnerProcedure.mutation(({ ctx }) => controller.cancelTenantDeletion(ctx.auth));
}

function pauseTenant() {
  return adminOrOwnerProcedure.mutation(({ ctx }) => controller.pauseTenant(ctx.auth));
}

function resumeTenant() {
  return adminOrOwnerProcedure.mutation(({ ctx }) => controller.resumeTenant(ctx.auth));
}

function cancelEmailChange() {
  return authProcedure.mutation(({ ctx }) => controller.cancelEmailChange(ctx.auth));
}

function uploadAvatar() {
  return authProcedure
    .input(
      z.object({
        dataBase64: z.string().min(1),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
        filename: z.string().min(1).max(255),
      }),
    )
    .mutation(({ input, ctx }) => controller.uploadAvatar(ctx.auth, input));
}

function deleteAvatar() {
  return authProcedure.mutation(({ ctx }) => controller.deleteAvatar(ctx.auth));
}

function adminTriggerPasswordReset() {
  return adminOrOwnerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => controller.adminTriggerPasswordReset(ctx.auth, input.id));
}

function deactivateUser() {
  return adminOrOwnerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => controller.adminDeactivateUser(ctx.auth, input.id));
}

function reactivateUser() {
  return adminOrOwnerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => controller.adminReactivateUser(ctx.auth, input.id));
}

function resendInvite() {
  return adminOrOwnerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => controller.adminResendInvite(ctx.auth, input.id));
}

function invite() {
  return adminOrOwnerProcedure
    .input(InviteAuthUserObj)
    .mutation(({ input, ctx }) => controller.inviteUser(ctx.auth, input));
}

function signOut() {
  return authProcedure.mutation(async ({ ctx }) => {
    clearRefreshCookie(ctx.res);
    return controller.signOut(ctx.auth);
  });
}

function signUp() {
  return publicProcedure.input(signUpInputObj).mutation(async ({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    // ACCEPTED RISK (finding M7): signUp answers "this email already has an account",
    // which is an enumeration oracle. Kept deliberately — silently accepting a duplicate
    // signup, or refusing without saying why, is worse for someone who simply forgot they
    // had an account. What is not acceptable is sweeping the oracle across a list, so the
    // per-IP limit is joined by a per-address one.
    checkRateLimit(`email:${input.email.toLowerCase()}:signUp`, 3, HOUR1);
    checkRateLimit(`${ip}:signUp`, 5, HOUR1);
    const result = await controller.signUp(input);
    setRefreshCookie(ctx.res, result.refresh_token, result.refresh_expires_at);
    return { auth_token: result.auth_token };
  });
}

function deleteOne() {
  return adminOrOwnerProcedure.input(idSchema).mutation(({ input, ctx }) => controller.deleteUser(ctx.auth, input));
}

function verifyEmail() {
  return publicProcedure.input(z.object({ code: z.string() })).mutation(({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    checkRateLimit(`${ip}:verifyEmail`, 10, MIN15);
    return controller.verifyEmail(input.code);
  });
}

function resendVerificationEmail() {
  return publicProcedure.input(z.object({ email: z.string().trim().email() })).mutation(({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    checkRateLimit(`${ip}:resendVerification`, 5, MIN15);
    checkRateLimit(`resendVerification:${input.email}`, 5, MIN15);
    return controller.resendVerificationEmail(input.email);
  });
}

function dismissPasskeyPrompt() {
  return authProcedure.mutation(({ ctx }) => controller.dismissPasskeyPrompt(ctx.auth));
}

const controller = new AuthController();
const passkeyController = new PasskeyController();

function passkeyRegistrationOptions() {
  return authProcedure.query(({ ctx }) => passkeyController.getRegistrationOptions(ctx.auth));
}

function verifyPasskeyRegistration() {
  return authProcedure
    .input(
      z.object({
        response: z.any().transform((v) => v as RegistrationResponseJSON),
        friendlyName: z.string().max(100).optional(),
      }),
    )
    .mutation(({ input, ctx }) => passkeyController.verifyRegistration(ctx.auth, input.response, input.friendlyName));
}

function passkeyAuthenticationOptions() {
  return publicProcedure.query(({ ctx }) => {
    // Mints a WebAuthn challenge; was unthrottled (finding M8).
    checkRateLimit(`${ctx.req?.ip ?? 'unknown'}:passkeyAuthOptions`, 30, MIN15);
    return passkeyController.getAuthenticationOptions();
  });
}

function checkEmail() {
  return publicProcedure.input(z.object({ email: z.string().trim().email() })).query(({ input, ctx }) => {
    const ip = ctx.req?.ip ?? 'unknown';
    // ACCEPTED RISK (finding M7): a `true` here reveals that the address exists AND has a
    // passkey (an unknown address and a password-only account both return false). The
    // sign-in page needs it to offer passkey authentication. Bounded on both axes so it
    // cannot be swept across a list.
    checkRateLimit(`email:${input.email.toLowerCase()}:checkEmail`, 10, MIN15);
    checkRateLimit(`${ip}:checkEmail`, 20, MIN15);
    return passkeyController.checkEmailPasskeys(input.email);
  });
}

function verifyPasskeyAuthentication() {
  return publicProcedure
    .input(
      z.object({
        response: z.any().transform((v) => v as AuthenticationResponseJSON),
        nonce: z.string(),
        rememberMe: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ip = ctx.req?.ip ?? 'unknown';
      checkRateLimit(`${ip}:verifyPasskeyAuthentication`, 10, MIN15);
      const ua = ctx.req?.headers?.['user-agent'] ?? '';
      const result = await passkeyController.verifyAuthentication(
        input.response,
        input.nonce,
        ip,
        ua,
        input.rememberMe,
      );
      setRefreshCookie(ctx.res, result.refresh_token, result.refresh_expires_at);
      return { auth_token: result.auth_token };
    });
}

function listPasskeys() {
  return authProcedure.query(({ ctx }) => passkeyController.listPasskeys(ctx.auth));
}

function deletePasskey() {
  return authProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => passkeyController.deletePasskey(ctx.auth, input.id));
}

function updatePasskeyName() {
  return authProcedure
    .input(z.object({ id: z.string(), friendlyName: z.string().min(1).max(100) }))
    .mutation(({ input, ctx }) => passkeyController.updatePasskeyName(ctx.auth, input.id, input.friendlyName));
}

export const AuthRouter = router({
  signUp: signUp(),
  signIn: signIn(),
  signOut: signOut(),
  currentUser: currentUser(),
  getAllWithCounts: getAllWithCounts(),
  getById: getById(),
  invite: invite(),
  update: update(),
  delete: deleteOne(),
  count: count(),
  resetPassword: resetPassword(),
  renewAuthToken: renewAuthToken(),
  sendPasswordResetEmail: sendPasswordResetEmail(),
  verifyEmail: verifyEmail(),
  resendVerificationEmail: resendVerificationEmail(),
  verify2FA: verify2FA(),
  scheduleAccountDeletion: scheduleAccountDeletion(),
  cancelAccountDeletion: cancelAccountDeletion(),
  cancelEmailChange: cancelEmailChange(),
  getTenantAccountStatus: getTenantAccountStatus(),
  getSeatUsage: getSeatUsage(),

  /** Product-tour progress. Per user (a person learns the app once, not once per browser), so it
   * lives on the profile rather than in localStorage. */
  getTourState: authProcedure.query(({ ctx }) => controller.getTourState(ctx.auth)),
  setTourState: authProcedure
    .input(TourStateObj.partial())
    .mutation(({ ctx, input }) => controller.setTourState(ctx.auth, input)),
  scheduleTenantDeletion: scheduleTenantDeletion(),
  cancelTenantDeletion: cancelTenantDeletion(),
  cancelTenantDeletionByToken: cancelTenantDeletionByToken(),
  pauseTenant: pauseTenant(),
  resumeTenant: resumeTenant(),
  adminTriggerPasswordReset: adminTriggerPasswordReset(),
  deactivateUser: deactivateUser(),
  reactivateUser: reactivateUser(),
  resendInvite: resendInvite(),
  uploadAvatar: uploadAvatar(),
  deleteAvatar: deleteAvatar(),
  passkeyRegistrationOptions: passkeyRegistrationOptions(),
  verifyPasskeyRegistration: verifyPasskeyRegistration(),
  passkeyAuthenticationOptions: passkeyAuthenticationOptions(),
  checkEmail: checkEmail(),
  verifyPasskeyAuthentication: verifyPasskeyAuthentication(),
  listPasskeys: listPasskeys(),
  deletePasskey: deletePasskey(),
  updatePasskeyName: updatePasskeyName(),
  dismissPasskeyPrompt: dismissPasskeyPrompt(),
});
