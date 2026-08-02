import type { ReceiptRegimeSpec } from './receipt-regime.types';

/**
 * CRA charitable regime — official donation receipts issued by a registered charity or other
 * qualified donee (churches, registered non-profits).
 *
 * Prescribed contents (cash gifts): the statement "Official receipt for income tax purposes";
 * charity name and address as registered with the CRA; CRA registration number; unique serial
 * number; place (city/town/municipality) of issue; date or year the gift was received; date the
 * receipt was issued; donor full name and address; amount of the gift; amount and description of
 * any advantage; eligible amount; signature of an individual authorized to acknowledge gifts
 * (facsimile signatures permitted, Income Tax Regulations 3501(3)); the name and website address
 * of the Canada Revenue Agency.
 *
 * Replacement receipts must state clearly that they replace the original and show BOTH serial
 * numbers (ITR 3501(4)). Spoiled/cancelled receipts are marked "cancelled" and retained — never
 * deleted. In-kind (non-cash) receipts need a gift description and appraiser details; pplCRM
 * records monetary gifts only, so in-kind receipting is out of scope.
 *
 * Sources:
 * - https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/what-information-must-on-official-donation-receipt-a-registered-charity.html
 * - https://laws.justice.gc.ca/eng/regulations/c.r.c.,_c._945/page-38.html (ITR 3501)
 * - https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/policies-guidance/policy-statement-014-computer-generated-official-donation-receipts.html
 */
export const CRA_CHARITY_REGIME: ReceiptRegimeSpec = {
  id: 'cra_charity',
  label: 'Registered charity (CRA official donation receipts)',
  receiptTitle: 'Official receipt for income tax purposes',
  issuance: 'internal',
  candidateIssuance: 'internal',
  issuerRole: 'Individual authorized by the charity to acknowledge gifts',
  registrationNumberLabel: 'CRA registration number (e.g. 123456789 RR 0001)',
  requiredIssuerFields: ['org_legal_name', 'org_address', 'registration_number', 'place_of_issue', 'signatory_name'],
  advisoryIssuerFields: ['signature_file_id'],
  candidateExtraFields: [],
  footerLines: ['Canada Revenue Agency · canada.ca/charities-giving'],
  settingsCaveat:
    'Official donation receipts may only be issued by a registered charity or other qualified donee. ' +
    'Confirm your registration status and receipting practices with your own counsel or the CRA — ' +
    'pplCRM does not provide legal or tax advice.',
  sources: [
    'https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts/what-information-must-on-official-donation-receipt-a-registered-charity.html',
    'https://laws.justice.gc.ca/eng/regulations/c.r.c.,_c._945/page-38.html',
  ],
};
