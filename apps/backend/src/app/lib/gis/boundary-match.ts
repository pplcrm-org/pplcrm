import type { Kysely } from 'kysely';
import { sql } from 'kysely';

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
 * Which boundary sets a household is matched against.
 *
 * Every layer the workspace holds that has polygons — one it uploaded, one it drew, or one it added
 * from the published catalog. All three are things somebody in the workspace chose deliberately, and
 * a map that was chosen and then quietly not used would be the worst of both: the admin sees it in
 * the list and no household ever falls into it.
 *
 * Layers whose source is `import` are excluded, and that exclusion is load-bearing rather than an
 * optimisation. An imported layer holds no polygons at all — its area names arrived already assigned
 * per household in a CSV — so there is nothing to match against, and because
 * {@link applyHouseholdMatchesBatch} only clears rows for the layers it examined, leaving imports
 * out is what stops a re-match erasing area names a person imported.
 *
 * ## Why this is no longer derived from the campaigns
 *
 * It used to be. A layer was required only when an active campaign's jurisdiction, region and
 * chamber agreed with it, so that an Arizona campaign did not pay to match against 49 other states'
 * maps. That derivation only ever governed `bundled` layers, and it made sense while a bundled layer
 * was imagined as something the product attached on the workspace's behalf.
 *
 * Published maps are not attached on anyone's behalf. An admin picks one from the catalog, one row
 * is written, and the question "is this map relevant to us?" was answered by the person who added
 * it. Scoping is therefore done at the moment of adding rather than on every match pass, which is
 * both simpler and the reason an Arizona workspace never holds another state's map to begin with.
 * A workspace is capped at 50 layers of at most 5,000 areas each, so the ceiling is bounded either
 * way.
 */
export async function requiredSetIdsForTenant(db: Kysely<Models>, tenantId: string): Promise<string[]> {
  const sets = await db
    .selectFrom('boundary_sets')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('source', '<>', 'import')
    .execute();

  return sets.map((set) => String(set.id)).sort();
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

  // Diff, not blanket replace (REVIEW6 T2-5): the old shape deleted and re-inserted every row in
  // scope on every pass, so an afternoon of map drawing at workspace scale rewrote the whole
  // `household_districts` table — the table every grid and smart list reads — many times over in
  // dead tuples. Now the delete removes only pairs this pass no longer produces, and the upsert's
  // WHERE clause turns a re-insert of an unchanged answer into a no-op instead of a row rewrite.
  await db.transaction().execute(async (trx) => {
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

    let vanished = trx
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
      );
    if (rows.length > 0) {
      const keptPairs = sql.join(rows.map((row) => sql`(${row.household_id}::bigint, ${row.set_id}::bigint)`));
      vanished = vanished.where(sql<boolean>`(household_id, set_id) NOT IN (${keptPairs})`);
    }
    await vanished.execute();

    if (rows.length === 0) return;

    // The conflict branch is now the common case — a surviving row conflicts on every pass — and
    // its WHERE makes an unchanged row a no-op. `matched_at` therefore records when the ANSWER
    // last changed, not when the row was last examined; nothing reads it for freshness (the sweep's
    // freshness marker is households.boundary_checked_at).
    await trx
      .insertInto('household_districts')
      .values(rows)
      .onConflict((oc) =>
        oc
          .columns(['household_id', 'set_id'])
          .doUpdateSet({
            name: (eb) => eb.ref('excluded.name'),
            code: (eb) => eb.ref('excluded.code'),
            matched_at: (eb) => eb.ref('excluded.matched_at'),
          })
          .where(
            sql<boolean>`household_districts.name IS DISTINCT FROM excluded.name
              OR household_districts.code IS DISTINCT FROM excluded.code`,
          ),
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
  if (setIds.length === 0) return [];

  // Replace only the layers this call actually consulted, exactly as the batch job does — and note
  // that this is the LOADED list, not the required one. A published layer whose file could not be
  // read is absent from the loaded list, so its rows survive: "we could not open that map" is not
  // the same answer as "that map places this household nowhere", and storing the second in place of
  // the first would erase a household's riding because of a storage hiccup.
  const sets = await loadBoundarySets(db, tenantId, setIds);
  if (sets.length === 0) return [];

  const matches = matchPointToLoadedSets(lat, lng, sets);
  await applyHouseholdMatchesBatch(
    db,
    tenantId,
    [{ householdId, matches }],
    sets.map((set) => set.id),
  );
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
