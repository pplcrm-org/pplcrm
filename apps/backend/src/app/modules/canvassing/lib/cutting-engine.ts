/**
 * Turf-cutting engine (§13.2) — pure, deterministic, and dependency-free so it
 * is unit-testable without a DB or a map.
 *
 * ## What it does
 * Clusters geocoded households (one door per household) into contiguous groups
 * near a target size. It reuses the SAME geocoded lat/lng the household map and
 * geocoding job already fill (Wave 1A) — it never geocodes anything itself.
 *
 * ## Barriers (highways / rail / water)
 * The spec requires turfs never to cross a hard barrier. The only barrier data
 * the app has is the electoral boundary polygons a workspace holds, whose edges
 * in practice follow exactly those features (rivers, rail lines, arterial roads).
 * So the engine treats the **boundary line as the barrier**: a turf is never
 * allowed to span two boundaries. This is an honest proxy given the available
 * data — true per-street barrier linework is not in the dataset, so finer barrier
 * avoidance is deferred to the manual "rebalance on the map" step the spec
 * already calls for.
 *
 * Which boundary that is differs per campaign — a polling division for a Canadian
 * federal riding, a precinct for a US legislative district, a ward for a Toronto
 * council race — so this engine is deliberately told only the name of the area
 * each door falls in and never which kind of area it is. The caller resolves that
 * (see `turf-boundary.ts`) and passes the resulting names in.
 *
 * ## Contiguity
 * Within one boundary the doors are laid out along a boustrophedon ("snake")
 * sweep — banded by latitude, alternating east/west within each band — which
 * yields a locality-preserving 1-D order. Chunking that order into near-equal
 * runs gives spatially compact, contiguous turfs without needing a full TSP/graph
 * solve.
 */

export interface DoorPoint {
  household_id: string;
  lat: number | null;
  lng: number | null;
  /** The area this door falls in, or null when no boundary map covers it. */
  boundaryName: string | null;
}

export interface TurfCluster {
  households: string[];
  centroid_lat: number;
  centroid_lng: number;
  /**
   * The area every door in this turf shares, or null when the turf is unbounded — either the
   * workspace holds no boundary map, or these doors fell outside every area of the one it holds.
   */
  boundaryName: string | null;
}

export interface CutPlan {
  /** Proposed turfs, in a stable order. */
  turfs: TurfCluster[];
  /** Household ids that were placed into a turf. */
  placedCount: number;
  /** Household ids with no usable geocode — can't be mapped, reported honestly. */
  unplaced: string[];
}

const MIN_TARGET = 1;

function isFinitePoint(d: DoorPoint): d is DoorPoint & { lat: number; lng: number } {
  return typeof d.lat === 'number' && Number.isFinite(d.lat) && typeof d.lng === 'number' && Number.isFinite(d.lng);
}

/** Split `items` into `k` contiguous, near-equal chunks preserving order. */
function evenChunks<T>(items: readonly T[], k: number): T[][] {
  const chunks: T[][] = [];
  const n = items.length;
  const base = Math.floor(n / k);
  let remainder = n % k;
  let start = 0;
  for (let i = 0; i < k; i++) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    const end = start + base + extra;
    chunks.push(items.slice(start, end));
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

/**
 * Order points along a latitude-banded snake sweep so that consecutive points
 * are spatially close — the key to producing contiguous chunks.
 */
function snakeOrder(points: readonly (DoorPoint & { lat: number; lng: number })[]): (DoorPoint & {
  lat: number;
  lng: number;
})[] {
  const n = points.length;
  if (n <= 2) return [...points];

  const bandCount = Math.max(1, Math.round(Math.sqrt(n)));
  const byLat = [...points].sort((a, b) => a.lat - b.lat);
  const bands = evenChunks(byLat, bandCount);

  const ordered: (DoorPoint & { lat: number; lng: number })[] = [];
  bands.forEach((band, index) => {
    const sorted = [...band].sort((a, b) => a.lng - b.lng);
    if (index % 2 === 1) sorted.reverse(); // alternate direction each band
    ordered.push(...sorted);
  });
  return ordered;
}

function centroid(points: readonly { lat: number; lng: number }[]): { lat: number; lng: number } {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * The bucket key every door with no boundary lands in.
 *
 * All un-located doors share ONE bucket rather than getting one each, and that is a deliberate
 * behaviour worth keeping: they then cluster together on geography alone, which is exactly what a
 * workspace holding no boundary map gets for every door it has. Giving each unmatched door its own
 * bucket would produce a turf per door.
 */
const UNBOUNDED_KEY = '';

/**
 * Cut a set of doors into contiguous turfs of ~`targetDoors` each, never
 * crossing a boundary line.
 */
export function cutTurfs(doors: readonly DoorPoint[], targetDoors: number): CutPlan {
  const target = Math.max(MIN_TARGET, Math.floor(targetDoors));

  const placed: (DoorPoint & { lat: number; lng: number })[] = [];
  const unplaced: string[] = [];
  for (const d of doors) {
    if (isFinitePoint(d)) placed.push(d);
    else unplaced.push(d.household_id);
  }

  // Partition by boundary — a turf never spans two areas (the barrier proxy).
  const byBoundary = new Map<string, (DoorPoint & { lat: number; lng: number })[]>();
  for (const d of placed) {
    const key = d.boundaryName ?? UNBOUNDED_KEY;
    const bucket = byBoundary.get(key);
    if (bucket) bucket.push(d);
    else byBoundary.set(key, [d]);
  }

  const turfs: TurfCluster[] = [];
  // Stable boundary order for deterministic output.
  const boundaryKeys = [...byBoundary.keys()].sort();
  for (const boundaryKey of boundaryKeys) {
    const boundaryDoors = byBoundary.get(boundaryKey) ?? [];
    if (boundaryDoors.length === 0) continue;

    const ordered = snakeOrder(boundaryDoors);
    // Number of turfs for this boundary: round to nearest, at least one.
    const k = Math.max(1, Math.round(ordered.length / target));
    const chunks = evenChunks(ordered, k);
    for (const chunk of chunks) {
      const c = centroid(chunk);
      turfs.push({
        households: chunk.map((d) => d.household_id),
        centroid_lat: c.lat,
        centroid_lng: c.lng,
        // Null, not the empty-string key, so the caller can tell an unbounded turf from a
        // boundary that happens to be named — and label it as unbounded rather than blank.
        boundaryName: boundaryKey === UNBOUNDED_KEY ? null : boundaryKey,
      });
    }
  }

  return { turfs, placedCount: placed.length, unplaced };
}

/**
 * Preview math for the dialog ("~860 doors → 21 turfs of ~41 doors each"),
 * computed from the same engine so the preview can never disagree with the cut.
 */
export interface CutPreview {
  doors: number;
  unplaced: number;
  turfCount: number;
  avgDoorsPerTurf: number;
}

export function previewCut(doors: readonly DoorPoint[], targetDoors: number): CutPreview {
  const plan = cutTurfs(doors, targetDoors);
  const turfCount = plan.turfs.length;
  const avg = turfCount > 0 ? Math.round(plan.placedCount / turfCount) : 0;
  return { doors: plan.placedCount, unplaced: plan.unplaced.length, turfCount, avgDoorsPerTurf: avg };
}
