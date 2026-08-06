/**
 * Reading the published-map catalog.
 *
 * Everything here is a pure lookup over {@link PUBLISHED_BOUNDARY_ENTRIES}. The list is small
 * (roughly a hundred entries once populated) and constant for the life of a release, so the picker
 * in the browser filters it directly and the backend validates against the same array — there is no
 * catalog read endpoint, and no way for the two sides to disagree about what is available.
 */

import { JURISDICTIONS } from '../../jurisdictions';
import type { JurisdictionId } from '../../jurisdictions/jurisdiction.types';
import { PUBLISHED_BOUNDARY_ENTRIES } from './catalog.entries';
import type { PublishedBoundaryCountry, PublishedBoundaryEntry, PublishedBoundaryMatch } from './catalog.types';

export type { PublishedBoundaryCountry, PublishedBoundaryEntry, PublishedBoundaryMatch } from './catalog.types';
export { PUBLISHED_BOUNDARY_ENTRIES } from './catalog.entries';

/**
 * The storage key prefix the converted files live under, and the filename convention inside it.
 *
 * Stated here rather than in the backend because the conversion script and the loader both need it
 * and they live in different projects. The prefix is reserved: nothing tenant-owned may be written
 * under it, which `apps/backend/src/app/lib/storage-key.ts` enforces.
 */
export const PUBLISHED_BOUNDARY_STORAGE_PREFIX = 'catalog/boundaries';

/** The storage key holding one entry's converted GeoJSON. */
export function publishedBoundaryStorageKey(slug: string): string {
  return `${PUBLISHED_BOUNDARY_STORAGE_PREFIX}/${slug}.geojson`;
}

/**
 * The entry with this slug, or undefined when the slug names nothing the catalog publishes.
 *
 * A scan rather than a lookup table built at module load. The catalog is on the order of a hundred
 * constant entries and this is called once per layer per process — the loader caches the parsed
 * polygons, so the second call for a slug never happens. A derived index would buy nothing
 * measurable and would introduce the one bug class this cannot have: an index that disagrees with
 * the array it was built from.
 */
export function findPublishedBoundary(slug: string): PublishedBoundaryEntry | undefined {
  return PUBLISHED_BOUNDARY_ENTRIES.find((entry) => entry.slug === slug);
}

/** Narrows a value that arrived from outside — a tRPC input, a stored column — to a known slug. */
export function isPublishedBoundarySlug(value: unknown): value is string {
  return typeof value === 'string' && findPublishedBoundary(value) !== undefined;
}

/** Which country an entry belongs to, read from the jurisdiction registry rather than the slug. */
export function publishedBoundaryCountry(entry: PublishedBoundaryEntry): PublishedBoundaryCountry {
  const country = JURISDICTIONS[entry.jurisdiction].country;
  // Every jurisdiction the catalog uses has a country; `other` is the only one that does not, and
  // it has no publisher, so it can never appear here. The fallback keeps the return type honest
  // without a non-null assertion.
  return country === 'US' ? 'US' : 'CA';
}

/** True while this entry is the current edition — nothing has replaced it. */
export function isCurrentPublishedBoundary(entry: PublishedBoundaryEntry): boolean {
  return entry.supersededBy === null;
}

/**
 * The entries that cover a given office.
 *
 * A null `region` on an entry means the file covers the whole country, so it matches any region —
 * the Canadian federal riding map is one file for all thirteen provinces and territories. A null
 * `chamber` means the layer is not chamber-specific, which is every layer except US state
 * legislative districts, where the upper and lower maps are two different published files and
 * neither can be derived from the other.
 *
 * Superseded editions are excluded. A workspace that wants the previous lines can still find them
 * in the full list; suggesting them alongside the current ones would make the common case ambiguous.
 */
export function publishedBoundariesFor(match: PublishedBoundaryMatch): readonly PublishedBoundaryEntry[] {
  return PUBLISHED_BOUNDARY_ENTRIES.filter(
    (entry) =>
      entry.supersededBy === null &&
      entry.jurisdiction === match.jurisdiction &&
      (entry.region === null || entry.region === match.region) &&
      (entry.chamber === null || entry.chamber === match.chamber),
  );
}

/**
 * The entries suggested for a workspace, given every office its campaigns contest.
 *
 * Deduplicated by slug and returned in catalog order, so a workspace running a federal campaign and
 * two provincial ones is offered each relevant map once rather than once per campaign.
 */
export function publishedBoundariesForOffices(
  offices: readonly PublishedBoundaryMatch[],
): readonly PublishedBoundaryEntry[] {
  const slugs = new Set<string>();
  for (const office of offices) {
    for (const entry of publishedBoundariesFor(office)) slugs.add(entry.slug);
  }
  return PUBLISHED_BOUNDARY_ENTRIES.filter((entry) => slugs.has(entry.slug));
}

/** Every jurisdiction the catalog currently publishes at least one current edition for. */
export function publishedBoundaryJurisdictions(): readonly JurisdictionId[] {
  const seen = new Set<JurisdictionId>();
  for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
    if (entry.supersededBy === null) seen.add(entry.jurisdiction);
  }
  return [...seen];
}

/**
 * True when the catalog holds nothing at all.
 *
 * User-facing copy reads this rather than asserting that published maps do or do not exist. The
 * catalog is populated by a maintainer running the conversion script, so the honest sentence
 * changes with the data instead of with a release note somebody has to remember to write.
 */
export function publishedBoundaryCatalogIsEmpty(): boolean {
  return PUBLISHED_BOUNDARY_ENTRIES.length === 0;
}

/** A size a person can read, for the picker's "this downloads once" line. */
export function formatPublishedBoundarySize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
