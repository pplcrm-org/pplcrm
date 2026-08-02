import type { ReceiptRegimeSpec } from './receipt-regime.types';

/**
 * Federal political regime — official receipts for monetary contributions to a registered party,
 * registered association, or candidate (Canada Elections Act; Income Tax Regulations Part XX
 * §2000 prescribes the contents).
 *
 * Prescribed contents, party/association (ITR 2000(1)): the name of the party/association as
 * recorded in the Chief Electoral Officer's registry; serial number; date the receipt is issued;
 * date the contribution was received; contributor name and address; contribution amount;
 * description and amount of any advantage; eligible amount. Candidate receipts (ITR 2000(2))
 * additionally carry the official agent's name and the polling day.
 *
 * Issuance is restricted: only registered agents (party), electoral district agents
 * (association), or the candidate's official agent may issue receipts, and only for MONETARY
 * contributions. Replacement receipts must show clearly that they replace the original and
 * display both serial numbers; spoiled forms are marked "cancelled" and retained.
 *
 * Sources:
 * - https://laws.justice.gc.ca/eng/regulations/c.r.c.,_c._945/page-31.html (ITR 2000)
 * - https://www.elections.ca/content.aspx?section=pol&dir=can%2Ffin%2FEC20155_c76&document=p1&lang=e
 */
export const POLITICAL_FEDERAL_REGIME: ReceiptRegimeSpec = {
  id: 'political_federal',
  label: 'Federal political (registered party, association, or candidate)',
  receiptTitle: 'Official receipt for income tax purposes',
  issuance: 'internal',
  candidateIssuance: 'internal',
  issuerRole: 'Registered agent / electoral district agent / official agent',
  registrationNumberLabel: 'Elections Canada registry name confirmation (optional reference)',
  requiredIssuerFields: ['org_legal_name', 'agent_name'],
  advisoryIssuerFields: ['signature_file_id'],
  candidateExtraFields: ['polling_day'],
  footerLines: ['Issued under the Income Tax Act (Canada) for a monetary contribution.'],
  settingsCaveat:
    'Federally, only a registered agent (party), electoral district agent (association), or the ' +
    "candidate's official agent may issue contribution receipts, and only for monetary " +
    'contributions. Confirm with Elections Canada or your own counsel that this workspace’s ' +
    'signatory is authorized before issuing receipts.',
  sources: [
    'https://laws.justice.gc.ca/eng/regulations/c.r.c.,_c._945/page-31.html',
    'https://www.elections.ca/content.aspx?section=pol&dir=can%2Ffin%2FEC20155_c76&document=p1&lang=e',
  ],
};
