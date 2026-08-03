import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * A campaign declares which office it is contesting, in Canada or the United States.
 *
 * Until now the only electoral signal on a campaign was `kind = 'election'`, so nothing in the
 * product could tell a Canadian federal riding from a Toronto ward from an Ohio congressional
 * district — and every label in the UI was a hardcoded guess. These nine columns are the answer,
 * and each one exists because a real race cannot be described without it:
 *
 * `jurisdiction`  One flat enum of seven values rather than separate country and level columns.
 *                 The specs genuinely differ per country/level PAIR (vocabulary, which boundary
 *                 layers exist, whether a chamber applies), and a single enum makes invalid
 *                 combinations unrepresentable instead of merely discouraged. Same shape as the
 *                 six-entry receipt-regime enum this codebase already runs.
 *                 `other` is the honest default for every campaign that exists today and for the
 *                 races this product does not model — school board, county commission, band
 *                 council, special district.
 *
 * `seat_type`     A SEPARATE axis from jurisdiction, not a local-government special case. A US
 *                 Senator, a Governor, a Mayor, every member of Vancouver city council, and the
 *                 lone congressional seat in Alaska, Delaware, North Dakota, South Dakota, Vermont
 *                 and Wyoming are all elected across a whole region with no seat area at all. An
 *                 at-large seat area is simply "the locality if the campaign named one, otherwise
 *                 the region".
 *
 * `chamber`       Required, and NOT derivable from anything else. A state senate campaign and a
 *                 state house campaign have identical jurisdiction, region and country, yet match
 *                 different boundary layers. Null for every jurisdiction that has one chamber.
 *
 * `seat_position` Several US legislatures elect more than one person per district — the Arizona
 *                 House and New Jersey General Assembly elect two each, Washington uses numbered
 *                 positions inside each legislative district, and at-large council seats are
 *                 frequently numbered. Free text ("Position 2", "Seat B", "Place 4") covers all of
 *                 them without modelling seat counts.
 *
 * `seat_label_override`
 *                 The last word in a three-step resolution: explicit override, then the regional
 *                 exception table, then the jurisdiction's default word. The exceptions are real —
 *                 Alberta and Saskatchewan say Constituency, Newfoundland and Labrador and Prince
 *                 Edward Island say District, Quebec says Circonscription, New York says Election
 *                 district where everyone else says Precinct.
 *
 * `office_region`, `office_locality`, `seat_name`, `office_title` are the plain descriptive fields:
 * province or state code, municipality or county, the seat's own name, and what the officeholder is
 * called (MP, MLA, Councillor, Representative, Senator).
 *
 * `seat_name` stays free text here. It becomes a reference into the boundary catalogue once that
 * catalogue exists (see the boundary_sets migration that follows this one).
 *
 * The three CHECK constraints are the same defence as `chk_campaigns_kind` next to them: an
 * unrecognised value must not reach the column and quietly become a jurisdiction nothing honours.
 * Keep the value lists in step with `JURISDICTION_IDS`, `SEAT_TYPES` and `CHAMBERS` in
 * libs/common/src/lib/jurisdictions/.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS jurisdiction        text NOT NULL DEFAULT 'other',
      ADD COLUMN IF NOT EXISTS office_region       text,
      ADD COLUMN IF NOT EXISTS office_locality     text,
      ADD COLUMN IF NOT EXISTS chamber             text,
      ADD COLUMN IF NOT EXISTS seat_type           text NOT NULL DEFAULT 'district',
      ADD COLUMN IF NOT EXISTS seat_name           text,
      ADD COLUMN IF NOT EXISTS seat_position       text,
      ADD COLUMN IF NOT EXISTS seat_label_override text,
      ADD COLUMN IF NOT EXISTS office_title        text
  `.execute(db);

  await sql`
    ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_jurisdiction
  `.execute(db);
  await sql`
    ALTER TABLE public.campaigns
      ADD CONSTRAINT chk_campaigns_jurisdiction CHECK (jurisdiction IN (
        'ca_federal', 'ca_provincial', 'ca_municipal',
        'us_federal', 'us_state', 'us_local',
        'other'
      ))
  `.execute(db);

  await sql`
    ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_seat_type
  `.execute(db);
  await sql`
    ALTER TABLE public.campaigns
      ADD CONSTRAINT chk_campaigns_seat_type CHECK (seat_type IN ('district', 'at_large'))
  `.execute(db);

  // Null is the normal case: only US state legislatures split into two chambers in this model.
  await sql`
    ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_chamber
  `.execute(db);
  await sql`
    ALTER TABLE public.campaigns
      ADD CONSTRAINT chk_campaigns_chamber CHECK (chamber IS NULL OR chamber IN ('upper', 'lower'))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_chamber`.execute(db);
  await sql`ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_seat_type`.execute(db);
  await sql`ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_jurisdiction`.execute(db);
  await sql`
    ALTER TABLE public.campaigns
      DROP COLUMN IF EXISTS office_title,
      DROP COLUMN IF EXISTS seat_label_override,
      DROP COLUMN IF EXISTS seat_position,
      DROP COLUMN IF EXISTS seat_name,
      DROP COLUMN IF EXISTS seat_type,
      DROP COLUMN IF EXISTS chamber,
      DROP COLUMN IF EXISTS office_locality,
      DROP COLUMN IF EXISTS office_region,
      DROP COLUMN IF EXISTS jurisdiction
  `.execute(db);
}
