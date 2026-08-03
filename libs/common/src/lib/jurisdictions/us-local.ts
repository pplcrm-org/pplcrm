import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * United States local — a seat on a city or county council, or the mayoralty.
 *
 * ## The Massachusetts trap — read this before adding any label logic
 *
 * **In Massachusetts cities, a ward is a voting subdivision, not a seat area.** Wards contain
 * precincts, both are subdivisions of the city used to run the election, and neither elects anyone.
 * Boston's city council district seats are their own separate areas with their own boundaries, and
 * they have nothing to do with ward numbers. So "ward" means a seat area in Toronto and a voting
 * subdivision in Boston — the exact opposite meanings, in the same product, for the same word.
 *
 * This is why there is no Massachusetts entry in `regionalSeatLabels` below, and why there must
 * never be one. A label exception can only change which word is shown; it cannot change what the
 * area *is*. Massachusetts is handled entirely by data: a Boston workspace holds two boundary sets
 * with `role: 'subdivision'` — one named "Wards" and one named "Precincts" — alongside a third set
 * with `role: 'seat_area'` for the council districts. Because `household_districts` is keyed on
 * `(household_id, set_id)` rather than on any level or kind enum, one household holds its ward and
 * its precinct and its council district simultaneously, with none overwriting another.
 *
 * The failure mode this note exists to prevent: someone sees that Boston says "ward", adds
 * `MA: 'Ward'` to `regionalSeatLabels`, and the product then treats Boston's voting subdivisions as
 * the areas that elect councillors. Every turf boundary, every coverage report and every "which
 * ward is this voter in" answer would then be wrong in a way that looks plausible. If you are about
 * to encode a place's vocabulary as a seat label, first check whether that place's word names a
 * seat area at all.
 *
 * ## Everything else
 *
 * At-large support is required: mayors are elected city-wide, and many US councils mix district
 * seats with at-large seats on the same body. At-large council seats are frequently numbered as
 * well, which `campaigns.seat_position` covers ("Seat B", "Place 4").
 *
 * Locality is required because a council district number means nothing without the city, and
 * because the boundary set for a local race is scoped to one municipality or county.
 *
 * Vocabulary: "council district" is the default because it is the most widely used and because it
 * is unambiguous — unlike "ward", it names a seat area everywhere it is used. New York's
 * election-district exception applies here as it does to the other two US jurisdictions.
 *
 * Boundary data: no publisher covers US municipalities consistently. Cities publish their own
 * council-district maps individually in whatever format they choose, or not at all, so the shipped
 * path is upload, with drawing for the places that publish nothing usable and import when the area
 * name already sits on each row of a purchased voter file. Census voting-district files can supply
 * precincts for many places, but they are a decennial snapshot and go stale as places redraw.
 *
 * Receipting: null. US political contributions are not tax-deductible, so there is no receipt to
 * issue at any level of US government, local included.
 *
 * Sources:
 * - https://www.boston.gov/departments/elections (Boston: wards contain precincts)
 * - https://www.boston.gov/departments/city-council (council districts are separate areas)
 * - https://www.irs.gov/charities-non-profits/political-organizations
 */
export const US_LOCAL_JURISDICTION: JurisdictionSpec = {
  id: 'us_local',
  country: 'US',
  label: 'United States — local',
  description: 'A seat on a city or county council, or the mayoralty. Many councils have at-large seats.',
  seatLabel: 'Council district',
  seatLabelPlural: 'Council districts',
  subdivisionLabel: 'Precinct',
  subdivisionLabelPlural: 'Precincts',
  // Deliberately empty. See the Massachusetts note above: a place whose word names a different
  // kind of area is a data problem, not a label problem, and must never be solved here.
  regionalSeatLabels: {},
  regionalSubdivisionLabels: {
    NY: 'Election district',
  },
  supportsAtLarge: true,
  usesChamber: false,
  requiresRegion: true,
  requiresLocality: true,
  boundaryLayers: [
    { role: 'seat_area', label: 'Council district', labelPlural: 'Council districts', source: 'upload' },
    { role: 'subdivision', label: 'Precinct', labelPlural: 'Precincts', source: 'upload' },
  ],
  officeTitles: ['Council Member', 'Mayor', 'Alderman', 'Commissioner', 'Supervisor', 'Candidate'],
  suggestedReceiptRegime: () => null,
};
