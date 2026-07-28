import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Give the product's hottest list queries an index that covers their sort key.
 *
 * Every one of these tables had composite `(tenant_id, …)` indexes that stop *before* the column
 * the query orders by, so Postgres fetched the whole tenant's rows and sorted them externally on
 * every page load. That is invisible on a demo tenant and degrades non-linearly — it bites the
 * largest, most successful customer first.
 *
 * The inbox needed a schema change to be indexable at all: it sorted by
 * `coalesce(email_headers.date_sent, emails.created_at)`, a COALESCE across a join, which no
 * single index can serve. `date_sent` is denormalized onto `emails` (NOT NULL, defaulting to the
 * row's own creation time) so the sort becomes a plain column on one table.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // ── emails: denormalize the sort key ────────────────────────────────────────
  await sql`ALTER TABLE public.emails ADD COLUMN IF NOT EXISTS date_sent timestamp with time zone`.execute(db);

  // Backfill from the header row, which is where the real send time lives.
  await sql`
    UPDATE public.emails e
       SET date_sent = eh.date_sent
      FROM public.email_headers eh
     WHERE eh.email_id = e.id
       AND eh.tenant_id = e.tenant_id
       AND eh.date_sent IS NOT NULL
       AND e.date_sent IS NULL
  `.execute(db);

  // Anything with no header date keeps the old COALESCE fallback: its own created_at.
  await sql`UPDATE public.emails SET date_sent = created_at WHERE date_sent IS NULL`.execute(db);

  // NOT NULL with a default so a future insert that forgets the column still sorts sensibly
  // (as "just arrived") rather than vanishing from an ORDER BY on a nullable column.
  await sql`ALTER TABLE public.emails ALTER COLUMN date_sent SET DEFAULT now()`.execute(db);
  await sql`ALTER TABLE public.emails ALTER COLUMN date_sent SET NOT NULL`.execute(db);

  // The inbox query: tenant + campaign + folder, newest first, id as the total-order tiebreaker.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emails_inbox_sort
      ON public.emails (tenant_id, campaign_id, folder_id, date_sent DESC, id DESC)
  `.execute(db);

  // email_headers had no index beyond its PK and one unique, so the inbox's header join was a
  // scan per page. The ingester and the sync sweeps also look rows up by email_id.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_headers_email_date
      ON public.email_headers (email_id, date_sent DESC)
  `.execute(db);

  // ── user_activity: the fastest-growing table in the schema ──────────────────
  // Existing indexes are (tenant_id, entity, entity_id) and (tenant_id, user_id) — both stop
  // before created_at, and the tenant-wide feed had no usable index at all.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_activity_tenant_created
      ON public.user_activity (tenant_id, created_at DESC)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_activity_record_created
      ON public.user_activity (tenant_id, entity, entity_id, created_at DESC)
  `.execute(db);

  // ── notifications: the bell polls this ──────────────────────────────────────
  await sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON public.notifications (tenant_id, user_id, created_at DESC)
  `.execute(db);

  // ── donations: every fundraising report is a date range ─────────────────────
  await sql`
    CREATE INDEX IF NOT EXISTS idx_donations_tenant_campaign_created
      ON public.donations (tenant_id, campaign_id, created_at DESC)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const name of [
    'idx_donations_tenant_campaign_created',
    'idx_notifications_user_created',
    'idx_user_activity_record_created',
    'idx_user_activity_tenant_created',
    'idx_email_headers_email_date',
    'idx_emails_inbox_sort',
  ]) {
    await sql`DROP INDEX IF EXISTS ${sql.raw(name)}`.execute(db);
  }
  await sql`ALTER TABLE public.emails DROP COLUMN IF EXISTS date_sent`.execute(db);
}
