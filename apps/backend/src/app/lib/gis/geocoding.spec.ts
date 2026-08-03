import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as boundaryMatch from './boundary-match';
import * as geocodeCache from './geocode-cache';
import { geocodeAndMapHousehold, isPointInMultiPolygon, isPointInPolygon } from './geocoding';

describe('point-in-polygon math', () => {
  const loopPolygon = [
    [
      [-87.64, 41.87],
      [-87.62, 41.87],
      [-87.62, 41.89],
      [-87.64, 41.89],
      [-87.64, 41.87],
    ],
  ];

  it('returns true for a point inside the bounds', () => {
    expect(isPointInPolygon(-87.63, 41.88, loopPolygon)).toBe(true);
  });

  it('returns false for a point outside the bounds', () => {
    expect(isPointInPolygon(-87.65, 41.88, loopPolygon)).toBe(false);
  });

  it('excludes a point that falls inside an interior ring (a hole)', () => {
    const withHole = [
      ...loopPolygon,
      [
        [-87.636, 41.876],
        [-87.624, 41.876],
        [-87.624, 41.884],
        [-87.636, 41.884],
        [-87.636, 41.876],
      ],
    ];
    expect(isPointInPolygon(-87.63, 41.88, withHole)).toBe(false);
  });

  it('returns true if the point is inside any part of a multi-part area', () => {
    expect(isPointInMultiPolygon(-87.63, 41.88, [loopPolygon])).toBe(true);
  });
});

describe('geocodeAndMapHousehold', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Kysely stub, see below */
  let dbMock: any;
  let updateMock: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(() => {
    vi.restoreAllMocks();

    updateMock = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ numUpdatedRows: 1 }),
    };

    dbMock = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn(),
      updateTable: vi.fn().mockReturnValue(updateMock),
    };

    // Boundary matching has its own specs and its own database tables; these tests are about the
    // geocoding flow, so the two matcher entry points are stubbed rather than mocked in SQL.
    vi.spyOn(boundaryMatch, 'applyHouseholdMatches').mockResolvedValue(undefined);
    vi.spyOn(boundaryMatch, 'matchHouseholdBoundaries').mockResolvedValue([]);
  });

  it('marks a blank address failed without calling the geocoder', async () => {
    const cached = vi.spyOn(geocodeCache, 'geocodeAddressCached');
    dbMock.executeTakeFirst.mockResolvedValue({ id: '100', tenant_id: '1', street_num: '', street1: '', city: '' });

    await geocodeAndMapHousehold('100', '1', dbMock);

    expect(cached).not.toHaveBeenCalled();
    expect(updateMock.set).toHaveBeenCalledWith(expect.objectContaining({ geocoding_status: 'failed' }));
  });

  it('marks an incomplete address failed', async () => {
    dbMock.executeTakeFirst.mockResolvedValue({
      id: '100',
      tenant_id: '1',
      street_num: '123',
      street1: '',
      city: 'Chicago',
    });

    await geocodeAndMapHousehold('100', '1', dbMock);

    expect(updateMock.set).toHaveBeenCalledWith(expect.objectContaining({ geocoding_status: 'failed' }));
  });

  it('stores coordinates and then matches boundaries', async () => {
    dbMock.executeTakeFirst.mockResolvedValue({
      id: '100',
      tenant_id: '1',
      street_num: '123',
      street1: 'Main St',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
      address_fp_full: '123 main st chicago il 60601',
    });

    await geocodeAndMapHousehold('100', '1', dbMock);

    expect(updateMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        geocoding_status: 'success',
        lat: expect.any(Number),
        lng: expect.any(Number),
      }),
    );
    expect(boundaryMatch.matchHouseholdBoundaries).toHaveBeenCalledWith(
      dbMock,
      '1',
      '100',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('marks failed and clears stored areas when the address resolves to nothing', async () => {
    vi.spyOn(geocodeCache, 'geocodeAddressCached').mockResolvedValue(null);
    dbMock.executeTakeFirst.mockResolvedValue({
      id: '100',
      tenant_id: '1',
      street_num: '123',
      street1: 'Nowhere Rd',
      city: 'Chicago',
      state: 'IL',
      address_fp_full: '123 nowhere rd chicago il',
    });

    await geocodeAndMapHousehold('100', '1', dbMock);

    expect(updateMock.set).toHaveBeenCalledWith(expect.objectContaining({ geocoding_status: 'failed' }));
    expect(boundaryMatch.applyHouseholdMatches).toHaveBeenCalledWith(dbMock, '1', '100', []);
  });
});
