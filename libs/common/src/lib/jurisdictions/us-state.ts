import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * United States state — a seat in a state legislature, or a statewide executive office.
 *
 * **This is the only jurisdiction that uses chambers, and the reason is data, not terminology.**
 * A state senate district and a state house district are two different boundary layers, published
 * as two different files (the Census Bureau's TIGER/Line calls them SLDU and SLDL), covering the
 * same ground with different lines. Neither can be derived from the other: state senate districts
 * are not unions of house districts in most states, and the numbering schemes are unrelated. So
 * without knowing the chamber there is no way to choose which map to match households against, and
 * every other field on the campaign leaves it ambiguous. That is why `usesChamber` is true here and
 * false everywhere else, including `us_federal` where Congress also has two chambers — a Senate
 * seat has no district at all, so nothing there depends on knowing the chamber.
 *
 * Nebraska is the one state with a single chamber. Its Legislature is unicameral and its members
 * are called Senators, so Nebraska has upper-chamber districts and no lower-chamber districts.
 * A Nebraska campaign should choose the upper chamber; the shape of the data already reflects this,
 * because no lower-chamber boundary file exists for Nebraska to match against.
 *
 * At-large support covers the statewide executive offices, which have no district by definition:
 * governor, lieutenant governor, attorney general, secretary of state, treasurer, and in several
 * states an elected supreme court or board of education. These are `seat_type: 'at_large'` with the
 * state named in `office_region`.
 *
 * Multi-member districts are common at this level and are handled by `campaigns.seat_position`
 * rather than by any seat-count modelling here. The Arizona House and the New Jersey General
 * Assembly each elect two members per district; Washington uses numbered positions within each
 * legislative district; several New England states use multi-member districts as well. A free-text
 * position ("Position 2", "Seat B", "Place 4") covers all of these without the registry having to
 * know how many seats each district has.
 *
 * Vocabulary: "legislative district" is the neutral term that works across states whose chambers
 * are named differently (House of Representatives, Assembly, House of Delegates). New York's
 * election-district exception applies here as it does to the other two US jurisdictions.
 *
 * Boundary data: TIGER/Line publishes state legislative districts per state per chamber, so the
 * bundled layers here carry no `bundledSlug` — the slug is composed at ingest time from the state,
 * chamber and vintage, as in `us-sldl-az-2022`. Boundaries change with redistricting, and in
 * several states again mid-decade by court order, so bundled sets are versioned and never updated
 * in place.
 *
 * Receipting: null. US political contributions are not tax-deductible, so there is no receipt to
 * issue. A small number of states do offer a state political contribution credit, but which states
 * and on what terms must be verified against current state law before anything is built — it is
 * deliberately not inferred here.
 *
 * Sources:
 * - https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 * - https://nebraskalegislature.gov/about/about_unicameral.php (Nebraska is unicameral)
 * - https://www.azleg.gov/ (Arizona: two House members per legislative district)
 */
export const US_STATE_JURISDICTION: JurisdictionSpec = {
  id: 'us_state',
  country: 'US',
  label: 'United States — state',
  description: 'A seat in a state legislature, or a statewide office such as governor.',
  seatLabel: 'Legislative district',
  seatLabelPlural: 'Legislative districts',
  subdivisionLabel: 'Precinct',
  subdivisionLabelPlural: 'Precincts',
  regionalSeatLabels: {},
  regionalSubdivisionLabels: {
    NY: 'Election district',
  },
  supportsAtLarge: true,
  usesChamber: true,
  requiresRegion: true,
  requiresLocality: false,
  boundaryLayers: [
    { role: 'seat_area', label: 'Legislative district', labelPlural: 'Legislative districts', source: 'bundled' },
    { role: 'subdivision', label: 'Precinct', labelPlural: 'Precincts', source: 'bundled' },
  ],
  officeTitles: [
    'State Representative',
    'State Senator',
    'Assembly Member',
    'Delegate',
    'Governor',
    'Lieutenant Governor',
    'Attorney General',
    'Secretary of State',
    'Candidate',
  ],
  suggestedReceiptRegime: () => null,
};
