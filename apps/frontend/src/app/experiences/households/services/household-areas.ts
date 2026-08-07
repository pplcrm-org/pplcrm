/**
 * Reading a household's electoral geography off a household record.
 *
 * A household is inside several boundaries at the same time: a federal riding AND a provincial
 * riding AND a municipal ward AND a precinct. That is why the three old text columns on
 * `households` (district, precinct, ward) were replaced by `household_districts`, which holds one
 * row per household per boundary map. Anything that shows a household's geography therefore shows a
 * LIST, never three fixed slots.
 *
 * The household record arrives from `households.getById`, which is untyped at the tRPC boundary, so
 * every field is read defensively here rather than cast. Two shapes are accepted:
 *
 * - `electoral_areas`: one entry per boundary, each naming the map it came from. This is the shape
 *   the detail pages want, because "Ward 4" and "Ottawa Centre" mean nothing without the map name.
 * - `any_electoral_area`: every area joined into one string by the backend, which is what the grid
 *   and the smart-list rule builder already read. Usable as a fallback, but it carries no map
 *   names, so entries read from it have an empty `setLabel`.
 *
 * A household with no boundaries at all returns an empty list. That is a real answer, not a
 * failure: it means this workspace has not imported, uploaded or drawn a map yet, or this address
 * has not been placed on one.
 */

/** The separator the backend uses when it joins area names into one string. */
export const ELECTORAL_AREA_SEPARATOR = ' · ';

/** One boundary a household falls inside. */
export interface HouseholdArea {
  /** What this workspace calls the map the area belongs to, e.g. "Wards". Empty when unknown. */
  setLabel: string;
  /** The area itself, e.g. "Ward 4" or "Ottawa Centre". */
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The single area to show in a badge or a one-line address suffix, or null when there is none.
 *
 * Two sources, in this order:
 *
 *  1. `electoral_area` — the area on the ACTIVE CAMPAIGN'S own seat map. The grid query computes it,
 *     because it already knows which campaign is in context. It is the exact-comparable one.
 *  2. The first entry of `electoral_areas`. The record endpoints cannot compute (1): resolving the
 *     campaign's seat map needs the active campaign id, and the shared record fetch is given only a
 *     workspace and a row id. Rather than guess a map — which would show a confidently wrong area to
 *     a workspace holding several — the backend sends every boundary already ordered with seat areas
 *     (ridings, wards, congressional districts) ahead of subdivisions (precincts, polling divisions),
 *     then by map name. So the first entry is the broadest real boundary the household is in. It is
 *     not campaign-specific, but it is never wrong, which is the property that matters for a label.
 */
export function readPrimaryElectoralArea(record: unknown): string | null {
  if (!isRecord(record)) return null;
  const name = readString(record['electoral_area']);
  if (name.length > 0) return name;
  return readHouseholdAreas(record)[0]?.name ?? null;
}

/**
 * The one-line area suffix used after an address, e.g. "Ward 3" or "Ottawa Centre".
 *
 * `seatLabel` is the active campaign's own word for the seat it contests. It is prepended only when
 * the area name does not already contain it, so a Toronto ward reads "Ward 4" rather than
 * "Ward Ward 4". Returns null when the household has no area on the campaign's map, in which case
 * the caller shows the address alone rather than an empty separator.
 */
export function electoralAreaSuffix(record: unknown, seatLabel: string | null): string | null {
  const area = readPrimaryElectoralArea(record);
  if (!area) return null;
  if (!seatLabel) return area;
  return area.toLowerCase().includes(seatLabel.toLowerCase()) ? area : `${seatLabel} ${area}`;
}

/** Every boundary the household falls inside, in the order the backend supplied them. */
export function readHouseholdAreas(record: unknown): HouseholdArea[] {
  if (!isRecord(record)) return [];

  const listed = record['electoral_areas'];
  if (Array.isArray(listed)) {
    const areas: HouseholdArea[] = [];
    for (const entry of listed) {
      if (!isRecord(entry)) continue;
      const name = readString(entry['name']);
      if (name.length === 0) continue;
      areas.push({ setLabel: readString(entry['set_label']), name });
    }
    return areas;
  }

  const joined = readString(record['any_electoral_area']);
  if (joined.length === 0) return [];
  return joined
    .split(ELECTORAL_AREA_SEPARATOR)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => ({ setLabel: '', name }));
}

/**
 * Whether a record's address is in the campaign's own territory, worded for a person to read.
 *
 * The backend answers this on both the households list and the record endpoints, so the wording
 * lives here and both record pages use it. Returns null when the question does not apply — an
 * at-large office, or a workspace with no map for this office — so a page can leave it out entirely
 * rather than showing an empty label.
 *
 * "Outside the map" and "not answered" are separate answers on purpose. Both mean no area is known,
 * but the first is a finished answer (the address was tested against every area and fell in none —
 * outside the province, or outside the country) and the second is not (no address on file, no
 * coordinates yet, or no match run since the map was added). Merging them would report a pending
 * lookup as a decision.
 */
export function seatStatusLabelFor(status: string | null | undefined, seatWord: string): string | null {
  const word = seatWord.trim().toLowerCase() || 'area';
  switch (status) {
    case 'in':
      return `In your ${word}`;
    case 'other':
      return `Outside your ${word}`;
    case 'outside':
      return 'Outside the map';
    case 'unknown':
      return 'Not placed on the map yet';
    default:
      return null;
  }
}
