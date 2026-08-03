import { JURISDICTIONS, regionsForCountry, type JurisdictionId } from '../jurisdictions';

import type { ReceiptRegimeId } from './receipt-regime.types';

/**
 * What a campaign's declared office can tell the donations settings page about receipting — and
 * the one thing it must never do, which is choose.
 *
 * `receipt-regime.types.ts` records the rule this file has to honour: "which regime applies is
 * workspace configuration (`receipts.regime` setting) — never inferred". That rule exists because
 * the regime is a statement about how the ORGANIZATION is registered, not about which seat it is
 * contesting. A Toronto campaign's gifts might be receipted by a registered constituency
 * association under the Ontario regime, or by a federal riding association under the federal
 * regime, or not receipted by this workspace at all. The campaign record cannot distinguish those,
 * so this module produces a hint to show BESIDE the picker and never a value to put INTO it.
 *
 * Concretely: nothing here writes a setting, nothing here returns a default, and the settings page
 * must not pre-select the suggested regime. A wrongly pre-selected regime prints wrong legal
 * wording on a tax document, and it does so silently, because a pre-selected field looks answered.
 *
 * The direction of the dependency is worth noting: this module reads `../jurisdictions`, and the
 * jurisdictions module refers back to `ReceiptRegimeId` with a type-only import that disappears at
 * compile time. There is therefore no runtime cycle between the two folders.
 */

/**
 * Why a US political workspace is offered no regime at all.
 *
 * Contributions to US candidates, parties and political committees are not deductible for federal
 * income tax, so there is no receipt to issue and no regime to model — every US jurisdiction's
 * `suggestedReceiptRegime` returns null, and that null is a statement of fact rather than a gap
 * waiting to be filled. Offering such a workspace a Canadian regime would be worse than offering it
 * nothing: the Canadian receipt wording asserts an entitlement that does not exist.
 *
 * Two adjacent things this string deliberately does not mention, because pplCRM does not do them:
 *
 * - **FEC and state disclosure reporting.** US committees must report contributions, collect
 *   occupation and employer past the itemization threshold, and enforce per-donor limits. That is a
 *   separate compliance system, it is not built here, and the last sentence of this string exists
 *   so nobody reads the absence of receipting as a claim that filing is handled.
 * - **US state political contribution credits.** A small number of states offer one. Which states
 *   and on what terms has to be verified against current state law before any of it is built.
 *
 * A US 501(c)(3) charity is a genuinely different case — it does issue deductible receipts, and
 * there is no US charity regime in this folder yet. It is not covered by this string because a
 * charity workspace is not electoral and so never carries a US political jurisdiction.
 */
export const US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED =
  'Contributions to United States candidates, parties and political committees are not ' +
  'tax-deductible, so there is no tax receipt to issue and no receipting regime that applies. ' +
  'Gifts are still recorded here in full. pplCRM does not prepare FEC or state disclosure filings.';

/**
 * A hint to display next to the regime picker. Never a selection.
 *
 * `suggested` — the campaign's office points at one of the regimes in this folder.
 * `not_receipted` — there is nothing to pick, and the page should say why instead of showing a
 * picker that cannot be answered correctly.
 */
export type CampaignReceiptRegimeHint =
  | { kind: 'suggested'; regime: ReceiptRegimeId; message: string }
  | { kind: 'not_receipted'; message: string };

/** The region's full name if this module knows it, else the stored code, else null. */
function regionLabel(country: 'CA' | 'US' | null, region: string | null): string | null {
  if (!region) return null;
  return regionsForCountry(country).find((r) => r.code === region)?.name ?? region;
}

/**
 * The receipting hint for a campaign's declared office, or null when there is nothing useful to
 * say.
 *
 * Null is the honest answer for a Canadian province with no regime modelled (Manitoba,
 * Saskatchewan, the Atlantic provinces, the territories), for municipal races, and for the `other`
 * jurisdiction. Suggesting a neighbouring province's regime would be worse than suggesting nothing,
 * and saying "not receipted" there would be false — those contributions often are receipted, just
 * not by a regime this product models yet.
 *
 * The caller supplies the campaign's `jurisdiction` and `office_region`. It gets back a message to
 * show and, in the `suggested` case, a regime id it can look up in `RECEIPT_REGIMES` for the
 * regime's own label. It does not get anything it can assign to the setting.
 */
export function receiptRegimeHintForCampaign(
  jurisdiction: JurisdictionId | null,
  region: string | null,
): CampaignReceiptRegimeHint | null {
  if (!jurisdiction) return null;
  const spec = JURISDICTIONS[jurisdiction];

  // Checked before the suggestion, not after: for US offices the null from suggestedReceiptRegime
  // has a specific meaning that the page must state, rather than being "no opinion". If a US
  // charity regime is ever added, it belongs to a non-electoral workspace and does not change this
  // branch — see US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED.
  if (spec.country === 'US') {
    return { kind: 'not_receipted', message: US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED };
  }

  const regime = spec.suggestedReceiptRegime(region);
  if (!regime) return null;

  const where = regionLabel(spec.country, region);
  return {
    kind: 'suggested',
    regime,
    message:
      `This campaign contests a ${spec.label} office${where ? ` in ${where}` : ''}, where this ` +
      'regime usually applies. It is a suggestion only, and nothing has been selected for you: ' +
      'which regime you may issue under depends on how your organization is registered, which only ' +
      'you can answer.',
  };
}
