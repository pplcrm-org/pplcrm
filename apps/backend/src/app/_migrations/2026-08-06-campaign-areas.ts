import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * The map areas a campaign represents — one row per area, because a seat can be made of several.
 *
 * `campaigns.seat_name` holds one string and cannot answer this. Two different questions were being
 * answered from it:
 *
 * 1. WHICH AREAS DOES THIS CAMPAIGN COVER? Used to decide whether a door is in the campaign's own
 *    territory. A provincial candidate covers one riding, but a regional councillor covers two or
 *    more wards, and a single text column cannot say so. That is what this table is for.
 * 2. WHAT DISTRICT GOES ON A TAX RECEIPT? A legal document needs exactly one name, and for a
 *    municipal candidate it is NOT the ward — a Toronto council candidate running in Ward 12 is
 *    still a City of Toronto candidate and the receipt has to say the city. `seat_name` keeps
 *    answering this, unchanged, and the receipt code that reads it is untouched.
 *
 * Conflating those two is why this table exists rather than a second text column. The receipt
 * district and the covered areas are different values with different meanings, and for municipal
 * campaigns they are different words.
 *
 * `set_id` is NULLABLE ON PURPOSE. An area may be typed by hand — the campaign is created before
 * any map is added, or the municipality publishes no ward map at all, which is the ordinary case
 * for wards. `name` is therefore the value that matching compares, and `set_id` only records where
 * the name came from so the form can show whether it was chosen from a map or typed. Deleting a
 * boundary map must not delete a campaign's statement about which areas it represents, so the
 * reference is cleared rather than cascading.
 *
 * Names are compared case-insensitively everywhere (the seat name is typed by a person; the area
 * name comes from a publisher's file), so the unique index is on the lower-cased name. Without it,
 * "Ward 3" and "ward 3" would both be storable and the campaign would claim two areas that are one.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.campaign_areas (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id     bigint NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
      campaign_id   bigint NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
      set_id        bigint REFERENCES public.boundary_sets (id) ON DELETE SET NULL,
      name          text   NOT NULL,
      code          text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      createdby_id  bigint
    )
  `.execute(db);

  // One statement per area per campaign, case-insensitively. See the note above on why lower().
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_areas_campaign_name
      ON public.campaign_areas (campaign_id, lower(btrim(name)))
  `.execute(db);

  // Every read is "the areas of this campaign", scoped by tenant as the lint rule requires.
  await sql`
    CREATE INDEX IF NOT EXISTS ix_campaign_areas_tenant_campaign
      ON public.campaign_areas (tenant_id, campaign_id)
  `.execute(db);

  // Seed from what the workspace has already said. A campaign contesting one named district seat
  // covers that district, so its existing seat_name becomes its first area and nobody has to
  // re-enter it. At-large offices contest no single area and are deliberately skipped: a mayor
  // covers the whole city, which is not one area of a ward map.
  await sql`
    INSERT INTO public.campaign_areas (tenant_id, campaign_id, name, createdby_id)
    SELECT c.tenant_id, c.id, btrim(c.seat_name), c.createdby_id
      FROM public.campaigns AS c
     WHERE c.seat_name IS NOT NULL
       AND btrim(c.seat_name) <> ''
       AND coalesce(c.seat_type, 'district') <> 'at_large'
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.campaign_areas`.execute(db);
}
