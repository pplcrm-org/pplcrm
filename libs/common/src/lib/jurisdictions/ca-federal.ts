import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * Canadian federal — a seat in the House of Commons.
 *
 * Vocabulary: the legal term is "electoral district", but nobody says it. Campaign staff, media and
 * Elections Canada's own public-facing material all say "riding", so that is the default word here.
 * There are no regional exceptions federally: the word is the same in every province.
 *
 * No at-large seats. Every one of the 343 seats in the House of Commons is contested in a single
 * electoral district, and Canada has never had a federal at-large seat. `supportsAtLarge` is false,
 * which is what stops the campaign form from offering an option that cannot exist.
 *
 * No chambers. The Senate of Canada is appointed by the Governor General on the Prime Minister's
 * advice, not elected, so there is no second chamber for a campaign to contest. This is why
 * `usesChamber` is false here but true for `us_state`, where both houses are elected.
 *
 * No region. A federal riding is named and numbered nationally and a riding name identifies the
 * seat on its own, so asking which province adds a field without adding information. Contrast
 * `ca_provincial`, where "Calgary-Elbow" only makes sense once you know it is Alberta.
 *
 * Boundary data: Elections Canada publishes the full national set. The 2023 Representation Order
 * raised the number of seats from 338 to 343 and redrew boundaries, which is exactly why bundled
 * sets are versioned by vintage and never updated in place — a campaign may need the outgoing map
 * for historical comparison and the incoming map for targeting at the same time.
 *
 * Receipting: federal political contributions are receipted by the registered party, electoral
 * district association or candidate under the Canada Elections Act, and the federal political
 * contribution tax credit applies, so this jurisdiction suggests the federal political regime.
 *
 * Sources:
 * - https://www.elections.ca/content.aspx?section=res&dir=cir/list&document=index&lang=e
 * - https://www.elections.ca/content.aspx?section=pol&document=index&lang=e (political financing)
 */
export const CA_FEDERAL_JURISDICTION: JurisdictionSpec = {
  id: 'ca_federal',
  country: 'CA',
  label: 'Canada — federal',
  description: 'A seat in the House of Commons. Contested in a riding.',
  seatLabel: 'Riding',
  seatLabelPlural: 'Ridings',
  subdivisionLabel: 'Polling division',
  subdivisionLabelPlural: 'Polling divisions',
  regionalSeatLabels: {},
  regionalSubdivisionLabels: {},
  supportsAtLarge: false,
  usesChamber: false,
  requiresRegion: false,
  requiresLocality: false,
  boundaryLayers: [
    {
      role: 'seat_area',
      label: 'Riding',
      labelPlural: 'Ridings',
      source: 'bundled',
      bundledSlug: 'ca-fed-2023',
    },
    {
      role: 'subdivision',
      label: 'Polling division',
      labelPlural: 'Polling divisions',
      source: 'bundled',
      bundledSlug: 'ca-fed-pd-2023',
    },
  ],
  officeTitles: ['MP', 'Member of Parliament', 'Candidate'],
  suggestedReceiptRegime: () => 'political_federal',
};
