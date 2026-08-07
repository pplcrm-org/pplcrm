import { describe, expect, it } from 'vitest';

import {
  TURF_WALKED_FINISHED_PCT,
  TURF_WALKED_LEGEND,
  TURF_WALKED_OVER_HALF_PCT,
  TURF_WALKED_VARIANT,
  turfWalkedBucket,
  turfWalkedPct,
} from './turf-vocabulary';

/**
 * How far a turf has been walked decides how the coverage map shades it, and once a campaign is
 * large enough that shading is the whole map — no individual doors are drawn at all. So this is not
 * decoration: it is the only thing on screen saying where the campaign has and has not been.
 *
 * Kept out of the page component so it can be checked without a map, a browser or a tRPC mock.
 */
describe('turfWalkedPct', () => {
  it('counts every door that was knocked at all, answered or not', () => {
    // 100 doors, 40 never tried: 60 were knocked, whether or not anyone came to the door.
    expect(turfWalkedPct(100, 40)).toBe(60);
  });

  it('reads an untouched turf as nothing walked', () => {
    expect(turfWalkedPct(100, 100)).toBe(0);
  });

  it('reads a fully walked turf as everything walked', () => {
    expect(turfWalkedPct(100, 0)).toBe(100);
  });

  it('answers zero for a turf with no doors rather than dividing by zero', () => {
    expect(turfWalkedPct(0, 0)).toBe(0);
  });

  it('never reports more than everything, however the counts arrive', () => {
    // A negative not-yet count should not be able to produce "120% knocked".
    expect(turfWalkedPct(100, -20)).toBe(100);
    expect(turfWalkedPct(100, 140)).toBe(0);
  });
});

describe('turfWalkedBucket', () => {
  it('separates a turf nobody has started from one barely started', () => {
    expect(turfWalkedBucket(0)).toBe('not_started');
    expect(turfWalkedBucket(1)).toBe('started');
  });

  it('changes step exactly at the percentages the legend states', () => {
    expect(turfWalkedBucket(TURF_WALKED_OVER_HALF_PCT - 1)).toBe('started');
    expect(turfWalkedBucket(TURF_WALKED_OVER_HALF_PCT)).toBe('over_half');
    expect(turfWalkedBucket(TURF_WALKED_FINISHED_PCT - 1)).toBe('over_half');
    expect(turfWalkedBucket(TURF_WALKED_FINISHED_PCT)).toBe('finished');
    expect(turfWalkedBucket(100)).toBe('finished');
  });
});

describe('the shading legend', () => {
  it('names every step the map can draw, so nothing on screen is unexplained', () => {
    const legendBuckets = TURF_WALKED_LEGEND.map((entry) => entry.bucket).sort();
    expect(legendBuckets).toEqual(Object.keys(TURF_WALKED_VARIANT).sort());
  });

  it('gives each step its own colour, so two steps cannot be confused for one', () => {
    const colours = Object.values(TURF_WALKED_VARIANT);
    expect(new Set(colours).size).toBe(colours.length);
  });
});
