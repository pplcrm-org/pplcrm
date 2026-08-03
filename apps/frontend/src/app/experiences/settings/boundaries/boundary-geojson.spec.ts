import { BOUNDARY_MAX_FEATURES_PER_SET, BOUNDARY_UPLOAD_MAX_BYTES, type BoundaryGeometryType } from '@common';
import { describe, expect, it } from 'vitest';

import {
  MAX_RESHAPE_VERTICES,
  checkBoundaryFileSize,
  countRawGeometryVertices,
  geometryOuterRings,
  geometryTooLargeToSave,
  guessCodeProperty,
  guessNameProperty,
  inspectBoundaryGeoJson,
  isTooDetailedToReshape,
  partPolygonId,
  readPartPolygonId,
  replaceOuterRing,
  ringToPolygonGeometry,
} from './boundary-geojson';

/** A square around a point, as the map would hand it over: latitude/longitude, ring not closed. */
const SQUARE = [
  { lat: 45.4, lng: -75.7 },
  { lat: 45.4, lng: -75.6 },
  { lat: 45.5, lng: -75.6 },
  { lat: 45.5, lng: -75.7 },
];

function featureCollection(features: unknown[]): string {
  return JSON.stringify({ type: 'FeatureCollection', features });
}

function squareFeature(properties: Record<string, unknown>): unknown {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-75.7, 45.4],
          [-75.6, 45.4],
          [-75.6, 45.5],
          [-75.7, 45.5],
          [-75.7, 45.4],
        ],
      ],
    },
  };
}

describe('checkBoundaryFileSize', () => {
  it('accepts a file at the limit', () => {
    expect(checkBoundaryFileSize(BOUNDARY_UPLOAD_MAX_BYTES)).toBeNull();
  });

  it('names the limit when the file is too big', () => {
    const message = checkBoundaryFileSize(BOUNDARY_UPLOAD_MAX_BYTES + 1);
    expect(message).toContain('20 MB');
  });
});

describe('inspectBoundaryGeoJson', () => {
  it('reports the areas, the skipped shapes and the properties on offer', () => {
    const result = inspectBoundaryGeoJson(
      featureCollection([
        squareFeature({ WARD_NAME: 'Ward 1', WARD_CODE: '1' }),
        squareFeature({ WARD_NAME: 'Ward 2', WARD_CODE: '2' }),
        { type: 'Feature', properties: { WARD_NAME: 'A pin' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inspection.featureCount).toBe(3);
    expect(result.inspection.areaCount).toBe(2);
    expect(result.inspection.skippedCount).toBe(1);
    expect(result.inspection.properties.map((property) => property.key)).toEqual(['WARD_CODE', 'WARD_NAME']);
    expect(result.inspection.properties.find((property) => property.key === 'WARD_NAME')?.samples).toEqual([
      'Ward 1',
      'Ward 2',
    ]);
  });

  it('refuses a file that is not JSON, without saying "failed"', () => {
    const result = inspectBoundaryGeoJson('<html>not a map</html>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('not valid JSON');
  });

  it('refuses a file with no features list', () => {
    const result = inspectBoundaryGeoJson(JSON.stringify({ type: 'Polygon' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('FeatureCollection');
  });

  it('states the area limit rather than failing bare', () => {
    const tooMany = Array.from({ length: BOUNDARY_MAX_FEATURES_PER_SET + 1 }, () => squareFeature({ N: 'x' }));
    const result = inspectBoundaryGeoJson(featureCollection(tooMany));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('5,000');
  });

  it('states the point limit when one area is too detailed', () => {
    const ring = Array.from({ length: 50_001 }, (_, index) => [-75 + index * 1e-6, 45]);
    ring.push([-75, 45]);
    const result = inspectBoundaryGeoJson(
      featureCollection([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('50,000');
  });

  it('refuses a file whose shapes are all points or lines', () => {
    const result = inspectBoundaryGeoJson(
      featureCollection([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Polygon or MultiPolygon');
  });
});

describe('property guesses', () => {
  const properties = [
    { key: 'OBJECTID', samples: ['1'] },
    { key: 'WARD_NAME', samples: ['Ward 1'] },
    { key: 'WARD_CODE', samples: ['1'] },
  ];

  it('guesses the property whose name contains "name"', () => {
    expect(guessNameProperty(properties)).toBe('WARD_NAME');
  });

  it('guesses a separate code property and never reuses the name one', () => {
    expect(guessCodeProperty(properties, 'WARD_NAME')).toBe('WARD_CODE');
  });

  it('offers no guess when there is nothing to guess from', () => {
    expect(guessNameProperty([])).toBe('');
    expect(guessCodeProperty([], '')).toBe('');
  });
});

describe('countRawGeometryVertices', () => {
  it('counts every ring of every part', () => {
    const geometry = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 5],
          ],
        ],
      ],
    };
    expect(countRawGeometryVertices(geometry)).toBe(8);
  });

  it('returns null for a shape that encloses no area', () => {
    expect(countRawGeometryVertices({ type: 'LineString', coordinates: [] })).toBeNull();
    expect(countRawGeometryVertices(null)).toBeNull();
  });
});

describe('a drawn ring round-trips through stored geometry', () => {
  it('flips to longitude-first, closes the ring, and comes back unchanged', () => {
    const geometry = ringToPolygonGeometry(SQUARE);
    expect(geometry).not.toBeNull();
    if (!geometry) return;

    expect(geometry.type).toBe('Polygon');
    const ring = geometry.coordinates[0];
    expect(ring).toBeDefined();
    if (!ring) return;
    // GeoJSON is [longitude, latitude]; the map is latitude-first. Getting this backwards puts
    // Ottawa in Antarctica, so it is asserted rather than assumed.
    expect(ring[0]).toEqual([-75.7, 45.4]);
    // The first position is repeated as the last, which a traced ring does not do for itself.
    expect(ring).toHaveLength(SQUARE.length + 1);
    expect(ring[ring.length - 1]).toEqual(ring[0]);

    // Coming back out, the repeat is stripped again: the editable path is exactly the traced ring,
    // one handle per corner, no stacked pair at the origin.
    expect(geometryOuterRings(geometry)[0]).toEqual(SQUARE);
  });

  it('refuses a ring that is still a line', () => {
    expect(ringToPolygonGeometry(SQUARE.slice(0, 2))).toBeNull();
  });
});

describe('geometryOuterRings', () => {
  it('returns one ring per part and leaves holes out', () => {
    const geometry: BoundaryGeometryType = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 0],
          ],
          [
            [0.5, 0.5],
            [1, 0.5],
            [1, 1],
            [0.5, 0.5],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 5],
          ],
        ],
      ],
    };
    const rings = geometryOuterRings(geometry);
    expect(rings).toHaveLength(2);
    expect(rings[0]?.[0]).toEqual({ lat: 0, lng: 0 });
    expect(rings[1]?.[0]).toEqual({ lat: 5, lng: 5 });
  });

  it('strips the repeated closing position, so an editable path has one handle per corner', () => {
    // Stored rings close on themselves ([a, b, c, a]); an editable path must not, or the map shows
    // two stacked handles at the origin and dragging one leaves the other behind as a real vertex,
    // growing the ring by one position on every edit.
    const geometry: BoundaryGeometryType = {
      type: 'Polygon',
      coordinates: [
        [
          [-75.7, 45.4],
          [-75.6, 45.4],
          [-75.6, 45.5],
          [-75.7, 45.4],
        ],
      ],
    };
    expect(geometryOuterRings(geometry)[0]).toEqual([
      { lat: 45.4, lng: -75.7 },
      { lat: 45.4, lng: -75.6 },
      { lat: 45.5, lng: -75.6 },
    ]);
  });

  it('leaves a ring alone when it does not close on itself', () => {
    // Defensive: a ring that (wrongly) lacks the closing repeat loses no corner.
    const geometry: BoundaryGeometryType = {
      type: 'Polygon',
      coordinates: [
        [
          [-75.7, 45.4],
          [-75.6, 45.4],
          [-75.6, 45.5],
        ],
      ],
    };
    expect(geometryOuterRings(geometry)[0]).toHaveLength(3);
  });
});

describe('features too detailed to reshape on the map', () => {
  /** A Polygon whose single ring holds `count` full-precision positions (≈39 bytes each in JSON). */
  function ringOf(count: number): BoundaryGeometryType {
    const position: [number, number] = [-75.12345678901234, 45.98765432109876];
    const ring: [number, number][] = Array.from({ length: count }, () => position);
    return { type: 'Polygon', coordinates: [ring] };
  }

  it('leaves an ordinary drawn area editable', () => {
    const geometry = ringToPolygonGeometry(SQUARE);
    expect(geometry).not.toBeNull();
    if (!geometry) return;
    expect(isTooDetailedToReshape(geometry)).toBe(false);
  });

  it('marks a feature past the vertex threshold view-only', () => {
    expect(isTooDetailedToReshape(ringOf(MAX_RESHAPE_VERTICES + 1))).toBe(true);
    expect(isTooDetailedToReshape(ringOf(MAX_RESHAPE_VERTICES))).toBe(false);
  });

  it('refuses to send a geometry the server would bounce as an oversized request body', () => {
    const huge = ringOf(40_000);
    // Sanity-check the fixture really is past the 1 MiB cap the helper mirrors, so this test can
    // never silently pass on a fixture that shrank.
    expect(JSON.stringify(huge).length).toBeGreaterThan(1024 * 1024);
    // The pre-send check is what turns that raw HTTP 413 into a sentence naming the fix.
    expect(geometryTooLargeToSave(huge)).toBe(true);

    const small = ringToPolygonGeometry(SQUARE);
    expect(small).not.toBeNull();
    if (!small) return;
    expect(geometryTooLargeToSave(small)).toBe(false);
  });

  it('keeps the editable ceiling comfortably inside the request-body limit', () => {
    // The whole point of MAX_RESHAPE_VERTICES: any feature the map lets someone reshape must also
    // be one the server will accept back when the reshape is saved.
    expect(geometryTooLargeToSave(ringOf(MAX_RESHAPE_VERTICES))).toBe(false);
  });
});

describe('replaceOuterRing', () => {
  const holed: BoundaryGeometryType = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 0],
      ],
      [
        [0.5, 0.5],
        [1, 0.5],
        [1, 1],
        [0.5, 0.5],
      ],
    ],
  };

  it('replaces the outline and keeps the hole', () => {
    const updated = replaceOuterRing(holed, 0, SQUARE);
    expect(updated?.type).toBe('Polygon');
    if (updated?.type !== 'Polygon') return;
    expect(updated.coordinates).toHaveLength(2);
    expect(updated.coordinates[0]?.[0]).toEqual([-75.7, 45.4]);
    expect(updated.coordinates[1]).toEqual(holed.coordinates[1]);
  });

  it('replaces one part of a multi-part area and leaves the others alone', () => {
    const multi: BoundaryGeometryType = { type: 'MultiPolygon', coordinates: [holed.coordinates, holed.coordinates] };
    const updated = replaceOuterRing(multi, 1, SQUARE);
    expect(updated?.type).toBe('MultiPolygon');
    if (updated?.type !== 'MultiPolygon') return;
    expect(updated.coordinates[0]).toEqual(holed.coordinates);
    expect(updated.coordinates[1]?.[0]?.[0]).toEqual([-75.7, 45.4]);
  });

  it('drops an edit aimed at a part that is not there', () => {
    expect(replaceOuterRing(holed, 3, SQUARE)).toBeNull();
  });
});

describe('part ids', () => {
  it('round-trips a feature id that itself contains no separator', () => {
    expect(readPartPolygonId(partPolygonId('42', 3))).toEqual({ featureId: '42', partIndex: 3 });
  });

  it('rejects anything that is not a part id', () => {
    expect(readPartPolygonId('42')).toBeNull();
    expect(readPartPolygonId('#0')).toBeNull();
    expect(readPartPolygonId('42#nope')).toBeNull();
  });
});
