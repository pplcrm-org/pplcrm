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
      for (const field of [...spec.requiredIssuerFields, ...spec.candidateExtraFields]) {
        expect(RECEIPT_ISSUER_FIELDS).toContain(field);
      }
      if (spec.issuance === 'internal') {
        // Internal regimes print receipts: they need a title and a signature requirement.
        expect(spec.receiptTitle.length).toBeGreaterThan(0);
        expect(spec.requiredIssuerFields).toContain('signature_file_id');
        expect(spec.requiredIssuerFields).toContain('org_legal_name');
      } else {
        // External regimes never print: no fields may be required and an explanation must exist.
        expect(spec.requiredIssuerFields).toHaveLength(0);
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

  it('keeps the Alberta auto-issue threshold just above $50', () => {
    expect(RECEIPT_REGIMES.political_ab.autoIssueThresholdCents).toBe(5001);
  });
});
