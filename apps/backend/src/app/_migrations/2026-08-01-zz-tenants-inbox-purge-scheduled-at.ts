import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * When a workspace's synced shared-inbox mail is due for permanent deletion.
 *
 * The shared inbox is Grassroots+ (plans.ts GATED_FEATURES.inbox). A workspace that lands on the
 * Free plan loses inbox ACCESS immediately, and its synced mail is purged 30 days later
 * (INBOX_PURGE_DELAY_DAYS) by the `purge_downgraded_inboxes` cron — see
 * lib/jobs/handlers/inbox-purge.handlers.ts. Upgrading before the deadline clears this column and
 * nothing is deleted; the purge itself is unrecoverable even after a re-upgrade, because a fresh
 * mailbox connection only backfills the initial-sync window, never full history.
 *
 * NULL = nothing scheduled (paid plan, or no synced mail to purge). Set in one place —
 * `syncInboxPurgeSchedule` (modules/billing/inbox-purge.ts) — whenever a tenant's plan changes.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS inbox_purge_scheduled_at timestamp with time zone`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.tenants DROP COLUMN IF EXISTS inbox_purge_scheduled_at`.execute(db);
}
