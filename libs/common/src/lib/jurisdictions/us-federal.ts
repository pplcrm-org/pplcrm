import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * States that elect their single member of the US House of Representatives statewide, under the
 * apportionment that followed the 2020 Census (in force for the 118th Congress onward).
 *
 * A House campaign in one of these states is `seat_type: 'at_large'`, not a district campaign, and
 * a form can use this list to pick that default once the state is chosen.
 *
 * **This list has a vintage and will change.** Under the 2010 apportionment there were seven such
 * states; Montana gained a second seat in the 2020 reapportionment and dropped off, leaving six.
 * The next census will move states on and off again. That is exactly why at-large is a per-campaign
 * field on the record rather than a rule derived from the state: the campaign states what it is
 * contesting, and this list is only a helpful default.
 *
 * Source: https://www.census.gov/data/tables/2020/dec/2020-apportionment-data.html
 */
export const US_AT_LARGE_CONGRESSIONAL_STATES = ['AK', 'DE', 'ND', 'SD', 'VT', 'WY'] as const;

/**
 * United States federal — a seat in Congress.
 *
 * At-large support is required here, and it is the case that most often gets modelled wrongly.
 * **Both US senators from a state are elected statewide**, with no district of their own. A Senate
 * campaign therefore has `seat_type: 'at_large'` and an empty `seat_name`, and its area is the
 * whole state named in `office_region`. On top of that, the six states in
 * {@link US_AT_LARGE_CONGRESSIONAL_STATES} elect their single House member statewide too.
 *
 * Contrast Canada: `ca_federal` sets `supportsAtLarge: false` because every seat in the House of
 * Commons is contested in a riding and the Senate is appointed, not elected. This is the single
 * clearest place where a shared "national legislature" abstraction would have been wrong.
 *
 * No chambers, despite Congress having two. `usesChamber` is about which boundary map to match
 * households against, and both federal chambers resolve without it: a House seat matches the
 * congressional district map, and a Senate seat matches nothing because it has no district. The
 * chamber is captured in `office_title` (Representative vs Senator) where it belongs, as a title.
 * `us_state` is different — there the two chambers are two different district maps.
 *
 * Vocabulary: "congressional district" is the standard term nationally. The voting subdivision is
 * the precinct everywhere except New York, which calls it an election district; that exception is
 * in `regionalSubdivisionLabels` and applies to all three US jurisdictions.
 *
 * Region is required: a congressional district is identified as a state plus a number (OH-3), so
 * the state is part of the seat's identity, not extra context.
 *
 * Boundary data: the Census Bureau's TIGER/Line files publish congressional districts for all fifty
 * states as one consistent national family from one publisher, which is markedly better than the
 * Canadian situation of one commission per province. Voting districts (precincts) are also
 * published, but as a decennial snapshot: states redraw precincts continuously, so a bundled
 * precinct set goes stale between censuses. That is why the precinct layer is published per state
 * without a national slug, and why importing precincts from a voter file usually beats bundling.
 *
 * **Receipting: null, and this is a statement of fact rather than a gap.** Contributions to US
 * federal candidates, parties and political committees are **not tax-deductible**, so there is no
 * receipt to issue and no regime to suggest. The donations settings page should say that plainly
 * rather than offering a Canadian regime.
 *
 * Two things deliberately not modelled here, recorded so they are not mistaken for oversights:
 * FEC disclosure reporting (which requires collecting each contributor's occupation and employer
 * past the itemization threshold, and enforcing per-donor limits) is a compliance system of its own
 * and not a variant of receipting; and a US 501(c)(3) charity, which does issue deductible
 * receipts, is a separate missing regime unrelated to any political jurisdiction.
 *
 * Sources:
 * - https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
 * - https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/contribution-limits/
 * - https://www.irs.gov/charities-non-profits/political-organizations (contributions not deductible)
 */
export const US_FEDERAL_JURISDICTION: JurisdictionSpec = {
  id: 'us_federal',
  country: 'US',
  label: 'United States — federal',
  description: 'A seat in Congress. Senators are elected statewide, so a Senate race has no district.',
  seatLabel: 'Congressional district',
  seatLabelPlural: 'Congressional districts',
  subdivisionLabel: 'Precinct',
  subdivisionLabelPlural: 'Precincts',
  regionalSeatLabels: {},
  regionalSubdivisionLabels: {
    NY: 'Election district',
  },
  supportsAtLarge: true,
  usesChamber: false,
  requiresRegion: true,
  requiresLocality: false,
  boundaryLayers: [
    {
      role: 'seat_area',
      label: 'Congressional district',
      labelPlural: 'Congressional districts',
      source: 'bundled',
      bundledSlug: 'us-cd-119',
    },
    { role: 'subdivision', label: 'Precinct', labelPlural: 'Precincts', source: 'bundled' },
  ],
  officeTitles: ['Representative', 'Senator', 'Candidate'],
  suggestedReceiptRegime: () => null,
};
