import type { DemoHouseholdDef } from './demo-data-types';

/**
 * The shared, narrative-free address book every demo dataset builds its households from.
 *
 * Real Ottawa streets with real coordinates and real ward names, so map pins, the "Located"
 * geocode chip and ward-bounded turf cutting all work with zero Google API calls at signup. That
 * is precisely why the addresses are SHARED rather than invented per organization mode: new
 * coordinates cannot be made up, they have to be geocoded, and a wrong pair puts a household in
 * the river.
 *
 * A site carries no tags, notes or story — those belong to the dataset using it. A campaign sees
 * a lawn-sign location here; a congregation sees a family that hosts the Tuesday study.
 */
export interface HouseholdSite {
  key: string;
  street_num: string;
  street1: string;
  zip: string;
  lat: number;
  lng: number;
  ward: string;
  home_phone?: string;
}

export const DEMO_CITY = 'Ottawa';
export const DEMO_STATE = 'ON';
export const DEMO_COUNTRY = 'Canada';

export const HOUSEHOLD_SITES: readonly HouseholdSite[] = [
  // ── Somerset ward ──
  {
    key: 'hh-cooper',
    street_num: '174',
    street1: 'Cooper Street',
    zip: 'K2P 0E8',
    lat: 45.4136,
    lng: -75.691,
    ward: 'Somerset',
    home_phone: '613-555-0221',
  },
  {
    key: 'hh-maclaren',
    street_num: '288',
    street1: 'MacLaren Street',
    zip: 'K2P 0M6',
    lat: 45.4152,
    lng: -75.696,
    ward: 'Somerset',
  },
  {
    key: 'hh-frank',
    street_num: '92',
    street1: 'Frank Street',
    zip: 'K2P 0X2',
    lat: 45.4126,
    lng: -75.6875,
    ward: 'Somerset',
  },
  {
    key: 'hh-arlington',
    street_num: '41',
    street1: 'Arlington Avenue',
    zip: 'K2P 1C1',
    lat: 45.4079,
    lng: -75.6944,
    ward: 'Somerset',
  },
  {
    key: 'hh-gladstone',
    street_num: '356',
    street1: 'Gladstone Avenue',
    zip: 'K2P 0Y9',
    lat: 45.4107,
    lng: -75.6987,
    ward: 'Somerset',
  },
  {
    key: 'hh-bay',
    street_num: '145',
    street1: 'Bay Street',
    zip: 'K1R 7T2',
    lat: 45.4155,
    lng: -75.705,
    ward: 'Somerset',
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
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-kirkwood',
    street_num: '175',
    street1: 'Kirkwood Avenue',
    zip: 'K1Z 8K3',
    lat: 45.394,
    lng: -75.7495,
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-java',
    street_num: '33',
    street1: 'Java Street',
    zip: 'K1Y 3L2',
    lat: 45.4028,
    lng: -75.7291,
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-armstrong',
    street_num: '245',
    street1: 'Armstrong Street',
    zip: 'K1Y 2W3',
    lat: 45.4046,
    lng: -75.7247,
    ward: 'Kitchissippi',
  },
  {
    key: 'hh-huron',
    street_num: '58',
    street1: 'Huron Avenue N',
    zip: 'K1Y 0W8',
    lat: 45.4013,
    lng: -75.7346,
    ward: 'Kitchissippi',
  },

  // ── Capital ward ──
  {
    key: 'hh-fifth',
    street_num: '87',
    street1: 'Fifth Avenue',
    zip: 'K1S 2M8',
    lat: 45.4009,
    lng: -75.6926,
    ward: 'Capital',
  },
  {
    key: 'hh-holmwood',
    street_num: '224',
    street1: 'Holmwood Avenue',
    zip: 'K1S 2P4',
    lat: 45.399,
    lng: -75.6858,
    ward: 'Capital',
    home_phone: '613-555-0268',
  },
  {
    key: 'hh-sunnyside',
    street_num: '145',
    street1: 'Sunnyside Avenue',
    zip: 'K1S 0R2',
    lat: 45.3949,
    lng: -75.6812,
    ward: 'Capital',
  },
  {
    key: 'hh-powell',
    street_num: '36',
    street1: 'Powell Avenue',
    zip: 'K1S 2A2',
    lat: 45.4046,
    lng: -75.6949,
    ward: 'Capital',
  },
  {
    key: 'hh-aylmer',
    street_num: '112',
    street1: 'Aylmer Avenue',
    zip: 'K1S 2X6',
    lat: 45.3952,
    lng: -75.6867,
    ward: 'Capital',
  },

  // ── Rideau-Vanier ward ──
  {
    key: 'hh-sweetland',
    street_num: '61',
    street1: 'Sweetland Avenue',
    zip: 'K1N 7T7',
    lat: 45.4266,
    lng: -75.6797,
    ward: 'Rideau-Vanier',
  },
  {
    key: 'hh-marlborough',
    street_num: '128',
    street1: 'Marlborough Avenue',
    zip: 'K1N 8G3',
    lat: 45.4229,
    lng: -75.6752,
    ward: 'Rideau-Vanier',
  },
  {
    key: 'hh-blackburn',
    street_num: '45',
    street1: 'Blackburn Avenue',
    zip: 'K1N 8A4',
    lat: 45.4245,
    lng: -75.6791,
    ward: 'Rideau-Vanier',
  },
  {
    key: 'hh-charlotte',
    street_num: '219',
    street1: 'Charlotte Street',
    zip: 'K1N 8L2',
    lat: 45.4287,
    lng: -75.6832,
    ward: 'Rideau-Vanier',
  },

  // ── Alta Vista ward ──
  {
    key: 'hh-kilborn',
    street_num: '1128',
    street1: 'Kilborn Avenue',
    zip: 'K1H 6L1',
    lat: 45.3867,
    lng: -75.6544,
    ward: 'Alta Vista',
  },
  {
    key: 'hh-pleasantpark',
    street_num: '645',
    street1: 'Pleasant Park Road',
    zip: 'K1H 5M2',
    lat: 45.3901,
    lng: -75.6608,
    ward: 'Alta Vista',
  },
  {
    key: 'hh-halifax',
    street_num: '88',
    street1: 'Halifax Drive',
    zip: 'K1G 0T6',
    lat: 45.3945,
    lng: -75.6377,
    ward: 'Alta Vista',
  },
  {
    key: 'hh-featherston',
    street_num: '1520',
    street1: 'Featherston Drive',
    zip: 'K1H 6P2',
    lat: 45.3846,
    lng: -75.6414,
    ward: 'Alta Vista',
  },
  {
    key: 'hh-kilborn-import',
    street_num: '1128',
    street1: 'Kilborn Ave.',
    zip: 'K1H 6L1',
    lat: 45.3867,
    lng: -75.6544,
    ward: 'Alta Vista',
  },
];

const SITE_BY_KEY = new Map(HOUSEHOLD_SITES.map((s) => [s.key, s]));

/**
 * A household at one of the shared sites, with this dataset's own story layered on.
 * Throws on an unknown key so a typo is a failed test run, not a household that never appears.
 */
export function at(key: string, story: Omit<DemoHouseholdDef, keyof HouseholdSite> = {}): DemoHouseholdDef {
  const site = SITE_BY_KEY.get(key);
  if (!site) throw new Error(`Unknown household site "${key}" — see HOUSEHOLD_SITES in demo-data-places.ts`);
  return { ...site, ...story };
}

/** Every shared site, with an optional per-key story overlay. */
export function allSites(
  stories: Record<string, Omit<DemoHouseholdDef, keyof HouseholdSite>> = {},
): DemoHouseholdDef[] {
  return HOUSEHOLD_SITES.map((s) => ({ ...s, ...(stories[s.key] ?? {}) }));
}
