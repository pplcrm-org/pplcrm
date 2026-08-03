import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * Something else — the generic fallback, and the default for every campaign.
 *
 * This is not a placeholder and not an error state. It is the honest answer for three real groups:
 *
 * - **Every campaign that existed before this registry.** The database column defaults to `other`,
 *   so no existing record is retroactively assigned an office it never declared.
 * - **Races pplCRM does not model.** School board, county commission, band council, conservation
 *   authority, special district, port commission, and any race outside Canada and the United
 *   States. These are real campaigns with real doors to knock; they simply do not have a bundled
 *   boundary publisher or a vocabulary the product can guess.
 * - **Non-electoral workspaces.** A church, charity or advocacy organization is never asked the
 *   jurisdiction question at all — the campaign form gates it behind `ORG_MODE_IS_ELECTORAL` — so
 *   their campaigns sit here permanently and never see a district picker.
 *
 * Because the office is unknown, the constraints are all relaxed: no region is required, no
 * locality is required, and even `seat_name` is optional when the seat type is `district`. That
 * last exemption is deliberate — for a modelled jurisdiction, a district campaign that cannot name
 * its district is almost certainly a mistake worth catching, but here the product does not know
 * enough about the race to insist.
 *
 * At-large is supported because plenty of unmodelled bodies elect their members at large, and there
 * is no basis for refusing it when the office itself is unknown.
 *
 * Vocabulary is the neutral pair: "District" for a seat area and "Subdivision" for a voting
 * subdivision. Neither is a great word for any particular race, which is why `seat_label_override`
 * matters more here than anywhere else — a school board campaign can set "Trustee area" and every
 * screen follows.
 *
 * Boundary data: import, upload or draw. Drawing is often the fastest route for these races,
 * because a body with no bundled publisher usually has no downloadable map either, and a campaign
 * can equally draw its own organizing areas ("the three neighbourhoods we are targeting") and use
 * them to bound canvassing turfs.
 *
 * Receipting: null. The product does not know what body this is or what country it is in, so it has
 * nothing to suggest and says so rather than guessing.
 */
export const OTHER_JURISDICTION: JurisdictionSpec = {
  id: 'other',
  country: null,
  label: 'Something else',
  description: 'Any other race — school board, county, band council, or a country we do not model yet.',
  seatLabel: 'District',
  seatLabelPlural: 'Districts',
  subdivisionLabel: 'Subdivision',
  subdivisionLabelPlural: 'Subdivisions',
  regionalSeatLabels: {},
  regionalSubdivisionLabels: {},
  supportsAtLarge: true,
  usesChamber: false,
  requiresRegion: false,
  requiresLocality: false,
  boundaryLayers: [
    { role: 'seat_area', label: 'District', labelPlural: 'Districts', source: 'upload' },
    { role: 'subdivision', label: 'Subdivision', labelPlural: 'Subdivisions', source: 'upload' },
  ],
  officeTitles: ['Candidate', 'Member', 'Trustee', 'Director', 'Commissioner', 'Chair'],
  suggestedReceiptRegime: () => null,
};
