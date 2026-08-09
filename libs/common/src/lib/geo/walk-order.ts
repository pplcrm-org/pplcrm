import type { LatLng } from './haversine';

/**
 * The suggested walking order over a turf's doors, shared by the Canvass
 * Companion, the CRM turf page and the printable walk sheet — one
 * implementation so no two surfaces can ever disagree about "door 3".
 *
 * The order is a suggestion, never a lock: stored `walk_order` (the cutting
 * engine's snake sweep) decides which street comes first, and within a street
 * doors walk up one parity side by ascending house number and back down the
 * other — the loop a paper walk map draws. House numbers that don't parse
 * keep the stored order at the end of their street.
 */

/** The minimum a door must carry to be placed in a walking order. */
export interface WalkOrderable {
  street: string | null;
  street_num: string | null;
  walk_order: number;
}

/** One street's doors, in walking order. */
export interface WalkStreetGroup<T extends WalkOrderable> {
  /** Normalized street key; `''` groups the doors with no street on file. */
  key: string;
  /** First spelling seen — display what the data says, not a normalization. */
  street: string;
  /** Doors in the order they should be walked. */
  doors: T[];
}

/**
 * Normalized street key: case- and whitespace-insensitive, `''` when absent.
 * The Companion's segment grouping delegates here, so scoping a street and
 * ordering a street can never split on spelling.
 */
export function streetKeyOf(street: string | null | undefined): string {
  return street?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

/** Leading integer of a house number ("218A" → 218), or null when it has none. */
export function streetNumberValue(streetNum: string | null | undefined): number | null {
  const match = /^\s*(\d+)/.exec(streetNum ?? '');
  return match ? Number(match[1]) : null;
}

interface SideDoor<T> {
  door: T;
  num: number;
}

function bySideOrder<T extends WalkOrderable>(a: SideDoor<T>, b: SideDoor<T>): number {
  return a.num - b.num || a.door.walk_order - b.door.walk_order;
}

/**
 * Group doors by street and order each street for walking.
 *
 * Streets come back in the order the cutter first reaches them (lowest stored
 * `walk_order`), which is the only inter-street order the data supports.
 * Within a street, the parity side holding the lowest-`walk_order` numeric
 * door goes first ascending, the other side returns descending; a street with
 * one side only ascends with no return leg.
 */
export function groupForWalk<T extends WalkOrderable>(items: readonly T[]): WalkStreetGroup<T>[] {
  const groups = new Map<string, { street: string; doors: T[] }>();
  const inWalkOrder = [...items].sort((a, b) => a.walk_order - b.walk_order);
  for (const item of inWalkOrder) {
    const key = streetKeyOf(item.street);
    const group = groups.get(key);
    if (group) group.doors.push(item);
    else groups.set(key, { street: item.street?.trim() ?? '', doors: [item] });
  }

  return [...groups.entries()].map(([key, group]) => {
    const numeric: SideDoor<T>[] = [];
    const rest: T[] = [];
    for (const door of group.doors) {
      const num = streetNumberValue(door.street_num);
      if (num == null) rest.push(door);
      else numeric.push({ door, num });
    }
    // group.doors is already in stored walk order, so numeric[0] is the door
    // the cutter reached first — its side of the street is where the walk starts.
    const firstNumeric = numeric[0];
    if (firstNumeric === undefined) return { key, street: group.street, doors: group.doors };
    const startParity = firstNumeric.num % 2;
    const outbound = numeric.filter((d) => d.num % 2 === startParity).sort(bySideOrder);
    const returning = numeric.filter((d) => d.num % 2 !== startParity).sort((a, b) => -bySideOrder(a, b));
    return {
      key,
      street: group.street,
      doors: [...outbound.map((d) => d.door), ...returning.map((d) => d.door), ...rest],
    };
  });
}

/** The whole turf's suggested walking order, flattened across streets. */
export function orderForWalk<T extends WalkOrderable>(items: readonly T[]): T[] {
  return groupForWalk(items).flatMap((group) => group.doors);
}

const METERS_PER_DEGREE_LAT = 111_320;

/** Local flat-earth meters between two nearby coordinates — fine at street scale. */
function localMeters(origin: LatLng, point: LatLng): { x: number; y: number } {
  const latScale = Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * latScale * METERS_PER_DEGREE_LAT,
    y: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
  };
}

/**
 * Drop near-collinear vertices so a path bends only at real turns.
 *
 * A walk line's job is direction, not per-door precision — forty doors along
 * one street front should render as one or two segments, not forty. Single
 * O(n) pass: an interior point survives only when it sits more than
 * `toleranceMeters` off the straight line from the last kept point to the
 * next point.
 */
export function simplifyPath(points: readonly LatLng[], toleranceMeters = 10): LatLng[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length <= 2 || first === undefined || last === undefined) return [...points];

  const kept: LatLng[] = [first];
  let anchor = first;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const next = points[i + 1];
    if (point === undefined || next === undefined) continue;
    const segment = localMeters(anchor, next);
    const candidate = localMeters(anchor, point);
    const segmentLength = Math.hypot(segment.x, segment.y);
    const deviation =
      segmentLength === 0
        ? Math.hypot(candidate.x, candidate.y)
        : Math.abs(segment.x * candidate.y - segment.y * candidate.x) / segmentLength;
    if (deviation > toleranceMeters) {
      kept.push(point);
      anchor = point;
    }
  }
  kept.push(last);
  return kept;
}
