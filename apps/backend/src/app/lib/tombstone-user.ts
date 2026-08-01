import type { Transaction } from 'kysely';

import { deleteFileRowIfUnreferenced } from './file-references';
import { logger } from '../logger';
import type { Models } from '../../../../../libs/common/src/lib/kysely.models';

/**
 * Tombstone a user instead of hard-deleting the row: ~61 NO ACTION foreign keys
 * (createdby_id / updatedby_id / author_id / user_activity.user_id …) reference authusers, so a
 * DELETE fails with 23503 for anyone who ever acted in the app. The row stays for FK integrity
 * and attribution ("Deleted user" in grids and activity feeds — they render
 * authusers.first_name/last_name); everything personal is scrubbed or removed:
 *
 * - avatar file (storage object + files row), profiles, sessions, passkeys — deleted. The avatar
 *   row is kept if anything else still points at it, because uploads are sha256-deduped and that
 *   row can also be an email attachment or a newsletter image.
 *   (passkeys/profiles/sessions only cascade on a row DELETE, so they go explicitly here.)
 * - email → deleted-<id>@deleted.invalid (satisfies NOT NULL + the global unique key, and
 *   frees the real address for re-signup), name → 'Deleted user', password emptied (argon2
 *   verification can never match), 2FA/reset codes cleared.
 * - deletion_scheduled_at cleared (stops the daily cron from re-selecting the user),
 *   deactivated_at + deleted_at set (every live-user filter excludes the row).
 *
 * Workspace (tenant) deletion is different — wipeTenant removes all content first and hard
 * deletes for real. Shared by the perform_scheduled_deletions cron and the admin delete-user
 * action so both paths have identical semantics.
 *
 * Returns the avatar blob's storage key when the avatar row was deleted, so the CALLER can delete
 * the blob after its transaction commits. Deleting the blob in here would destroy the payload even
 * when the transaction later rolls back and the row comes back.
 */
export async function tombstoneAuthUser(
  trx: Transaction<Models>,
  opts: { tenantId: string; userId: string; updatedbyId: string },
): Promise<string | null> {
  const { tenantId, userId, updatedbyId } = opts;
  const now = new Date();

  const profile = await trx
    .selectFrom('profiles')
    .select(['avatar_file_id'])
    .where('tenant_id', '=', tenantId)
    .where('auth_id', '=', userId)
    .executeTakeFirst();
  const avatarFileId = profile?.avatar_file_id ? String(profile.avatar_file_id) : null;

  await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
  await trx.deleteFrom('profiles').where('tenant_id', '=', tenantId).where('auth_id', '=', userId).execute();
  await trx.deleteFrom('passkeys').where('tenant_id', '=', tenantId).where('user_id', '=', userId).execute();

  // After the profiles row is gone, so its own avatar_file_id is no longer a holder. Account
  // deletion must never fail over this, so a shared file is simply kept and the error swallowed.
  let avatarBlobKey: string | null = null;
  if (avatarFileId) {
    try {
      avatarBlobKey = await deleteFileRowIfUnreferenced(trx, tenantId, avatarFileId, {
        includeEntityOwnership: true,
      });
    } catch (err) {
      // The blob is orphaned at worst — never fail the deletion over avatar cleanup.
      logger.error({ err, userId }, 'Failed to clean up avatar while tombstoning user');
    }
  }

  await trx
    .updateTable('authusers')
    .set({
      email: `deleted-${userId}@deleted.invalid`,
      first_name: 'Deleted user',
      last_name: '',
      password: '',
      password_reset_code: null,
      password_reset_code_created_at: null,
      verified: false,
      two_factor_enabled: false,
      two_factor_code: null,
      two_factor_expires_at: null,
      two_factor_attempts: 0,
      previous_email: null,
      previous_role: null,
      passkey_setup_dismissed_at: null,
      campaign_id: null,
      deletion_scheduled_at: null,
      deactivated_at: now,
      deleted_at: now,
      updated_at: now,
      updatedby_id: updatedbyId,
    })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', userId)
    .execute();

  return avatarBlobKey;
}
