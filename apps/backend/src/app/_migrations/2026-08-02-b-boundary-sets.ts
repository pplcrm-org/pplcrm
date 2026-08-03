import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Electoral geography that can hold every level of government at once.
 *
 * `households.district`, `households.precinct` and `households.ward` are three fixed text columns,
 * so an address can record exactly three answers. A single United States household actually sits
 * inside a congressional district AND a state senate district AND a state house district AND a city
 * council district AND a precinct simultaneously — five different lines over one roof. Three columns
 * hold three of them, so each geocoding pass overwrote whatever the previous one found. That is the
 * defect this migration exists to fix.
 *
 * Those three columns are NOT dropped here. They stay, unread, until a separate cleanup change
 * removes them, so that the code reading them and the code writing the new tables can be changed
 * independently rather than in one unreviewable step.
 *
 * Three tables:
 *
 * `boundary_sets`      One named, versioned map layer — "Congressional districts (119th Congress)",
 *                      "Ottawa wards 2022", "the three neighbourhoods we are targeting". `role`
 *                      records what the layer MEANS ('seat_area', 'subdivision', 'locality') and is
 *                      the only place meaning lives.
 * `boundary_features`  The polygons of an editable set, one row per named area. Bulk reference data
 *                      (435 congressional districts, tens of thousands of precincts) ships as build
 *                      assets instead and never lands here; rows are for the sets a human will
 *                      rename, redraw or correct. `geometry` and `bbox` are jsonb: `geometry` holds
 *                      GeoJSON Polygon / MultiPolygon coordinates, `bbox` holds
 *                      [minLng, minLat, maxLng, maxLat] so the matcher can reject a point with four
 *                      comparisons before running a full ray cast.
 * `household_districts` Which named area of which set covers a given household.
 *
 * WHY THE UNIQUE KEY IS (household_id, set_id) AND NOT (household_id, level, kind)
 * ------------------------------------------------------------------------------
 * This is the single most important decision in this migration, and getting it wrong reintroduces
 * the exact bug being fixed, one layer up. A key built from an enum of levels or kinds cannot hold
 * the two cases below, and both are ordinary rather than exotic:
 *
 * 1. Massachusetts needs two subdivision layers at the same time. In Massachusetts cities, wards
 *    CONTAIN precincts and both are voting subdivisions of the same city — the ward is not a seat
 *    area at all, unlike an Ontario ward. Boston City Council districts are their own thing,
 *    unrelated to wards. So a household is genuinely in a ward AND a precinct, two rows with the
 *    same role. A key that allows one row per role, level or kind cannot store both, and no design
 *    that attaches meaning to the WORD "ward" can be correct in Ontario and Massachusetts at once.
 *    Meaning therefore comes from `boundary_sets.role`, never from a layer's name.
 *
 * 2. Redistricting means old and new maps must coexist. Canada went from 338 to 343 seats in the
 *    2023 representation order; the United States redraws congressional and legislative districts
 *    after every census and, in several states, again mid-decade by court order. A campaign
 *    legitimately needs the outgoing map for historical comparison and the incoming map for
 *    targeting, on the same household, on the same day. One row per SET handles this. One row per
 *    level does not — the second vintage would overwrite the first.
 *
 * Keying on the set also makes the key mean something checkable: a household can be in one area of
 * any given map, and in as many maps as the workspace holds.
 *
 * All three tables carry `tenant_id` and get the standard `tenant_isolation` row-level-security
 * policy. None of them belongs on the `local/no-unscoped-db-query` ignore list — uploaded and
 * hand-drawn boundaries are tenant-private data, and every query must carry its own
 * `.where('tenant_id', ...)`. See the pplcrm-tenant-safety skill.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.boundary_sets (
      id            bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id     bigint      NOT NULL,
      slug          text        NOT NULL,
      label         text        NOT NULL,
      jurisdiction  text        NOT NULL,
      role          text        NOT NULL,
      chamber       text,
      region        text,
      vintage       text,
      source        text        NOT NULL,
      file_id       bigint,
      name_property text,
      code_property text,
      feature_count integer,
      createdby_id  bigint      NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT boundary_sets_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT boundary_sets_id_key UNIQUE (id),
      CONSTRAINT uq_boundary_sets_slug UNIQUE (tenant_id, slug),
      CONSTRAINT chk_boundary_sets_jurisdiction CHECK (jurisdiction IN (
        'ca_federal', 'ca_provincial', 'ca_municipal',
        'us_federal', 'us_state', 'us_local',
        'other'
      )),
      CONSTRAINT chk_boundary_sets_role CHECK (role IN ('seat_area', 'subdivision', 'locality')),
      CONSTRAINT chk_boundary_sets_source CHECK (source IN ('bundled', 'upload', 'import', 'drawn')),
      CONSTRAINT chk_boundary_sets_chamber CHECK (chamber IS NULL OR chamber IN ('upper', 'lower'))
    )
  `.execute(db);

  // The uploaded original is kept after parsing, so a bad parse can be re-run against the source
  // file rather than asking the admin to find it again. Deleting the file leaves the set intact.
  await sql`
    ALTER TABLE public.boundary_sets DROP CONSTRAINT IF EXISTS fk_boundary_sets_file
  `.execute(db);
  await sql`
    ALTER TABLE public.boundary_sets
      ADD CONSTRAINT fk_boundary_sets_file
      FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE SET NULL
  `.execute(db);

  // Deriving which sets a workspace's active campaigns require: filtered by jurisdiction, then by
  // role and region.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_boundary_sets_jurisdiction
      ON public.boundary_sets (tenant_id, jurisdiction, role)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.boundary_features (
      id           bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id    bigint      NOT NULL,
      set_id       bigint      NOT NULL,
      name         text        NOT NULL,
      code         text,
      geometry     jsonb       NOT NULL,
      bbox         jsonb       NOT NULL,
      createdby_id bigint      NOT NULL,
      updatedby_id bigint,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT boundary_features_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT boundary_features_id_key UNIQUE (id)
    )
  `.execute(db);

  // Deleting a set deletes its polygons: a feature has no meaning apart from the layer it belongs
  // to, and an orphan would be matched against by nothing and listed nowhere.
  await sql`
    ALTER TABLE public.boundary_features DROP CONSTRAINT IF EXISTS fk_boundary_features_set
  `.execute(db);
  await sql`
    ALTER TABLE public.boundary_features
      ADD CONSTRAINT fk_boundary_features_set
      FOREIGN KEY (set_id) REFERENCES public.boundary_sets(id) ON DELETE CASCADE
  `.execute(db);

  // The matcher's read: every polygon of one set. Also the boundaries page's feature list.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_boundary_features_set
      ON public.boundary_features (tenant_id, set_id)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.household_districts (
      id           bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id    bigint      NOT NULL,
      household_id bigint      NOT NULL,
      set_id       bigint      NOT NULL,
      name         text        NOT NULL,
      code         text,
      matched_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT household_districts_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT household_districts_id_key UNIQUE (id),
      CONSTRAINT uq_household_districts_household_set UNIQUE (household_id, set_id)
    )
  `.execute(db);

  await sql`
    ALTER TABLE public.household_districts DROP CONSTRAINT IF EXISTS fk_household_districts_household
  `.execute(db);
  await sql`
    ALTER TABLE public.household_districts
      ADD CONSTRAINT fk_household_districts_household
      FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    ALTER TABLE public.household_districts DROP CONSTRAINT IF EXISTS fk_household_districts_set
  `.execute(db);
  await sql`
    ALTER TABLE public.household_districts
      ADD CONSTRAINT fk_household_districts_set
      FOREIGN KEY (set_id) REFERENCES public.boundary_sets(id) ON DELETE CASCADE
  `.execute(db);

  // "Every household in precinct 12" — the smart-list rule, the turf-cutting partition, and the
  // grid's sortable seat column all read this shape.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_household_districts_lookup
      ON public.household_districts (tenant_id, set_id, name)
  `.execute(db);

  // Tenant isolation, same NULLIF-escape shape as every other table in this schema: paths that run
  // with no app.tenant_id GUC (migrations, background jobs) are permitted by the first branch and
  // stay protected by their own explicit .where('tenant_id', ...) scoping.
  for (const table of ['boundary_sets', 'boundary_features', 'household_districts'] as const) {
    await sql`ALTER TABLE public.${sql.raw(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE public.${sql.raw(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant_isolation ON public.${sql.raw(table)}`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation ON public.${sql.raw(table)}
        USING (
          NULLIF(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        )
        WITH CHECK (
          NULLIF(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        )
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.household_districts`.execute(db);
  await sql`DROP TABLE IF EXISTS public.boundary_features`.execute(db);
  await sql`DROP TABLE IF EXISTS public.boundary_sets`.execute(db);
}
