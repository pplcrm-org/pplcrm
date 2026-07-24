import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * User-submitted bug reports (fire-and-forget): stored for the ops record, then emailed to
 * OPS_ALERT_EMAIL via the send-bug-report-email background job. Tenant-scoped like any other
 * tenant-authored row; there is no in-app read surface, so no read policies beyond RLS.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE public.bug_reports (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id bigint NOT NULL,
      created_by bigint NOT NULL,
      description text NOT NULL,
      page_url text,
      user_agent text,
      viewport text,
      screenshot_file_id bigint,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX idx_bug_reports_tenant ON public.bug_reports (tenant_id, created_at DESC)`.execute(db);
  await sql`ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE ONLY public.bug_reports FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation ON public.bug_reports
      USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)))
      WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.bug_reports`.execute(db);
}
