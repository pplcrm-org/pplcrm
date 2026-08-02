import type { ReceiptRegimeSpec } from './receipt-regime.types';

/**
 * British Columbia political regime — income tax receipts for monetary political contributions
 * (B.C. Reg 343/95 "Political Contributions Regulations" under the Income Tax Act; Election Act).
 *
 * Prescribed contents (Reg 343/95 s.2): a statement that it is a receipt for British Columbia
 * income tax purposes; sequential serial numbers (and the serial on the receipt); the amount of
 * each contribution; the date each contribution was received; contributor name and address; the
 * signature of the FINANCIAL AGENT; for a party/association the organization name as filed with
 * the chief electoral officer plus its identity number (Election Act s.192); for a candidate the
 * candidate name, electoral district, final voting day, and candidate identity number.
 *
 * Replacement receipts (s.2(3)) must state they are replacements and show the original serial.
 * Spoiled receipts (s.3(2)) are marked "cancelled" and all copies retained. Monetary
 * contributions only; candidates may only issue for money received after their certificate of
 * candidacy and before the return of the writ (surfaced as a caveat, not enforced logic).
 *
 * Sources:
 * - https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/343_95
 * - https://elections.bc.ca/candidates-parties/making-a-political-contribution/
 */
export const POLITICAL_BC_REGIME: ReceiptRegimeSpec = {
  id: 'political_bc',
  label: 'British Columbia political (registered party, association, or candidate)',
  receiptTitle: 'Receipt for British Columbia income tax purposes',
  issuance: 'internal',
  candidateIssuance: 'internal',
  issuerRole: 'Financial agent',
  registrationNumberLabel: 'Identity number (Election Act s.192)',
  requiredIssuerFields: ['org_legal_name', 'registration_number', 'agent_name'],
  advisoryIssuerFields: ['signature_file_id'],
  candidateExtraFields: ['electoral_district', 'polling_day'],
  footerLines: ['Issued under the Income Tax Act (British Columbia) for a monetary political contribution.'],
  settingsCaveat:
    'In British Columbia, contribution receipts are issued and signed by the financial agent, for ' +
    'monetary contributions only; candidates may only receipt money received after their ' +
    'certificate of candidacy and before the return of the writ. Confirm with Elections BC or ' +
    'your own counsel that this workspace’s signatory is authorized before issuing receipts.',
  sources: [
    'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/343_95',
    'https://elections.bc.ca/candidates-parties/making-a-political-contribution/',
  ],
};
