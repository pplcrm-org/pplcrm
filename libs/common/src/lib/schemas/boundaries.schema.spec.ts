import { describe, expect, it } from 'vitest';

import {
  boundaryBBoxOf,
  boundaryGeometrySchema,
  boundaryPositionSchema,
  countBoundaryVertices,
} from './boundaries.schema';

/**
 * GeoJSON positions may carry a third elevation element (RFC 7946 §3.1.1), and QGIS/KML exports
 * routinely write `[lng, lat, 0]`. These tests pin that such files parse, and that the third
 * element never leaks into anything computed from the geometry — only indices 0 and 1 are read.
 */
describe('boundaryPositionSchema', () => {
  it('accepts a plain [lng, lat] position', () => {
    expect(boundaryPositionSchema.safeParse([-75.7, 45.4]).success).toBe(true);
  });

  it('accepts a position with a third elevation element', () => {
    expect(boundaryPositionSchema.safeParse([-75.7, 45.4, 0]).success).toBe(true);
  });

  it('rejects a lone number and a non-numeric elevation', () => {
    expect(boundaryPositionSchema.safeParse([-75.7]).success).toBe(false);
    expect(boundaryPositionSchema.safeParse([-75.7, 45.4, 'sea level']).success).toBe(false);
  });

  it('still enforces the longitude and latitude ranges', () => {
    expect(boundaryPositionSchema.safeParse([-181, 45.4, 0]).success).toBe(false);
    expect(boundaryPositionSchema.safeParse([-75.7, 91, 0]).success).toBe(false);
  });
});

describe('boundaryGeometrySchema with elevation elements', () => {
  const elevatedSquare = {
    type: 'Polygon',
    coordinates: [
      [
        [-76, 45, 0],
        [-75, 45, 0],
        [-75, 46, 0],
        [-76, 46, 0],
        [-76, 45, 0],
      ],
    ],
  };

  it('parses a Polygon whose positions carry [lng, lat, 0]', () => {
    const parsed = boundaryGeometrySchema.safeParse(elevatedSquare);
    expect(parsed.success).toBe(true);
  });

  it('computes the bbox from indices 0 and 1 only', () => {
    const parsed = boundaryGeometrySchema.parse(elevatedSquare);
    expect(boundaryBBoxOf(parsed)).toEqual([-76, 45, -75, 46]);
  });

  it('counts vertices of an elevated ring the same as a flat one', () => {
    const parsed = boundaryGeometrySchema.parse(elevatedSquare);
    expect(countBoundaryVertices(parsed)).toBe(5);
  });
});
