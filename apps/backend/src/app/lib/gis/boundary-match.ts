import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type { LoadedBoundarySet } from './boundary-store';
import { featureContainsPoint, loadBoundarySets } from './boundary-store';

/**
 * Boundary matching — deciding which named areas cover one address.
 *
 * THE GOVERNING DISTINCTION, and the reason this file and `geocode-queue.ts` are treated so
 * differently: matching is free and geocoding is not. Turning an address into coordinates is billed
 * per request by Google. Deciding which polygons contain a coordinate is pure CPU with no external
 * call at all. So geocoding is plan-gated, metered and spread across days, while matching may be
 * re-run as often as anyone likes — every time a map is drawn, redrawn, uploaded or deleted. An
 * admin who redraws a ward boundary twenty times pays nothing.
 */

/** One area, of one layer, that covers the point. */
export interface BoundaryMatch {
  set_id: string;
  name: string;
  code: string | null;
}

/** One household's matches, for the batch form of {@link applyHouseholdMatches}. */
export interface HouseholdBoundaryMatches {
  householdId: string;
  matches: BoundaryMatch[];
}

/**
 * Which boundary sets this tenant's active campaigns require.
 *
 * Matching every household against every layer would be wasted work, and with United States data
 * the waste is large: an Arizona state house campaign needs its own lower-chamber legislative
 * districts and its own precincts, and has no use for the other 49 states' maps or for the upper
 * chamber's. So the required list is derived from what the workspace is actually contesting.
 *
 * Two rules produce the list, and the second one is not in the plan text:
 *
 *  1. A layer is required when an active campaign's jurisdiction, region and chamber all agree with
 *     it. A national layer (no region) serves any campaign of its jurisdiction; a layer for one
 *     province or state serves only campaigns in that region; a layer for one chamber serves only
 *     campaigns in that chamber.
 *  2. Every layer the workspace made itself — uploaded or drawn — is always required, whatever the
 *     campaigns say. An admin who draws "the three neighbourhoods we are targeting" expects
 *     households to fall into them immediately, and a workspace is capped at 50 layers of at most
 *     5,000 areas, so this costs almost nothing. Requiring a campaign to be configured first would
 *     make drawing a map appear to do nothing.
 *
 * Layers whose source is `import` are never included: they hold no polygons, because their area
 * names arrived already assigned per household in a CSV. There is nothing to match against.
 */
export async function requiredSetIdsForTenant(db: Kysely<Models>, tenantId: string): Promise<string[]> {
  const campaigns = await db
    .selectFrom('campaigns')
    .select(['jurisdiction', 'office_region', 'chamber'])
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'active')
    .execute();

  // A workspace holds at most BOUNDARY_MAX_SETS_PER_TENANT (50) layers, so reading them all and
  // filtering here is cheaper and far clearer than composing one OR-per-campaign SQL predicate.
  const sets = await db
    .selectFrom('boundary_sets')
    .select(['id', 'jurisdiction', 'region', 'chamber', 'source'])
    .where('tenant_id', '=', tenantId)
    .where('source', '<>', 'import')
    .execute();

  const required = new Set<string>();
  for (const set of sets) {
    if (set.source === 'upload' || set.source === 'drawn') {
      required.add(String(set.id));
      continue;
    }
    for (const campaign of campaigns) {
      if (set.jurisdiction !== campaign.jurisdiction) continue;
      if (set.region != null && set.region !== campaign.office_region) continue;
      if (set.chamber != null && set.chamber !== campaign.chamber) continue;
      required.add(String(set.id));
      break;
    }
  }

  return [...required].sort();
}

/**
 * Match one point against layers already loaded into memory. Pure CPU, no query, no network.
 *
 * At most one area per layer, because a household is in one ward and one precinct and one
 * congressional district — but in as many layers as the workspace holds, which is the entire point
 * of the rework. The three fixed text columns this replaces could hold three answers, so every
 * geocoding pass overwrote the previous campaign's geography.
 *
 * When hand-drawn areas overlap, the first area in the layer's fixed sort order wins. That is a
 * choice, not an accident: see `compareFeatures` in ./boundary-store. The overlap itself is
 * reported through the validation counts rather than hidden.
 */
export function matchPointToLoadedSets(lat: number, lng: number, sets: readonly LoadedBoundarySet[]): BoundaryMatch[] {
  const matches: BoundaryMatch[] = [];
  for (const set of sets) {
    for (const feature of set.features) {
      if (featureContainsPoint(lat, lng, feature)) {
        matches.push({ set_id: set.id, name: feature.name, code: feature.code });
        break;
      }
    }
  }
  return matches;
}

/** How many areas of one layer contain the point. Two or more is an overlap in a hand-drawn map. */
export function countContainingFeatures(lat: number, lng: number, set: LoadedBoundarySet): number {
  let count = 0;
  for (const feature of set.features) {
    if (featureContainsPoint(lat, lng, feature)) count++;
  }
  return count;
}

/**
 * Match one point against the given boundary sets. Pure CPU, no network.
 *
 * This loads the layers on every call, which is right for a single household saved in the UI and
 * wrong for a batch: use `loadBoundarySets` once and `matchPointToLoadedSets` per point when
 * matching thousands of households, as the sweep job does.
 */
export async function matchPointToSets(
  db: Kysely<Models>,
  tenantId: string,
  lat: number,
  lng: number,
  setIds: string[],
): Promise<BoundaryMatch[]> {
  const sets = await loadBoundarySets(db, tenantId, setIds);
  return matchPointToLoadedSets(lat, lng, sets);
}

/**
 * Replace several households' `household_districts` rows in one transaction.
 *
 * WHAT "REPLACE" DELIBERATELY DOES NOT TOUCH, and why each exclusion exists:
 *
 *  - Rows belonging to a layer whose source is `import`. Those names came off a purchased voter
 *    file's own columns, with no polygon anywhere and no geocoding call — nothing here can
 *    recompute them, so deleting them would destroy data this code has no way to restore.
 *  - Rows belonging to layers outside `replacedSetIds`, when the caller names a subset. A job that
 *    re-matches one redrawn ward map must not wipe the household's congressional district on the
 *    way past — and a pass that matched only the required layers must not wipe an archived
 *    campaign's layer it never looked at. Omit `replacedSetIds` only when the answer really is
 *    "this household is in no geometry-derived area at all": `markGeocodingFailed` does, because an
 *    unplaceable address invalidates every row derived from its coordinates.
 */
export async function applyHouseholdMatchesBatch(
  db: Kysely<Models>,
  tenantId: string,
  entries: readonly HouseholdBoundaryMatches[],
  replacedSetIds?: readonly string[],
): Promise<void> {
  if (entries.length === 0) return;
  const householdIds = entries.map((entry) => entry.householdId);
  const scopedSetIds = replacedSetIds ? [...new Set(replacedSetIds.map(String))] : null;
  if (scopedSetIds !== null && scopedSetIds.length === 0) return;

  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('household_districts')
      .where('tenant_id', '=', tenantId)
      .where('household_id', 'in', householdIds)
      .where('set_id', 'in', (eb) =>
        eb
          .selectFrom('boundary_sets')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('source', '<>', 'import')
          .$if(scopedSetIds !== null, (qb) => qb.where('id', 'in', scopedSetIds ?? [])),
      )
      .execute();

    const rows = entries.flatMap((entry) =>
      entry.matches.map((match) => ({
        tenant_id: tenantId,
        household_id: entry.householdId,
        set_id: match.set_id,
        name: match.name,
        code: match.code,
        matched_at: new Date(),
      })),
    );
    if (rows.length === 0) return;

    // The delete above already cleared these, so the conflict clause only covers a concurrent CSV
    // import writing the same (household, set) pair between the delete and the insert.
    await trx
      .insertInto('household_districts')
      .values(rows)
      .onConflict((oc) =>
        oc.columns(['household_id', 'set_id']).doUpdateSet({
          name: (eb) => eb.ref('excluded.name'),
          code: (eb) => eb.ref('excluded.code'),
          matched_at: (eb) => eb.ref('excluded.matched_at'),
        }),
      )
      .execute();
  });
}

/** Replace one household's `household_districts` rows. Delete then insert, one transaction. */
export async function applyHouseholdMatches(
  db: Kysely<Models>,
  tenantId: string,
  householdId: string,
  matches: BoundaryMatch[],
): Promise<void> {
  await applyHouseholdMatchesBatch(db, tenantId, [{ householdId, matches }]);
}

/**
 * Match one household that already has coordinates, and store the result.
 *
 * Called straight after a successful geocode and from the batch job. It makes no external call, so
 * it is safe to run on the request path once coordinates exist.
 */
export async function matchHouseholdBoundaries(
  db: Kysely<Models>,
  tenantId: string,
  householdId: string,
  lat: number,
  lng: number,
): Promise<BoundaryMatch[]> {
  const setIds = await requiredSetIdsForTenant(db, tenantId);
  // Replace only the layers this call matched against, exactly as the batch job does. Rows in a
  // layer the workspace no longer requires — an archived campaign's map — were not looked at, so
  // they are not an answer this pass can overwrite. With no required layers there is nothing to
  // match and nothing to replace.
  if (setIds.length === 0) return [];
  const matches = await matchPointToSets(db, tenantId, lat, lng, setIds);
  await applyHouseholdMatchesBatch(db, tenantId, [{ householdId, matches }], setIds);
  return matches;
}

/**
 * Narrow a stored coordinate column to a usable number.
 *
 * `households.lat` / `lng` are `double precision` and nullable, and the pg driver returns some
 * numeric types as strings, so every read of them goes through here rather than through a bare
 * `Number()` that would turn a null into 0 and place the household off the coast of Africa.
 */
export function asCoordinate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Re-exported so a caller can hold layers across many points without importing two modules. */
export { loadBoundarySets } from './boundary-store';
export type { LoadedBoundaryFeature, LoadedBoundarySet } from './boundary-store';
