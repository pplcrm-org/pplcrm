import { describe, expect, it } from 'vitest';
import { RECEIPT_REGIMES, RECEIPT_REGIME_IDS, RECEIPT_ISSUER_FIELDS } from './index';

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
