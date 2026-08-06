import { describe, expect, it } from 'vitest';

import {
  BOUNDARY_MAX_FEATURES_PER_SET,
  BOUNDARY_ROLES,
  BOUNDARY_UPLOAD_MAX_BYTES,
} from '../../schemas/boundaries.schema';
import { CA_PROVINCES, JURISDICTIONS, US_STATES } from '../../jurisdictions';
import {
  PUBLISHED_BOUNDARY_ENTRIES,
  PUBLISHED_BOUNDARY_STORAGE_PREFIX,
  findPublishedBoundary,
  formatPublishedBoundarySize,
  isPublishedBoundarySlug,
  publishedBoundariesFor,
  publishedBoundariesForOffices,
  publishedBoundaryCatalogIsEmpty,
  publishedBoundaryCountry,
  publishedBoundaryStorageKey,
} from './index';

const REGION_CODES = new Set([...CA_PROVINCES, ...US_STATES].map((r) => r.code));

/**
 * These run over whatever `tools/boundary-catalog` last generated. They are written to pass over an
 * empty catalog and to keep passing as entries are added, because the point is to fail the build the
 * day a generated entry is wrong — not to assert that any particular map exists.
 */
describe('published boundary catalog', () => {
  it('gives every entry a unique slug that can be a filename and a boundary_sets slug', () => {
    const slugs = PUBLISHED_BOUNDARY_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      // Same rule `boundarySetSlugSchema` enforces, because the slug is copied straight onto the row.
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(slug.length).toBeLessThanOrEqual(80);
    }
  });

  it('describes a real file: counts and sizes within the caps the uploader enforces', () => {
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      expect(entry.featureCount).toBeGreaterThan(0);
      expect(entry.featureCount).toBeLessThanOrEqual(BOUNDARY_MAX_FEATURES_PER_SET);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.bytes).toBeLessThanOrEqual(BOUNDARY_UPLOAD_MAX_BYTES);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('records who published each map and what it may be redistributed under', () => {
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.vintage.trim().length).toBeGreaterThan(0);
      expect(entry.publisher.trim().length).toBeGreaterThan(0);
      expect(entry.licence.trim().length).toBeGreaterThan(0);
      expect(entry.attribution.trim().length).toBeGreaterThan(0);
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      expect(entry.nameProperty.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses only jurisdictions, roles, regions and chambers the rest of the product models', () => {
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      const spec = JURISDICTIONS[entry.jurisdiction];
      expect(spec).toBeDefined();
      // `other` has no publisher and no country, so it can never name a published map.
      expect(spec.country).not.toBeNull();
      expect(BOUNDARY_ROLES).toContain(entry.role);
      if (entry.region !== null) expect(REGION_CODES.has(entry.region)).toBe(true);
      // A chamber is meaningful only where the legislature has two houses with two different maps.
      if (entry.chamber !== null) expect(spec.usesChamber).toBe(true);
      // A null region is deliberately allowed even where a CAMPAIGN must name one. The two are
      // different questions: a campaign has to say which state it runs in, while the file covering
      // its districts may well be published for the whole country at once — the US Census publishes
      // one nationwide file per legislative chamber. `publishedBoundariesFor` treats a null region
      // as "covers any region", so a nationwide entry is offered to a campaign in every state.
    }
  });

  it('resolves every supersededBy to another entry, and never in a cycle', () => {
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      if (entry.supersededBy === null) continue;
      expect(entry.supersededBy).not.toBe(entry.slug);
      const replacement = findPublishedBoundary(entry.supersededBy);
      expect(replacement).toBeDefined();
      // The replacement covers the same office, or it is not a replacement.
      expect(replacement?.jurisdiction).toBe(entry.jurisdiction);
      expect(replacement?.region).toBe(entry.region);
      expect(replacement?.chamber).toBe(entry.chamber);
      expect(replacement?.role).toBe(entry.role);
    }
  });

  it('offers at most one current edition per office, role and chamber', () => {
    const seen = new Map<string, string>();
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      if (entry.supersededBy !== null) continue;
      const key = [entry.jurisdiction, entry.region ?? '', entry.chamber ?? '', entry.role].join('|');
      const clash = seen.get(key);
      expect(clash, `${entry.slug} and ${clash} both claim to be the current edition`).toBeUndefined();
      seen.set(key, entry.slug);
    }
  });

  it('builds a storage key under the reserved prefix', () => {
    expect(publishedBoundaryStorageKey('ca-fed-2023')).toBe(`${PUBLISHED_BOUNDARY_STORAGE_PREFIX}/ca-fed-2023.geojson`);
  });

  it('recognises only slugs it actually publishes', () => {
    expect(isPublishedBoundarySlug('definitely-not-a-published-map')).toBe(false);
    expect(isPublishedBoundarySlug(42)).toBe(false);
    expect(isPublishedBoundarySlug(null)).toBe(false);
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      expect(isPublishedBoundarySlug(entry.slug)).toBe(true);
      expect(publishedBoundaryCountry(entry)).toMatch(/^(CA|US)$/);
    }
  });

  it('suggests nothing for an office no entry covers', () => {
    expect(publishedBoundariesFor({ jurisdiction: 'other', region: null, chamber: null })).toEqual([]);
  });

  it('matches a nationwide entry to any region, and a regional entry only to its own', () => {
    for (const entry of PUBLISHED_BOUNDARY_ENTRIES) {
      if (entry.supersededBy !== null) continue;
      const office = { jurisdiction: entry.jurisdiction, region: entry.region, chamber: entry.chamber };
      expect(publishedBoundariesFor(office).map((e) => e.slug)).toContain(entry.slug);
      if (entry.region !== null) {
        const elsewhere = publishedBoundariesFor({ ...office, region: 'ZZ' });
        expect(elsewhere.map((e) => e.slug)).not.toContain(entry.slug);
      }
    }
  });

  it('returns each suggested map once when several campaigns contest the same office', () => {
    const office = { jurisdiction: 'ca_federal', region: null, chamber: null } as const;
    const suggested = publishedBoundariesForOffices([office, office, office]);
    expect(new Set(suggested.map((e) => e.slug)).size).toBe(suggested.length);
  });

  it('reports emptiness from the data rather than from a hard-coded answer', () => {
    expect(publishedBoundaryCatalogIsEmpty()).toBe(PUBLISHED_BOUNDARY_ENTRIES.length === 0);
  });

  it('writes a size a person can read', () => {
    expect(formatPublishedBoundarySize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatPublishedBoundarySize(200 * 1024)).toBe('200 KB');
    expect(formatPublishedBoundarySize(10)).toBe('1 KB');
  });
});
