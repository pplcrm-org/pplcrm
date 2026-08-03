import { describe, expect, it } from 'vitest';

import { cutTurfs, previewCut, type DoorPoint } from './cutting-engine';

/** Build a grid of geocoded doors inside a single boundary area. */
function grid(count: number, boundaryName: string | null = 'W1'): DoorPoint[] {
  const doors: DoorPoint[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    doors.push({
      household_id: String(i + 1),
      lat: 41.85 + Math.floor(i / side) * 0.001,
      lng: -87.69 + (i % side) * 0.001,
      boundaryName,
    });
  }
  return doors;
}

describe('cutting-engine', () => {
  it('cuts a universe into roughly target-sized turfs', () => {
    const plan = cutTurfs(grid(100), 25);
    expect(plan.placedCount).toBe(100);
    expect(plan.turfs.length).toBe(4);
    for (const turf of plan.turfs) {
      expect(turf.households.length).toBeGreaterThan(15);
      expect(turf.households.length).toBeLessThan(35);
    }
  });

  it('places every geocoded door exactly once (no loss, no duplication)', () => {
    const plan = cutTurfs(grid(57), 20);
    const ids = plan.turfs.flatMap((t) => t.households);
    expect(ids.length).toBe(57);
    expect(new Set(ids).size).toBe(57);
  });

  it('never lets a turf span two boundaries (barrier proxy)', () => {
    const doors = [...grid(40, 'W1'), ...grid(40, 'W2').map((d) => ({ ...d, household_id: `b${d.household_id}` }))];
    const plan = cutTurfs(doors, 40);
    // Each area yields its own turf(s); no turf mixes W1 and W2 ids.
    for (const turf of plan.turfs) {
      const hasW1 = turf.households.some((id) => !id.startsWith('b'));
      const hasW2 = turf.households.some((id) => id.startsWith('b'));
      expect(hasW1 && hasW2).toBe(false);
    }
    expect(plan.turfs.length).toBeGreaterThanOrEqual(2);
  });

  it('reports ungeocoded households as unplaced instead of dropping them', () => {
    const doors: DoorPoint[] = [
      ...grid(10),
      { household_id: 'x1', lat: null, lng: null, boundaryName: 'W1' },
      { household_id: 'x2', lat: 41.85, lng: null, boundaryName: 'W1' },
    ];
    const plan = cutTurfs(doors, 10);
    expect(plan.unplaced.sort()).toEqual(['x1', 'x2']);
    expect(plan.placedCount).toBe(10);
  });

  /**
   * Doors with no boundary share ONE bucket rather than getting one each. Without this a
   * workspace holding no boundary map — the ordinary case until one is imported, uploaded or
   * drawn — would get one turf per door instead of walkable turfs.
   */
  it('collapses every door with no boundary into one bucket, cut on geography alone', () => {
    const plan = cutTurfs(grid(100, null), 25);
    expect(plan.placedCount).toBe(100);
    expect(plan.turfs.length).toBe(4);
    // And every resulting turf reports itself as unbounded, so the UI can label it.
    for (const turf of plan.turfs) expect(turf.boundaryName).toBeNull();
  });

  it('keeps the unbounded bucket separate from named areas', () => {
    const doors = [...grid(40, 'W1'), ...grid(40, null).map((d) => ({ ...d, household_id: `u${d.household_id}` }))];
    const plan = cutTurfs(doors, 40);
    for (const turf of plan.turfs) {
      const hasNamed = turf.households.some((id) => !id.startsWith('u'));
      const hasUnbounded = turf.households.some((id) => id.startsWith('u'));
      expect(hasNamed && hasUnbounded).toBe(false);
    }
    expect(plan.turfs.some((t) => t.boundaryName === 'W1')).toBe(true);
    expect(plan.turfs.some((t) => t.boundaryName === null)).toBe(true);
  });

  it('produces contiguous, compact turfs (neighbouring doors stay together)', () => {
    // A 10x10 grid cut into 4 turfs of 25 should keep each turf spatially tight.
    const plan = cutTurfs(grid(100), 25);
    for (const turf of plan.turfs) {
      const lats = turf.households.map((id) => Number(id)).map((i) => Math.floor((i - 1) / 10));
      const span = Math.max(...lats) - Math.min(...lats);
      // A compact turf covers only a few latitude bands, not the whole map.
      expect(span).toBeLessThanOrEqual(6);
    }
  });

  it('previewCut agrees with cutTurfs', () => {
    const doors = grid(83);
    const preview = previewCut(doors, 20);
    const plan = cutTurfs(doors, 20);
    expect(preview.turfCount).toBe(plan.turfs.length);
    expect(preview.doors).toBe(plan.placedCount);
    expect(preview.avgDoorsPerTurf).toBeGreaterThan(0);
  });

  it('handles an empty universe without throwing', () => {
    const plan = cutTurfs([], 30);
    expect(plan.turfs).toEqual([]);
    expect(plan.placedCount).toBe(0);
  });
});
