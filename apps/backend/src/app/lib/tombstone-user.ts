import type { Transaction } from 'kysely';

import { logger } from '../logger';
import { StorageService } from './storage.service';
import type { Models } from '../../../../../libs/common/src/lib/kysely.models';

/**
 * Tombstone a user instead of hard-deleting the row: ~61 NO ACTION foreign keys
 * (createdby_id / updatedby_id / author_id / user_activity.user_id …) reference authusers, so a
 * DELETE fails with 23503 for anyone who ever acted in the app. The row stays for FK integrity
 * and attribution ("Deleted user" in grids and activity feeds — they render
 * authusers.first_name/last_name); everything personal is scrubbed or removed:
 *
 * - avatar file (storage object + files row), profiles, sessions, passkeys — deleted.
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
 */
export async function tombstoneAuthUser(
  trx: Transaction<Models>,
  opts: { tenantId: string; userId: string; updatedbyId: string },
): Promise<void> {
  const { tenantId, userId, updatedbyId } = opts;
  const now = new Date();

  const profile = await trx
    .selectFrom('profiles')
    .select(['avatar_file_id'])
    .where('tenant_id', '=', tenantId)
    .where('auth_id', '=', userId)
    .executeTakeFirst();
  if (profile?.avatar_file_id) {
    try {
      const avatarFile = await trx
        .selectFrom('files')
        .select('storage_key')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(profile.avatar_file_id))
        .executeTakeFirst();
      if (avatarFile?.storage_key) await new StorageService().delete(String(avatarFile.storage_key));
      await trx
        .deleteFrom('files')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(profile.avatar_file_id))
        .execute();
    } catch (err) {
      // The blob is orphaned at worst — never fail the deletion over avatar cleanup.
      logger.error({ err, userId }, 'Failed to clean up avatar while tombstoning user');
    }
  }

  await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
  await trx.deleteFrom('profiles').where('tenant_id', '=', tenantId).where('auth_id', '=', userId).execute();
  await trx.deleteFrom('passkeys').where('tenant_id', '=', tenantId).where('user_id', '=', userId).execute();

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
}
