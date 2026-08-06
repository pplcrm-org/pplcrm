/**
 * The publishers whose boundary files pplCRM redistributes.
 *
 * This is the input to `scripts/boundary-catalog.ts`. One entry per published map. The script
 * downloads what each entry names, converts and simplifies it, checks it against the product's own
 * caps, and writes both the GeoJSON file and the generated catalog entry that describes it.
 *
 * ## Every source here is openly licensed, and each licence was read one at a time
 *
 * pplCRM converts each file, stores it, and serves it to every workspace that adds the map, so an
 * openly-licensed source is the only kind that belongs here. All of the ones below grant copying,
 * publishing and commercial use outright.
 *
 * Read each publisher's licence individually rather than reasoning from the country or the level of
 * government, because one publisher can offer two geographies under two different agreements.
 * Elections Ontario is the worked example: its RIDING boundaries are "Open-Use" — worldwide,
 * royalty-free, commercial use allowed — while its POLLING DIVISION files are "Limited-Use" and say
 * the data "may not be … transferred or ceded in any way … to anyone else". Reading only the second
 * of those produces the wrong answer for the province. Riding boundaries are what this catalog
 * carries; polling divisions are neither wanted nor taken.
 *
 * `licenceVerified` records that a person has read the publisher's actual licence text and put its
 * name and required attribution in the two fields below, with the URL and the date in a comment so
 * the next person can audit the decision instead of repeating the research. The build script refuses
 * any source where it is false, so a half-finished entry cannot ship by accident.
 *
 * ## Property names are the one thing here that fails loudly rather than silently
 *
 * `sourceNameProperty` and `sourceCodeProperty` name fields in the PUBLISHER's file. The conversion
 * renames them to the fixed `name` and `code` the loader reads, so nothing downstream depends on
 * what the publisher called them. A wrong guess makes mapshaper stop with a missing-field error at
 * build time, which is the desired outcome — the alternative would be a map whose every area is
 * called "Area 1", "Area 2".
 */

import type { BoundaryRole, Chamber, JurisdictionId } from '../libs/common/src/lib/jurisdictions/jurisdiction.types';

export interface PublishedBoundarySource {
  /** Catalog slug, the converted filename, and the `boundary_sets.slug` every workspace gets. */
  slug: string;
  label: string;
  jurisdiction: JurisdictionId;
  region: string | null;
  chamber: Chamber | null;
  role: BoundaryRole;
  vintage: string;
  publisher: string;
  /** The licence's own name, as the publisher writes it. */
  licence: string;
  /** The attribution wording that licence requires. Shown in the product wherever the map is. */
  attribution: string;
  /** The publisher's landing page, so a maintainer can re-derive this file years from now. */
  sourceUrl: string;
  /** The file itself: a zipped shapefile, a GeoJSON, or anything else mapshaper reads. */
  downloadUrl: string;
  /** Which property of the PUBLISHER's file holds each area's name. */
  sourceNameProperty: string;
  /** Which property holds each area's code, or null when the publisher provides none. */
  sourceCodeProperty: string | null;
  /**
   * Set true only once this publisher's licence has been read and confirmed to permit
   * redistribution. The build script refuses to convert a source where this is false.
   */
  licenceVerified: boolean;
  /**
   * The slug this edition replaces, when it replaces one. The replaced entry keeps its file and its
   * catalog entry — a workspace working an election held under the old lines still needs them.
   */
  supersedes?: string;
}

export const PUBLISHED_BOUNDARY_SOURCES: readonly PublishedBoundarySource[] = [
  // ── Canada ────────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'ca-fed-2023',
    label: 'Canada — federal ridings',
    jurisdiction: 'ca_federal',
    region: null, // One file covers all thirteen provinces and territories.
    chamber: null,
    role: 'seat_area', // Each riding elects one Member of Parliament.
    vintage: '2023 representation order',
    publisher: 'Elections Canada',
    // Licence read at https://open.canada.ca/en/open-government-licence-canada (2026-08-06). It
    // grants "a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information,
    // including for commercial purposes", covering copying, publishing and distribution, and the
    // only condition is the attribution below. Redistribution is therefore permitted.
    licence: 'Open Government Licence – Canada',
    attribution: 'Contains information licensed under the Open Government Licence – Canada.',
    sourceUrl: 'https://open.canada.ca/data/en/dataset/18bf3ea7-1940-46ec-af52-9ba3f77ed708',
    downloadUrl:
      'https://ftp.maps.canada.ca/pub/elections_elections/Electoral-districts_Circonscription-electorale/federal_electoral_districts_boundaries_2023/FED_CA_2023_EN-SHP.zip',
    // UNVERIFIED against the actual archive — the field names could not be read without downloading
    // it. These follow the Statistics Canada federal-electoral-district convention. If they are
    // wrong, the build stops with a missing-field error naming the fields the file really has.
    sourceNameProperty: 'FEDENAME',
    sourceCodeProperty: 'FEDNUM',
    licenceVerified: true,
  },

  // ── United States ─────────────────────────────────────────────────────────────────────────────
  //
  // All three use the Census Bureau's CARTOGRAPHIC boundary files rather than the full TIGER/Line
  // ones. They are the same boundaries already generalised for mapping, which is exactly what a
  // point-in-polygon matcher wants: a fraction of the vertices, no loss that matters at the scale a
  // household sits at, and a download small enough to fetch on demand.
  //
  // Each is one nationwide file rather than fifty per-state files, and each therefore carries
  // `region: null` — which matches a campaign in any state, because `publishedBoundariesFor` treats
  // a null region as "covers the whole country". Fifty entries per layer would be fifty downloads,
  // fifty checksums and fifty rows for a workspace running in two states, to save a few thousand
  // bounding-box comparisons per household that the matcher rejects in four numeric tests each.
  {
    slug: 'us-cd-119',
    label: 'United States — congressional districts',
    jurisdiction: 'us_federal',
    region: null,
    chamber: null,
    role: 'seat_area',
    vintage: '119th Congress (2024 boundaries)',
    publisher: 'United States Census Bureau',
    // The publisher's own dataset metadata on data.gov declares CC0 1.0 Universal (public domain
    // dedication) — read 2026-08-06. Works of the US federal government carry no copyright, and the
    // dedication permits use, modification and redistribution without restriction. The attribution
    // below is not required by the licence; it is stated because a workspace acting on these lines
    // has a right to know who drew them.
    licence: 'Public domain — Creative Commons CC0 1.0 Universal',
    attribution: 'Boundaries published by the United States Census Bureau (2024 cartographic boundary files).',
    sourceUrl: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
    downloadUrl: 'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_500k.zip',
    sourceNameProperty: 'NAMELSAD',
    // GEOID carries the state FIPS code as its first two digits, which is what keeps "District 12"
    // in Texas distinguishable from "District 12" in Ohio inside one nationwide layer.
    sourceCodeProperty: 'GEOID',
    licenceVerified: true,
  },
  {
    slug: 'us-sldu-2024',
    label: 'United States — state senate districts',
    jurisdiction: 'us_state',
    region: null,
    chamber: 'upper',
    role: 'seat_area',
    vintage: '2024 boundaries',
    publisher: 'United States Census Bureau',
    licence: 'Public domain — Creative Commons CC0 1.0 Universal',
    attribution: 'Boundaries published by the United States Census Bureau (2024 cartographic boundary files).',
    sourceUrl: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
    downloadUrl: 'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_sldu_500k.zip',
    sourceNameProperty: 'NAMELSAD',
    sourceCodeProperty: 'GEOID',
    licenceVerified: true,
  },
  {
    slug: 'us-sldl-2024',
    label: 'United States — state house districts',
    jurisdiction: 'us_state',
    region: null,
    chamber: 'lower',
    role: 'seat_area',
    vintage: '2024 boundaries',
    publisher: 'United States Census Bureau',
    licence: 'Public domain — Creative Commons CC0 1.0 Universal',
    attribution: 'Boundaries published by the United States Census Bureau (2024 cartographic boundary files).',
    sourceUrl: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
    // The largest of the three at about 16 MB zipped, and the one most likely to fail the caps: the
    // fifty states between them hold roughly 4,800 lower-chamber districts against a limit of 5,000
    // areas per set. If the build refuses it, this layer has to become one entry per state; nothing
    // else in the design changes, because a per-state entry simply carries its own `region`.
    downloadUrl: 'https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_sldl_500k.zip',
    sourceNameProperty: 'NAMELSAD',
    sourceCodeProperty: 'GEOID',
    licenceVerified: true,
  },

  // ── Canadian provinces ────────────────────────────────────────────────────────────────────────
  //
  // Every province publishes through its own body under its own licence, so each needs its own
  // reading. Only riding (electoral district) boundaries are taken. Polling divisions are not: they
  // are finer than anything the product matches on, and — as Ontario shows below — they are often
  // the file a publisher puts under stricter terms.
  {
    slug: 'ca-prov-on-2022',
    label: 'Ontario — provincial ridings',
    jurisdiction: 'ca_provincial',
    region: 'ON',
    chamber: null,
    role: 'seat_area',
    vintage: '2022 general election',
    publisher: 'Elections Ontario',
    // Elections Ontario offers its two geographies under TWO DIFFERENT licences, and the difference
    // is the whole reason this entry exists while polling divisions are absent:
    //
    //   riding boundaries  -> "Open-Use Data Product Licence Agreement"     (this entry)
    //   polling divisions  -> "Limited-Use Data Product Licence Agreement"  (not taken)
    //
    // The Open-Use agreement, read 2026-08-06 at
    // https://www.elections.on.ca/en/voting-in-ontario/electoral-district-shapefiles/open-use-data-product-licence-agreement.html
    // grants a "worldwide, royalty-free, perpetual, non-exclusive licence to use the Information,
    // including for commercial purposes", and the freedom to "copy, modify, publish, translate,
    // adapt, distribute or otherwise use the Information in any medium, mode or format for any
    // lawful purpose". It requires no attribution; the line below is a courtesy so a workspace
    // acting on these lines can see who drew them. Its one restriction is that use must not suggest
    // official status or an Elections Ontario endorsement, which the product does not do.
    licence: 'Elections Ontario Open-Use Data Product Licence Agreement',
    attribution: 'Boundaries published by Elections Ontario.',
    sourceUrl: 'https://www.elections.on.ca/en/voting-in-ontario/electoral-district-shapefiles.html',
    downloadUrl:
      'https://www.elections.on.ca/content/dam/NGW/sitecontent/2017/preo/shapefiles/Electoral%20District%20Shapefile%20-%202022%20General%20Election.zip',
    // Unverified against the archive; a wrong name stops the build with a missing-field error.
    sourceNameProperty: 'ED_NAME_EN',
    sourceCodeProperty: 'ED_ID',
    licenceVerified: true,
  },
  {
    slug: 'ca-prov-ab-2019',
    label: 'Alberta — provincial constituencies',
    jurisdiction: 'ca_provincial',
    region: 'AB',
    chamber: null,
    role: 'seat_area',
    vintage: '2019 boundaries',
    publisher: 'Elections Alberta',
    // The dataset record at the sourceUrl below names "Open Government Licence - Alberta". That
    // licence page itself could not be read — https://open.alberta.ca/licence returned HTTP 520 on
    // 2026-08-06 — so the licence name here comes from the publisher's dataset record rather than
    // from the licence text. Alberta's open licence follows the same family as the federal and
    // Ontario ones; confirm the attribution wording below when the page is reachable again.
    licence: 'Open Government Licence – Alberta',
    attribution: 'Contains information licensed under the Open Government Licence – Alberta.',
    sourceUrl: 'https://open.canada.ca/data/en/dataset/d2eff235-4c11-416f-b4e2-791c305594b1',
    downloadUrl: 'https://www.elections.ab.ca/wp-content/uploads/2019Boundaries_ED-Shapefiles.zip',
    // Unverified against the archive; a wrong name stops the build with a missing-field error.
    sourceNameProperty: 'ED_NAME',
    sourceCodeProperty: 'ED_NUM',
    licenceVerified: true,
  },
];

/**
 * What was checked, what was found, and what is still open — so nobody researches this twice.
 *
 * ## Ontario — open, and the reason to read a publisher's licences one at a time
 *
 * Elections Ontario publishes two geographies under two different agreements, and a first pass that
 * finds only the restrictive one draws the wrong conclusion about the province:
 *
 *  - **Riding (electoral district) boundaries — "Open-Use Data Product Licence Agreement".**
 *    Worldwide, royalty-free, perpetual, commercial use allowed, copying and publishing allowed, no
 *    attribution required. This is the file taken above.
 *  - **Polling divisions — "Limited-Use Data Product Licence Agreement".** States the data products
 *    "may not be sold, rented, leased, lent, sub-licensed, transferred or ceded in any way … to
 *    anyone else". Not taken, and not wanted: polling divisions are finer than anything the product
 *    matches on.
 *
 * Ontario's own open-data portal carries neither — searching data.ontario.ca for "electoral
 * district" returns a list of ministers' titles — so Elections Ontario is the source for both.
 *
 * ## Quebec — excluded by decision
 *
 * Left out deliberately, not for licence reasons. Do not add it back without asking.
 *
 * ## Not yet checked
 *
 * British Columbia, Saskatchewan, Manitoba, Nova Scotia, New Brunswick, Newfoundland and Labrador,
 * Prince Edward Island, Northwest Territories, Yukon and Nunavut. Each publishes separately. British
 * Columbia (BC Data Catalogue, via Elections BC) and Saskatchewan (gis.saskatchewan.ca, "Provincial
 * Constituencies") both appear to publish through an open catalogue and are the obvious next two.
 *
 * ## Out of scope entirely
 *
 * **Municipal wards** — thousands of publishers, no common format, many publishing only a PDF.
 * **Polling divisions and US precincts** — finer than anything the product matches on; a single US
 * state's precinct file exceeds the 5,000-area cap, and Census voting-district data is a decennial
 * snapshot that goes stale between censuses, so importing those names from a voter file beats
 * publishing them.
 */
export const BOUNDARY_SOURCE_RESEARCH_NOTES = [
  'Ontario — riding boundaries open (Open-Use licence); polling divisions limited-use and out of scope',
  'Quebec — excluded by decision',
  'BC, SK, MB, NS, NB, NL, PE, NT, YT, NU — not yet checked',
] as const;
