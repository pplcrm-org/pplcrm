import type { Chamber, JurisdictionId, SeatType } from '../../../../../../libs/common/src';
import type { BoundaryGeometryType } from '../../../../../../libs/common/src/lib/schemas/boundaries.schema';
import type { DemoHouseholdDef } from './demo-data-types';

/**
 * Where the demo workspace is, one address book per country.
 *
 * ## Why the coordinates are real and hardcoded
 *
 * Real streets with real coordinates and real seat-area names, so map pins, the "Located" geocode
 * chip and boundary-bounded turf cutting all work at signup with ZERO paid address lookups. That is
 * why the addresses are SHARED across the datasets rather than invented per organization mode: new
 * coordinates cannot be made up, they have to be looked up, and a wrong pair puts a household in
 * the river.
 *
 * ## Why there is more than one pack
 *
 * A campaign in Ohio that signs up and is shown Ottawa ward names has been told, on its first
 * screen, that this product is not for it. So the address book is a PACK, one per country, and
 * signup's answer to "which country" chooses which one is seeded. Every pack exports the SAME site
 * keys, so a dataset's story ("the family that hosts the Tuesday study lives at hh-cooper") is
 * written once and works in either country.
 *
 * A site therefore carries no tags, notes or story — those belong to the dataset using it. A
 * campaign sees a lawn-sign location here; a congregation sees a family that hosts the study.
 *
 * ## Site keys are opaque
 *
 * The keys are named after the Canadian pack's streets ('hh-cooper' for Cooper Street) because that
 * pack came first and every dataset already references them by those names. They are identifiers,
 * not addresses: in the United States pack `hh-cooper` is a house on Morse Avenue in Chicago.
 * Renaming them would touch several thousand lines of story for no gain.
 */

/** The five slots every pack fills, so a dataset can talk about an area without naming a city. */
export const DEMO_AREA_KEYS = ['core', 'west', 'south', 'east', 'southeast'] as const;
export type DemoAreaKey = (typeof DEMO_AREA_KEYS)[number];

/** Addresses a dataset points at that are not households: an event hall, a campaign office. */
export const DEMO_VENUE_KEYS = ['hq', 'park', 'hall', 'annex'] as const;
export type DemoVenueKey = (typeof DEMO_VENUE_KEYS)[number];

/** Where a delivery route starts. Separate from a venue because a route needs real coordinates. */
export const DEMO_ROUTE_START_KEYS = ['west', 'south'] as const;
export type DemoRouteStartKey = (typeof DEMO_ROUTE_START_KEYS)[number];

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
 * They are sample data in a sample workspace, drawn to enclose the demo households of one area and
 * nothing else, which is all turf cutting and the map need. The set they are seeded into says so in
 * its label and its vintage, so nobody can mistake them for the real lines.
 */
export interface DemoPlaceArea {
  /** The real name of the area — 'Somerset', 'Ward 49'. */
  name: string;
  /** The area's own identifier where it has one, else null. */
  code: string | null;
  /** What the demo's pre-cut turf over this area is called. */
  turfName: string;
  ring: readonly (readonly [number, number])[];
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

// ── Canada: Ottawa, Ontario ─────────────────────────────────────────────────────────────────────
// Five City of Ottawa wards. The addresses and coordinates are the ones this file has always
// carried; only their grouping into area slots is new.

const OTTAWA_SITES: readonly HouseholdSite[] = [
  // ── Somerset ward ──
  {
    key: 'hh-cooper',
    street_num: '174',
    street1: 'Cooper Street',
    zip: 'K2P 0E8',
    lat: 45.4136,
    lng: -75.691,
    area: 'core',
    home_phone: '613-555-0221',
  },
  {
    key: 'hh-maclaren',
    street_num: '288',
    street1: 'MacLaren Street',
    zip: 'K2P 0M6',
    lat: 45.4152,
    lng: -75.696,
    area: 'core',
  },
  {
    key: 'hh-frank',
    street_num: '92',
    street1: 'Frank Street',
    zip: 'K2P 0X2',
    lat: 45.4126,
    lng: -75.6875,
    area: 'core',
  },
  {
    key: 'hh-arlington',
    street_num: '41',
    street1: 'Arlington Avenue',
    zip: 'K2P 1C1',
    lat: 45.4079,
    lng: -75.6944,
    area: 'core',
  },
  {
    key: 'hh-gladstone',
    street_num: '356',
    street1: 'Gladstone Avenue',
    zip: 'K2P 0Y9',
    lat: 45.4107,
    lng: -75.6987,
    area: 'core',
  },
  {
    key: 'hh-bay',
    street_num: '145',
    street1: 'Bay Street',
    zip: 'K1R 7T2',
    lat: 45.4155,
    lng: -75.705,
    area: 'core',
    home_phone: '613-555-0244',
  },

  // ── Kitchissippi ward ──
  {
    key: 'hh-byron',
    street_num: '468',
    street1: 'Byron Avenue',
    zip: 'K2A 3G4',
    lat: 45.3925,
    lng: -75.7565,
    area: 'west',
  },
  {
    key: 'hh-kirkwood',
    street_num: '175',
    street1: 'Kirkwood Avenue',
    zip: 'K1Z 8K3',
    lat: 45.394,
    lng: -75.7495,
    area: 'west',
  },
  {
    key: 'hh-java',
    street_num: '33',
    street1: 'Java Street',
    zip: 'K1Y 3L2',
    lat: 45.4028,
    lng: -75.7291,
    area: 'west',
  },
  {
    key: 'hh-armstrong',
    street_num: '245',
    street1: 'Armstrong Street',
    zip: 'K1Y 2W3',
    lat: 45.4046,
    lng: -75.7247,
    area: 'west',
  },
  {
    key: 'hh-huron',
    street_num: '58',
    street1: 'Huron Avenue N',
    zip: 'K1Y 0W8',
    lat: 45.4013,
    lng: -75.7346,
    area: 'west',
  },

  // ── Capital ward ──
  {
    key: 'hh-fifth',
    street_num: '87',
    street1: 'Fifth Avenue',
    zip: 'K1S 2M8',
    lat: 45.4009,
    lng: -75.6926,
    area: 'south',
  },
  {
    key: 'hh-holmwood',
    street_num: '224',
    street1: 'Holmwood Avenue',
    zip: 'K1S 2P4',
    lat: 45.399,
    lng: -75.6858,
    area: 'south',
    home_phone: '613-555-0268',
  },
  {
    key: 'hh-sunnyside',
    street_num: '145',
    street1: 'Sunnyside Avenue',
    zip: 'K1S 0R2',
    lat: 45.3949,
    lng: -75.6812,
    area: 'south',
  },
  {
    key: 'hh-powell',
    street_num: '36',
    street1: 'Powell Avenue',
    zip: 'K1S 2A2',
    lat: 45.4046,
    lng: -75.6949,
    area: 'south',
  },
  {
    key: 'hh-aylmer',
    street_num: '112',
    street1: 'Aylmer Avenue',
    zip: 'K1S 2X6',
    lat: 45.3952,
    lng: -75.6867,
    area: 'south',
  },

  // ── Rideau-Vanier ward ──
  {
    key: 'hh-sweetland',
    street_num: '61',
    street1: 'Sweetland Avenue',
    zip: 'K1N 7T7',
    lat: 45.4266,
    lng: -75.6797,
    area: 'east',
  },
  {
    key: 'hh-marlborough',
    street_num: '128',
    street1: 'Marlborough Avenue',
    zip: 'K1N 8G3',
    lat: 45.4229,
    lng: -75.6752,
    area: 'east',
  },
  {
    key: 'hh-blackburn',
    street_num: '45',
    street1: 'Blackburn Avenue',
    zip: 'K1N 8A4',
    lat: 45.4245,
    lng: -75.6791,
    area: 'east',
  },
  {
    key: 'hh-charlotte',
    street_num: '219',
    street1: 'Charlotte Street',
    zip: 'K1N 8L2',
    lat: 45.4287,
    lng: -75.6832,
    area: 'east',
  },

  // ── Alta Vista ward ──
  {
    key: 'hh-kilborn',
    street_num: '1128',
    street1: 'Kilborn Avenue',
    zip: 'K1H 6L1',
    lat: 45.3867,
    lng: -75.6544,
    area: 'southeast',
  },
  {
    key: 'hh-pleasantpark',
    street_num: '645',
    street1: 'Pleasant Park Road',
    zip: 'K1H 5M2',
    lat: 45.3901,
    lng: -75.6608,
    area: 'southeast',
  },
  {
    key: 'hh-halifax',
    street_num: '88',
    street1: 'Halifax Drive',
    zip: 'K1G 0T6',
    lat: 45.3945,
    lng: -75.6377,
    area: 'southeast',
  },
  {
    key: 'hh-featherston',
    street_num: '1520',
    street1: 'Featherston Drive',
    zip: 'K1H 6P2',
    lat: 45.3846,
    lng: -75.6414,
    area: 'southeast',
  },
  {
    key: 'hh-kilborn-import',
    street_num: '1128',
    street1: 'Kilborn Ave.',
    zip: 'K1H 6L1',
    lat: 45.3867,
    lng: -75.6544,
    area: 'southeast',
  },
];

export const CANADA_PLACE_PACK: PlacePack = {
  country: 'CA',
  countryName: 'Canada',
  city: 'Ottawa',
  state: 'ON',
  phoneAreaCode: '613',
  sites: OTTAWA_SITES,
  areas: {
    core: {
      name: 'Somerset',
      code: '14',
      turfName: 'Centretown core (Somerset)',
      // North edge 45.419 is Rideau-Vanier's south edge: the two rectangles share a line, never
      // an area. (At 45.42 they overlapped in a sliver the product's own boundary validation
      // would flag.) The northernmost core household, hh-bay, sits at 45.4155 — well inside.
      ring: box(-75.71, 45.406, -75.683, 45.419),
    },
    west: {
      name: 'Kitchissippi',
      code: '15',
      turfName: 'Westboro east (Kitchissippi)',
      ring: box(-75.765, 45.386, -75.718, 45.411),
    },
    south: {
      name: 'Capital',
      code: '17',
      turfName: 'The Glebe (Capital)',
      ring: box(-75.7, 45.391, -75.676, 45.406),
    },
    east: {
      name: 'Rideau-Vanier',
      code: '12',
      turfName: 'Sandy Hill (Rideau-Vanier)',
      ring: box(-75.69, 45.419, -75.67, 45.433),
    },
    southeast: {
      name: 'Alta Vista',
      code: '18',
      turfName: 'Alta Vista',
      ring: box(-75.668, 45.38, -75.632, 45.399),
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
//    distance north or south of Madison Street and east or west of State Street, so an address can
//    be placed between two known major-street crossings instead of being guessed at. Every
//    coordinate below is interpolated between crossings whose positions are well established
//    (Madison, North Avenue, Fullerton, Devon, Howard; State, Halsted, Ashland, Damen, Western),
//    which lands each pin on its own block.
//
// The five wards are ones whose territory is a single well-known neighbourhood, and every address
// sits in the middle of that neighbourhood rather than near a ward line, so the ward each household
// is filed under does not depend on where exactly a jagged boundary runs.

const CHICAGO_SITES: readonly HouseholdSite[] = [
  // ── Ward 49 — Rogers Park ──
  {
    key: 'hh-cooper',
    street_num: '1424',
    street1: 'W Morse Avenue',
    zip: '60626',
    lat: 42.0079,
    lng: -87.6668,
    area: 'core',
    home_phone: '773-555-0221',
  },
  {
    key: 'hh-maclaren',
    street_num: '1338',
    street1: 'W Lunt Avenue',
    zip: '60626',
    lat: 42.0096,
    lng: -87.6647,
    area: 'core',
  },
  {
    key: 'hh-frank',
    street_num: '1522',
    street1: 'W Estes Avenue',
    zip: '60626',
    lat: 42.0113,
    lng: -87.6698,
    area: 'core',
  },
  {
    key: 'hh-arlington',
    street_num: '1245',
    street1: 'W Pratt Boulevard',
    zip: '60626',
    lat: 42.0062,
    lng: -87.6621,
    area: 'core',
  },
  {
    key: 'hh-gladstone',
    street_num: '1640',
    street1: 'W Greenleaf Avenue',
    zip: '60626',
    lat: 42.0101,
    lng: -87.6731,
    area: 'core',
  },
  {
    key: 'hh-bay',
    street_num: '1130',
    street1: 'W Touhy Avenue',
    zip: '60626',
    lat: 42.013,
    lng: -87.659,
    area: 'core',
    home_phone: '773-555-0244',
  },

  // ── Ward 43 — Lincoln Park ──
  {
    key: 'hh-byron',
    street_num: '2130',
    street1: 'N Sheffield Avenue',
    zip: '60614',
    lat: 41.9202,
    lng: -87.6522,
    area: 'west',
  },
  {
    key: 'hh-kirkwood',
    street_num: '1042',
    street1: 'W Webster Avenue',
    zip: '60614',
    lat: 41.9215,
    lng: -87.6532,
    area: 'west',
  },
  {
    key: 'hh-java',
    street_num: '2244',
    street1: 'N Orchard Street',
    zip: '60614',
    lat: 41.9223,
    lng: -87.6449,
    area: 'west',
  },
  {
    key: 'hh-armstrong',
    street_num: '840',
    street1: 'W Belden Avenue',
    zip: '60614',
    lat: 41.9235,
    lng: -87.6483,
    area: 'west',
  },
  {
    key: 'hh-huron',
    street_num: '2318',
    street1: 'N Racine Avenue',
    zip: '60614',
    lat: 41.9238,
    lng: -87.6571,
    area: 'west',
  },

  // ── Ward 1 — Wicker Park and Bucktown ──
  {
    key: 'hh-fifth',
    street_num: '1832',
    street1: 'W Le Moyne Street',
    zip: '60622',
    lat: 41.9086,
    lng: -87.6725,
    area: 'south',
  },
  {
    key: 'hh-holmwood',
    street_num: '1657',
    street1: 'N Hermitage Avenue',
    zip: '60622',
    lat: 41.9114,
    lng: -87.6701,
    area: 'south',
    home_phone: '773-555-0268',
  },
  {
    key: 'hh-sunnyside',
    street_num: '2016',
    street1: 'W Evergreen Avenue',
    zip: '60622',
    lat: 41.9056,
    lng: -87.677,
    area: 'south',
  },
  {
    key: 'hh-powell',
    street_num: '1745',
    street1: 'N Wolcott Avenue',
    zip: '60622',
    lat: 41.913,
    lng: -87.6742,
    area: 'south',
  },
  {
    key: 'hh-aylmer',
    street_num: '2140',
    street1: 'W Cortland Street',
    zip: '60647',
    lat: 41.9158,
    lng: -87.68,
    area: 'south',
  },

  // ── Ward 47 — Lincoln Square and Ravenswood ──
  {
    key: 'hh-sweetland',
    street_num: '2136',
    street1: 'W Sunnyside Avenue',
    zip: '60625',
    lat: 41.9632,
    lng: -87.6799,
    area: 'east',
  },
  {
    key: 'hh-marlborough',
    street_num: '4712',
    street1: 'N Hoyne Avenue',
    zip: '60625',
    lat: 41.9671,
    lng: -87.679,
    area: 'east',
  },
  {
    key: 'hh-blackburn',
    street_num: '2244',
    street1: 'W Leland Avenue',
    zip: '60625',
    lat: 41.9669,
    lng: -87.6825,
    area: 'east',
  },
  {
    key: 'hh-charlotte',
    street_num: '4532',
    street1: 'N Paulina Street',
    zip: '60640',
    lat: 41.9638,
    lng: -87.6693,
    area: 'east',
  },

  // ── Ward 25 — Pilsen ──
  {
    key: 'hh-kilborn',
    street_num: '1734',
    street1: 'W 18th Street',
    zip: '60608',
    lat: 41.8583,
    lng: -87.6701,
    area: 'southeast',
  },
  {
    key: 'hh-pleasantpark',
    street_num: '1416',
    street1: 'W 21st Street',
    zip: '60608',
    lat: 41.8538,
    lng: -87.6623,
    area: 'southeast',
  },
  {
    key: 'hh-halifax',
    street_num: '1920',
    street1: 'W Cullerton Street',
    zip: '60608',
    lat: 41.8553,
    lng: -87.6746,
    area: 'southeast',
  },
  {
    key: 'hh-featherston',
    street_num: '1112',
    street1: 'W 19th Street',
    zip: '60608',
    lat: 41.8568,
    lng: -87.6549,
    area: 'southeast',
  },
  {
    key: 'hh-kilborn-import',
    street_num: '1734',
    street1: 'W 18th St.',
    zip: '60608',
    lat: 41.8583,
    lng: -87.6701,
    area: 'southeast',
  },
];

export const UNITED_STATES_PLACE_PACK: PlacePack = {
  country: 'US',
  countryName: 'United States',
  city: 'Chicago',
  state: 'IL',
  phoneAreaCode: '773',
  sites: CHICAGO_SITES,
  areas: {
    core: {
      name: 'Ward 49',
      code: '49',
      turfName: 'Rogers Park east (Ward 49)',
      ring: box(-87.68, 42.001, -87.653, 42.018),
    },
    west: {
      name: 'Ward 43',
      code: '43',
      turfName: 'Lincoln Park west (Ward 43)',
      ring: box(-87.662, 41.918, -87.64, 41.93),
    },
    south: {
      name: 'Ward 1',
      code: '1',
      turfName: 'Wicker Park (Ward 1)',
      ring: box(-87.686, 41.9, -87.665, 41.917),
    },
    east: {
      name: 'Ward 47',
      code: '47',
      turfName: 'Ravenswood (Ward 47)',
      ring: box(-87.69, 41.958, -87.664, 41.972),
    },
    southeast: {
      name: 'Ward 25',
      code: '25',
      turfName: 'Pilsen (Ward 25)',
      ring: box(-87.682, 41.848, -87.648, 41.864),
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

/** Every shared site, with an optional per-key story overlay. */
export function allSites(stories: Record<string, Omit<DemoHouseholdDef, 'key'>> = {}): DemoHouseholdDef[] {
  return SITE_KEYS.map((key) => ({ key, ...(stories[key] ?? {}) }));
}
