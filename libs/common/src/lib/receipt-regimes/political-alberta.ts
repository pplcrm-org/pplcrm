import type { ReceiptRegimeSpec } from './receipt-regime.types';

/**
 * Alberta political regime — official contribution receipts under the Election Finances and
 * Contributions Disclosure Act, administered by Elections Alberta.
 *
 * Issuance: the Chief Financial Officer of the political participant issues official
 * contribution receipts. Receipts are REQUIRED for contributions over $50 and may be issued for
 * smaller amounts when the donor asks — auto-issue therefore skips gifts of $50 or less
 * (autoIssueThresholdCents), while manual issue stays available at any amount. The official
 * receipt must indicate whether the contribution is eligible for the Alberta political
 * contributions tax credit (showsTaxCreditEligibility).
 *
 * Sources:
 * - https://www.elections.ab.ca/finance/contributions/
 * - https://www.bennettjones.com/Insights/Blogs/Navigating-Political-Contributions-Albertas-Elections-Finances-and-Contributions-Disclosure-Act
 */
export const POLITICAL_ALBERTA_REGIME: ReceiptRegimeSpec = {
  id: 'political_ab',
  label: 'Alberta political (registered party, constituency association, or candidate)',
  receiptTitle: 'Official contribution receipt',
  issuance: 'internal',
  candidateIssuance: 'internal',
  issuerRole: 'Chief Financial Officer',
  registrationNumberLabel: 'Elections Alberta registration identifier',
  requiredIssuerFields: ['org_legal_name', 'org_address', 'agent_name', 'signature_file_id'],
  candidateExtraFields: [],
  autoIssueThresholdCents: 5001,
  showsTaxCreditEligibility: true,
  footerLines: ['Issued under the Election Finances and Contributions Disclosure Act (Alberta).'],
  settingsCaveat:
    'In Alberta, official contribution receipts are issued by the Chief Financial Officer and are ' +
    'required for contributions over $50. The receipt must state whether the contribution is ' +
    'eligible for the Alberta political contributions tax credit. Confirm your receipting ' +
    'obligations with Elections Alberta or your own counsel before issuing receipts.',
  sources: ['https://www.elections.ab.ca/finance/contributions/'],
};
