import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * Canadian municipal — a seat on a city or town council, or the mayoralty.
 *
 * This is the first Canadian jurisdiction that supports at-large seats, and it supports them for
 * two distinct reasons:
 *
 * - A mayor is elected by the whole municipality and has no ward of their own.
 * - Some councils elect every member at large. Vancouver's entire city council is elected
 *   city-wide, so a Vancouver councillor campaign has no ward either. Several smaller
 *   municipalities do the same.
 *
 * An at-large municipal seat's area is simply the municipality named in `office_locality`, which is
 * why locality is required here and optional at higher levels.
 *
 * Vocabulary: "ward" is the default and is correct in Ontario, British Columbia and most of the
 * country. Quebec is the exception — Montreal and other Quebec municipalities call the equivalent
 * area a district (district électoral), so `QC` maps to "District". Note that this is the same word
 * Newfoundland and Labrador uses provincially for a completely different kind of area; the word is
 * only ever a label, and the meaning comes from the boundary set's role.
 *
 * The voting subdivision word is "poll" rather than "polling division". Municipal returning
 * officers in Canada generally say poll, and the shorter word is what appears on municipal
 * election-day paperwork.
 *
 * No chambers. Canadian municipal councils are single bodies.
 *
 * Boundary data: there is no national or provincial publisher of municipal ward maps. Each
 * municipality publishes its own, in whatever format it chooses, or does not publish one at all.
 * So the shipped path for both layers is upload, with drawing available for the municipalities that
 * publish nothing usable and import available when the ward name already sits on each row of a
 * purchased or exported voter list. A typical municipality has roughly 5 to 45 wards, which is
 * small enough to draw by hand in one sitting.
 *
 * Receipting returns null. Municipal contribution rules are set province by province and, in
 * several provinces, by the municipality itself; Ontario municipal candidates issue receipts under
 * the Municipal Elections Act with no provincial tax credit, while Toronto runs its own rebate
 * programme. None of that is modelled in `receipt-regimes/`, and suggesting a provincial or federal
 * political regime for a municipal race would be wrong, so this suggests nothing and leaves the
 * workspace to choose.
 *
 * Sources:
 * - https://vancouver.ca/your-government/city-councillors.aspx (council elected at large)
 * - https://www.ontario.ca/laws/statute/96m32 (Municipal Elections Act, 1996)
 * - https://montreal.ca/en/city-government (borough and district structure)
 */
export const CA_MUNICIPAL_JURISDICTION: JurisdictionSpec = {
  id: 'ca_municipal',
  country: 'CA',
  label: 'Canada — municipal',
  description: 'A seat on a city or town council, or the mayoralty. Some councils are elected at large.',
  seatLabel: 'Ward',
  seatLabelPlural: 'Wards',
  subdivisionLabel: 'Poll',
  subdivisionLabelPlural: 'Polls',
  regionalSeatLabels: {
    QC: 'District',
  },
  regionalSubdivisionLabels: {},
  supportsAtLarge: true,
  usesChamber: false,
  requiresRegion: true,
  requiresLocality: true,
  boundaryLayers: [
    { role: 'seat_area', label: 'Ward', labelPlural: 'Wards', source: 'upload' },
    { role: 'subdivision', label: 'Poll', labelPlural: 'Polls', source: 'upload' },
  ],
  officeTitles: ['Councillor', 'Mayor', 'Deputy Mayor', 'Reeve', 'Candidate'],
  suggestedReceiptRegime: () => null,
};
