import type { ReceiptRegimeSpec } from './receipt-regime.types';

/**
 * Ontario political regime — tax receipts for contributions to Ontario registered parties and
 * constituency associations (Election Finances Act; Elections Ontario CFO handbooks).
 *
 * Issuance: the Chief Financial Officer of a registered party or registered constituency
 * association issues receipts on forms approved by Elections Ontario. CANDIDATE campaigns do not
 * issue their own tax receipts — Elections Ontario issues those. This spec therefore sets
 * candidateIssuance: 'external': gifts to an election-kind campaign are recorded here, and the
 * product explains that Elections Ontario receipts them.
 *
 * Elections Ontario requires CFOs to reconcile tax receipts (issued / cancelled or voided /
 * lost or destroyed / returned), which the issued→cancelled lifecycle supports.
 *
 * Sources:
 * - https://www.elections.on.ca/content/dam/NGW/sitecontent/Compliance%20Documentation/English/Political%20Parties/CFO%20Handbook%20for%20Political%20Parties.pdf
 * - https://www.elections.on.ca/content/dam/NGW/sitecontent/Compliance%20Documentation/English/Candidates/CFO%20Handbook%20for%20Candidates.pdf
 * - https://www.ontario.ca/page/political-contribution-tax-credit-individuals
 */
export const POLITICAL_ONTARIO_REGIME: ReceiptRegimeSpec = {
  id: 'political_on',
  label: 'Ontario political (registered party or constituency association)',
  receiptTitle: 'Official receipt for Ontario income tax purposes',
  issuance: 'internal',
  candidateIssuance: 'external',
  issuerRole: 'Chief Financial Officer',
  registrationNumberLabel: 'Elections Ontario registration identifier',
  registrationNumberHint: 'As recorded on your Elections Ontario registration',
  requiredIssuerFields: ['org_legal_name', 'registration_number', 'agent_name'],
  advisoryIssuerFields: ['signature_file_id'],
  candidateExtraFields: [],
  footerLines: ['Issued for a contribution under the Election Finances Act (Ontario).'],
  settingsCaveat:
    'In Ontario, tax receipts are issued by the CFO of a registered party or constituency ' +
    'association on forms approved by Elections Ontario; candidate-campaign contributions are ' +
    'receipted by Elections Ontario itself. Confirm your receipting authority with Elections ' +
    'Ontario or your own counsel before issuing receipts.',
  candidateExternalExplanation:
    'Contributions to an Ontario candidate campaign are receipted by Elections Ontario, not by ' +
    'the campaign. This gift is recorded here; Elections Ontario issues the tax receipt.',
  sources: [
    'https://www.elections.on.ca/en/political-entities-in-ontario/political-parties/filing-guidelines-for-political-parties.html',
    'https://www.ontario.ca/page/political-contribution-tax-credit-individuals',
  ],
};
