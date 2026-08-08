import { describe, expect, it } from 'vitest';

import {
  electoralAreaSuffix,
  readHouseholdAreas,
  readPrimaryElectoralArea,
  seatStatusLabelFor,
  seatStatusShortLabelFor,
} from './household-areas';

/**
 * A household record arrives untyped from the tRPC boundary, so every one of these readers has to
 * cope with a missing field, a null, and a wrong type without throwing. The behaviour that matters
 * to a person is that an address with no boundary shows nothing at all rather than an empty label
 * or a stray separator.
 */
describe('readPrimaryElectoralArea', () => {
  it('reads the area on the campaign’s own map', () => {
    expect(readPrimaryElectoralArea({ electoral_area: 'Ward 4' })).toBe('Ward 4');
  });

  it('returns null for a household that has not been placed on a map', () => {
    expect(readPrimaryElectoralArea({ electoral_area: null })).toBeNull();
    expect(readPrimaryElectoralArea({ electoral_area: '   ' })).toBeNull();
    expect(readPrimaryElectoralArea({})).toBeNull();
    expect(readPrimaryElectoralArea(null)).toBeNull();
  });
});

describe('electoralAreaSuffix', () => {
  it("prepends the campaign's own word when the area name does not already carry it", () => {
    expect(electoralAreaSuffix({ electoral_area: 'Ottawa Centre' }, 'Riding')).toBe('Riding Ottawa Centre');
  });

  it('does not repeat a word the area name already contains', () => {
    expect(electoralAreaSuffix({ electoral_area: 'Ward 4' }, 'Ward')).toBe('Ward 4');
  });

  it('shows the bare area name when the campaign declares no jurisdiction', () => {
    expect(electoralAreaSuffix({ electoral_area: 'Ward 4' }, null)).toBe('Ward 4');
  });

  it('returns null so the caller can drop the separator entirely', () => {
    expect(electoralAreaSuffix({}, 'Ward')).toBeNull();
  });
});

describe('readHouseholdAreas', () => {
  it('returns one entry per boundary, each naming the map it came from', () => {
    const areas = readHouseholdAreas({
      electoral_areas: [
        { set_label: 'Federal ridings', name: 'Ottawa Centre' },
        { set_label: 'Wards', name: 'Ward 14' },
        { set_label: 'Polling divisions', name: '204' },
      ],
    });
    expect(areas).toEqual([
      { setLabel: 'Federal ridings', name: 'Ottawa Centre' },
      { setLabel: 'Wards', name: 'Ward 14' },
      { setLabel: 'Polling divisions', name: '204' },
    ]);
  });

  it('drops entries with no area name rather than rendering a blank row', () => {
    const areas = readHouseholdAreas({
      electoral_areas: [{ set_label: 'Wards', name: '' }, { set_label: 'Wards', name: 'Ward 14' }, 'nonsense'],
    });
    expect(areas).toEqual([{ setLabel: 'Wards', name: 'Ward 14' }]);
  });

  it('falls back to the joined string the grid already reads, which carries no map names', () => {
    const areas = readHouseholdAreas({ any_electoral_area: 'Ottawa Centre · Ward 14' });
    expect(areas).toEqual([
      { setLabel: '', name: 'Ottawa Centre' },
      { setLabel: '', name: 'Ward 14' },
    ]);
  });

  it('returns an empty list for a household with no boundaries at all', () => {
    expect(readHouseholdAreas({ any_electoral_area: null })).toEqual([]);
    expect(readHouseholdAreas({})).toEqual([]);
    expect(readHouseholdAreas(undefined)).toEqual([]);
  });
});

describe('seatStatusShortLabelFor', () => {
  it('gives each of the four statuses a short, grid-sized label', () => {
    expect(seatStatusShortLabelFor('in')).toBe('Yes');
    expect(seatStatusShortLabelFor('other')).toBe('No — another area');
    expect(seatStatusShortLabelFor('outside')).toBe('No — outside the map');
    expect(seatStatusShortLabelFor('unknown')).toBe('Not placed yet');
  });

  it('tells "not checked yet" apart from a blank cell — the two private copies this replaced had no unknown case at all', () => {
    expect(seatStatusShortLabelFor('unknown')).not.toBe('');
  });

  it('renders a missing or unrecognised status as an empty cell rather than throwing', () => {
    expect(seatStatusShortLabelFor(null)).toBe('');
    expect(seatStatusShortLabelFor(undefined)).toBe('');
    expect(seatStatusShortLabelFor('some-future-status')).toBe('');
  });
});

describe('seatStatusLabelFor and seatStatusShortLabelFor', () => {
  it('recognise exactly the same four status values, long-form and short-form', () => {
    for (const status of ['in', 'other', 'outside', 'unknown']) {
      expect(seatStatusLabelFor(status, 'riding')).not.toBeNull();
      expect(seatStatusShortLabelFor(status)).not.toBe('');
    }
  });
});
