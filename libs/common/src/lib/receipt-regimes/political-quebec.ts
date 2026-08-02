import type { ReceiptRegimeSpec } from './receipt-regime.types';

/**
 * Quebec political regime — deliberately external-issuance-only.
 *
 * Quebec abolished its provincial political contribution tax credit on January 1, 2013 (the
 * municipal credit ended January 1, 2026), and provincial contributions are processed through
 * Élections Québec, which manages the contribution receipts itself (forms DGE-1431 / DGE-1432).
 * A party or candidate does not issue Quebec tax receipts, so pplCRM never prints one: a Quebec
 * workspace records gifts and can send year-end summaries (non-official statements) only.
 *
 * Sources:
 * - https://www.electionsquebec.qc.ca/en/get-involved/making-a-contribution-to-a-political-party-or-candidate/
 * - https://www.electionsquebec.qc.ca/en/financing-expenses-and-contributions/forms-and-guides/
 * - https://www.revenuquebec.ca/en/citizens/tax-credits/tax-credit-for-contributions-to-authorized-quebec-political-parties/
 */
export const POLITICAL_QUEBEC_REGIME: ReceiptRegimeSpec = {
  id: 'political_qc',
  label: 'Quebec political (receipts issued by Élections Québec)',
  receiptTitle: '',
  issuance: 'external',
  candidateIssuance: 'external',
  issuerRole: 'Élections Québec',
  registrationNumberLabel: '',
  requiredIssuerFields: [],
  candidateExtraFields: [],
  footerLines: [],
  settingsCaveat:
    'Quebec provincial contributions are made through Élections Québec, which issues the ' +
    'contribution receipts; the provincial tax credit was abolished on January 1, 2013. Confirm ' +
    'your obligations with Élections Québec or your own counsel.',
  externalExplanation:
    'Provincial contributions in Quebec are processed through Élections Québec, which issues any ' +
    'contribution receipts. This workspace records gifts and can send year-end giving summaries, ' +
    'but does not print Quebec contribution receipts.',
  sources: [
    'https://www.electionsquebec.qc.ca/en/get-involved/making-a-contribution-to-a-political-party-or-candidate/',
    'https://www.revenuquebec.ca/en/citizens/tax-credits/tax-credit-for-contributions-to-authorized-quebec-political-parties/',
  ],
};
