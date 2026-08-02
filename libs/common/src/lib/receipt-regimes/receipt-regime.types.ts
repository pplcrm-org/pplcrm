/**
 * Receipt regimes — the per-jurisdiction rules for issuing donation/contribution receipts.
 *
 * Each regime is one reviewable data file (cra-charity.ts, political-federal.ts, …) so the
 * prescribed contents and issuance rules sit in plain TypeScript with source URLs, not buried
 * in PDF layout code. The PDF builder and the settings UI both read these specs.
 *
 * "Which regime applies" is workspace configuration (`receipts.regime` setting) — never inferred
 * from org mode. The caveat strings are shown in settings; they are deliberately NOT printed on
 * receipts, and nothing here is a compliance guarantee (EULA §9: the customer is responsible for
 * issuing legally required receipts).
 */

export type ReceiptRegimeId =
  | 'cra_charity'
  | 'political_federal'
  | 'political_on'
  | 'political_bc'
  | 'political_ab'
  | 'political_qc';

export const RECEIPT_REGIME_IDS = [
  'cra_charity',
  'political_federal',
  'political_on',
  'political_bc',
  'political_ab',
  'political_qc',
] as const;

/**
 * Workspace settings a regime can require before receipts may be issued. Each maps 1:1 to a
 * `receipts.<field>` settings key; `getReceiptSettingsStatus` reports the missing ones.
 */
export const RECEIPT_ISSUER_FIELDS = [
  'org_legal_name',
  'org_address',
  'registration_number',
  'signatory_name',
  'signatory_title',
  'signature_file_id',
  'place_of_issue',
  'agent_name',
  'electoral_district',
  'polling_day',
] as const;
export type ReceiptIssuerField = (typeof RECEIPT_ISSUER_FIELDS)[number];

/** Plain-language labels for settings-completeness messages ("Missing: CRA registration number"). */
export const RECEIPT_ISSUER_FIELD_LABELS: Record<ReceiptIssuerField, string> = {
  org_legal_name: 'legal organization name',
  org_address: 'registered organization address',
  registration_number: 'registration number',
  signatory_name: 'signatory name',
  signatory_title: 'signatory title',
  signature_file_id: 'signature image',
  place_of_issue: 'place of issue',
  agent_name: 'authorized agent name',
  electoral_district: 'electoral district',
  polling_day: 'polling day',
};

export interface ReceiptRegimeSpec {
  id: ReceiptRegimeId;
  /** Settings select label. */
  label: string;
  /** The prescribed heading printed at the top of the receipt. */
  receiptTitle: string;
  /**
   * 'internal' — this workspace prints its own receipts. 'external' — an outside body issues
   * them (Quebec: Élections Québec) and the product only records gifts + sends summaries.
   */
  issuance: 'internal' | 'external';
  /**
   * Issuance rule when the gift belongs to a campaign with kind='election' (a candidate
   * campaign). Ontario: Elections Ontario issues candidate receipts, so 'external' there.
   */
  candidateIssuance: 'internal' | 'external';
  /** The legally prescribed role of the person who signs ("Registered agent", "CFO", …). */
  issuerRole: string;
  /** Label for the `receipts.registration_number` field in this regime's settings UI. */
  registrationNumberLabel: string;
  /** Settings that must be present before this regime issues any receipt. */
  requiredIssuerFields: readonly ReceiptIssuerField[];
  /**
   * Settings this regime prescribes that the product reports as missing but never withholds a
   * receipt over. The signature image is the only one: a facsimile signature is prescribed, it is
   * the issuing organization's own decision how it signs, and blocking issuance to enforce it
   * would substitute our judgement for theirs. We say it is missing; they decide.
   */
  advisoryIssuerFields: readonly ReceiptIssuerField[];
  /** Additional settings required when the gift's campaign has kind='election'. */
  candidateExtraFields: readonly ReceiptIssuerField[];
  /**
   * Auto-issue skips gifts at or below this amount (manual issue stays allowed at any amount).
   * Alberta: receipts are mandatory only above $50.
   */
  autoIssueThresholdCents?: number;
  /** Whether the PDF prints a tax-credit-eligibility line (Alberta prescribes one). */
  showsTaxCreditEligibility?: boolean;
  /** Lines printed at the bottom of the receipt (e.g. the CRA name + website reference). */
  footerLines: readonly string[];
  /**
   * Plain-language note shown in the settings UI (never printed on receipts): the workspace must
   * verify signatory eligibility with its own counsel or electoral authority.
   */
  settingsCaveat: string;
  /** Shown instead of the config form when issuance is 'external' (Quebec). */
  externalExplanation?: string;
  /** Shown when candidateIssuance is 'external' and an election-campaign gift is selected (Ontario). */
  candidateExternalExplanation?: string;
  /** Official source URLs backing this spec — for reviewers and counsel, not printed. */
  sources: readonly string[];
}
