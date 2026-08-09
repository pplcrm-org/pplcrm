import { describe, expect, it } from 'vitest';

import type { WalkOrderable } from './walk-order';
import { groupForWalk, orderForWalk, simplifyPath, streetKeyOf, streetNumberValue } from './walk-order';

function door(street: string | null, streetNum: string | null, walkOrder: number): WalkOrderable {
  return { street, street_num: streetNum, walk_order: walkOrder };
}

function nums(group: { doors: WalkOrderable[] }): (string | null)[] {
  return group.doors.map((d) => d.street_num);
}

describe('streetKeyOf', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(streetKeyOf('Alder St')).toBe('alder st');
    expect(streetKeyOf('  alder   ST ')).toBe('alder st');
  });

  it('maps missing streets to the empty key', () => {
    expect(streetKeyOf(null)).toBe('');
    expect(streetKeyOf(undefined)).toBe('');
    expect(streetKeyOf('   ')).toBe('');
  });
});

describe('streetNumberValue', () => {
  it('parses the leading integer', () => {
    expect(streetNumberValue('218')).toBe(218);
    expect(streetNumberValue(' 218A')).toBe(218);
  });

  it('returns null when no leading integer exists', () => {
    expect(streetNumberValue('Rear')).toBe(null);
    expect(streetNumberValue(null)).toBe(null);
    expect(streetNumberValue('')).toBe(null);
  });
});

describe('groupForWalk', () => {
  it('walks up one parity side ascending, then back down the other descending', () => {
    const groups = groupForWalk([
      door('Alder St', '2', 3),
      door('Alder St', '1', 1),
      door('Alder St', '4', 4),
      door('Alder St', '3', 2),
      door('Alder St', '5', 5),
    ]);
    expect(groups).toHaveLength(1);
    // Walk order 1 is number 1 (odd), so odds ascend first, evens return descending.
    expect(nums(groups[0])).toEqual(['1', '3', '5', '4', '2']);
  });

  it('starts on the side of the lowest-walk_order door, even when it is the even side', () => {
    const groups = groupForWalk([
      door('Alder St', '217', 2),
      door('Alder St', '218', 1),
      door('Alder St', '220', 3),
      door('Alder St', '219', 4),
    ]);
    expect(nums(groups[0])).toEqual(['218', '220', '219', '217']);
  });

  it('a single-parity street ascends with no return leg', () => {
    const groups = groupForWalk([door('Bay Rd', '6', 2), door('Bay Rd', '2', 1), door('Bay Rd', '4', 3)]);
    expect(nums(groups[0])).toEqual(['2', '4', '6']);
  });

  it('doors without a numeric house number append at the end of their street in stored order', () => {
    const groups = groupForWalk([
      door('Alder St', 'Rear', 2),
      door('Alder St', '1', 3),
      door('Alder St', null, 1),
      door('Alder St', '3', 4),
    ]);
    expect(nums(groups[0])).toEqual(['1', '3', null, 'Rear']);
  });

  it('a street with no numeric numbers at all keeps stored walk order', () => {
    const groups = groupForWalk([door('Mews Ln', 'B', 2), door('Mews Ln', 'A', 1)]);
    expect(nums(groups[0])).toEqual(['A', 'B']);
  });

  it('orders streets by the lowest stored walk_order, including the no-street bucket', () => {
    const groups = groupForWalk([
      door('Second St', '1', 5),
      door(null, '9', 3),
      door('First St', '1', 1),
      door('Second St', '3', 4),
      door('First St', '3', 2),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['first st', '', 'second st']);
  });

  it('groups spellings of one street together and displays the first spelling seen', () => {
    const groups = groupForWalk([door('Alder  St', '1', 1), door('alder st', '3', 2)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].street).toBe('Alder  St');
    expect(nums(groups[0])).toEqual(['1', '3']);
  });

  it('breaks equal-number ties by stored walk order', () => {
    const groups = groupForWalk([door('Alder St', '5', 2), door('Alder St', '5', 1), door('Alder St', '7', 3)]);
    expect(groups[0].doors.map((d) => d.walk_order)).toEqual([1, 2, 3]);
  });
});

describe('orderForWalk', () => {
  it('flattens the street groups in order', () => {
    const ordered = orderForWalk([
      door('Second St', '2', 3),
      door('First St', '1', 1),
      door('Second St', '4', 4),
      door('First St', '3', 2),
    ]);
    expect(ordered.map((d) => `${d.street} ${d.street_num}`)).toEqual([
      'First St 1',
      'First St 3',
      'Second St 2',
      'Second St 4',
    ]);
  });
});

describe('simplifyPath', () => {
  // ~0.00001° latitude ≈ 1.1 m; the default tolerance is 10 m.
  const base = { lat: 43.7, lng: -79.25 };

  it('returns paths of two or fewer points unchanged', () => {
    expect(simplifyPath([])).toEqual([]);
    expect(simplifyPath([base])).toEqual([base]);
    expect(simplifyPath([base, { lat: 43.71, lng: -79.25 }])).toHaveLength(2);
  });

  it('drops doors sitting on a straight run', () => {
    const straight = Array.from({ length: 40 }, (_, i) => ({ lat: 43.7 + i * 0.0001, lng: -79.25 }));
    const simplified = simplifyPath(straight);
    expect(simplified).toEqual([straight[0], straight[39]]);
  });

  it('keeps a real corner', () => {
    const path = [
      { lat: 43.7, lng: -79.25 },
      { lat: 43.701, lng: -79.25 },
      { lat: 43.701, lng: -79.249 },
    ];
    expect(simplifyPath(path)).toEqual(path);
  });

  it('respects the tolerance: a small jog survives only a small tolerance', () => {
    const path = [
      { lat: 43.7, lng: -79.25 },
      { lat: 43.7005, lng: -79.25005 }, // ~4 m off the straight line
      { lat: 43.701, lng: -79.25 },
    ];
    expect(simplifyPath(path, 10)).toHaveLength(2);
    expect(simplifyPath(path, 1)).toHaveLength(3);
  });

  it('handles a zero-length lookahead segment without dividing by zero', () => {
    const path = [base, { lat: 43.7001, lng: -79.25 }, base];
    expect(simplifyPath(path, 1)).toEqual(path);
  });
});
