import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Self-service account deletion becomes a tombstone, not a hard delete.
 *
 * ~61 foreign keys reference authusers with NO ACTION (createdby_id / updatedby_id /
 * author_id / user_activity.user_id …), so `DELETE FROM authusers` fails with 23503 for any
 * user who ever acted in the app — which is why the perform_scheduled_deletions cron silently
 * re-failed the same users forever. Instead the row is retained for FK integrity and the
 * identity is scrubbed in place (email → deleted-<id>@deleted.invalid, name → 'Deleted user',
 * credentials/2FA cleared). `deleted_at` marks the tombstone; every live-user query filters on
 * it. Workspace (tenant) deletion remains a true hard delete via wipeTenant.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.authusers ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.authusers DROP COLUMN IF EXISTS deleted_at`.execute(db);
}
