import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Deleting a person or household sequential-scans several large child tables.
 *
 * Every FK column below is indexed only behind `tenant_id` (or as a non-leading column of a
 * composite primary key), e.g. `idx_donations_person` is `(tenant_id, person_id)`. Postgres
 * enforces an ON DELETE SET NULL/CASCADE FK with a plain `WHERE <fkcol> = $1` and no tenant
 * filter — a btree on `(tenant_id, <fkcol>)` cannot serve that lookup as a leading-column match
 * (Postgres 16 has no skip scan), so the check falls back to a sequential scan of the child table.
 *
 * `volunteer_shifts` already carries the correct pattern for exactly this reason:
 * `idx_volunteer_shifts_person_ri` / `idx_volunteer_shifts_event_ri` are single-column indexes
 * that exist ONLY to serve FK referential-integrity checks, alongside the tenant-scoped index used
 * for normal queries. This migration adds the same `_ri` sibling index for every other FK column
 * that references `persons(id)` or `households(id)` and does not already have a leading-column
 * index.
 *
 * Composite FKs that reference `persons(id, tenant_id)` — `event_registrations`, `form_submissions`,
 * `person_connections` — are NOT touched: their RI check is `WHERE person_id = $1 AND tenant_id =
 * $2`, both columns supplied as equality predicates, so their existing `(tenant_id, person_id)`-
 * shaped indexes already serve the check regardless of column order. Tables where the FK column
 * already leads some index (`volunteer_shifts.person_id`, `tasks.person_id`,
 * `potential_duplicates.person_id`/`household_id`, `workflow_enrollments.person_id`,
 * `map_lists_persons.person_id`, `map_lists_households.household_id`) are skipped for the same
 * reason.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // campaign_person_facts.person_id — fk_cpf_person, ON DELETE CASCADE
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaign_person_facts_person_ri
      ON public.campaign_person_facts (person_id)
  `.execute(db);

  // campaign_subscriptions.person_id — fk_csub_person, ON DELETE CASCADE
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaign_subscriptions_person_ri
      ON public.campaign_subscriptions (person_id)
  `.execute(db);

  // delivery_requests.household_id — fk_delivery_requests_household, ON DELETE CASCADE
  await sql`
    CREATE INDEX IF NOT EXISTS idx_delivery_requests_household_ri
      ON public.delivery_requests (household_id)
  `.execute(db);

  // delivery_requests.person_id — fk_delivery_requests_person, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_delivery_requests_person_ri
      ON public.delivery_requests (person_id)
  `.execute(db);

  // delivery_routes.volunteer_person_id — fk_delivery_routes_volunteer, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_delivery_routes_volunteer_person_ri
      ON public.delivery_routes (volunteer_person_id)
  `.execute(db);

  // donation_pledges.person_id — fk_donation_pledges_person, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_donation_pledges_person_ri
      ON public.donation_pledges (person_id)
  `.execute(db);

  // donations.person_id — fk_donations_person, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_donations_person_ri
      ON public.donations (person_id)
  `.execute(db);

  // persons.household_id — fk_household_id, no action (RESTRICT)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_persons_household_ri
      ON public.persons (household_id)
  `.execute(db);

  // teams.team_captain_id — fk_teams_team_captain, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_teams_team_captain_ri
      ON public.teams (team_captain_id)
  `.execute(db);

  // turf_households.household_id — fk_turf_households_household, ON DELETE CASCADE
  await sql`
    CREATE INDEX IF NOT EXISTS idx_turf_households_household_ri
      ON public.turf_households (household_id)
  `.execute(db);

  // turf_knocks.household_id — fk_turf_knocks_household, ON DELETE CASCADE
  await sql`
    CREATE INDEX IF NOT EXISTS idx_turf_knocks_household_ri
      ON public.turf_knocks (household_id)
  `.execute(db);

  // turf_knocks.person_id — fk_turf_knocks_person, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_turf_knocks_person_ri
      ON public.turf_knocks (person_id)
  `.execute(db);

  // map_households_tags.household_id — household_id is only the 2nd column of the
  // (tenant_id, household_id, tag_id) primary key, not a leading column.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_map_households_tags_household_ri
      ON public.map_households_tags (household_id)
  `.execute(db);

  // map_peoples_tags.person_id — person_id is only the 2nd column of the
  // (tenant_id, person_id, tag_id) primary key, not a leading column.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_map_peoples_tags_person_ri
      ON public.map_peoples_tags (person_id)
  `.execute(db);

  // map_teams_persons.person_id — person_id is only the 3rd column of the
  // (tenant_id, team_id, person_id) primary key, not a leading column.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_map_teams_persons_person_ri
      ON public.map_teams_persons (person_id)
  `.execute(db);

  // tenants.placeholder_household_id — tenants_placeholder_household_id_fkey, ON DELETE SET NULL
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenants_placeholder_household_ri
      ON public.tenants (placeholder_household_id)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_tenants_placeholder_household_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_map_teams_persons_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_map_peoples_tags_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_map_households_tags_household_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_turf_knocks_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_turf_knocks_household_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_turf_households_household_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_teams_team_captain_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_persons_household_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_donations_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_donation_pledges_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_delivery_routes_volunteer_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_delivery_requests_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_delivery_requests_household_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_campaign_subscriptions_person_ri`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_campaign_person_facts_person_ri`.execute(db);
}
