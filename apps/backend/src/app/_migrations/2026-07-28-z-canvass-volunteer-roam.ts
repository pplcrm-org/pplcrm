import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Let an approved volunteer pick their own turf.
 *
 * Until now a turf token WAS the security boundary: you saw one turf's doors because
 * that is what the token granted. That conflated two different decisions. Approving a
 * companion volunteer is the trust decision — an admin has already said this person may
 * see canvassing data for this campaign. Which turf they walk is a planning decision.
 *
 * `app.canvass_volunteer_roam` separates them:
 *   'campaign' (default) — browse and self-claim any unretired turf in their campaign
 *   'assigned'           — only turfs an admin put them on (the pre-existing behavior)
 *
 * The default is 'campaign' for existing workspaces as well as new ones, which WIDENS
 * what already-approved volunteers can see. That is a deliberate product decision, so
 * the value is written explicitly for every existing tenant rather than left implicit:
 * a security posture should be recorded, not inferred from a missing row. Anyone
 * reading `settings` later sees a real choice with a date on it.
 *
 * `companion_volunteers.can_roam` is the per-volunteer override (null = inherit), so
 * "this one person stays on their turf" never requires tightening the whole workspace.
 */
const ROAM_SETTING_KEY = 'app.canvass_volunteer_roam';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.companion_volunteers ADD COLUMN IF NOT EXISTS can_roam boolean`.execute(db);

  // Write the default explicitly for every tenant, using that tenant's own admin as the
  // actor so the audit columns are honest. ON CONFLICT (not NOT EXISTS) so a tenant that
  // has already chosen keeps their choice.
  await sql`
    INSERT INTO public.settings (tenant_id, key, value, createdby_id, updatedby_id)
    SELECT t.id, ${ROAM_SETTING_KEY}, '"campaign"'::jsonb, t.admin_id, t.admin_id
      FROM public.tenants AS t
    ON CONFLICT (tenant_id, key) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM public.settings WHERE key = ${ROAM_SETTING_KEY}`.execute(db);
  await sql`ALTER TABLE public.companion_volunteers DROP COLUMN IF EXISTS can_roam`.execute(db);
}
