import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Dashboard statistics move off the request path (REVIEW6 T1-3).
 *
 * The dashboard used to read the whole `emails`, `tasks`, `user_activity` and `email_recipients`
 * tables into Node memory on every page view to recompute averages from scratch — tens of MB and
 * seconds of CPU on a mailbox-sync tenant, growing for the life of the workspace. The
 * retrospective numbers (windowed closed counts, average first response, average time-to-close)
 * now live in one snapshot row per tenant per day, written by the `refresh_dashboard_stats`
 * background job (nightly sweep + manual refresh); the dashboard reads the newest row by primary
 * key. Older rows are kept as daily history so week-over-week trends stay computable — they can
 * never be backfilled later — and are pruned past 400 days by `prune_retention` (13 months keeps
 * a full year-over-year comparison available).
 *
 * `payload` is versioned jsonb (`DashboardStatsSnapshotObj` in libs/common); the reader treats a
 * shape mismatch as "no snapshot yet", never as data.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.dashboard_stats_snapshots (
      tenant_id     bigint      NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
      snapshot_date date        NOT NULL,
      computed_at   timestamptz NOT NULL DEFAULT now(),
      payload       jsonb       NOT NULL,
      PRIMARY KEY (tenant_id, snapshot_date)
    )
  `.execute(db);

  // Tenant isolation, same NULLIF-escape shape as every other table in this schema: paths that run
  // with no app.tenant_id GUC (migrations, background jobs) are permitted by the first branch and
  // stay protected by their own explicit .where('tenant_id', ...) scoping.
  await sql`ALTER TABLE public.dashboard_stats_snapshots ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.dashboard_stats_snapshots FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation ON public.dashboard_stats_snapshots`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation ON public.dashboard_stats_snapshots
      USING (
        NULLIF(current_setting('app.tenant_id', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
      )
      WITH CHECK (
        NULLIF(current_setting('app.tenant_id', true), '') IS NULL
        OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
      )
  `.execute(db);

  // The live dashboard reads ("open inbox emails", "closed inbox emails in the last N days") filter
  // on all three columns; the existing (tenant_id, folder_id) index reaches every inbox email ever
  // synced, which is exactly the unbounded scan this change removes.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_emails_tenant_folder_status
      ON public.emails (tenant_id, folder_id, status)
  `.execute(db);

  // Serves "was there an outbound email TO this address after this inbound arrived" — the
  // first-response lookup, asked per open breach candidate (live) and per windowed email (snapshot
  // job). The existing (email_id, kind, pos) index answers the opposite direction only. Expression
  // index because the inbound side compares case-insensitively.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_email_recipients_to_address
      ON public.email_recipients (tenant_id, lower(email))
      WHERE kind = 'to'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_email_recipients_to_address`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_emails_tenant_folder_status`.execute(db);
  await sql`DROP TABLE IF EXISTS public.dashboard_stats_snapshots`.execute(db);
}
