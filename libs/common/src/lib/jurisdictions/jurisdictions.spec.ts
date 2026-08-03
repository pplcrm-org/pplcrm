import { describe, expect, it } from 'vitest';
import {
  CA_PROVINCES,
  JURISDICTIONS,
  JURISDICTION_IDS,
  US_AT_LARGE_CONGRESSIONAL_STATES,
  US_STATES,
  isJurisdictionId,
  regionsForCountry,
  seatLabelFor,
  seatLabelPluralFor,
  subdivisionLabelFor,
  subdivisionLabelPluralFor,
} from './index';

describe('jurisdiction registry', () => {
  it('registers every jurisdiction id exactly once', () => {
    expect(Object.keys(JURISDICTIONS).sort()).toEqual([...JURISDICTION_IDS].sort());
    for (const id of JURISDICTION_IDS) {
      expect(JURISDICTIONS[id].id).toBe(id);
    }
  });

  it('declares everything the campaign form and the label resolvers read', () => {
    for (const spec of Object.values(JURISDICTIONS)) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.seatLabel.length).toBeGreaterThan(0);
      expect(spec.seatLabelPlural.length).toBeGreaterThan(0);
      expect(spec.subdivisionLabel.length).toBeGreaterThan(0);
      expect(spec.subdivisionLabelPlural.length).toBeGreaterThan(0);
      expect(spec.officeTitles.length).toBeGreaterThan(0);
      // Every jurisdiction expects both a seat-area layer and a voting-subdivision layer, because
      // an at-large campaign still canvasses by subdivision even though nobody is elected by one.
      expect(spec.boundaryLayers.map((l) => l.role)).toContain('seat_area');
      expect(spec.boundaryLayers.map((l) => l.role)).toContain('subdivision');
    }
  });

  it('names a bundled slug only on bundled layers', () => {
    for (const spec of Object.values(JURISDICTIONS)) {
      for (const layer of spec.boundaryLayers) {
        if (layer.source !== 'bundled') expect(layer.bundledSlug).toBeUndefined();
      }
    }
  });

  it('derives country from the id, with other having none', () => {
    expect(JURISDICTIONS.ca_federal.country).toBe('CA');
    expect(JURISDICTIONS.ca_provincial.country).toBe('CA');
    expect(JURISDICTIONS.ca_municipal.country).toBe('CA');
    expect(JURISDICTIONS.us_federal.country).toBe('US');
    expect(JURISDICTIONS.us_state.country).toBe('US');
    expect(JURISDICTIONS.us_local.country).toBe('US');
    expect(JURISDICTIONS.other.country).toBeNull();
  });
});

/**
 * At-large is the case a shared "national legislature" abstraction gets wrong. US senators and
 * state governors are elected statewide with no district, so those jurisdictions must allow it;
 * Canada elects every federal and provincial member in a single riding and appoints its Senate, so
 * those two must refuse it. Turning either of these into `true` would offer a campaign an option
 * that cannot exist in its country.
 */
describe('at-large support', () => {
  it('is refused only for Canadian federal and provincial seats', () => {
    const refusing = JURISDICTION_IDS.filter((id) => !JURISDICTIONS[id].supportsAtLarge);
    expect([...refusing].sort()).toEqual(['ca_federal', 'ca_provincial']);
  });

  it('lists the states that elect their single House member statewide', () => {
    // Six under the 2020 apportionment; it was seven before Montana gained a second seat.
    expect([...US_AT_LARGE_CONGRESSIONAL_STATES]).toEqual(['AK', 'DE', 'ND', 'SD', 'VT', 'WY']);
    const stateCodes = US_STATES.map((s) => s.code);
    for (const code of US_AT_LARGE_CONGRESSIONAL_STATES) {
      expect(stateCodes).toContain(code);
    }
  });
});

/**
 * Chambers exist to pick a boundary file, not to describe a legislature. Congress has two chambers
 * and does not need the field, because a Senate seat has no district at all. Only US state
 * legislatures publish two different district maps that nothing else can distinguish.
 */
describe('chamber use', () => {
  it('is required only for US state legislatures', () => {
    const usingChamber = JURISDICTION_IDS.filter((id) => JURISDICTIONS[id].usesChamber);
    expect([...usingChamber]).toEqual(['us_state']);
  });
});

describe('required office fields', () => {
  it('asks for a region everywhere except Canadian federal and other', () => {
    const requiring = JURISDICTION_IDS.filter((id) => JURISDICTIONS[id].requiresRegion);
    expect([...requiring].sort()).toEqual(['ca_municipal', 'ca_provincial', 'us_federal', 'us_local', 'us_state']);
  });

  it('asks for a locality only for the two local jurisdictions', () => {
    const requiring = JURISDICTION_IDS.filter((id) => JURISDICTIONS[id].requiresLocality);
    expect([...requiring].sort()).toEqual(['ca_municipal', 'us_local']);
  });
});

describe('seat label resolution', () => {
  it('falls back to the spec default when there is no override and no regional exception', () => {
    expect(seatLabelFor('ca_federal', null, null)).toBe('Riding');
    expect(seatLabelFor('ca_provincial', 'ON', null)).toBe('Riding');
    expect(seatLabelFor('us_federal', 'OH', null)).toBe('Congressional district');
    expect(seatLabelFor('us_state', 'AZ', null)).toBe('Legislative district');
    expect(seatLabelFor('us_local', 'MA', null)).toBe('Council district');
    expect(seatLabelFor('other', null, null)).toBe('District');
  });

  it('applies every regional exception without anyone configuring it', () => {
    expect(seatLabelFor('ca_provincial', 'AB', null)).toBe('Constituency');
    expect(seatLabelFor('ca_provincial', 'SK', null)).toBe('Constituency');
    expect(seatLabelFor('ca_provincial', 'NL', null)).toBe('District');
    expect(seatLabelFor('ca_provincial', 'PE', null)).toBe('District');
    expect(seatLabelFor('ca_provincial', 'QC', null)).toBe('Circonscription');
    expect(seatLabelFor('ca_municipal', 'QC', null)).toBe('District');
    expect(seatLabelFor('ca_municipal', 'ON', null)).toBe('Ward');
  });

  it('lets an explicit override beat the regional exception and the default', () => {
    expect(seatLabelFor('ca_provincial', 'AB', 'Trustee area')).toBe('Trustee area');
    expect(seatLabelFor('ca_federal', null, '  Circonscription  ')).toBe('Circonscription');
  });

  it('ignores an empty or whitespace override rather than showing a blank word', () => {
    expect(seatLabelFor('ca_provincial', 'AB', '')).toBe('Constituency');
    expect(seatLabelFor('ca_provincial', 'AB', '   ')).toBe('Constituency');
  });

  it('ignores a region code that has no exception', () => {
    expect(seatLabelFor('ca_provincial', 'MB', null)).toBe('Riding');
    expect(seatLabelFor('ca_provincial', 'ZZ', null)).toBe('Riding');
  });

  it('pluralises defaults, exceptions and overrides', () => {
    expect(seatLabelPluralFor('ca_federal', null, null)).toBe('Ridings');
    expect(seatLabelPluralFor('us_federal', 'OH', null)).toBe('Congressional districts');
    expect(seatLabelPluralFor('ca_provincial', 'AB', null)).toBe('Constituencies');
    expect(seatLabelPluralFor('ca_provincial', 'NL', null)).toBe('Districts');
    expect(seatLabelPluralFor('ca_provincial', 'QC', null)).toBe('Circonscriptions');
    expect(seatLabelPluralFor('ca_municipal', 'ON', 'Borough')).toBe('Boroughs');
    expect(seatLabelPluralFor('ca_municipal', 'ON', 'Parish')).toBe('Parishes');
    expect(seatLabelPluralFor('ca_municipal', 'ON', 'Constituency')).toBe('Constituencies');
    expect(seatLabelPluralFor('ca_municipal', 'ON', '')).toBe('Wards');
  });
});

/**
 * Massachusetts is the reason meaning never comes from a word. A Boston ward is a voting
 * subdivision containing precincts, while a Toronto ward is the area that elects a councillor. If a
 * regional seat-label exception for MA ever appears, the product will start treating Boston's
 * voting subdivisions as the areas that elect its councillors — plausible-looking and wrong
 * everywhere. Massachusetts is handled by holding two subdivision boundary sets, never by a label.
 */
describe('the Massachusetts case is handled by data, never by a label', () => {
  it('adds no seat-label exception for Massachusetts anywhere', () => {
    for (const spec of Object.values(JURISDICTIONS)) {
      expect(spec.regionalSeatLabels['MA']).toBeUndefined();
    }
  });

  it('still reads the neutral seat word for a Massachusetts local campaign', () => {
    expect(seatLabelFor('us_local', 'MA', null)).toBe('Council district');
    expect(subdivisionLabelFor('us_local', 'MA')).toBe('Precinct');
  });
});

describe('subdivision label resolution', () => {
  it('uses the spec default outside New York', () => {
    expect(subdivisionLabelFor('ca_federal', null)).toBe('Polling division');
    expect(subdivisionLabelFor('ca_municipal', 'ON')).toBe('Poll');
    expect(subdivisionLabelFor('us_federal', 'OH')).toBe('Precinct');
    expect(subdivisionLabelFor('other', null)).toBe('Subdivision');
  });

  it('says election district in New York at all three US levels', () => {
    expect(subdivisionLabelFor('us_federal', 'NY')).toBe('Election district');
    expect(subdivisionLabelFor('us_state', 'NY')).toBe('Election district');
    expect(subdivisionLabelFor('us_local', 'NY')).toBe('Election district');
  });

  it('pluralises for the grain sentence', () => {
    expect(subdivisionLabelPluralFor('us_federal', 'OH')).toBe('Precincts');
    expect(subdivisionLabelPluralFor('us_federal', 'NY')).toBe('Election districts');
    expect(subdivisionLabelPluralFor('ca_federal', null)).toBe('Polling divisions');
    expect(subdivisionLabelPluralFor('ca_municipal', 'QC')).toBe('Polls');
  });
});

/**
 * US political contributions are not tax-deductible federally, so there is no receipt to issue and
 * nothing to suggest. Returning a Canadian regime for a US campaign would put a Canadian tax-credit
 * receipt in front of a US donor.
 */
describe('receipt regime suggestions', () => {
  it('suggests the federal political regime for a Canadian federal campaign', () => {
    expect(JURISDICTIONS.ca_federal.suggestedReceiptRegime(null)).toBe('political_federal');
  });

  it('suggests the matching provincial regime, and nothing for provinces without one', () => {
    const suggest = JURISDICTIONS.ca_provincial.suggestedReceiptRegime;
    expect(suggest('ON')).toBe('political_on');
    expect(suggest('BC')).toBe('political_bc');
    expect(suggest('AB')).toBe('political_ab');
    expect(suggest('QC')).toBe('political_qc');
    expect(suggest('MB')).toBeNull();
    expect(suggest(null)).toBeNull();
  });

  it('suggests nothing for a Canadian municipal campaign', () => {
    expect(JURISDICTIONS.ca_municipal.suggestedReceiptRegime('ON')).toBeNull();
  });

  it('suggests nothing for every US jurisdiction, at every level', () => {
    for (const id of ['us_federal', 'us_state', 'us_local'] as const) {
      for (const region of [null, 'OH', 'AZ', 'NY', 'MA']) {
        expect(JURISDICTIONS[id].suggestedReceiptRegime(region)).toBeNull();
      }
    }
  });

  it('suggests nothing for an unmodelled race', () => {
    expect(JURISDICTIONS.other.suggestedReceiptRegime(null)).toBeNull();
  });
});

describe('isJurisdictionId', () => {
  it('accepts every registered id', () => {
    for (const id of JURISDICTION_IDS) {
      expect(isJurisdictionId(id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isJurisdictionId('ca_state')).toBe(false);
    expect(isJurisdictionId('')).toBe(false);
    expect(isJurisdictionId(null)).toBe(false);
    expect(isJurisdictionId(undefined)).toBe(false);
    expect(isJurisdictionId(7)).toBe(false);
    expect(isJurisdictionId({ id: 'ca_federal' })).toBe(false);
  });
});

describe('regions', () => {
  it('carries all ten provinces, three territories and fifty states', () => {
    expect(CA_PROVINCES).toHaveLength(13);
    expect(US_STATES).toHaveLength(50);
  });

  it('uses unique two-letter codes', () => {
    for (const list of [CA_PROVINCES, US_STATES]) {
      const codes = list.map((r) => r.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('returns the right list per country and an empty list for the rest', () => {
    expect(regionsForCountry('CA')).toBe(CA_PROVINCES);
    expect(regionsForCountry('US')).toBe(US_STATES);
    expect(regionsForCountry('GB')).toEqual([]);
    expect(regionsForCountry(null)).toEqual([]);
    expect(regionsForCountry(undefined)).toEqual([]);
  });

  /**
   * Every region code a jurisdiction names an exception for must be a real region of that
   * jurisdiction's country, or the exception silently never fires.
   */
  it('keys every regional exception to a real region of that country', () => {
    for (const spec of Object.values(JURISDICTIONS)) {
      const codes = regionsForCountry(spec.country).map((r) => r.code);
      const exceptions = [...Object.keys(spec.regionalSeatLabels), ...Object.keys(spec.regionalSubdivisionLabels)];
      for (const code of exceptions) {
        expect(codes).toContain(code);
      }
    }
  });
});
