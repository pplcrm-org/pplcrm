/**
 * Jurisdictions — what office a campaign is contesting, and what words to use for it.
 *
 * Each jurisdiction is one reviewable data file (ca-federal.ts, us-state.ts, …) so the vocabulary,
 * the regional exceptions and the boundary expectations sit in plain TypeScript with sources, not
 * scattered through form templates and grid headers. The campaign form, the household grid, the
 * canvassing turf cutter and the donation settings page all read the same specs.
 *
 * ## Why one flat enum instead of separate country and level columns
 *
 * `ca_provincial` and `us_state` are both "the level below national", but they behave differently
 * enough that a country column plus a level column would need a lookup table anyway: US states
 * have two chambers with two different district maps, Canadian provinces have one; US states elect
 * a governor statewide, provinces do not elect a premier at all. One flat id excludes the invalid
 * combinations by construction, and it matches the six-entry RECEIPT_REGIME_IDS pattern that is
 * already working next door. The cost is that adding a country adds three entries rather than one.
 *
 * ## Why the vocabulary is data and never a hard-coded word
 *
 * The word "ward" means a seat area in Ontario and a voting subdivision in Massachusetts. The word
 * "district" means a seat area federally in the United States and a seat area provincially in
 * Newfoundland and Labrador, but in Ontario provincially the word is "riding". No fixed mapping
 * from a label to a meaning is correct everywhere, so meaning never comes from the word. It comes
 * from `BoundaryRole` on the boundary set, and the word is only ever a display label resolved
 * through `seatLabelFor` / `subdivisionLabelFor`.
 *
 * ## Naming
 *
 * This is called a jurisdiction, not a mode. There are already two things called modes — the
 * tenant's org mode (`org-mode.ts`) and the campaign's kind (office vs election) — and that file's
 * own header already warns about the two being confused. A third "mode" would make it worse.
 */

import type { ReceiptRegimeId } from '../receipt-regimes/receipt-regime.types';

// Resolving a label needs the spec registry. The registry lives in ./index because that is where
// the seven data files are aggregated, so this import points back at the folder barrel. It is only
// ever read inside a function body, never while this module is evaluating, so the cycle resolves
// cleanly under ES modules: by the time anyone calls a resolver, both modules are fully evaluated.
import { JURISDICTIONS } from './index';

/**
 * Every jurisdiction pplCRM models. `other` is the honest default: it covers every campaign that
 * existed before this registry, plus every race the product does not model (school board, county
 * commission, band council, special district, and anything outside Canada and the United States).
 */
export const JURISDICTION_IDS = [
  'ca_federal',
  'ca_provincial',
  'ca_municipal',
  'us_federal',
  'us_state',
  'us_local',
  'other',
] as const;
export type JurisdictionId = (typeof JURISDICTION_IDS)[number];

/**
 * Whether the seat has its own territory.
 *
 * `district` — one seat, one bounded area (a riding, a congressional district, a city ward).
 * `at_large` — elected across the whole region or locality with no seat area of its own. This is
 * not a local-only case: a US Senator and a state governor are both elected statewide, and six
 * states currently elect their single member of the House of Representatives statewide too.
 */
export const SEAT_TYPES = ['district', 'at_large'] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

export const SEAT_TYPE_LABELS: Record<SeatType, string> = {
  district: 'A specific district',
  at_large: 'At large — no district',
};

/**
 * Which house of a two-house legislature the seat sits in.
 *
 * Only `us_state` uses this, and the reason is data, not terminology: a state senate district and
 * a state house district are two different boundary layers published as two different files, and
 * neither can be derived from the other. Without knowing the chamber there is no way to pick which
 * map to match households against.
 */
export const CHAMBERS = ['upper', 'lower'] as const;
export type Chamber = (typeof CHAMBERS)[number];

export const CHAMBER_LABELS: Record<Chamber, string> = {
  upper: 'Upper chamber (state senate)',
  lower: 'Lower chamber (state house or assembly)',
};

/**
 * What a boundary set means, independent of what its features are called.
 *
 * `seat_area` — the territory that elects one representative.
 * `subdivision` — a voting subdivision inside a seat area, the territory served by one polling
 *   place. Roughly one evening's canvassing walk, where a seat area is far too large to be one.
 * `locality` — the outline of a municipality or county. Used to draw the area of an at-large seat,
 *   which by definition has no seat area of its own, and to scope local boundary sets.
 *
 * This is the field that makes Massachusetts and Ontario both representable. A Toronto ward is a
 * set with role `seat_area`; a Boston ward is a set with role `subdivision`, sitting alongside a
 * second `subdivision` set for its precincts. Both are called "ward" and they mean opposite things,
 * and nothing in the product ever has to decide which from the name.
 */
export type BoundaryRole = 'seat_area' | 'subdivision' | 'locality';

/**
 * Where a boundary set's polygons came from.
 *
 * `bundled` — shipped with the product as a build asset from an authoritative national publisher.
 * `upload` — an admin uploaded a GeoJSON file.
 * `import` — no polygons at all; the area name arrived already assigned per household in a CSV.
 * `drawn` — an admin drew the polygons on the map inside the app.
 */
export type BoundarySource = 'bundled' | 'upload' | 'import' | 'drawn';

/**
 * One boundary layer a jurisdiction expects to have.
 *
 * `source` records the path pplCRM ships for that layer, which is what the boundaries settings page
 * should offer first. It is not a restriction: a workspace can always upload, draw or import
 * instead, and `boundary_sets.source` records what actually happened for each individual set.
 */
export interface BoundaryLayerSpec {
  role: BoundaryRole;
  /** The word for one feature of this layer: 'Riding', 'Polling division'. */
  label: string;
  labelPlural: string;
  source: BoundarySource;
  /**
   * The slug of the bundled set, present only when one file covers the whole country. Omitted for
   * bundled layers published per region or per chamber (Canadian provincial commissions publish
   * one map each; the Census Bureau publishes state legislative districts per state per chamber),
   * because those slugs are composed at ingest time from the region, chamber and vintage.
   */
  bundledSlug?: string;
}

export interface JurisdictionSpec {
  id: JurisdictionId;
  /** Derivable from the id; stored explicitly so reading a spec file tells you. Null for `other`. */
  country: 'CA' | 'US' | null;
  /** Picker label, e.g. 'Canada — federal'. */
  label: string;
  /** One plain sentence under the picker option. */
  description: string;
  /** Default word for one seat area, before regional exceptions and the campaign's own override. */
  seatLabel: string;
  seatLabelPlural: string;
  /** Default word for one voting subdivision. */
  subdivisionLabel: string;
  subdivisionLabelPlural: string;
  /** Region code -> the seat word that region actually uses. Applied automatically. */
  regionalSeatLabels: Readonly<Record<string, string>>;
  /** Region code -> the voting-subdivision word that region actually uses. */
  regionalSubdivisionLabels: Readonly<Record<string, string>>;
  /** Whether a seat at this level can be elected across the whole region with no seat area. */
  supportsAtLarge: boolean;
  /** Whether the campaign must say which house of a two-house legislature the seat is in. */
  usesChamber: boolean;
  /** Whether the campaign must name a province, territory or state. */
  requiresRegion: boolean;
  /** Whether the campaign must name a municipality or county. */
  requiresLocality: boolean;
  boundaryLayers: readonly BoundaryLayerSpec[];
  /** Titles offered in the office-title picker. Free text is still allowed. */
  officeTitles: readonly string[];
  /**
   * The receipt regime this jurisdiction suggests for the donations settings page, or null when
   * there is nothing to suggest. Only a suggestion — the regime stays workspace configuration.
   */
  suggestedReceiptRegime: (region: string | null) => ReceiptRegimeId | null;
}

/**
 * Plural form of a display label.
 *
 * Every default label in this registry carries its own explicit plural, so this rule never runs on
 * them. It runs on exactly two inputs: the regional exception words (Constituency, District,
 * Circonscription, Election district) and whatever a campaign typed into `seat_label_override`.
 * Regular English pluralisation is correct for all of the first group, and for a user-typed word it
 * is a reasonable guess that the user can always avoid by typing the plural they want as part of
 * the override.
 */
function pluralizeLabel(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

/** Trimmed override text, or undefined when the override is absent, empty or whitespace. */
function usableOverride(override: string | null | undefined): string | undefined {
  const trimmed = override?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The word for one seat area.
 *
 * Resolution order is explicit override, then regional exception, then the spec default. The
 * override wins because a campaign knows its own race better than any table does; the regional
 * exception comes next because it is right far more often than the country-level default. An
 * Alberta provincial campaign gets "Constituency" without anyone configuring anything.
 */
export function seatLabelFor(j: JurisdictionId, region: string | null, override: string | null): string {
  const chosen = usableOverride(override);
  if (chosen) return chosen;
  const spec = JURISDICTIONS[j];
  return (region ? spec.regionalSeatLabels[region] : undefined) ?? spec.seatLabel;
}

/** Plural of {@link seatLabelFor} — "across 12 ridings", "across 8 constituencies". */
export function seatLabelPluralFor(j: JurisdictionId, region: string | null, override: string | null): string {
  const chosen = usableOverride(override);
  if (chosen) return pluralizeLabel(chosen);
  const spec = JURISDICTIONS[j];
  const regional = region ? spec.regionalSeatLabels[region] : undefined;
  return regional ? pluralizeLabel(regional) : spec.seatLabelPlural;
}

/**
 * The word for one voting subdivision.
 *
 * There is no override parameter, and that is deliberate: `campaigns.seat_label_override` renames
 * the seat the campaign is contesting, which is the thing a candidate has an opinion about. The
 * subdivision word is a property of where you are, not of what you are running for.
 */
export function subdivisionLabelFor(j: JurisdictionId, region: string | null): string {
  const spec = JURISDICTIONS[j];
  return (region ? spec.regionalSubdivisionLabels[region] : undefined) ?? spec.subdivisionLabel;
}

/** Plural of {@link subdivisionLabelFor} — "across 40 precincts", "across 40 election districts". */
export function subdivisionLabelPluralFor(j: JurisdictionId, region: string | null): string {
  const spec = JURISDICTIONS[j];
  const regional = region ? spec.regionalSubdivisionLabels[region] : undefined;
  return regional ? pluralizeLabel(regional) : spec.subdivisionLabelPlural;
}

/** Narrows an unknown value — a stored column, a query parameter — to a known jurisdiction id. */
export function isJurisdictionId(v: unknown): v is JurisdictionId {
  return typeof v === 'string' && (JURISDICTION_IDS as readonly string[]).includes(v);
}
