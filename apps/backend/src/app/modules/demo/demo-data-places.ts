import type { Chamber, JurisdictionId, SeatType } from '../../../../../../libs/common/src';
import type { BoundaryGeometryType } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import type { DemoHouseholdDef } from './demo-data-types';

/**
 * Where the demo workspace is, one address book per country.
 *
 * ## The shape of the neighbourhood: two dense clusters, every house on the street
 *
 * The demo used to scatter 25 households across five city wards, which made the canvassing pages
 * read as a handful of lonely pins. It now models FOURTEEN residential street segments in TWO
 * tight clusters, with EVERY house on each segment present — a couple of hundred doors packed the
 * way a real field operation sees them, so turfs, walk order and the field report all look like
 * the thing they are demonstrating.
 *
 * The two clusters sit in two different seat areas on purpose (turf cutting never lets a turf
 * span a boundary, and two clusters make that visible). In the Canadian pack they are:
 *
 * - Centretown — Somerset ward (14), which also lies in the federal riding of Ottawa Centre.
 * - Sandy Hill — Rideau-Vanier ward (12), which also lies in the riding of Ottawa—Vanier.
 *
 * So the clusters are in two different wards AND two different ridings, whichever level of
 * boundary a user later uploads.
 *
 * ## Why the coordinates are real and hardcoded
 *
 * Real streets with real coordinates and real seat-area names, so map pins, the "Located" geocode
 * chip and boundary-bounded turf cutting all work at signup with ZERO paid address lookups.
 * Individual houses are interpolated along each street segment between anchor coordinates that
 * were looked up once (the same technique the Chicago pack has always used: place an address
 * between two known crossings). Odd and even house numbers are nudged to opposite sides of the
 * street line, so a street reads as two facing rows of doors on the map. A wrong anchor would put
 * a household in the river, which is why anchors are never invented, only carried forward.
 *
 * ## Why there is more than one pack
 *
 * A campaign in Ohio that signs up and is shown Ottawa ward names has been told, on its first
 * screen, that this product is not for it. So the address book is a PACK, one per country, and
 * signup's answer to "which country" chooses which one is seeded. Every pack carries the SAME
 * streets (by key) with the SAME number of houses, so a dataset's story ("the family that hosts
 * the Tuesday study lives at hh-cooper") is written once and works in either country.
 *
 * A site therefore carries no tags, notes or story — those belong to the dataset using it. A
 * campaign sees a lawn-sign location here; a congregation sees a family that hosts the study.
 *
 * ## Site keys are opaque
 *
 * Generated houses are keyed `<street>-h<NN>` ('st-cooper-h07') and the 25 story households keep
 * their historical keys ('hh-cooper'), because every dataset already references them by those
 * names. They are identifiers, not addresses: in the United States pack `hh-cooper` is a house on
 * Morse Avenue in Chicago. Renaming them would touch several thousand lines of story for no gain.
 */

/** The two clusters. Every street, house and pre-cut turf lives in exactly one of them. */
export const DEMO_AREA_KEYS = ['core', 'east'] as const;
export type DemoAreaKey = (typeof DEMO_AREA_KEYS)[number];

/** Addresses a dataset points at that are not households: an event hall, a campaign office. */
export const DEMO_VENUE_KEYS = ['hq', 'park', 'hall', 'annex'] as const;
export type DemoVenueKey = (typeof DEMO_VENUE_KEYS)[number];

/** Where a delivery route starts. Separate from a venue because a route needs real coordinates. */
export const DEMO_ROUTE_START_KEYS = ['west', 'south'] as const;
export type DemoRouteStartKey = (typeof DEMO_ROUTE_START_KEYS)[number];

// ── The streets ─────────────────────────────────────────────────────────────────────────────────

/**
 * The country-agnostic street list: an opaque key, which cluster it is in, and how many houses it
 * carries. Both packs must realize every entry with the same house count — that is what keeps the
 * generated site keys identical across countries, and the pack-parity test in
 * `demo-datasets.spec.ts` holds it.
 */
export const DEMO_STREET_SPECS = [
  // ── Cluster one: 'core' ──
  { key: 'st-cooper', area: 'core', houses: 20 },
  { key: 'st-maclaren', area: 'core', houses: 20 },
  { key: 'st-frank', area: 'core', houses: 16 },
  { key: 'st-arlington', area: 'core', houses: 18 },
  { key: 'st-gladstone', area: 'core', houses: 20 },
  { key: 'st-bay', area: 'core', houses: 16 },
  { key: 'st-james', area: 'core', houses: 18 },
  { key: 'st-percy', area: 'core', houses: 16 },
  // ── Cluster two: 'east' ──
  { key: 'st-sweetland', area: 'east', houses: 18 },
  { key: 'st-blackburn', area: 'east', houses: 16 },
  { key: 'st-charlotte', area: 'east', houses: 18 },
  { key: 'st-marlborough', area: 'east', houses: 16 },
  { key: 'st-russell', area: 'east', houses: 20 },
  { key: 'st-goulburn', area: 'east', houses: 16 },
] as const satisfies readonly { key: string; area: DemoAreaKey; houses: number }[];

export type DemoStreetKey = (typeof DEMO_STREET_SPECS)[number]['key'];
export const DEMO_STREET_KEYS: readonly DemoStreetKey[] = DEMO_STREET_SPECS.map((s) => s.key);

/**
 * Which generated house each legacy story key names, by street and house index.
 *
 * The 25 story keys predate the dense streets: every dataset references households like
 * 'hh-cooper' by name, so those keys must keep existing. Each one is now an alias for one house
 * of one street; the builder below emits the story key in place of the generated key at that
 * position. `phoneLocal` is the site's landline without an area code — the pack prepends its own,
 * so a Chicago workspace never opens on a page of 613 numbers.
 */
const STORY_SITES: Readonly<Record<string, { street: DemoStreetKey; index: number; phoneLocal?: string }>> = {
  'hh-cooper': { street: 'st-cooper', index: 14, phoneLocal: '555-0143' },
  'hh-fifth': { street: 'st-cooper', index: 5 },
  'hh-maclaren': { street: 'st-maclaren', index: 14 },
  'hh-holmwood': { street: 'st-maclaren', index: 6, phoneLocal: '555-0149' },
  'hh-frank': { street: 'st-frank', index: 10 },
  'hh-aylmer': { street: 'st-frank', index: 3 },
  'hh-arlington': { street: 'st-arlington', index: 12 },
  'hh-powell': { street: 'st-arlington', index: 5 },
  'hh-gladstone': { street: 'st-gladstone', index: 12 },
  'hh-sunnyside': { street: 'st-gladstone', index: 4 },
  'hh-bay': { street: 'st-bay', index: 8, phoneLocal: '555-0148' },
  'hh-huron': { street: 'st-bay', index: 2 },
  'hh-byron': { street: 'st-james', index: 3 },
  'hh-kirkwood': { street: 'st-james', index: 12 },
  'hh-java': { street: 'st-percy', index: 5 },
  'hh-armstrong': { street: 'st-percy', index: 11 },
  'hh-sweetland': { street: 'st-sweetland', index: 14 },
  'hh-featherston': { street: 'st-sweetland', index: 4 },
  'hh-blackburn': { street: 'st-blackburn', index: 10 },
  'hh-charlotte': { street: 'st-charlotte', index: 10 },
  'hh-marlborough': { street: 'st-marlborough', index: 10 },
  'hh-kilborn': { street: 'st-russell', index: 8 },
  'hh-pleasantpark': { street: 'st-russell', index: 15 },
  'hh-halifax': { street: 'st-goulburn', index: 6 },
};

/**
 * The March-CSV duplicate twin: the same house as `hh-kilborn`, re-entered with an abbreviated
 * street spelling so the address fingerprints match and the duplicates sweep groups the pair.
 * Appended by the site builder as a 25th story household rather than generated from a street,
 * because it deliberately is NOT another door — turfs and street helpers exclude it.
 */
const IMPORT_TWIN_KEY = 'hh-kilborn-import';
const IMPORT_TWIN_OF = 'hh-kilborn';

const storyKeyByPosition = new Map<string, string>(
  Object.entries(STORY_SITES).map(([key, slot]) => [`${slot.street}#${slot.index}`, key]),
);

/** One house of one street, before a pack gives it a country: the shared, key-stable skeleton. */
export interface DemoHouse {
  key: string;
  street: DemoStreetKey;
  area: DemoAreaKey;
  /** Position along the street, 0-based. The pack's numbering turns it into a house number. */
  index: number;
  /** True when this house is one of the 25 legacy story households. */
  story: boolean;
}

/** Every house of every street, in seeding order. Does NOT include the import twin. */
export const DEMO_HOUSES: readonly DemoHouse[] = DEMO_STREET_SPECS.flatMap((spec) =>
  Array.from({ length: spec.houses }, (_, index): DemoHouse => {
    const storyKey = storyKeyByPosition.get(`${spec.key}#${index}`);
    return {
      key: storyKey ?? `${spec.key}-h${String(index + 1).padStart(2, '0')}`,
      street: spec.key,
      area: spec.area,
      index,
      story: storyKey != null,
    };
  }),
);

/** The door list of one or more streets: every house key, in walking order. No import twin. */
export function housesOn(...streets: DemoStreetKey[]): string[] {
  return DEMO_HOUSES.filter((h) => streets.includes(h.street)).map((h) => h.key);
}

export interface HouseholdSite {
  key: string;
  street_num: string;
  street1: string;
  zip: string;
  lat: number;
  lng: number;
  /** Which of the pack's areas this address sits in. */
  area: DemoAreaKey;
  home_phone?: string;
}

/**
 * One seat area of the pack's city, with an outline the demo can cut turfs against.
 *
 * `ring` is a GeoJSON linear ring — [longitude, latitude] pairs, first point repeated as the last.
 * The rings are deliberately simple rectangles, and they are NOT the city's official boundaries.
 * They are sample data in a sample workspace, drawn to enclose the demo households of one cluster
 * and nothing else, which is all turf cutting and the map need. The set they are seeded into says
 * so in its label and its vintage, so nobody can mistake them for the real lines.
 */
export interface DemoPlaceArea {
  /** The real name of the area — 'Somerset', 'Ward 49'. */
  name: string;
  /** The area's own identifier where it has one, else null. */
  code: string | null;
  ring: readonly (readonly [number, number])[];
}

/**
 * One street segment as a pack realizes it: a real name, a postal code, and the coordinates of
 * its first and last house. Every house in between is interpolated on the line — `start` is house
 * index 0 (number `firstNum`) and `end` is the last house (`firstNum + (houses-1) * numStep`).
 * Both endpoints are [longitude, latitude], matching the GeoJSON order used everywhere else here.
 */
export interface PackStreet {
  name: string;
  /** The bare name turf names are built from: 'Cooper', 'Morse'. */
  shortName: string;
  zip: string;
  firstNum: number;
  /** House-number increment between neighbours: 1 in Ottawa, 7 in Chicago's block grid. */
  numStep: number;
  start: readonly [number, number];
  end: readonly [number, number];
}

export interface DemoVenue {
  line1: string;
  zip: string;
}

export interface DemoRouteStart extends DemoVenue {
  lat: number;
  lng: number;
}

/**
 * The office the demo campaign contests.
 *
 * Both electoral demo datasets depict a sitting council member and the campaign to hold that seat
 * (see `demo-data-office.ts`), so the jurisdiction is the local one in both countries. The demo
 * seeder writes these onto the workspace's office campaign only when signup left it undeclared —
 * an answer the user actually gave is never overwritten.
 */
export interface DemoOffice {
  jurisdiction: JurisdictionId;
  office_region: string | null;
  office_locality: string | null;
  chamber: Chamber | null;
  seat_type: SeatType;
  seat_name: string | null;
  seat_label_override: string | null;
  office_title: string | null;
}

/** How the pack's areas are seeded as a `boundary_sets` row. */
export interface DemoBoundarySet {
  slug: string;
  label: string;
  vintage: string;
}

export interface PlacePack {
  /** ISO country code. The value signup's chosen jurisdiction resolves to. */
  country: 'CA' | 'US';
  /** Written to `households.country`. */
  countryName: string;
  city: string;
  /** Province or state code, written to `households.state`. */
  state: string;
  /** The area code every demo phone number in this pack uses, with the fictional 555 exchange. */
  phoneAreaCode: string;
  streets: Readonly<Record<DemoStreetKey, PackStreet>>;
  sites: readonly HouseholdSite[];
  areas: Readonly<Record<DemoAreaKey, DemoPlaceArea>>;
  venues: Readonly<Record<DemoVenueKey, DemoVenue>>;
  routeStarts: Readonly<Record<DemoRouteStartKey, DemoRouteStart>>;
  boundarySet: DemoBoundarySet;
  office: DemoOffice;
  /**
   * Whether this pack's workspaces can be seeded with official donation receipts.
   *
   * Only Canada. Every receipt regime the product implements is Canadian (the CRA charity regime
   * and the four political ones), because United States political contributions are not
   * tax-deductible and there is no US charity regime built yet. Seeding a Canada Revenue Agency
   * receipt over a Chicago address would be a false document on a user's first screen.
   */
  seedsReceipts: boolean;
}

/** A closed rectangular ring in GeoJSON order: [longitude, latitude], first point repeated last. */
function box(minLng: number, minLat: number, maxLng: number, maxLat: number): readonly (readonly [number, number])[] {
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
}

/** 'Russell Avenue' → 'Russell Ave.' — the spelling the March-CSV duplicate twin came in with. */
function abbreviateStreetType(name: string): string {
  return name
    .replace(/Avenue$/, 'Ave.')
    .replace(/Street$/, 'St.')
    .replace(/Boulevard$/, 'Blvd.');
}

/** How far odd and even houses sit from the street line, in degrees (~9 m). */
const SIDE_OFFSET_DEG = 0.00008;

/**
 * Every house of every street for one pack, in the shared `DEMO_HOUSES` order, with the import
 * twin appended. Interpolates each house along its street segment and nudges odd and even numbers
 * to opposite sides of the line, so the map draws two facing rows of doors instead of a string of
 * pins in the middle of the road.
 */
function buildSites(
  streets: Readonly<Record<DemoStreetKey, PackStreet>>,
  phoneAreaCode: string,
): readonly HouseholdSite[] {
  const specByKey = new Map(DEMO_STREET_SPECS.map((s) => [s.key, s]));
  const sites = DEMO_HOUSES.map((house): HouseholdSite => {
    const street = streets[house.street];
    const spec = specByKey.get(house.street);
    if (!spec) throw new Error(`Demo street "${house.street}" has no spec`);
    const t = house.index / (spec.houses - 1);
    const num = street.firstNum + house.index * street.numStep;
    const dLng = street.end[0] - street.start[0];
    const dLat = street.end[1] - street.start[1];
    const len = Math.hypot(dLng, dLat) || 1;
    // Unit perpendicular to the street line; odd numbers on one side, even on the other.
    const side = num % 2 === 0 ? 1 : -1;
    const lng = street.start[0] + t * dLng + side * SIDE_OFFSET_DEG * (-dLat / len);
    const lat = street.start[1] + t * dLat + side * SIDE_OFFSET_DEG * (dLng / len);
    const phoneLocal = STORY_SITES[house.key]?.phoneLocal;
    return {
      key: house.key,
      street_num: String(num),
      street1: street.name,
      zip: street.zip,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      area: house.area,
      ...(phoneLocal ? { home_phone: `${phoneAreaCode}-${phoneLocal}` } : {}),
    };
  });

  const twinOf = sites.find((s) => s.key === IMPORT_TWIN_OF);
  if (!twinOf) throw new Error(`Import twin base "${IMPORT_TWIN_OF}" is not among the story sites`);
  return [
    ...sites,
    {
      ...twinOf,
      key: IMPORT_TWIN_KEY,
      street1: abbreviateStreetType(twinOf.street1),
      // The twin never carries the landline — a CSV import would not have brought one.
      home_phone: undefined,
    },
  ];
}

// ── Canada: Ottawa, Ontario ─────────────────────────────────────────────────────────────────────
//
// Cluster one is Centretown (Somerset ward — federal riding Ottawa Centre). Cluster two is Sandy
// Hill (Rideau-Vanier ward — riding Ottawa—Vanier). Segment endpoints are derived from
// OpenStreetMap address points (surveyed buildings carrying these exact house numbers), looked up
// 2026-08-10: for each street, two real buildings bracketing the demo's number range define the
// line, and the first/last house positions are interpolated on it in number space. Where OSM
// coverage bracketed the range too tightly to spread the houses (a block face of large buildings),
// the segment is stretched symmetrically to at least ~3 m per house so pins don't heap. A user who
// checks a pin against the live map must find it on the right block of the right street.
// The earlier endpoints (before this lookup) placed several streets hundreds of metres off —
// Arlington and James sat on top of the Queensway — which is exactly the "household in the river"
// failure this comment block warns about. Anchors are looked up, never invented.

const OTTAWA_STREETS: Readonly<Record<DemoStreetKey, PackStreet>> = {
  'st-cooper': {
    name: 'Cooper Street',
    shortName: 'Cooper',
    zip: 'K2P 0E8',
    firstNum: 160,
    numStep: 1,
    start: [-75.689365, 45.418944],
    end: [-75.690044, 45.418623],
  },
  'st-maclaren': {
    name: 'MacLaren Street',
    shortName: 'MacLaren',
    zip: 'K2P 0M6',
    firstNum: 274,
    numStep: 1,
    start: [-75.692881, 45.416218],
    end: [-75.69348, 45.415827],
  },
  'st-frank': {
    name: 'Frank Street',
    shortName: 'Frank',
    zip: 'K2P 0X2',
    firstNum: 82,
    numStep: 1,
    start: [-75.684496, 45.416649],
    end: [-75.685078, 45.416439],
  },
  'st-arlington': {
    name: 'Arlington Avenue',
    shortName: 'Arlington',
    zip: 'K2P 1C1',
    firstNum: 29,
    numStep: 1,
    start: [-75.693542, 45.409903],
    end: [-75.69415, 45.409611],
  },
  'st-gladstone': {
    name: 'Gladstone Avenue',
    shortName: 'Gladstone',
    zip: 'K2P 0Y9',
    firstNum: 344,
    numStep: 1,
    start: [-75.692622, 45.412337],
    end: [-75.693234, 45.411685],
  },
  'st-bay': {
    name: 'Bay Street',
    shortName: 'Bay',
    zip: 'K1R 7T2',
    firstNum: 137,
    numStep: 1,
    start: [-75.706326, 45.418316],
    end: [-75.705811, 45.417989],
  },
  'st-james': {
    name: 'James Street',
    shortName: 'James',
    zip: 'K1R 5M6',
    firstNum: 150,
    numStep: 1,
    start: [-75.699496, 45.411214],
    end: [-75.700433, 45.411205],
  },
  'st-percy': {
    name: 'Percy Street',
    shortName: 'Percy',
    zip: 'K1R 7V3',
    firstNum: 508,
    numStep: 1,
    start: [-75.6948, 45.40165],
    end: [-75.694193, 45.400897],
  },
  'st-sweetland': {
    name: 'Sweetland Avenue',
    shortName: 'Sweetland',
    zip: 'K1N 7T7',
    firstNum: 47,
    numStep: 1,
    start: [-75.678934, 45.425482],
    end: [-75.678545, 45.425037],
  },
  'st-blackburn': {
    name: 'Blackburn Avenue',
    shortName: 'Blackburn',
    zip: 'K1N 8A4',
    firstNum: 35,
    numStep: 1,
    start: [-75.676413, 45.426478],
    end: [-75.675809, 45.425862],
  },
  'st-charlotte': {
    name: 'Charlotte Street',
    shortName: 'Charlotte',
    zip: 'K1N 8L2',
    firstNum: 209,
    numStep: 1,
    start: [-75.675325, 45.431941],
    end: [-75.674845, 45.431416],
  },
  'st-marlborough': {
    name: 'Marlborough Avenue',
    shortName: 'Marlborough',
    zip: 'K1N 8G3',
    firstNum: 118,
    numStep: 1,
    start: [-75.672516, 45.425294],
    end: [-75.671881, 45.424621],
  },
  'st-russell': {
    name: 'Russell Avenue',
    shortName: 'Russell',
    zip: 'K1N 7X1',
    firstNum: 150,
    numStep: 1,
    start: [-75.676354, 45.423268],
    end: [-75.675884, 45.422798],
  },
  'st-goulburn': {
    name: 'Goulburn Avenue',
    shortName: 'Goulburn',
    zip: 'K1N 8C7',
    firstNum: 96,
    numStep: 1,
    start: [-75.674225, 45.426012],
    end: [-75.673896, 45.425615],
  },
};

export const CANADA_PLACE_PACK: PlacePack = {
  country: 'CA',
  countryName: 'Canada',
  city: 'Ottawa',
  state: 'ON',
  phoneAreaCode: '613',
  streets: OTTAWA_STREETS,
  sites: buildSites(OTTAWA_STREETS, '613'),
  areas: {
    core: {
      name: 'Somerset',
      code: '14',
      // North edge 45.421 is Rideau-Vanier's south edge: the two rectangles share a line, never
      // an area — overlapping features would trip the product's own boundary validation. The south
      // edge reaches 45.399 because Percy Street's real 500-block sits below the Queensway.
      ring: box(-75.712, 45.399, -75.683, 45.421),
    },
    east: {
      name: 'Rideau-Vanier',
      code: '12',
      ring: box(-75.69, 45.421, -75.669, 45.434),
    },
  },
  venues: {
    hq: { line1: '1064 Wellington Street West', zip: 'K1Y 2Y3' },
    park: { line1: '100 Brewer Way', zip: 'K1S 5T1' },
    hall: { line1: '211 Hope Street', zip: 'K1N 7B4' },
    annex: { line1: '340 Somerset Street West', zip: 'K2P 0J9' },
  },
  routeStarts: {
    west: { line1: '1064 Wellington Street West', zip: 'K1Y 2Y3', lat: 45.4012, lng: -75.7196 },
    south: { line1: '175 Third Avenue', zip: 'K1S 2K2', lat: 45.4009, lng: -75.6889 },
  },
  boundarySet: {
    slug: 'demo-ottawa-wards',
    label: 'Ottawa wards (sample outlines)',
    vintage: 'Sample demo data — approximate outlines, not the official ward boundaries',
  },
  office: {
    jurisdiction: 'ca_municipal',
    office_region: 'ON',
    office_locality: 'Ottawa',
    chamber: null,
    seat_type: 'district',
    seat_name: 'Somerset',
    // 'Ward' is already what ca_municipal says, so there is nothing to override.
    seat_label_override: null,
    office_title: 'Councillor',
  },
  seedsReceipts: true,
};

// ── United States: Chicago, Illinois ────────────────────────────────────────────────────────────
//
// WHY CHICAGO. Two things had to be true of the US city, and few cities give both.
//
// 1. The seat areas a council member holds are called WARDS, exactly what the Canadian pack already
//    models, so the demo story — a ward council member, ward-bounded turfs, a ward coverage report
//    — transfers with no distortion at all.
// 2. Chicago's street grid is a published linear coordinate system: every address states its
//    distance north or south of Madison Street and east or west of State Street. Segment endpoints
//    are fitted to OpenStreetMap address points (surveyed buildings on these streets, looked up
//    2026-08-10) rather than computed from the grid alone — the fitted lines agree with the grid
//    to a few tens of metres, which the pure arithmetic the file previously carried did not always
//    manage. House numbers advance by 7 per door — Chicago allots ~100 address units per 200 m
//    block, so neighbouring lots are several units apart, and an odd step keeps the numbers
//    alternating between the two sides of the street.
//
// Cluster one is Rogers Park (Ward 49), cluster two is Ravenswood / Lincoln Square (Ward 47) —
// each a single well-known neighbourhood, every address in the middle of it rather than near a
// ward line, so the ward each household is filed under does not depend on where exactly a jagged
// boundary runs.

const CHICAGO_STREETS: Readonly<Record<DemoStreetKey, PackStreet>> = {
  'st-cooper': {
    name: 'W Morse Avenue',
    shortName: 'Morse',
    zip: '60626',
    firstNum: 1354,
    numStep: 7,
    start: [-87.66557, 42.008118],
    end: [-87.668129, 42.007771],
  },
  'st-maclaren': {
    name: 'W Lunt Avenue',
    shortName: 'Lunt',
    zip: '60626',
    firstNum: 1240,
    numStep: 7,
    start: [-87.663454, 42.009363],
    end: [-87.665922, 42.008979],
  },
  'st-frank': {
    name: 'W Estes Avenue',
    shortName: 'Estes',
    zip: '60626',
    firstNum: 1452,
    numStep: 7,
    start: [-87.667576, 42.011567],
    end: [-87.669752, 42.011569],
  },
  'st-arlington': {
    name: 'W Pratt Boulevard',
    shortName: 'Pratt',
    zip: '60626',
    firstNum: 1161,
    numStep: 7,
    start: [-87.660412, 42.005348],
    end: [-87.663477, 42.005397],
  },
  'st-gladstone': {
    name: 'W Greenleaf Avenue',
    shortName: 'Greenleaf',
    zip: '60626',
    firstNum: 1556,
    numStep: 7,
    start: [-87.669586, 42.010234],
    end: [-87.672459, 42.009997],
  },
  'st-bay': {
    name: 'W Touhy Avenue',
    shortName: 'Touhy',
    zip: '60626',
    firstNum: 1074,
    numStep: 7,
    start: [-87.65849, 42.012113],
    end: [-87.661025, 42.01222],
  },
  'st-james': {
    name: 'W Farwell Avenue',
    shortName: 'Farwell',
    zip: '60626',
    firstNum: 1300,
    numStep: 7,
    start: [-87.664296, 42.006808],
    end: [-87.66683, 42.006982],
  },
  'st-percy': {
    name: 'N Greenview Avenue',
    shortName: 'Greenview',
    zip: '60626',
    firstNum: 6808,
    numStep: 7,
    start: [-87.667812, 42.005877],
    end: [-87.667839, 42.007556],
  },
  'st-sweetland': {
    name: 'N Hoyne Avenue',
    shortName: 'Hoyne',
    zip: '60625',
    firstNum: 4614,
    numStep: 7,
    start: [-87.68148, 41.965683],
    end: [-87.681537, 41.967873],
  },
  'st-blackburn': {
    name: 'N Seeley Avenue',
    shortName: 'Seeley',
    zip: '60625',
    firstNum: 4514,
    numStep: 7,
    start: [-87.680628, 41.963902],
    end: [-87.680748, 41.965838],
  },
  'st-charlotte': {
    name: 'N Paulina Street',
    shortName: 'Paulina',
    zip: '60640',
    firstNum: 4462,
    numStep: 7,
    start: [-87.670846, 41.963095],
    end: [-87.671208, 41.965296],
  },
  'st-marlborough': {
    name: 'W Leland Avenue',
    shortName: 'Leland',
    zip: '60625',
    firstNum: 2174,
    numStep: 7,
    start: [-87.683467, 41.966857],
    end: [-87.686885, 41.966815],
  },
  'st-russell': {
    name: 'W Sunnyside Avenue',
    shortName: 'Sunnyside',
    zip: '60625',
    firstNum: 2080,
    numStep: 7,
    start: [-87.680091, 41.963357],
    end: [-87.684895, 41.963134],
  },
  'st-goulburn': {
    name: 'W Eastwood Avenue',
    shortName: 'Eastwood',
    zip: '60625',
    firstNum: 2100,
    numStep: 7,
    start: [-87.681004, 41.965996],
    end: [-87.684429, 41.965915],
  },
};

export const UNITED_STATES_PLACE_PACK: PlacePack = {
  country: 'US',
  countryName: 'United States',
  city: 'Chicago',
  state: 'IL',
  phoneAreaCode: '773',
  streets: CHICAGO_STREETS,
  sites: buildSites(CHICAGO_STREETS, '773'),
  areas: {
    core: {
      name: 'Ward 49',
      code: '49',
      ring: box(-87.685, 42.0, -87.653, 42.02),
    },
    east: {
      name: 'Ward 47',
      code: '47',
      ring: box(-87.69, 41.954, -87.664, 41.974),
    },
  },
  venues: {
    hq: { line1: '1120 West Fullerton Avenue', zip: '60614' },
    park: { line1: '1425 North Damen Avenue', zip: '60622' },
    hall: { line1: '2233 West Irving Park Road', zip: '60618' },
    annex: { line1: '1701 West 18th Street', zip: '60608' },
  },
  routeStarts: {
    west: { line1: '1120 West Fullerton Avenue', zip: '60614', lat: 41.9254, lng: -87.6551 },
    south: { line1: '1701 North Damen Avenue', zip: '60647', lat: 41.9122, lng: -87.6766 },
  },
  boundarySet: {
    slug: 'demo-chicago-wards',
    label: 'Chicago wards (sample outlines)',
    vintage: 'Sample demo data — approximate outlines, not the official ward boundaries',
  },
  office: {
    jurisdiction: 'us_local',
    office_region: 'IL',
    office_locality: 'Chicago',
    chamber: null,
    seat_type: 'district',
    seat_name: 'Ward 49',
    // The us_local default word is "Council district"; Chicago says "Ward" for the same thing.
    seat_label_override: 'Ward',
    // Chicago's council members are titled Alderman — the us_local officeTitles list carries it.
    office_title: 'Alderman',
  },
  seedsReceipts: false,
};

/**
 * Every pack, by country code.
 *
 * A TOTAL record over the two countries the jurisdiction registry models, so adding a country there
 * is a compile error here until someone decides what its demo city is — rather than that country's
 * campaigns quietly being shown another country's streets.
 */
export const PLACE_PACKS: Record<'CA' | 'US', PlacePack> = {
  CA: CANADA_PLACE_PACK,
  US: UNITED_STATES_PLACE_PACK,
};

/**
 * The pack a workspace with no declared country gets.
 *
 * Signup's office step is skippable, and a campaign that skipped it has jurisdiction 'other', whose
 * country is null. There is no other signal to read — the workspace's data region is a hosting
 * preference and deliberately not the campaign's country — so the fallback is Canada, and it is a
 * fallback rather than a guess.
 */
export const DEFAULT_PLACE_PACK = CANADA_PLACE_PACK;

/** The pack for a country code, falling back to {@link DEFAULT_PLACE_PACK} for anything else. */
export function placePackForCountry(country: string | null | undefined): PlacePack {
  if (country === 'CA') return PLACE_PACKS.CA;
  if (country === 'US') return PLACE_PACKS.US;
  return DEFAULT_PLACE_PACK;
}

/** The site keys every pack must carry, in the order the demo households are seeded. */
export const SITE_KEYS: readonly string[] = DEFAULT_PLACE_PACK.sites.map((s) => s.key);

const DEFAULT_SITE_KEYS = new Set(SITE_KEYS);

/**
 * The 25 legacy story household keys, in their historical order — the households the hand-written
 * datasets tell stories about. The non-electoral datasets seed ONLY these (a food bank does not
 * need every door on fourteen streets); the electoral datasets seed every house.
 */
export const STORY_HOUSEHOLD_KEYS: readonly string[] = [
  'hh-cooper',
  'hh-maclaren',
  'hh-frank',
  'hh-arlington',
  'hh-gladstone',
  'hh-bay',
  'hh-byron',
  'hh-kirkwood',
  'hh-java',
  'hh-armstrong',
  'hh-huron',
  'hh-fifth',
  'hh-holmwood',
  'hh-sunnyside',
  'hh-powell',
  'hh-aylmer',
  'hh-sweetland',
  'hh-marlborough',
  'hh-blackburn',
  'hh-charlotte',
  'hh-kilborn',
  'hh-pleasantpark',
  'hh-halifax',
  'hh-featherston',
  IMPORT_TWIN_KEY,
];

/** One pack's sites by key, for the seeder to bind a story to a place. */
export function sitesByKey(pack: PlacePack): Map<string, HouseholdSite> {
  return new Map(pack.sites.map((s) => [s.key, s]));
}

/**
 * The GeoJSON geometry for one area's outline.
 *
 * Built here rather than stored in the pack so the ring is written once, as coordinates, and the
 * Polygon wrapper cannot drift between the two packs.
 */
export function areaGeometry(area: DemoPlaceArea): BoundaryGeometryType {
  return { type: 'Polygon', coordinates: [area.ring.map(([lng, lat]) => [lng, lat] as [number, number])] };
}

/**
 * A household at one of the shared sites, with this dataset's own story layered on.
 * Throws on an unknown key so a typo is a failed test run, not a household that never appears.
 */
export function at(key: string, story: Omit<DemoHouseholdDef, 'key'> = {}): DemoHouseholdDef {
  if (!DEFAULT_SITE_KEYS.has(key)) {
    throw new Error(`Unknown household site "${key}" — see the place packs in demo-data-places.ts`);
  }
  return { key, ...story };
}

/** Every house on every street — the electoral datasets' address book — with story overlays. */
export function allSites(stories: Record<string, Omit<DemoHouseholdDef, 'key'>> = {}): DemoHouseholdDef[] {
  return SITE_KEYS.map((key) => ({ key, ...(stories[key] ?? {}) }));
}

/** Only the 25 story households — the address book for datasets that do not canvass streets. */
export function storyHouseholds(stories: Record<string, Omit<DemoHouseholdDef, 'key'>> = {}): DemoHouseholdDef[] {
  return STORY_HOUSEHOLD_KEYS.map((key) => ({ key, ...(stories[key] ?? {}) }));
}
