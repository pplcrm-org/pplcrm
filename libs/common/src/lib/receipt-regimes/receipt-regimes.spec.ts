import { describe, expect, it } from 'vitest';
import {
  RECEIPT_REGIMES,
  RECEIPT_REGIME_IDS,
  RECEIPT_ISSUER_FIELDS,
  US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED,
  receiptRegimeHintForCampaign,
} from './index';

describe('receipt regimes', () => {
  it('registers every regime id exactly once', () => {
    expect(Object.keys(RECEIPT_REGIMES).sort()).toEqual([...RECEIPT_REGIME_IDS].sort());
    for (const id of RECEIPT_REGIME_IDS) {
      expect(RECEIPT_REGIMES[id].id).toBe(id);
    }
  });

  it('declares everything the PDF builder and settings UI read', () => {
    for (const spec of Object.values(RECEIPT_REGIMES)) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.issuerRole.length).toBeGreaterThan(0);
      expect(spec.settingsCaveat.length).toBeGreaterThan(0);
      expect(spec.sources.length).toBeGreaterThan(0);
      for (const field of [...spec.requiredIssuerFields, ...spec.advisoryIssuerFields, ...spec.candidateExtraFields]) {
        expect(RECEIPT_ISSUER_FIELDS).toContain(field);
      }
      if (spec.issuance === 'internal') {
        // Internal regimes print receipts: they need a title and an issuing organization.
        expect(spec.receiptTitle.length).toBeGreaterThan(0);
        expect(spec.requiredIssuerFields).toContain('org_legal_name');
      } else {
        // External regimes never print: no fields may be required and an explanation must exist.
        expect(spec.requiredIssuerFields).toHaveLength(0);
        expect(spec.advisoryIssuerFields).toHaveLength(0);
        expect(spec.externalExplanation ?? '').not.toHaveLength(0);
      }
      if (spec.candidateIssuance === 'external' && spec.issuance === 'internal') {
        expect(spec.candidateExternalExplanation ?? '').not.toHaveLength(0);
      }
    }
  });

  it('keeps the Quebec regime external-only (credit abolished 2013; Élections Québec issues)', () => {
    expect(RECEIPT_REGIMES.political_qc.issuance).toBe('external');
  });

  /**
   * Every printing regime prescribes a signature, and none of them may withhold a receipt over
   * it. Whether to print a facsimile signature is the issuing organization's decision; the
   * product's job is to say the field is empty, not to refuse the document. Moving
   * `signature_file_id` back into `requiredIssuerFields` would silently reinstate that refusal
   * inside the issue guard, which is why this is asserted rather than left to review.
   */
  it('treats the signature image as advisory, never as a condition of issuing', () => {
    for (const spec of Object.values(RECEIPT_REGIMES)) {
      expect(spec.requiredIssuerFields).not.toContain('signature_file_id');
      if (spec.issuance === 'internal') {
        expect(spec.advisoryIssuerFields).toContain('signature_file_id');
      }
    }
  });

  it('keeps the Alberta auto-issue threshold just above $50', () => {
    expect(RECEIPT_REGIMES.political_ab.autoIssueThresholdCents).toBe(5001);
  });
});

describe('receiptRegimeHintForCampaign', () => {
  it('suggests the regime of the four provinces that have one, and the federal regime', () => {
    expect(receiptRegimeHintForCampaign('ca_provincial', 'ON')).toMatchObject({
      kind: 'suggested',
      regime: 'political_on',
    });
    expect(receiptRegimeHintForCampaign('ca_provincial', 'BC')).toMatchObject({
      kind: 'suggested',
      regime: 'political_bc',
    });
    expect(receiptRegimeHintForCampaign('ca_provincial', 'AB')).toMatchObject({
      kind: 'suggested',
      regime: 'political_ab',
    });
    expect(receiptRegimeHintForCampaign('ca_provincial', 'QC')).toMatchObject({
      kind: 'suggested',
      regime: 'political_qc',
    });
    expect(receiptRegimeHintForCampaign('ca_federal', null)).toMatchObject({
      kind: 'suggested',
      regime: 'political_federal',
    });
  });

  /**
   * The hint names a regime and says why, and it must also say that nothing was chosen. The
   * settings page is expected to render this next to an UNSET picker; a page that pre-selects the
   * suggestion would put unverified legal wording on a tax receipt without anyone deciding to.
   */
  it('states in the suggestion itself that nothing has been selected', () => {
    const hint = receiptRegimeHintForCampaign('ca_provincial', 'AB');
    expect(hint?.message).toMatch(/suggestion only/i);
    expect(hint?.message).toMatch(/nothing has been selected/i);
    expect(hint?.message).toContain('Alberta');
  });

  /**
   * US political contributions are not tax-deductible, so there is no regime to offer and the page
   * must say so rather than showing a picker of Canadian regimes. The last assertion guards the
   * other half of that honesty: the product does not file FEC or state disclosure reports either,
   * and the explanation says so out loud.
   */
  it('tells a US political workspace plainly that there is nothing to receipt', () => {
    for (const jurisdiction of ['us_federal', 'us_state', 'us_local'] as const) {
      expect(receiptRegimeHintForCampaign(jurisdiction, 'OH')).toEqual({
        kind: 'not_receipted',
        message: US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED,
      });
    }
    expect(US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED).toMatch(/not\s+tax-deductible/i);
    expect(US_POLITICAL_CONTRIBUTIONS_NOT_RECEIPTED).toMatch(/does not prepare FEC or state disclosure filings/i);
  });

  /** Silence, not a guess: no regime is modelled for these, and a neighbour's regime is not close enough. */
  it('says nothing at all where no regime is modelled', () => {
    expect(receiptRegimeHintForCampaign('ca_provincial', 'MB')).toBeNull();
    expect(receiptRegimeHintForCampaign('ca_provincial', null)).toBeNull();
    expect(receiptRegimeHintForCampaign('ca_municipal', 'ON')).toBeNull();
    expect(receiptRegimeHintForCampaign('other', null)).toBeNull();
    expect(receiptRegimeHintForCampaign(null, 'ON')).toBeNull();
  });
});
