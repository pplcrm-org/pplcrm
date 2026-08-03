import type { JurisdictionSpec } from './jurisdiction.types';

/**
 * Canadian provincial and territorial — a seat in a provincial or territorial legislature.
 *
 * Vocabulary is where this jurisdiction earns its own file. The default word is "riding", which is
 * right in Ontario, British Columbia and most of the country, and wrong in five places:
 *
 * | Region | Word actually used | Why |
 * | --- | --- | --- |
 * | Alberta (AB) | Constituency | Elections Alberta and the Legislative Assembly both say constituency |
 * | Saskatchewan (SK) | Constituency | Elections Saskatchewan says constituency |
 * | Newfoundland and Labrador (NL) | District | The House of Assembly's seats are districts |
 * | Prince Edward Island (PE) | District | The Legislative Assembly's seats are districts |
 * | Quebec (QC) | Circonscription | The French term is used in English-language Quebec politics too |
 *
 * These are exceptions in `regionalSeatLabels`, applied automatically, so an Alberta campaign reads
 * "Constituency" on every screen without anyone configuring anything. That is the point of the
 * exception table: the manual `seat_label_override` exists for races these five rows do not cover,
 * not as the mechanism for the common cases.
 *
 * The member's title varies the same way and for the same reason: MPP in Ontario, MNA in Quebec,
 * MHA in Newfoundland and Labrador, MLA everywhere else. All of them are offered in `officeTitles`
 * rather than filtered by region, because the picker also allows free text and a wrong filter is
 * worse than a slightly long list.
 *
 * No at-large seats. Every provincial and territorial seat in Canada is contested in a single
 * district. (Nunavut and the Northwest Territories run consensus governments with no political
 * parties, but the seats are still single-district seats.)
 *
 * No chambers. Every province abolished its upper house long ago — Quebec's Legislative Council was
 * the last, abolished in 1968 — so provincial legislatures are unicameral and there is no chamber
 * to choose. This is the difference from `us_state`, where both houses are elected.
 *
 * Region is required because a provincial riding name only identifies a seat once you know the
 * province, and because the boundary set, the vocabulary and the receipt regime all depend on it.
 *
 * Boundary data: there is no single national publisher. Each province runs its own electoral
 * boundaries commission with its own format and its own redistribution schedule, which is why the
 * bundled layers here carry no `bundledSlug` — the slug is composed per province and vintage. The
 * four largest provinces come first; a province with nothing bundled falls back to upload or draw.
 *
 * Receipting: four provinces have a receipt regime modelled in `receipt-regimes/`, and the
 * suggestion is region-specific. Every other province returns null rather than guessing, because
 * suggesting a neighbouring province's regime would be worse than suggesting nothing.
 *
 * Sources:
 * - https://www.elections.ab.ca/ (Alberta: constituency)
 * - https://www.elections.sk.ca/ (Saskatchewan: constituency)
 * - https://www.assembly.nl.ca/ (Newfoundland and Labrador: district)
 * - https://www.electionsquebec.qc.ca/ (Quebec: circonscription)
 */
export const CA_PROVINCIAL_JURISDICTION: JurisdictionSpec = {
  id: 'ca_provincial',
  country: 'CA',
  label: 'Canada — provincial or territorial',
  description: 'A seat in a provincial or territorial legislature. The word for it varies by province.',
  seatLabel: 'Riding',
  seatLabelPlural: 'Ridings',
  subdivisionLabel: 'Polling division',
  subdivisionLabelPlural: 'Polling divisions',
  regionalSeatLabels: {
    AB: 'Constituency',
    SK: 'Constituency',
    NL: 'District',
    PE: 'District',
    QC: 'Circonscription',
  },
  regionalSubdivisionLabels: {},
  supportsAtLarge: false,
  usesChamber: false,
  requiresRegion: true,
  requiresLocality: false,
  boundaryLayers: [
    { role: 'seat_area', label: 'Riding', labelPlural: 'Ridings', source: 'bundled' },
    { role: 'subdivision', label: 'Polling division', labelPlural: 'Polling divisions', source: 'bundled' },
  ],
  officeTitles: ['MLA', 'MPP', 'MNA', 'MHA', 'Member of the Legislative Assembly', 'Candidate'],
  suggestedReceiptRegime: (region) => {
    switch (region) {
      case 'ON':
        return 'political_on';
      case 'BC':
        return 'political_bc';
      case 'AB':
        return 'political_ab';
      case 'QC':
        return 'political_qc';
      default:
        return null;
    }
  },
};
