/**
 * Copy and mock data for the /districts page — "one product, every North American race".
 *
 * Everything here is a factual claim about what the product does, so it is governed by the
 * `pplcrm-website-claims` registry. The sources of truth:
 *
 *  - the seven jurisdictions and their default words → `JURISDICTION_IDS` / `JURISDICTIONS`
 *    in `libs/common/src/lib/jurisdictions/`
 *  - the automatic regional exceptions (Alberta says constituency, Quebec says
 *    circonscription, New York says election district) → `regionalSeatLabels` /
 *    `regionalSubdivisionLabels` on those same specs
 *  - one household holding every boundary that covers it → the `household_districts` table,
 *    keyed `(household_id, set_id)` so no level can overwrite another
 *  - "drawing never calls a paid service" → boundary matching is point-in-polygon arithmetic
 *    over coordinates already on file; only Google Geocoding is billed, and no boundary edit
 *    triggers it
 *
 * If any of those change, this file changes in the same commit. Do not add a number here that
 * is not read off the code.
 */

/** One row of the seven-jurisdiction table: what the product calls a seat there, with a real seat. */
export interface JurisdictionRow {
  /** Picker label, matching the wording of the jurisdiction option in the app. */
  readonly level: string;
  /** Default seat-area word for that jurisdiction. */
  readonly seatWord: string;
  /** Default voting-subdivision word for that jurisdiction. */
  readonly subdivisionWord: string;
  /** A real seat, so the row is concrete rather than a category. */
  readonly example: string;
  /** What the person holding that seat is called. */
  readonly title: string;
}

/**
 * The seven jurisdictions, in the order the app offers them. `other` is last and is the honest
 * default: plenty of real races (school board, county commission, band council, special
 * district) are not modelled and should not be forced into a box that fits badly.
 */
export const JURISDICTION_ROWS: readonly JurisdictionRow[] = [
  {
    level: 'Canada — federal',
    seatWord: 'Riding',
    subdivisionWord: 'Polling division',
    example: 'Ottawa Centre',
    title: 'MP',
  },
  {
    level: 'Canada — provincial or territorial',
    seatWord: 'Riding',
    subdivisionWord: 'Polling division',
    example: 'Ottawa South, Ontario',
    title: 'MPP',
  },
  {
    level: 'Canada — municipal',
    seatWord: 'Ward',
    subdivisionWord: 'Poll',
    example: 'Ward 14, Toronto',
    title: 'Councillor',
  },
  {
    level: 'United States — federal',
    seatWord: 'Congressional district',
    subdivisionWord: 'Precinct',
    example: 'OH-3, Ohio',
    title: 'Representative',
  },
  {
    level: 'United States — state',
    seatWord: 'Legislative district',
    subdivisionWord: 'Precinct',
    example: 'LD-12 (House), Arizona',
    title: 'State Representative',
  },
  {
    level: 'United States — local',
    seatWord: 'Council district',
    subdivisionWord: 'Precinct',
    example: 'District 4, Phoenix',
    title: 'Council member',
  },
  {
    level: 'Something else',
    seatWord: 'District',
    subdivisionWord: 'Subdivision',
    example: 'School board, county commission, band council',
    title: 'Your own title',
  },
];

/** The four words the home-page teaser leads with. Same source as the table above. */
export interface WordCard {
  readonly word: string;
  readonly where: string;
  readonly example: string;
}

export const WORD_CARDS: readonly WordCard[] = [
  { word: 'Riding', where: 'Canada, federal and provincial', example: 'Ottawa Centre' },
  { word: 'Ward', where: 'Canadian municipalities', example: 'Ward 14, Toronto' },
  { word: 'Constituency', where: 'Alberta and Saskatchewan', example: 'Calgary-Elbow' },
  { word: 'Congressional district', where: 'United States, federal', example: 'OH-3, Ohio' },
];

/** One row in the households-grid mock. Pairs by index with the shared mock addresses. */
export interface SampleRow {
  readonly seat: string;
  readonly subdivision: string;
}

/**
 * One tab of the vocabulary demonstration: the office a campaign declared on the left, and the
 * screen that office produces on the right. The whole point of the section is that the second
 * follows from the first with nobody editing a label, so both halves live in one object.
 */
export interface VocabularySample {
  /** Chip label. Deliberately the WORD, not the jurisdiction, because the word is the payload. */
  readonly tab: string;
  /** "Level of government" as the campaign form records it. */
  readonly level: string;
  /** Province, state, and municipality where the jurisdiction asks for them. `—` when it does not. */
  readonly region: string;
  /** Chamber. Only US state races have one, so every other sample reads `—`. */
  readonly chamber: string;
  /** Seat name, or the at-large answer. */
  readonly seat: string;
  /** Office title, as picked on the campaign. */
  readonly title: string;
  /** Grid column header for the seat area. `null` for an at-large race, which has no seat area. */
  readonly seatColumn: string | null;
  /** Grid column header for the voting subdivision. */
  readonly subdivisionColumn: string;
  /** The grain sentence under the grid title, in this jurisdiction's plural. */
  readonly grain: string;
  /** One sentence naming what this sample proves. */
  readonly note: string;
  readonly rows: readonly SampleRow[];
}

/** The sample the section opens on. Named so the page never has to index into the array. */
export const DEFAULT_VOCABULARY_SAMPLE: VocabularySample = {
  tab: 'Riding',
  level: 'Canada — federal',
  region: '—',
  chamber: '—',
  seat: 'Ottawa Centre',
  title: 'MP',
  seatColumn: 'Riding',
  subdivisionColumn: 'Polling division',
  grain: '5,012 households across 4 ridings',
  note: 'Riding is the default word for a Canadian federal race, and a federal race needs no province: the seat is the geography.',
  rows: [
    { seat: 'Ottawa Centre', subdivision: 'PD 412' },
    { seat: 'Ottawa Centre', subdivision: 'PD 412' },
    { seat: 'Ottawa Centre', subdivision: 'PD 415' },
    { seat: 'Ottawa—Vanier', subdivision: 'PD 108' },
  ],
};

/**
 * Six samples, chosen to cover every mechanism rather than every jurisdiction: the default
 * word, a municipal word, an automatic regional exception, a US seat, a chamber plus a
 * multi-member position, and a race with no seat area at all.
 */
export const VOCABULARY_SAMPLES: readonly VocabularySample[] = [
  DEFAULT_VOCABULARY_SAMPLE,
  {
    tab: 'Ward',
    level: 'Canada — municipal',
    region: 'Ontario · Toronto',
    chamber: '—',
    seat: 'Ward 14',
    title: 'Councillor',
    seatColumn: 'Ward',
    subdivisionColumn: 'Poll',
    grain: '5,012 households across 8 wards',
    note: 'A municipal race asks which city, because ward numbers only mean something inside one. Quebec municipalities say district instead, and pplCRM already knows.',
    rows: [
      { seat: 'Ward 14', subdivision: 'Poll 22' },
      { seat: 'Ward 14', subdivision: 'Poll 22' },
      { seat: 'Ward 14', subdivision: 'Poll 27' },
      { seat: 'Ward 13', subdivision: 'Poll 04' },
    ],
  },
  {
    tab: 'Constituency',
    level: 'Canada — provincial or territorial',
    region: 'Alberta',
    chamber: '—',
    seat: 'Calgary-Elbow',
    title: 'MLA',
    seatColumn: 'Constituency',
    subdivisionColumn: 'Polling division',
    grain: '5,012 households across 6 constituencies',
    note: 'Nobody typed the word constituency. Alberta and Saskatchewan use it, so choosing Alberta chose the word, right down to the plural.',
    rows: [
      { seat: 'Calgary-Elbow', subdivision: 'PD 31' },
      { seat: 'Calgary-Elbow', subdivision: 'PD 31' },
      { seat: 'Calgary-Elbow', subdivision: 'PD 36' },
      { seat: 'Calgary-Buffalo', subdivision: 'PD 12' },
    ],
  },
  {
    tab: 'Congressional district',
    level: 'United States — federal',
    region: 'Ohio',
    chamber: '—',
    seat: 'OH-3',
    title: 'Representative',
    seatColumn: 'Congressional district',
    subdivisionColumn: 'Precinct',
    grain: '5,012 households across 3 congressional districts',
    note: 'The same grid, the American word, and precincts underneath instead of polling divisions.',
    rows: [
      { seat: 'OH-3', subdivision: 'FRA-0142' },
      { seat: 'OH-3', subdivision: 'FRA-0142' },
      { seat: 'OH-3', subdivision: 'FRA-0155' },
      { seat: 'OH-15', subdivision: 'FRA-0301' },
    ],
  },
  {
    tab: 'Legislative district',
    level: 'United States — state',
    region: 'Arizona',
    chamber: 'Lower (House)',
    seat: 'LD-12 · Position 2',
    title: 'State Representative',
    seatColumn: 'Legislative district',
    subdivisionColumn: 'Precinct',
    grain: '5,012 households across 5 legislative districts',
    note: 'A state race says which chamber, because the upper and lower maps are different lines over the same street. Arizona elects two representatives per district, so the seat carries a position.',
    rows: [
      { seat: 'LD-12', subdivision: 'MAR-0088' },
      { seat: 'LD-12', subdivision: 'MAR-0088' },
      { seat: 'LD-12', subdivision: 'MAR-0091' },
      { seat: 'LD-11', subdivision: 'MAR-0204' },
    ],
  },
  {
    tab: 'No district at all',
    level: 'United States — federal',
    region: 'Ohio',
    chamber: '—',
    seat: 'Elected at large across Ohio',
    title: 'Senator',
    seatColumn: null,
    subdivisionColumn: 'Precinct',
    grain: '5,012 households across 214 precincts',
    note: 'A US Senate race is statewide, so there is no district column to show. Precincts do the organizing, and the seat-name field never appears.',
    rows: [
      { seat: '', subdivision: 'FRA-0142' },
      { seat: '', subdivision: 'FRA-0142' },
      { seat: '', subdivision: 'FRA-0155' },
      { seat: '', subdivision: 'CUY-1120' },
    ],
  },
];

/** Offices elected across a whole region with no seat area of their own. */
export const AT_LARGE_EXAMPLES: readonly string[] = [
  'US Senate, elected across the state',
  'Governor, Attorney General, Secretary of State',
  'The single at-large House seat in Alaska, Delaware, North Dakota, South Dakota, Vermont and Wyoming',
  'Mayors, and at-large city council seats',
  'All of Vancouver city council',
];

/**
 * The four ways a boundary map reaches a workspace, and there are only four.
 *
 * What "Select" covers is exactly the list in `PUBLISHED_BOUNDARY_ENTRIES`
 * (`libs/common/src/lib/boundaries/catalog/catalog.entries.ts`) and nothing more: Canadian federal
 * ridings, Ontario and Alberta provincial ridings, and US congressional, state senate and state
 * house districts. **Municipal wards and precincts are not published and are not included** — those
 * still arrive by import, upload or drawing, so the site must never say the product knows your
 * city council's lines. When a jurisdiction is added to or removed from that file, this list and
 * the copy around it change in the same commit.
 */
export interface MapSource {
  readonly n: string;
  readonly label: string;
  readonly note: string;
}

export const MAP_SOURCES: readonly MapSource[] = [
  { n: '1', label: 'Select', note: 'a published federal or state map' },
  { n: '2', label: 'Import', note: 'columns your file already has' },
  { n: '3', label: 'Upload', note: 'a GeoJSON from open data' },
  { n: '4', label: 'Draw', note: 'by hand, over your own doors' },
];

/** A CSV column in the import mock, and the field it lands in. */
export interface ImportMapping {
  readonly column: string;
  readonly field: string;
  /**
   * True for the two headers the wizard deliberately refuses to guess: bare `SD` and `HD`.
   * `SD` is the state code for South Dakota as often as it is a senate district, and silently
   * mapping a whole column at the wrong boundary is worse than asking — so the wizard leaves
   * both unmapped and the person points them at the right field on the mapping step.
   */
  readonly manual?: true;
}

/**
 * Column names a people or households import maps to electoral geography. Keep this list in step
 * with the header auto-map (`ELECTORAL_HEADER_TO_FIELD`) and the field labels
 * (`ELECTORAL_IMPORT_FIELD_LABELS`) in
 * `libs/uxcommon/src/components/csv-import/persons-field-mapping.ts` — the field strings here are
 * the labels the wizard actually shows.
 */
export const IMPORT_MAPPINGS: readonly ImportMapping[] = [
  { column: 'CD', field: 'Congressional district' },
  { column: 'LD', field: 'Legislative district' },
  { column: 'Riding', field: 'District / riding' },
  { column: 'Ward', field: 'Ward' },
  { column: 'Precinct', field: 'Precinct / polling division' },
  { column: 'SD', field: 'State senate district', manual: true },
  { column: 'HD', field: 'State house district', manual: true },
];

/** Areas in the drawing mock's side panel. The third is mid-draw, which is why it has no count. */
export interface DrawnArea {
  readonly name: string;
  readonly households: string;
  readonly drawing?: true;
}

export const DRAWN_AREAS: readonly DrawnArea[] = [
  { name: 'Riverside', households: '812 households' },
  { name: 'Old Mill', households: '640 households' },
  { name: 'Hillcrest', households: 'Drawing…', drawing: true },
];

/**
 * Household pins under the drawing surface, as coordinates in the mock's 320×220 viewBox.
 *
 * A list rather than a decorative texture because the pins are the argument: you draw around
 * doors you actually have, and you can see which ones fall outside every area you drew. The
 * ones in the lower-left corner are outside both polygons on purpose — they are the households
 * the validation count in the side panel is reporting.
 */
export const MAP_PINS: readonly { x: number; y: number }[] = [
  { x: 31, y: 32 },
  { x: 58, y: 38 },
  { x: 88, y: 34 },
  { x: 118, y: 37 },
  { x: 138, y: 38 },
  { x: 167, y: 32 },
  { x: 203, y: 30 },
  { x: 225, y: 30 },
  { x: 250, y: 35 },
  { x: 286, y: 36 },
  { x: 32, y: 57 },
  { x: 59, y: 60 },
  { x: 83, y: 63 },
  { x: 110, y: 62 },
  { x: 138, y: 56 },
  { x: 172, y: 62 },
  { x: 202, y: 63 },
  { x: 229, y: 62 },
  { x: 249, y: 59 },
  { x: 279, y: 61 },
  { x: 29, y: 84 },
  { x: 61, y: 85 },
  { x: 90, y: 86 },
  { x: 111, y: 86 },
  { x: 143, y: 85 },
  { x: 168, y: 89 },
  { x: 199, y: 85 },
  { x: 228, y: 87 },
  { x: 253, y: 87 },
  { x: 279, y: 83 },
  { x: 31, y: 112 },
  { x: 58, y: 110 },
  { x: 86, y: 109 },
  { x: 117, y: 110 },
  { x: 138, y: 115 },
  { x: 171, y: 113 },
  { x: 202, y: 110 },
  { x: 226, y: 111 },
  { x: 255, y: 113 },
  { x: 279, y: 110 },
  { x: 31, y: 134 },
  { x: 56, y: 140 },
  { x: 89, y: 137 },
  { x: 113, y: 138 },
  { x: 140, y: 136 },
  { x: 173, y: 136 },
  { x: 199, y: 134 },
  { x: 230, y: 139 },
  { x: 253, y: 135 },
  { x: 285, y: 136 },
  { x: 27, y: 164 },
  { x: 61, y: 163 },
  { x: 81, y: 163 },
  { x: 110, y: 168 },
  { x: 140, y: 165 },
  { x: 171, y: 167 },
  { x: 200, y: 168 },
  { x: 224, y: 162 },
  { x: 254, y: 163 },
  { x: 285, y: 164 },
  { x: 34, y: 192 },
  { x: 58, y: 193 },
  { x: 85, y: 191 },
  { x: 118, y: 190 },
  { x: 140, y: 192 },
  { x: 174, y: 193 },
  { x: 195, y: 188 },
  { x: 224, y: 186 },
  { x: 250, y: 191 },
  { x: 285, y: 188 },
];

/** A limit we state before anyone has to ask. Every one of these is a thing we do NOT do. */
export interface Limit {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

export const LIMITS: readonly Limit[] = [
  {
    icon: 'exclamation-triangle',
    title: 'A boundary you draw is approximate',
    body: 'Two areas drawn next to each other can leave a sliver of gap or a sliver of overlap unless you trace carefully. That is fine for the job it is for: turfs, walk lists and coverage. It is not fine for anything legal or compliance-facing, including the electoral district printed on a donation receipt, and pplCRM says so on the page where you draw.',
  },
  {
    icon: 'funnel',
    title: 'We tell you what did not match',
    body: 'We report two counts for every boundary set: households that landed in no area, and households that landed in more than one. They are counted when you open the map and again whenever you press Check again — a full count checks every located household against every area, so re-running it after each edit would make an editing session pay for that scan over and over, and a notice reminds you the numbers are out of date until you ask. You still find out about the gap you left, on demand, instead of a month later from a volunteer standing on a sidewalk.',
  },
  {
    icon: 'document-currency-dollar',
    title: 'US political contributions get no TAX receipt',
    body: 'They are not tax-deductible federally, so there is no tax receipt to issue and pplCRM issues none. Ask us for a US political contribution regime and the answer is that none exists. Your donors are still sent a plain donation receipt by email for every gift, which confirms the gift and makes no tax claim. Canadian political and charitable receipting is unchanged: numbered official receipts, gap-free, on the regimes that allow them.',
  },
  {
    icon: 'shield-exclamation',
    title: 'We do not file your disclosure reports',
    body: 'pplCRM does not prepare or submit FEC or state campaign-finance reports, and does not claim to. Keeping the record and filing the report are two different jobs; we do the first one.',
  },
];
