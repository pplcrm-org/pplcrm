/**
 * Which boundary map bounds a campaign's turfs, and what to call one of its areas.
 *
 * The turf-cutting engine refuses to let a turf span two boundaries because a boundary edge
 * follows a river, a rail line or an arterial road. That reasoning holds for any jurisdiction.
 * What does not hold is a fixed answer to "which boundary": a Canadian federal campaign walks
 * polling divisions, a US legislative campaign walks precincts, a Toronto council campaign walks
 * wards, and a workspace may hold several maps at once — an outgoing and an incoming
 * redistricting vintage, a seat map and a subdivision map, a hand-drawn set of organizing areas.
 *
 * This module is the single place that decides.
 */

import { sql } from 'kysely';

import type { Kysely, Transaction } from 'kysely';

import {
  isJurisdictionId,
  seatLabelFor,
  seatLabelPluralFor,
  subdivisionLabelFor,
  subdivisionLabelPluralFor,
  type JurisdictionId,
} from '../../../../../../../libs/common/src';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

/** What a turf is cut against, and the campaign's own word for one of those areas. */
export interface TurfBoundaryContext {
  /**
   * The `boundary_sets` row turfs are cut against, or null when the workspace holds no usable map
   * for this campaign. Null is a supported answer, not a failure — see `resolveTurfBoundary`.
   */
  set_id: string | null;
  /** The word for one area: 'Polling division', 'Precinct', 'Ward', 'Riding'. */
  label: string;
  /** Plural of the same word, for a heading such as "By polling division". */
  label_plural: string;
}

/** A subdivision map is finer than a seat map, so it is preferred whenever the workspace has one. */
const SUBDIVISION_ROLE = 'subdivision';
const SEAT_AREA_ROLE = 'seat_area';

/** The jurisdiction a campaign with no declared office falls back to. */
const DEFAULT_JURISDICTION: JurisdictionId = 'other';

interface CampaignOffice {
  jurisdiction: JurisdictionId;
  region: string | null;
  /** 'upper' | 'lower' | null. Only US state legislatures set it — their two houses use two maps. */
  chamber: string | null;
  seat_label_override: string | null;
}

type Conn = Kysely<Models> | Transaction<Models>;

/**
 * Resolve which boundary set bounds a campaign's turfs, and what to call one of its areas.
 *
 * The rule, in order:
 *
 * 1. **The finest subdivision set the workspace holds for this campaign's jurisdiction and
 *    region.** A subdivision — a polling division, a precinct — is roughly one evening's walk,
 *    which is the size a turf wants to be. "Finest" is read as the set with the most areas
 *    covering the same ground, because more areas over one territory means smaller areas.
 *
 * 2. **Otherwise the seat set.** A riding or a congressional district is far too large to be a
 *    turf, so this never makes a turf the right size on its own — but it is still a real barrier
 *    that a turf should not straddle, and the engine chunks each area into target-sized turfs
 *    anyway.
 *
 * 3. **Otherwise no set at all.** Every door then lands in one bucket and the clustering is purely
 *    geographic. This is not a degraded mode bolted on for safety: it is what every workspace that
 *    has not imported, uploaded or drawn a map gets, and it produces perfectly walkable turfs. It
 *    is also exactly what the product did in practice before boundary sets existed, since the only
 *    boundary data that ever shipped was a placeholder file covering three rectangles in Chicago.
 *    The difference is that it is now reached deliberately and the turfs are labelled unbounded,
 *    rather than reached by accident and labelled with a null nobody explained.
 *
 * A set with `region` NULL is national and matches any campaign region; a set with a region matches
 * only a campaign in that region. Ties are broken by the newest set (highest id) so that re-running
 * a cut with the same data always picks the same map.
 *
 * `campaign_id` may be null, in which case the workspace's permanent office campaign is used —
 * the same default `CampaignsRepo.resolveForWrite` applies to every campaign-scoped write.
 */
export async function resolveTurfBoundary(
  db: Conn,
  input: { tenant_id: string; campaign_id: string | null },
): Promise<TurfBoundaryContext> {
  const office = await loadCampaignOffice(db, input);

  const subdivision = await finestSetForRole(db, input.tenant_id, office, SUBDIVISION_ROLE);
  if (subdivision) {
    return {
      set_id: subdivision,
      label: subdivisionLabelFor(office.jurisdiction, office.region),
      label_plural: subdivisionLabelPluralFor(office.jurisdiction, office.region),
    };
  }

  const seatArea = await finestSetForRole(db, input.tenant_id, office, SEAT_AREA_ROLE);
  if (seatArea) {
    return {
      set_id: seatArea,
      label: seatLabelFor(office.jurisdiction, office.region, office.seat_label_override),
      label_plural: seatLabelPluralFor(office.jurisdiction, office.region, office.seat_label_override),
    };
  }

  // No map. The word still matters: it is what the coverage table's heading says, and naming the
  // area a turf WOULD be bounded by is what tells someone with an empty table what is missing.
  return {
    set_id: null,
    label: subdivisionLabelFor(office.jurisdiction, office.region),
    label_plural: subdivisionLabelPluralFor(office.jurisdiction, office.region),
  };
}

/**
 * The campaign's declared office, or the neutral default when there is no campaign, no office
 * campaign, or the stored jurisdiction is a value this build does not recognise. An unrecognised
 * value reads as "unspecified", which is true, rather than throwing on a plain text column.
 */
async function loadCampaignOffice(
  db: Conn,
  input: { tenant_id: string; campaign_id: string | null },
): Promise<CampaignOffice> {
  const row = input.campaign_id
    ? await db
        .selectFrom('campaigns')
        .select(['jurisdiction', 'office_region', 'chamber', 'seat_label_override'])
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.campaign_id)
        .executeTakeFirst()
    : await db
        .selectFrom('campaigns')
        .select(['jurisdiction', 'office_region', 'chamber', 'seat_label_override'])
        .where('tenant_id', '=', input.tenant_id)
        .where('kind', '=', 'office')
        .executeTakeFirst();

  if (!row) return { jurisdiction: DEFAULT_JURISDICTION, region: null, chamber: null, seat_label_override: null };
  return {
    jurisdiction: isJurisdictionId(row.jurisdiction) ? row.jurisdiction : DEFAULT_JURISDICTION,
    region: row.office_region ?? null,
    chamber: row.chamber ?? null,
    seat_label_override: row.seat_label_override ?? null,
  };
}

/**
 * The id of the set with the most areas for one role, matching this campaign's jurisdiction and
 * region, or null when the workspace holds none.
 *
 * `feature_count` is NULL on a set whose features have not been counted yet (an import set has no
 * polygons at all), and NULLS LAST puts those behind any counted set rather than ahead of it.
 */
async function finestSetForRole(
  db: Conn,
  tenant_id: string,
  office: CampaignOffice,
  role: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('boundary_sets')
    .select(['id'])
    .where('tenant_id', '=', tenant_id)
    .where('jurisdiction', '=', office.jurisdiction)
    .where('role', '=', role)
    .where((eb) =>
      // A national set covers every region; a regional set covers only its own.
      office.region ? eb.or([eb('region', 'is', null), eb('region', '=', office.region)]) : eb('region', 'is', null),
    )
    .where((eb) =>
      // Same chamber rule the household matcher applies (boundary-match.ts): a set with no
      // chamber covers any campaign, a chambered set covers only its own chamber. Without
      // this, a state-senate campaign in a workspace holding both chambers' maps could be
      // cut against the house map and have it presented under senate wording.
      office.chamber
        ? eb.or([eb('chamber', 'is', null), eb('chamber', '=', office.chamber)])
        : eb('chamber', 'is', null),
    )
    .orderBy(sql`feature_count DESC NULLS LAST`)
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return row ? String(row.id) : null;
}
